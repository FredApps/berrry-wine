#!/usr/bin/env node
'use strict';

// Browser-backed DirectDraw memory stays attached to a live surface, making
// Restore idempotent there. Invalid or released wrappers must still fail.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DD_OK = 0;
const DDERR_INVALIDOBJECT = 0x88760082;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_dd_object") (param $type i32) (result i32)
    (call $dx_create_com_obj (local.get $type) (i32.const 0)))

  (func (export "test_dd_surface_restore") (param $surface i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_Restore
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

  assert.strictEqual(e.test_dd_surface_restore(surface) >>> 0, DD_OK,
    'restoring a live browser-backed surface is idempotent');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'Restore pops this and the return address');

  assert.strictEqual(e.test_dd_surface_restore(0) >>> 0, DDERR_INVALIDOBJECT,
    'a null interface cannot be restored');
  assert.strictEqual(e.test_dd_surface_restore(directDraw) >>> 0,
    DDERR_INVALIDOBJECT, 'another DirectDraw object type is not a surface');

  assert.strictEqual(e.test_dd_release(surface), 0,
    'the surface reaches its final release');
  assert.strictEqual(e.test_dd_surface_restore(surface) >>> 0,
    DDERR_INVALIDOBJECT, 'a released surface cannot be restored');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'failed Restore preserves stdcall cleanup');

  assert.strictEqual(e.test_dd_release(directDraw), 0,
    'the foreign DirectDraw object releases cleanly');

  console.log('PASS  DirectDraw Restore validates live surface ownership');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
