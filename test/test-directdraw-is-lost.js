#!/usr/bin/env node
'use strict';

// Browser-backed DirectDraw surfaces keep their memory while the object is
// live. IsLost must not extend that success to foreign or released objects.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DD_OK = 0;
const DDERR_INVALIDOBJECT = 0x88760082;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_dd_object") (param $type i32) (result i32)
    (call $dx_create_com_obj (local.get $type) (i32.const 0)))

  (func (export "test_dd_surface_is_lost") (param $surface i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_IsLost
      (local.get $surface) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dd_release") (param $object i32) (result i32)
    (call $dx_com_release_basic (local.get $object)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const surface = e.test_dd_object(2) >>> 0;
  const directDraw = e.test_dd_object(1) >>> 0;
  assert(surface && directDraw, 'DirectDraw test objects are allocated');

  assert.strictEqual(e.test_dd_surface_is_lost(surface) >>> 0, DD_OK,
    'a live browser-backed surface retains its memory');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'IsLost pops this and the return address');

  assert.strictEqual(e.test_dd_surface_is_lost(0) >>> 0, DDERR_INVALIDOBJECT,
    'a null interface is not a DirectDraw surface');
  assert.strictEqual(e.test_dd_surface_is_lost(directDraw) >>> 0,
    DDERR_INVALIDOBJECT, 'another DirectDraw object type is not a surface');

  assert.strictEqual(e.test_dd_release(surface), 0,
    'the surface reaches its final release');
  assert.strictEqual(e.test_dd_surface_is_lost(surface) >>> 0,
    DDERR_INVALIDOBJECT, 'a released surface cannot report live memory');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'failed IsLost preserves stdcall cleanup');

  assert.strictEqual(e.test_dd_release(directDraw), 0,
    'the foreign DirectDraw object releases cleanly');

  console.log('PASS  DirectDraw IsLost validates live surface ownership');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
