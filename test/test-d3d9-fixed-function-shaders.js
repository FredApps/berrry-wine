#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "new_device") (result i32)
    (local $d i32)
    (local.set $d (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
    (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
    (local.get $d))
  (func (export "test_d3d9_set_null_shaders") (param $device i32) (param $pixel i32) (param $shader i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (if (local.get $pixel)
      (then (call $handle_IDirect3DDevice9_SetPixelShader
        (local.get $device) (local.get $shader) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_IDirect3DDevice9_SetVertexShader
        (local.get $device) (local.get $shader) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (i64.or (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_dx_com_thunks();const device=e.new_device();
  for (const pixel of [0, 1]) {
    let result = e.test_d3d9_set_null_shaders(device, pixel, 0);
    assert.strictEqual(Number(result & 0xffffffffn), 0,
      'NULL shader selects the fixed-function pipeline');
    assert.strictEqual(Number(result >> 32n), 0x0030000c,
      'shader setter pops this, shader, and return address');
    result = e.test_d3d9_set_null_shaders(device, pixel, 1);
    assert.strictEqual(Number(result & 0xffffffffn) >>> 0, 0x8876086c,
      'unsupported programmable shader handles are rejected');
    result=e.test_d3d9_set_null_shaders(0,pixel,0);
    assert.strictEqual(Number(result&0xffffffffn)>>>0,0x8876086c,'NULL shader does not validate a NULL device');
  }
  console.log('PASS D3D9 NULL vertex/pixel shaders select fixed-function rendering');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
