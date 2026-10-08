#!/usr/bin/env node
'use strict';

// IDirectDrawSurface::GetColorKey on a surface with no key set fails with
// DDERR_NOCOLORKEY. Daytona USA Deluxe tolerates exactly that code for its
// unkeyed sprites and treats any other failure as fatal; we used to answer
// DDERR_NOCLIPPERATTACHED.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DDERR_NOCOLORKEY = 0x887600d7;
const DDCKEY_SRCBLT = 0x8;

const extraWat = String.raw`
  (func (export "test_ck_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))
  (func (export "test_ck_create") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ck_get") (param $surface i32) (param $flags i32) (param $key i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_GetColorKey
      (local.get $surface) (local.get $flags) (local.get $key) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ck_set") (param $surface i32) (param $flags i32) (param $key i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_SetColorKey
      (local.get $surface) (local.get $flags) (local.get $key) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ck_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });
  const desc = 0x410000, out = 0x410100, key = 0x410200;
  wat.test_ck_seed(0x51000000, 0x52000000);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 0x7);       // DDSD_CAPS|HEIGHT|WIDTH
  wat.guest_write32(desc + 8, 8);
  wat.guest_write32(desc + 12, 8);
  wat.guest_write32(desc + 104, 0x40);    // DDSCAPS_OFFSCREENPLAIN
  assert.strictEqual(wat.test_ck_create(desc, out) >>> 0, 0);
  const surface = wat.guest_read32(out) >>> 0;
  assert(surface, 'offscreen surface should be published');

  assert.strictEqual(wat.test_ck_get(surface, DDCKEY_SRCBLT, key) >>> 0, DDERR_NOCOLORKEY,
    'an unkeyed surface answers DDERR_NOCOLORKEY');
  assert.strictEqual(wat.test_ck_esp() >>> 0, 0x30010, 'GetColorKey pops three stdcall arguments');

  wat.guest_write32(key, 0xf8);
  wat.guest_write32(key + 4, 0xf8);
  assert.strictEqual(wat.test_ck_set(surface, DDCKEY_SRCBLT, key) >>> 0, 0);
  wat.guest_write32(key, 0);
  wat.guest_write32(key + 4, 0);
  assert.strictEqual(wat.test_ck_get(surface, DDCKEY_SRCBLT, key) >>> 0, 0,
    'a keyed surface answers DD_OK');
  assert.strictEqual(wat.guest_read32(key) >>> 0, 0xf8, 'and the key it was given');
  console.log('PASS  GetColorKey answers DDERR_NOCOLORKEY until a key is set');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
