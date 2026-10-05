#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create_clipper") (result i32)
    (call $init_dx_com_thunks)
    (call $dx_create_com_obj (i32.const 10) (global.get $DX_VTBL_DDCLIP)))
  (func (export "test_create_non_clipper") (result i32)
    (call $dx_create_com_obj (i32.const 3) (global.get $DX_VTBL_DDCLIP)))
  (func (export "test_alloc") (param $bytes i32) (result i32)
    (call $heap_alloc (local.get $bytes)))
  (func (export "test_peek32") (param $ptr i32) (result i32)
    (call $gl32 (local.get $ptr)))
  (func (export "test_poke32") (param $ptr i32) (param $value i32)
    (call $gs32 (local.get $ptr) (local.get $value)))
  (func (export "test_get_hwnd") (param $clipper i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_GetHWnd
      (local.get $clipper) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_set_hwnd")
      (param $clipper i32) (param $flags i32) (param $hwnd i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_SetHWnd
      (local.get $clipper) (local.get $flags) (local.get $hwnd)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const DD_OK = 0;
  const DDERR_INVALIDPARAMS = 0x80070057 | 0;
  const DDERR_INVALIDOBJECT = 0x88760082 | 0;
  const DESKTOP_HWND = 0x10000;
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const clipper = e.test_create_clipper() >>> 0;
  const out = e.test_alloc(4) >>> 0;
  assert.notStrictEqual(clipper, 0, 'a DirectDraw clipper object was allocated');

  e.test_poke32(out, 0x7f7f7f7f);
  assert.strictEqual(e.test_get_hwnd(clipper, out), DD_OK,
    'a fresh clipper has a readable window association');
  assert.strictEqual(e.test_peek32(out), 0,
    'a fresh clipper is not silently associated with the process main window');
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
    'GetHWnd pops this and its output argument');

  assert.strictEqual(e.test_set_hwnd(clipper, 0, DESKTOP_HWND), DD_OK,
    'SetHWnd accepts a real window and the required zero flags');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300010,
    'SetHWnd pops this and its two arguments');
  e.test_poke32(out, 0x7f7f7f7f);
  assert.strictEqual(e.test_get_hwnd(clipper, out), DD_OK);
  assert.strictEqual(e.test_peek32(out), DESKTOP_HWND,
    'GetHWnd returns the exact window retained by SetHWnd');

  assert.strictEqual(e.test_set_hwnd(clipper, 1, DESKTOP_HWND), DDERR_INVALIDPARAMS,
    'reserved nonzero SetHWnd flags are rejected');
  assert.strictEqual(e.test_set_hwnd(clipper, 0, 0x7777), DDERR_INVALIDPARAMS,
    'a fabricated window cannot become a clip source');
  assert.strictEqual(e.test_get_hwnd(clipper, out), DD_OK);
  assert.strictEqual(e.test_peek32(out), DESKTOP_HWND,
    'failed SetHWnd calls preserve the prior association');

  assert.strictEqual(e.test_get_hwnd(clipper, 0), DDERR_INVALIDPARAMS,
    'GetHWnd rejects a null output pointer instead of claiming success');

  const nonClipper = e.test_create_non_clipper() >>> 0;
  e.test_poke32(out, 0x55aa55aa);
  assert.strictEqual(
    e.test_set_hwnd(nonClipper, 0, DESKTOP_HWND), DDERR_INVALIDOBJECT,
    'SetHWnd rejects a different DirectDraw object type');
  assert.strictEqual(e.test_get_hwnd(nonClipper, out), DDERR_INVALIDOBJECT,
    'GetHWnd also validates the receiver object');
  assert.strictEqual(e.test_peek32(out) >>> 0, 0x55aa55aa,
    'an invalid receiver does not publish a fabricated HWND');

  console.log('PASS DirectDraw clipper retains and validates its associated HWND');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
