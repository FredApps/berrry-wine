#!/usr/bin/env node

// Pin $gdi_raster_stretch_blt's sampling rule:
//
//     dest(x, y) <- source(floor(x*sw/dw), floor(y*sh/dh))
//
// for x = 0..dw-1, y = 0..dh-1, against the inclusive origin and the -1 step
// a negative extent selects.
//
// This exists because that mapping is the thing any optimisation of the blit
// has to preserve, and it is easy to preserve *almost*. The generic path
// currently spends an i32.div_u per pixel per axis to compute it; the obvious
// strength reductions (hoisting the row terms, walking the column index
// incrementally) all reproduce the map only if they handle remainders
// exactly. So the ratios below are chosen to break a sloppy incremental walk:
// non-integer upscales and downscales, exact integer ratios, 1:1 (SimGolf's
// real case, where the whole map is the identity), and mirrored blits where an
// off-by-one in an accumulator would still look plausible.
//
// Both of those reductions are now in the generic path, so this test is what
// stands between them and a silently-wrong picture: remove the remainder carry
// from the column walk and 'upscale 3->7' fails here.

'use strict';

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

(async () => {
  const wasm = compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, renderer: null, resourceJson: {} };
  const imports = createHostImports(ctx);
  Object.assign(imports.host, {
    memory, create_thread: () => 0, exit_thread: () => 0, terminate_thread: () => 0,
    create_event: () => 0, set_event: () => 0, reset_event: () => 0,
    wait_single: () => 0, wait_multiple: () => 0,
    com_create_instance: () => 0x80004002,
  });
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const wat = instance.exports;
  const bytes = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);

  let nextDesc = 0x00100000;
  let nextBits = 0x02000000;

  function surface(width, height, bpp = 24) {
    const desc = nextDesc;
    const bits = nextBits;
    const stride = ((width * bpp + 31) >> 5) << 2;
    nextDesc += 0x100;
    nextBits += stride * height + 0x100;
    dv.setUint32(desc, bits, true);
    dv.setInt32(desc + 4, width, true);
    dv.setInt32(desc + 8, height, true);
    dv.setInt32(desc + 12, stride, true);
    dv.setInt32(desc + 16, bpp, true);
    dv.setInt32(desc + 20, 1, true);
    return { desc, bits, width, height, bpp, stride };
  }

  function at(s, x, y) { return s.bits + y * s.stride + x * (s.bpp >> 3); }

  // Each source pixel carries its own coordinates, so a destination pixel
  // names the source it was sampled from rather than merely differing.
  function paintCoords(s) {
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const p = at(s, x, y);
        bytes[p] = x + 1;
        bytes[p + 1] = y + 1;
        bytes[p + 2] = 0x5A;
      }
    }
  }

  function readCoords(s, x, y) {
    const p = at(s, x, y);
    return { x: bytes[p] - 1, y: bytes[p + 1] - 1, tag: bytes[p + 2] };
  }

  const SRCCOPY = 0x00CC0020;
  let cases = 0;

  // dw/dh may be negative (mirrored destination walk) and sw/sh may be
  // negative (mirrored source walk); the caller passes the inclusive origin.
  function checkMap(label, sw, sh, dw, dh) {
    const swAbs = Math.abs(sw), shAbs = Math.abs(sh);
    const dwAbs = Math.abs(dw), dhAbs = Math.abs(dh);
    const src = surface(swAbs, shAbs);
    const dst = surface(dwAbs, dhAbs);
    paintCoords(src);
    const sx0 = sw < 0 ? swAbs - 1 : 0;
    const sy0 = sh < 0 ? shAbs - 1 : 0;
    const dx0 = dw < 0 ? dwAbs - 1 : 0;
    const dy0 = dh < 0 ? dhAbs - 1 : 0;
    assert.strictEqual(wat.test_gdi_raster_stretch_blt(
      dst.desc, dx0, dy0, dw, dh, src.desc, sx0, sy0, sw, sh, 0, SRCCOPY), 1,
      `${label}: blit reported failure`);
    const xStep = sw < 0 ? -1 : 1;
    const yStep = sh < 0 ? -1 : 1;
    const dxStep = dw < 0 ? -1 : 1;
    const dyStep = dh < 0 ? -1 : 1;
    for (let y = 0; y < dhAbs; y++) {
      for (let x = 0; x < dwAbs; x++) {
        const tx = dx0 + x * dxStep;
        const ty = dy0 + y * dyStep;
        const ux = sx0 + xStep * Math.floor((x * swAbs) / dwAbs);
        const uy = sy0 + yStep * Math.floor((y * shAbs) / dhAbs);
        const got = readCoords(dst, tx, ty);
        assert.strictEqual(got.tag, 0x5A,
          `${label}: dest(${tx},${ty}) was never written`);
        assert.deepStrictEqual({ x: got.x, y: got.y }, { x: ux, y: uy },
          `${label}: dest(${tx},${ty}) sampled the wrong source pixel`);
      }
    }
    cases++;
  }

  // 1:1 -- SimGolf's actual per-frame chain is StretchBlt 800x600 <- 800x600.
  checkMap('identity 8x6', 8, 6, 8, 6);
  checkMap('identity 1x1', 1, 1, 1, 1);
  // Exact integer ratios.
  checkMap('upscale x3', 2, 2, 6, 6);
  checkMap('downscale /3', 6, 6, 2, 2);
  // Non-integer ratios, the ones a naive increment gets wrong.
  checkMap('upscale 3->7', 3, 3, 7, 7);
  checkMap('upscale 5->8', 5, 5, 8, 8);
  checkMap('downscale 7->3', 7, 7, 3, 3);
  checkMap('downscale 8->5', 8, 8, 5, 5);
  checkMap('wide 17->40', 17, 3, 40, 5);
  checkMap('wide 40->17', 40, 5, 17, 3);
  // Axes with different ratios, so a shared accumulator would show up.
  checkMap('mixed 9x4 -> 5x13', 9, 4, 5, 13);
  // Mirrors: step -1 on either side, and both at once.
  checkMap('mirror source x', -6, 4, 9, 4);
  checkMap('mirror dest x', 6, 4, -9, 4);
  checkMap('mirror both axes', -6, -4, -9, -7);

  console.log(`PASS  ${cases} stretch ratios map every destination pixel to floor(x*sw/dw)`);
  console.log('PASS  GDI StretchBlt nearest-neighbour map holds for every ratio tested');
})().catch(err => { console.error(err); process.exit(1); });
