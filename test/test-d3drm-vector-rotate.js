#!/usr/bin/env node

'use strict';

// D3DRMVectorRotate(r, v, axis, theta): v rotated by theta radians about
// axis, returned as a unit vector in r (and as the return value).
// Motocross Madness imports it from d3drm.dll and calls it once a race
// starts; without it the run ended at the first frame of gameplay.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: wat } = await bootRenderHarness({ fonts: 'none' });
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const bits = value => { f32[0] = value; return u32[0]; };
  const vec = ([x, y, z]) => {
    const p = wat.guest_alloc(12) >>> 0;
    [x, y, z].forEach((v, i) => {
      const b = bits(v);
      for (let k = 0; k < 4; k++) wat.guest_write8(p + i * 4 + k, (b >>> (k * 8)) & 255);
    });
    return p;
  };
  const read = p => [0, 1, 2].map(i => {
    let b = 0;
    for (let k = 0; k < 4; k++) b |= wat.guest_read8(p + i * 4 + k) << (k * 8);
    u32[0] = b >>> 0;
    return f32[0];
  });
  const near = (got, want, label) => got.forEach((v, i) =>
    assert(Math.abs(v - want[i]) < 1e-5, `${label}: got [${got}] want [${want}]`));

  const rotate = (v, axis, theta) => {
    const r = vec([9, 9, 9]);
    const ret = wat.test_call_D3DRMVectorRotate(r, vec(v), vec(axis), bits(theta)) >>> 0;
    assert.strictEqual(ret, r, 'returns the result pointer');
    return read(r);
  };

  near(rotate([1, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0], 'x about z by +90 degrees');
  near(rotate([0, 1, 0], [1, 0, 0], Math.PI / 2), [0, 0, 1], 'y about x by +90 degrees');
  // The axis is normalized first, and the result is a unit vector.
  near(rotate([2, 0, 0], [0, 0, 5], Math.PI), [-1, 0, 0], 'unnormalized input and axis');
  near(rotate([0, 0, 3], [0, 0, 1], 1.234), [0, 0, 1], 'a vector on the axis is unchanged');
  const s = Math.SQRT1_2;
  near(rotate([1, 0, 0], [0, 1, 0], Math.PI / 4), [s, 0, -s], 'x about y by +45 degrees');
  console.log('test-d3drm-vector-rotate: 5 passed');
})().catch(error => { console.error(error); process.exit(1); });
