#!/usr/bin/env node
// Microsoft Video 1 ('CRAM'/'MSVC'/'WHAM'): $vid_cram_decode in
// src/09a7e-video-codecs.wat, reached two ways.
//
// 1. Standalone (tools/avi-player/codecs-wasm.js): hand-built 8 bpp and
//    16 bpp streams covering every block kind — skip (across a row edge and
//    "skip the rest"), one-colour fill, two-colour, eight-colour quadrants —
//    against the pixels the generator itself painted, frame by frame.
// 2. Against ffmpeg, when it is on PATH: those same streams wrapped in AVI
//    files, plus a real ffmpeg-encoded 16 bpp movie, through
//    tools/avi-player/verify.js (bit-exact or fail).
// 3. The ICM front doors in the full emulator: ICOpen by each fourcc,
//    ICLocate by format, ICGetInfo's names, and ICM_DECOMPRESS into a 32 bpp
//    DIB, for both depths.
//
//   node test/test-video-cram.js [--write-avi=DIR]   (DIR keeps the fixtures)
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadNode, decoderKind } = require('../tools/avi-player/codecs-wasm');

const ROOT = path.join(__dirname, '..');
const W = 32, H = 24;                 // 8 x 6 blocks
const BW = W / 4, BH = H / 4, BLOCKS = BW * BH;

// ---- a tiny deterministic PRNG ----
function rng(seed) {
  let s = seed >>> 0;
  return n => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % n; };
}

const expand5 = v => (v << 3) | (v >> 2);
const rgb555 = v => [expand5((v >> 10) & 31), expand5((v >> 5) & 31), expand5(v & 31)];

// Generate `frames` frames. The model: `shown[y*W+x]` holds what each pixel
// displays, as [r,g,b]; the generator writes the stream and paints the model
// from the format description alone (block rows bottom-up, flag bit k = row
// k>>2 from the block's bottom, column k&3; set = first colour of the pair;
// eight-colour pairs are bottom-left, bottom-right, top-left, top-right).
function generate(bpp, frames, seed) {
  const r = rng(seed);
  const palette = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    palette[i * 4] = r(256); palette[i * 4 + 1] = r(256); palette[i * 4 + 2] = r(256);
  }
  const pal = i => [palette[i * 4 + 2], palette[i * 4 + 1], palette[i * 4]];
  const color = v => (bpp === 8 ? pal(v) : rgb555(v));
  const shown = new Array(W * H).fill(null);
  const chunks = [], expected = [];
  const kinds = { skip: 0, fill: 0, two: 0, eight: 0, skipRest: 0 };
  for (let f = 0; f < frames; f++) {
    const out = [];
    const u16 = v => out.push(v & 255, (v >> 8) & 255);
    let block = 0;
    const paint = (bi, pick) => {
      const bx = bi % BW, by = Math.floor(bi / BW), y0 = H - 4 - by * 4;
      for (let k = 0; k < 16; k++) {
        const px = k & 3, py = k >> 2;
        shown[(y0 + 3 - py) * W + bx * 4 + px] = pick(k, px, py);
      }
    };
    while (block < BLOCKS) {
      const left = BLOCKS - block;
      // The first frame paints everything; later ones skip some.
      const roll = f === 0 ? 1 + r(3) : r(8);
      if (f === frames - 1 && left <= 10) {
        out.push(0x00, 0x84); kinds.skipRest++;    // skip count 0: the rest
        break;
      }
      if (roll === 0) {
        // Often long enough to cross into the next block row.
        const n = 1 + r(Math.min(left, BW + 3));
        out.push(n & 255, 0x84 + (n >> 8)); kinds.skip++;
        block += n;
        continue;
      }
      if (roll === 1 || roll >= 5) {
        let flags;
        if (bpp === 16) {
          do { flags = 0x8000 | r(0x8000); } while (((flags >> 8) & 0xFC) === 0x84);
          u16(flags);
          paint(block, () => color(flags));
        } else {
          let b; do { b = 0x80 + r(0x10); } while ((b & 0xFC) === 0x84);
          const a = r(256);
          out.push(a, b);
          paint(block, () => color(a));
        }
        kinds.fill++;
      } else {
        const eight = roll === 3;
        const flags = r(0x10000);
        let c;
        if (bpp === 16) {
          u16(flags & 0x7FFF);
          const fl = flags & 0x7FFF;
          c = [];
          for (let i = 0; i < (eight ? 8 : 2); i++) c.push(r(0x10000));
          c[0] = eight ? c[0] | 0x8000 : c[0] & 0x7FFF;
          c.forEach(u16);
          paint(block, (k, px, py) => {
            const bit = (fl >> k) & 1;
            return color(c[(eight ? (py & 2) * 2 + (px & 2) : 0) + (bit ^ 1)]);
          });
        } else {
          const fl = eight ? (0x9000 | r(0x7000)) : (flags & 0x7FFF);
          u16(fl);
          c = [];
          for (let i = 0; i < (eight ? 8 : 2); i++) c.push(r(256));
          out.push(...c);
          paint(block, (k, px, py) => {
            const bit = (fl >> k) & 1;
            return color(c[(eight ? (py & 2) * 2 + (px & 2) : 0) + (bit ^ 1)]);
          });
        }
        kinds[eight ? 'eight' : 'two']++;
      }
      block++;
    }
    chunks.push(Uint8Array.from(out));
    expected.push(shown.map(p => p.slice()));
  }
  return { bpp, palette, chunks, expected, kinds };
}

// ---- AVI writer: one video stream, idx1, 8 bpp carries its palette ----
function writeAvi(file, { bpp, palette, chunks }) {
  const parts = [];
  const le32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  const chunk = (id, data) => Buffer.concat([Buffer.from(id), le32(data.length), data,
    Buffer.alloc(data.length & 1)]);
  const list = (kind, body) => chunk('LIST', Buffer.concat([Buffer.from(kind), ...body]));
  const avih = Buffer.alloc(56);
  avih.writeUInt32LE(66666, 0); avih.writeUInt32LE(0x10, 12); avih.writeUInt32LE(chunks.length, 16);
  avih.writeUInt32LE(1, 24); avih.writeUInt32LE(W, 32); avih.writeUInt32LE(H, 36);
  const strh = Buffer.alloc(56);
  strh.write('vids', 0); strh.write('CRAM', 4); strh.writeUInt32LE(1, 20); strh.writeUInt32LE(15, 24);
  strh.writeUInt32LE(chunks.length, 32); strh.writeUInt16LE(W, 52); strh.writeUInt16LE(H, 54);
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0); bih.writeInt32LE(W, 4); bih.writeInt32LE(H, 8);
  bih.writeUInt16LE(1, 12); bih.writeUInt16LE(bpp, 14); bih.write('CRAM', 16);
  bih.writeUInt32LE(W * H * bpp / 8, 20);
  if (bpp === 8) bih.writeUInt32LE(256, 32);
  const strf = bpp === 8 ? Buffer.concat([bih, Buffer.from(palette)]) : bih;
  const hdrl = list('hdrl', [chunk('avih', avih), list('strl', [chunk('strh', strh), chunk('strf', strf)])]);
  const idx = [];
  let off = 4;
  const movi = chunks.map(c => {
    const e = Buffer.alloc(16);
    e.write('00dc', 0); e.writeUInt32LE(0x10, 4); e.writeUInt32LE(off, 8); e.writeUInt32LE(c.length, 12);
    idx.push(e);
    const ch = chunk('00dc', Buffer.from(c));
    off += ch.length;
    return ch;
  });
  parts.push(Buffer.from('AVI '), hdrl, list('movi', movi), chunk('idx1', Buffer.concat(idx)));
  fs.writeFileSync(file, chunk('RIFF', Buffer.concat(parts)));
}

function compareFrame(label, got /* BGRX top-down */, exp) {
  for (let i = 0; i < W * H; i++) {
    const o = i * 4, [r, g, b] = exp[i];
    if (got[o + 2] !== r || got[o + 1] !== g || got[o] !== b) {
      assert.fail(`${label}: pixel ${i % W},${Math.floor(i / W)} is ` +
        `${got[o + 2]},${got[o + 1]},${got[o]}, expected ${r},${g},${b}`);
    }
  }
}

const EXTRA_WAT = String.raw`
  (func (export "cram_alloc") (param $n i32) (result i32) (call $heap_alloc (local.get $n)))
  (func $cram_call_setup (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (local.get $saved))
  (func $cram_call_done (param $saved i32) (result i32)
    (local $r i32)
    (local.set $r (i32.load (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (local.get $r))
  (func (export "cram_icopen") (param $type i32) (param $fcc i32) (result i32)
    (local $s i32)
    (local.set $s (call $cram_call_setup))
    (call $handle_ICOpen (local.get $type) (local.get $fcc) (i32.const 2) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $cram_call_done (local.get $s)))
  (func (export "cram_iclocate") (param $bi i32) (param $bo i32) (result i32)
    (local $s i32)
    (local.set $s (call $cram_call_setup))
    (call $handle_ICLocate (i32.const 0x63646976) (i32.const 0) (local.get $bi) (local.get $bo) (i32.const 2) (i32.const 0))
    (call $cram_call_done (local.get $s)))
  (func (export "cram_icgetinfo") (param $hic i32) (param $info i32) (result i32)
    (local $s i32)
    (local.set $s (call $cram_call_setup))
    (call $handle_ICGetInfo (local.get $hic) (local.get $info) (i32.const 568) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $cram_call_done (local.get $s)))
  (func (export "cram_icclose") (param $hic i32) (result i32)
    (local $s i32)
    (local.set $s (call $cram_call_setup))
    (call $handle_ICClose (local.get $hic) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $cram_call_done (local.get $s)))
  (func (export "cram_decompress") (param $hic i32) (param $bi i32) (param $data i32)
                                   (param $bo i32) (param $out i32) (result i32)
    (call $icm_decompress (call $icm_rec_of (local.get $hic)) (i32.const 0)
      (local.get $bi) (local.get $data) (local.get $bo) (local.get $out)))
`;

const fcc = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

async function icmPath(streams) {
  const { bootRenderHarness } = require('./render-helper');
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const mem = () => new Uint8Array(memory.buffer);
  const dv = () => new DataView(memory.buffer);
  const vidc = fcc('vidc');

  for (const name of ['CRAM', 'msvc', 'WHAM', 'Msvc']) {
    const hic = e.cram_icopen(vidc, fcc(name)) >>> 0;
    assert(hic, `ICOpen('vidc', '${name}') opens MS Video 1`);
    const info = e.cram_alloc(568);
    assert.strictEqual(e.cram_icgetinfo(hic, info), 568, `ICGetInfo on the '${name}' handle`);
    const wa = e.guest_to_wasm(info);
    const wstr = at => { let s = ''; for (let i = 0; ; i += 2) { const c = dv().getUint16(wa + at + i, true); if (!c) return s; s += String.fromCharCode(c); } };
    assert.strictEqual(dv().getUint32(wa + 8, true), fcc('CRAM'), 'ICINFO fccHandler is CRAM');
    assert.strictEqual(wstr(24), 'MS-CRAM');
    assert.strictEqual(wstr(56), 'Microsoft Video 1');
    assert.strictEqual(wstr(312), 'msvidc32.dll');
    assert.strictEqual(e.cram_icclose(hic), 0);
  }

  for (const s of streams) {
    // Input format: BITMAPINFOHEADER + palette for 8 bpp; biSizeImage 0 so
    // the ICM layer has to size the chunk itself.
    const bi = e.cram_alloc(40 + 1024);
    const biw = e.guest_to_wasm(bi);
    mem().fill(0, biw, biw + 1064);
    dv().setUint32(biw, 40, true); dv().setInt32(biw + 4, W, true); dv().setInt32(biw + 8, H, true);
    dv().setUint16(biw + 12, 1, true); dv().setUint16(biw + 14, s.bpp, true);
    dv().setUint32(biw + 16, fcc('CRAM'), true);
    if (s.bpp === 8) { dv().setUint32(biw + 32, 256, true); mem().set(s.palette, biw + 40); }
    const bo = e.cram_alloc(40);
    const bow = e.guest_to_wasm(bo);
    mem().fill(0, bow, bow + 40);
    dv().setUint32(bow, 40, true); dv().setInt32(bow + 4, W, true); dv().setInt32(bow + 8, H, true);
    dv().setUint16(bow + 12, 1, true); dv().setUint16(bow + 14, 32, true);
    dv().setUint32(bow + 20, W * H * 4, true);

    const hic = e.cram_iclocate(bi, bo) >>> 0;
    assert(hic, `ICLocate finds a decompressor for ${s.bpp} bpp CRAM -> 32 bpp`);
    const out = e.cram_alloc(W * H * 4);
    const data = e.cram_alloc(4096);
    s.chunks.forEach((c, f) => {
      mem().set(c, e.guest_to_wasm(data));
      assert.strictEqual(e.cram_decompress(hic, bi, data, bo, out), 0, `ICM_DECOMPRESS frame ${f}`);
      // Bottom-up 32 bpp DIB -> top-down BGRX for the comparison.
      const ow = e.guest_to_wasm(out), m = mem(), got = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) got.set(m.subarray(ow + (H - 1 - y) * W * 4, ow + (H - y) * W * 4), y * W * 4);
      compareFrame(`ICM ${s.bpp} bpp frame ${f}`, got, s.expected[f]);
    });
    assert.strictEqual(e.cram_icclose(hic), 0);
    console.log(`PASS: ICM path, ${s.bpp} bpp, ${s.chunks.length} frames through ICLocate + ICM_DECOMPRESS`);
  }

  // Only 8 and 16 bpp exist: a 24 bpp CRAM format finds no decompressor.
  const bad = e.cram_alloc(40);
  const bw = e.guest_to_wasm(bad);
  mem().fill(0, bw, bw + 40);
  dv().setUint32(bw, 40, true); dv().setInt32(bw + 4, W, true); dv().setInt32(bw + 8, H, true);
  dv().setUint16(bw + 12, 1, true); dv().setUint16(bw + 14, 24, true); dv().setUint32(bw + 16, fcc('CRAM'), true);
  assert.strictEqual(e.cram_iclocate(bad, 0), 0, 'ICLocate declines 24 bpp CRAM');
  console.log('PASS: ICM fourccs, ICGetInfo names, 24 bpp declined');
}

(async () => {
  const writeArg = process.argv.find(a => a.startsWith('--write-avi='));
  const s8 = generate(8, 12, 0xC0FFEE);
  const s16 = generate(16, 12, 0xBADC0DE);
  for (const s of [s8, s16]) {
    for (const k of ['skip', 'fill', 'two', 'eight', 'skipRest']) assert(s.kinds[k] > 0, `${s.bpp} bpp stream has ${k} blocks`);
  }

  // 1. standalone module
  const codecs = await loadNode();
  for (const s of [s8, s16]) {
    const bi = { width: W, height: H, bitCount: s.bpp, compression: fcc('CRAM'), compressionFcc: 'CRAM',
      palette: s.bpp === 8 ? s.palette : null };
    const { decoder, name } = await codecs.createDecoder(bi);
    assert(decoder, `standalone module decodes ${s.bpp} bpp CRAM`);
    s.chunks.forEach((c, f) => { decoder.decode(c); compareFrame(`${name} frame ${f}`, decoder.frame, s.expected[f]); });
    console.log(`PASS: standalone ${name}, ${s.chunks.length} frames match the model ` +
      `(${Object.entries(s.kinds).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  }
  for (const f of ['msvc', 'WHAM']) {
    assert.strictEqual(decoderKind({ compression: fcc(f), compressionFcc: f, bitCount: 16 }).kind, 'cram');
  }
  assert.strictEqual(decoderKind({ compression: fcc('CRAM'), compressionFcc: 'CRAM', bitCount: 24 }).kind, null);

  // 2. against ffmpeg
  const dir = writeArg ? writeArg.split('=')[1] : fs.mkdtempSync(path.join(os.tmpdir(), 'cram-'));
  fs.mkdirSync(dir, { recursive: true });
  const ff = spawnSync('ffmpeg', ['-version'], { timeout: 10000 });
  if (ff.status !== 0) {
    console.log('SKIP: ffmpeg not on PATH, no reference comparison');
  } else {
    const files = [path.join(dir, 'cram8-hand.avi'), path.join(dir, 'cram16-hand.avi'), path.join(dir, 'cram16-testsrc.avi')];
    writeAvi(files[0], s8);
    writeAvi(files[1], s16);
    const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15',
      '-t', '2', '-c:v', 'msvideo1', files[2]], { timeout: 60000 });
    assert.strictEqual(enc.status, 0, 'ffmpeg encodes a msvideo1 movie: ' + enc.stderr);
    const v = spawnSync(process.execPath, [path.join(ROOT, 'tools/avi-player/verify.js'), ...files, '--frames=100'],
      { timeout: 120000, encoding: 'utf8' });
    process.stdout.write(v.stdout); process.stderr.write(v.stderr);
    assert.strictEqual(v.status, 0, 'verify.js: every CRAM frame bit-exact against ffmpeg');
  }
  if (!writeArg) fs.rmSync(dir, { recursive: true, force: true });

  // 3. ICM front doors in the full emulator
  await icmPath([s8, s16]);
  console.log('PASS: test-video-cram');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
