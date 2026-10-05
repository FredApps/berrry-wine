#!/usr/bin/env node
'use strict';

// D3D3 and D3D7 expose the same ComputeSphereVisibility ABI.  The D3D7
// handler deliberately shares the D3D3 implementation; exercise both public
// entry points so that forwarding cannot change flags, HRESULT, or cleanup.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_d3dim_sphere_visibility")
    (param $revision i32) (param $count i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $gs32 (i32.const 0x00300018) (local.get $out))
    (if (i32.eq (local.get $revision) (i32.const 3))
      (then
        (call $handle_IDirect3DDevice3_ComputeSphereVisibility
          (i32.const 0) (i32.const 0) (i32.const 0) (local.get $count)
          (i32.const 0) (i32.const 0)))
      (else
        (call $handle_IDirect3DDevice7_ComputeSphereVisibility
          (i32.const 0) (i32.const 0) (i32.const 0) (local.get $count)
          (i32.const 0) (i32.const 0))))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_d3dim_sphere_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const out = 0x00410000;

  for (const revision of [3, 7]) {
    for (let i = 0; i < 4; i++) wat.guest_write32(out + i * 4, 0xdeadbeef);

    assert.strictEqual(
      wat.test_d3dim_sphere_visibility(revision, 3, out) >>> 0,
      0,
      `D3D${revision} returns D3D_OK`,
    );
    assert.deepStrictEqual(
      [0, 1, 2, 3].map(i => wat.guest_read32(out + i * 4) >>> 0),
      [0, 0, 0, 0xdeadbeef],
      `D3D${revision} writes exactly one visibility flag per sphere`,
    );
    assert.strictEqual(
      wat.test_d3dim_sphere_esp() >>> 0,
      0x0030001c,
      `D3D${revision} pops six arguments and the return address`,
    );

    assert.strictEqual(
      wat.test_d3dim_sphere_visibility(revision, 3, 0) >>> 0,
      0,
      `D3D${revision} preserves the null-output behavior`,
    );
  }

  console.log('PASS D3D3/D3D7 ComputeSphereVisibility share flags, HRESULT, and cleanup');
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
