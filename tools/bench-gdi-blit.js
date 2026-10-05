#!/usr/bin/env node

// Time the WAT GDI rasterizer's blit paths on fixed, deterministic work.
//
// Why this exists: a browser CPU profile of a real app cannot resolve a change
// worth single-digit percent in the rasterizer. Measured 2026-09-13 on
// SimGolf, three runs of ONE unchanged build gave $gdi_raster_stretch_blt
// 6085ms / 7255ms / 7254ms at 18.7 / 12.3 / 13.3 page fps -- a 19% spread in
// the metric and 52% in the frame rate, because the scene, the guest's own
// pacing and the machine's load all move underneath the sample. Fixed work in
// one process removes all three.
//
// This is a MICROBENCHMARK. It prices the blit primitive, not an application.
// Per CLAUDE.md: never quote a microbench % as an app %. To get an app number,
// multiply by the share the profile attributes to these functions.
//
// The arms of a comparison are two BUILDS (the change is compile-time), so run
// it once per tree and compare the printed medians:
//
//   node tools/bench-gdi-blit.js --reps=5
//   bash tools/make-test-worktree.sh /tmp/wt-base HEAD && \
//     (cd /tmp/wt-base && node tools/bench-gdi-blit.js --reps=5)
//
// Shapes cover the cases the code paths actually split on: a 1:1 "stretch"
// (SimGolf's real per-frame chain is StretchBlt 800x600 <- 800x600), a
// non-integer upscale and downscale (where the source-column walk is not
// trivial), and one row per pixel width, because the bulk path picks its
// inner loop by bytes-per-pixel.
//
// The 8bpp row is a CONTROL, not a measurement of the 8bpp bulk path: these
// surfaces carry no colour table, so $gdi_raster_palettes_match declines and
// the blit falls to the generic per-pixel loop. It is here to show that loop
// is unchanged. An 8bpp bulk number needs real palettised bitmaps, which is
// what test/test-wat-gdi-raster.js covers.

'use strict';

const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require(path.join(__dirname, '..', 'test', 'compile-src'));

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const REPS = Number(opt('reps', 5));
const BATCH = Number(opt('batch', 20));
const JSON_OUT = argv.includes('--json');

const SRCCOPY = 0x00CC0020;

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

  function surface(width, height, bpp) {
    const desc = nextDesc;
    const bits = nextBits;
    const stride = ((width * bpp + 31) >> 5) << 2;
    nextDesc += 0x100;
    nextBits += stride * height + 0x1000;
    dv.setUint32(desc, bits, true);
    dv.setInt32(desc + 4, width, true);
    dv.setInt32(desc + 8, height, true);
    dv.setInt32(desc + 12, stride, true);
    dv.setInt32(desc + 16, bpp, true);
    dv.setInt32(desc + 20, 1, true);
    for (let i = 0; i < stride * height; i++) bytes[bits + i] = (i * 7) & 0xff;
    return { desc, width, height, bpp };
  }

  const SHAPES = [
    { name: '1:1 800x600 8bpp (control: generic path)', sw: 800, sh: 600, dw: 800, dh: 600, bpp: 8 },
    { name: '1:1 800x600 16bpp', sw: 800, sh: 600, dw: 800, dh: 600, bpp: 16 },
    { name: '1:1 800x600 24bpp', sw: 800, sh: 600, dw: 800, dh: 600, bpp: 24 },
    { name: '1:1 800x600 32bpp', sw: 800, sh: 600, dw: 800, dh: 600, bpp: 32 },
    { name: 'upscale 517x389->800x600 24bpp', sw: 517, sh: 389, dw: 800, dh: 600, bpp: 24 },
    { name: 'downscale 800x600->517x389 24bpp', sw: 800, sh: 600, dw: 517, dh: 389, bpp: 24 },
  ];

  const results = [];
  for (const shape of SHAPES) {
    const src = surface(shape.sw, shape.sh, shape.bpp);
    const dst = surface(shape.dw, shape.dh, shape.bpp);
    const px = shape.dw * shape.dh;
    // One untimed pass so the JIT has tiered up before the first sample.
    wat.test_gdi_raster_stretch_blt(dst.desc, 0, 0, shape.dw, shape.dh,
      src.desc, 0, 0, shape.sw, shape.sh, 0, SRCCOPY);
    // Time a BATCH per sample, not one blit. A single 800x600 blit is a few
    // tens of ms, which is the same order as one GC pause or another process's
    // spike on a shared box -- measured 2026-09-13, single-blit samples of one
    // unchanged build ranged 27-43ms and could not separate two builds at all.
    // Batching raises the signal above that floor; the reported figure is
    // still per blit.
    const times = [];
    for (let r = 0; r < REPS; r++) {
      const t0 = process.hrtime.bigint();
      for (let b = 0; b < BATCH; b++) {
        const ok = wat.test_gdi_raster_stretch_blt(dst.desc, 0, 0, shape.dw, shape.dh,
          src.desc, 0, 0, shape.sw, shape.sh, 0, SRCCOPY);
        if (!ok) { console.error(`FAIL: ${shape.name} returned 0`); process.exit(1); }
      }
      const t1 = process.hrtime.bigint();
      times.push(Number(t1 - t0) / 1e6 / BATCH);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    results.push({ shape: shape.name, px, medianMs: median,
      minMs: times[0], maxMs: times[times.length - 1],
      mpxPerSec: px / (median / 1000) / 1e6 });
  }

  if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); return; }
  console.log(`GDI blit microbenchmark -- ${REPS} reps x ${BATCH} blits, median per blit`);
  console.log('(a primitive price, NOT an app percentage)\n');
  const w = Math.max(...results.map(r => r.shape.length));
  for (const r of results) {
    console.log(`  ${r.shape.padEnd(w)}  ${r.medianMs.toFixed(2).padStart(8)} ms` +
      `  ${r.mpxPerSec.toFixed(1).padStart(6)} Mpx/s` +
      `   [min ${r.minMs.toFixed(2)} max ${r.maxMs.toFixed(2)}]`);
  }
})().catch(err => { console.error(err); process.exit(1); });
