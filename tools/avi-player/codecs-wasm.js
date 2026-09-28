// The emulator's own video decoders, compiled standalone.
//
// src/09a7e-video-codecs.wat is pure — every parameter is a WASM address and
// it touches no globals or imports — so it compiles on its own inside a
// one-memory module. This file does that wrap and drives the result, so
// verify.js (Node, against ffmpeg) and index.html (browser) run exactly the
// WAT that ships in build/wine-assembly.wasm, not a copy of it.
//
//   Node:     const codecs = await require('./codecs-wasm').loadNode();
//   Browser:  load tools/watx-src/compiler-{parser,stages,codegen}.js and
//             compiler.js, then  await VideoCodecs.loadBrowser('../../src/...');
//
//   const { decoder, name, reason } = codecs.createDecoder(bitmapInfo);
//   decoder.decode(chunkBytes);           // updates the retained frame
//   decoder.paletteChange(pcChunkBytes);  // '##pc'
//   decoder.frame                         // Uint8Array, w*h*4, B G R 0, top-down
//   decoder.toRgba(imageData.data)        // for a canvas
(function (root) {
  'use strict';

  const FRAGMENT = 'src/09a7e-video-codecs.wat';
  const EXPORTS = ['vid_cvid_decode', 'vid_rle8_decode', 'vid_index_to_bgrx',
    'vid_raw_decode', 'vid_palette_change'];
  const CVID_STATE_SIZE = 64 + 32 * 8192;   // $VID_CVID_STATE_SIZE

  // WATX emits inline exports only, so each entry point gets one spliced into
  // its own (func ...) header.
  function wrapSource(fragment) {
    let src = fragment;
    for (const n of EXPORTS) {
      const head = `(func $${n} `;
      if (src.split(head).length !== 2) throw new Error(`${FRAGMENT}: expected one ${head.trim()}`);
      src = src.replace(head, `${head}(export "${n}") `);
    }
    // Top-level fields, no (module ...) wrapper — the shape src/main.watx has.
    return '(memory 1)\n(export "memory" (memory 0))\n' + src + '\n';
  }

  const OPTIONS = { mode: 'production', standardWat: true, runtimeBuiltins: false,
    tailCalls: false, strictDeclarations: true };

  function compileWith(compile, fragment) {
    const r = compile(wrapSource(fragment), new Map(), OPTIONS);
    if (!r || !r.success || !r.wasmBinary) {
      throw new Error('WATX compile of ' + FRAGMENT + ' failed: ' +
        String((r && (r.error || r.message)) || 'no binary'));
    }
    // Async on purpose: Chrome refuses a synchronous compile or instantiate
    // of a module over 4 KB on the main thread.
    return WebAssembly.compile(r.wasmBinary);
  }

  // Memory per decoder instance:
  //   0x0000 palette (256 RGBQUAD)   0x1000 Cinepak state   then index plane,
  //   frame, and a source buffer that grows to the largest chunk seen.
  function Decoder(instance, kind, bi) {
    this.kind = kind; this.bi = bi;
    this.width = bi.width; this.height = Math.abs(bi.height);
    const px = this.width * this.height;
    this.inst = instance;
    this.x = this.inst.exports;
    this.pal = 0;
    this.state = 0x1000;
    this.plane = this.state + CVID_STATE_SIZE;
    this.frameAt = (this.plane + px + 15) & ~15;
    this.src = this.frameAt + px * 4;
    this.srcCap = 0;
    this.ensure(64 * 1024);
    const mem = new Uint8Array(this.x.memory.buffer);
    if (bi.palette) mem.set(bi.palette, this.pal);
  }
  Decoder.prototype.ensure = function (n) {
    if (n <= this.srcCap) return;
    const need = this.src + n, have = this.x.memory.buffer.byteLength;
    if (need > have) this.x.memory.grow(Math.ceil((need - have) / 65536));
    this.srcCap = n;
    this.frame = new Uint8Array(this.x.memory.buffer, this.frameAt, this.width * this.height * 4);
  };
  Decoder.prototype.load = function (d) {
    this.ensure(d.length);
    new Uint8Array(this.x.memory.buffer).set(d, this.src);
  };
  Decoder.prototype.decode = function (d) {
    const { x, width: w, height: h } = this;
    this.load(d);
    if (this.kind === 'cvid') {
      x.vid_cvid_decode(this.state, this.src, d.length, this.frameAt, w, h);
    } else if (this.kind === 'rle8') {
      x.vid_rle8_decode(this.plane, this.src, d.length, w, h);
      this.paint();
    } else {
      x.vid_raw_decode(this.src, d.length, this.pal, this.bi.bitCount, w, h,
        this.bi.height < 0 ? 1 : 0, this.frameAt);
    }
  };
  // RLE8 keeps indices, so a palette change repaints without new data.
  Decoder.prototype.paint = function () {
    this.x.vid_index_to_bgrx(this.plane, this.pal, this.frameAt, this.width * this.height);
  };
  Decoder.prototype.paletteChange = function (d) {
    this.load(d);
    this.x.vid_palette_change(this.pal, this.src, d.length);
    if (this.kind === 'rle8') this.paint();
  };
  Decoder.prototype.toRgba = function (out) {
    const f = this.frame;
    for (let i = 0; i < f.length; i += 4) {
      out[i] = f[i + 2]; out[i + 1] = f[i + 1]; out[i + 2] = f[i]; out[i + 3] = 255;
    }
    return out;
  };

  // Which decoder a stream needs. Mirrors ICLocate: a format nothing here
  // claims gets null plus a reason, never a guess.
  function Codecs(module) { this.module = module; }
  Codecs.prototype.createDecoder = async function (bi) {
    const c = bi.compression, f = (bi.compressionFcc || '').toLowerCase();
    const make = async (kind, name) =>
      ({ decoder: new Decoder(await WebAssembly.instantiate(this.module, {}), kind, bi), name });
    if (c === 0 && [8, 16, 24, 32].includes(bi.bitCount)) return make('raw', `uncompressed ${bi.bitCount}bpp`);
    if (c === 1 && bi.bitCount === 8) return make('rle8', 'RLE8');
    if (f === 'cvid' && bi.bitCount !== 8) return make('cvid', 'Cinepak');
    return { decoder: null, name: c < 16 ? `BI ${c}` : bi.compressionFcc,
      reason: {
        iv41: 'Indeo 4 — no decoder yet',
        iv32: 'Indeo 3 — no decoder yet',
        iv50: 'Indeo 5 — no decoder yet',
        cram: 'MS Video 1 — no decoder yet',
        msvc: 'MS Video 1 — no decoder yet',
      }[f] || 'no decoder for this format' };
  };

  function loadNode() {
    const path = require('path'), fs = require('fs');
    const repo = path.join(__dirname, '..', '..');
    const { compile, sourceTextFromBytes } = require(path.join(repo, 'tools', 'watx.js'));
    const text = sourceTextFromBytes(fs.readFileSync(path.join(repo, FRAGMENT)));
    return compileWith(compile, text).then(m => new Codecs(m));
  }

  async function loadBrowser(url) {
    if (typeof root.compile !== 'function') throw new Error('WATX compiler scripts not loaded');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new Codecs(await compileWith(root.compile, await res.text()));
  }

  const api = { wrapSource, loadNode, loadBrowser, FRAGMENT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoCodecs = api;
})(typeof self !== 'undefined' ? self : this);
