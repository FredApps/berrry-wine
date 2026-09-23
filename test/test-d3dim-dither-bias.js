#!/usr/bin/env node
'use strict';

// D3DRENDERSTATE_DITHERENABLE's RGB565 quantizer must be unbiased, and must
// leave a colour that is already exactly representable in 565 unchanged.
//
// MW3 draws its near terrain in three passes: MODULATE(texture, diffuse), then
// two ZERO/SRCCOLOR framebuffer multiplies (a light map, then an all-white
// no-op). Each multiply reads the 565 destination back and packs it again.
// The dither used to add a threshold centred on zero before truncating, which
// is half a step dark on average, so a multiply by white still took half the
// pixels one 565 step down -- per pass. Dark brown terrain (blue only two
// steps above zero) came out olive with no blue at all, while the WebGL arm,
// which blends in float, kept it brown.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dither_pack565") (param $color i32) (param $x i32) (param $y i32) (result i32)
    (call $d3dim_pack_rgb565 (local.get $color) (local.get $x) (local.get $y)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const pack = (c, x, y) => wat.test_dither_pack565(c, x, y) & 0xffff;

  // The blend's destination read expands 565 as v << 3 / v << 2 with no
  // low-bit replication, so these are exactly the values a read-modify-write
  // pass multiplies by 1.0 and writes back.
  let drift = 0;
  for (let px = 0; px < 0x10000; px++) {
    const r = ((px >> 11) & 31) << 3, g = ((px >> 5) & 63) << 2, b = (px & 31) << 3;
    const argb = 0xff000000 | (r << 16) | (g << 8) | b;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (pack(argb, x, y) !== px) drift++;
    }
  }
  assert.strictEqual(drift, 0,
    `dithering moved ${drift} exactly-representable 565 pixels (a ZERO/SRCCOLOR pass by white darkens)`);

  // Averaged over the 4x4 Bayer cell, the quantized value must equal the
  // input: ordered dithering spreads the error, it must not shift the mean.
  for (let v = 0; v <= 248; v++) {
    let rs = 0, gs = 0, bs = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const p = pack(0xff000000 | (v << 16) | (Math.min(v, 252) << 8) | v, x, y);
      rs += ((p >> 11) & 31) << 3;
      gs += ((p >> 5) & 63) << 2;
      bs += (p & 31) << 3;
    }
    assert(Math.abs(rs / 16 - v) < 0.5, `red ${v} dithers to mean ${rs / 16}`);
    assert(Math.abs(bs / 16 - v) < 0.5, `blue ${v} dithers to mean ${bs / 16}`);
    assert(Math.abs(gs / 16 - Math.min(v, 252)) < 0.5, `green ${v} dithers to mean ${gs / 16}`);
  }

  // Dithering must still actually dither: a mid-bucket value spreads across
  // two adjacent levels instead of truncating uniformly.
  const spread = new Set();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) spread.add(pack(0xff242424, x, y));
  assert(spread.size > 1, 'DITHERENABLE produced a single level for a mid-bucket colour');

  console.log('PASS D3DIM RGB565 dither is unbiased and keeps exactly-representable pixels exact');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
