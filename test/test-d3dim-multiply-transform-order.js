#!/usr/bin/env node
'use strict';

// MultiplyTransform appends its matrix on the LEFT of the one already stored.
//
// D3D transforms row vectors (v * World * View * Proj), so the leftmost factor
// is the one applied to the vertex first. OpenGL's glMultMatrix post-multiplies
// a column-vector matrix, and the two conventions are transposes of each other:
// (M * A)^T = A^T * M^T. A GL matrix stack emulated over MultiplyTransform
// therefore needs the supplied matrix pre-multiplied, and a wrapper feeding its
// raw GL arrays straight to SetTransform is already correct for the same reason.
//
// Half-Life's D3D renderer is exactly that wrapper. It drives this entry point
// 74 times a frame with Quake's R_SetupGL sequence -- rotate -90 about x,
// rotate 90 about z, roll, pitch, yaw, then translate by -vieworg -- and never
// calls SetTransform for the world at all. With the operands the other way
// round the accumulated product came out reversed, which is not a malformed
// matrix but a *valid camera rolled 180 degrees*: the world rendered upside
// down and 130 of 178 transformed vertices landed behind the eye. The tell is
// in the composite's translation row. Under the correct order the translate is
// leftmost, so the rotations that follow it rotate its offset; under the
// reversed order the translate is last and its operand survives verbatim.
//
// The two matrices below are that first rotate and that translate. They do not
// commute, so asserting the product also excludes the reversed one.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (func (export "mtx_create_device") (result i32)
    (local $obj i32) (local $entry i32) (local $state i32)
    (local.set $obj
      (call $dx_create_com_obj (i32.const 20) (i32.const 0x53000000)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (local.set $state (call $heap_alloc (i32.const 4096)))
    (call $d3ddev_init_state (local.get $state))
    (i32.store offset=16 (local.get $entry) (local.get $state))
    (local.get $obj))

  (func (export "mtx_call")
      (param $api i32) (param $device i32) (param $type i32)
      (param $matrix i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $dispatch_api_table
      (local.get $api) (local.get $device) (local.get $type)
      (local.get $matrix) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

function api(name) {
  const entry = apiTable.find(candidate => candidate.name === name);
  assert(entry, `${name} remains registered`);
  return entry;
}

// out[i][j] = sum_k a[i][k] * b[k][j], on flat row-major 16-float arrays --
// the same convention $mat4_mul implements.
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[i * 4 + k] * b[k * 4 + j];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

// glRotatef(-90, 1, 0, 0) -- Quake's "put Z going up".
const ROTATE = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
];
// glTranslatef(-vieworg) for one real Uplink camera position.
const TRANSLATE = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  2047.96875, -744.03125, -64.03125, 1,
];
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const D3DTRANSFORMSTATE_WORLD = 1;

(async () => {
  const setTransform = api('IDirect3DDevice3_SetTransform');
  const getTransform = api('IDirect3DDevice3_GetTransform');
  const multiply = api('IDirect3DDevice3_MultiplyTransform');

  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const device = wat.mtx_create_device() >>> 0;
  assert(device, 'created a state-backed legacy Direct3D device');

  const input = 0x00310000;
  const output = 0x00310100;

  const writeMatrix = (addr, matrix) => {
    const scratch = new DataView(new ArrayBuffer(4));
    for (let word = 0; word < 16; word++) {
      scratch.setFloat32(0, matrix[word], true);
      wat.guest_write32(addr + word * 4, scratch.getUint32(0, true));
    }
  };
  const readMatrix = (addr) => {
    const scratch = new DataView(new ArrayBuffer(4));
    const out = [];
    for (let word = 0; word < 16; word++) {
      scratch.setUint32(0, wat.guest_read32(addr + word * 4) >>> 0, true);
      out.push(scratch.getFloat32(0, true));
    }
    return out;
  };
  const call = (entry, matrix) => {
    if (matrix) writeMatrix(input, matrix);
    assert.strictEqual(
      wat.mtx_call(entry.id, device, D3DTRANSFORMSTATE_WORLD,
        matrix ? input : output) >>> 0,
      0, `${entry.name} returns D3D_OK`);
  };

  // GL order: the rotate is issued first, the translate second.
  call(setTransform, IDENTITY);
  call(multiply, ROTATE);
  call(multiply, TRANSLATE);
  call(getTransform, null);

  const expected = mul(TRANSLATE, ROTATE);
  const got = readMatrix(output);
  got.forEach((value, word) => {
    assert.ok(Math.abs(value - expected[word]) < 1e-4,
      `world[${word}] is ${value}, expected ${expected[word]}`
      + ' (supplied matrix multiplies on the left)');
  });

  // The regression made visible: reversed, the translate operand reaches the
  // stored matrix untouched. Correct, the preceding rotate turns it.
  const reversed = mul(ROTATE, TRANSLATE);
  assert.deepStrictEqual(reversed.slice(12, 15), TRANSLATE.slice(12, 15),
    'the reversed product would pass the translate through verbatim');
  assert.notDeepStrictEqual(expected.slice(12, 15), TRANSLATE.slice(12, 15),
    'the correct product rotates the translate, so the two orders differ');
  assert.deepStrictEqual(got.slice(12, 15).map(v => Math.round(v * 1000) / 1000),
    [2047.969, -64.031, 744.031],
    'the stored translation row is the rotated view origin');

  // A single MultiplyTransform over identity is order-independent, so it must
  // still round-trip -- this is the case any fix has to leave alone.
  call(setTransform, IDENTITY);
  call(multiply, TRANSLATE);
  call(getTransform, null);
  assert.deepStrictEqual(readMatrix(output), TRANSLATE,
    'multiplying into an identity world stores the supplied matrix as-is');

  // Quake's whole R_SetupGL sequence, with a camera that is not level.
  //
  // This exists because the first confirmation of the fix was made against a
  // frame whose pitch and roll were exactly zero, and a yaw-only camera is the
  // weakest possible test of a matrix ORDER: with the two middle rotations
  // identity there are fewer non-commuting pairs left to disagree about. Roll
  // and pitch both turn about axes the following yaw also turns about, so they
  // are where the two orders come apart. The assertion below is that the device
  // reproduces the hand-computed left-appending product for the full sequence,
  // and that the reversed product's rotation block genuinely differs from it --
  // so this sequence discriminates the orders rather than merely passing.
  const rad = deg => deg * Math.PI / 180;
  // glRotatef arrays, read row-major exactly as the guest hands them over.
  const rotX = (deg) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  };
  const rotY = (deg) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  };
  const rotZ = (deg) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  };
  const pitch = 23.5, yaw = 137.25, roll = 11.75;
  const sequence = [
    rotX(-90),          // put Z going up
    rotZ(90),
    rotX(-roll),
    rotY(-pitch),
    rotZ(-yaw),
    TRANSLATE,
  ];

  call(setTransform, IDENTITY);
  for (const matrix of sequence) call(multiply, matrix);
  call(getTransform, null);

  // Each call appends on the left, so the composite is the reverse product.
  let composite = IDENTITY;
  for (const matrix of sequence) composite = mul(matrix, composite);
  const live = readMatrix(output);
  live.forEach((value, word) => {
    assert.ok(Math.abs(value - composite[word]) < 1e-3,
      `R_SetupGL composite word ${word} is ${value},`
      + ` expected ${composite[word]}`);
  });

  let backwards = IDENTITY;
  for (const matrix of sequence) backwards = mul(backwards, matrix);
  const rotationBlock = m => [0, 1, 2, 4, 5, 6, 8, 9, 10].map(w => m[w]);
  const spread = Math.max(...rotationBlock(composite)
    .map((value, i) => Math.abs(value - rotationBlock(backwards)[i])));
  assert.ok(spread > 0.5,
    'a pitched and rolled camera makes the two orders disagree by'
    + ` more than rounding (worst rotation-element delta ${spread})`);

  // The composite is a rigid rotation either way -- det +1, orthonormal rows --
  // which is exactly why the reversed one never looked broken. Assert it here
  // so nobody re-derives "the matrix is malformed" from a bad frame.
  const rows = [0, 1, 2].map(r => [0, 1, 2].map(c => composite[r * 4 + c]));
  rows.forEach((row, r) => assert.ok(
    Math.abs(Math.hypot(...row) - 1) < 1e-4,
    `composite rotation row ${r} stays unit length`));

  console.log('PASS  Direct3D MultiplyTransform pre-multiplies the supplied matrix');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
