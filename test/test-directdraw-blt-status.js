#!/usr/bin/env node
'use strict';

// Browser-backed DirectDraw blits complete before their handlers return, so a
// live surface is immediately ready/done. GetBltStatus must still validate the
// documented query flag and reject foreign or released COM wrappers.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DD_OK = 0;
const DDERR_INVALIDOBJECT = 0x88760082;
const DDERR_INVALIDPARAMS = 0x80070057;
const DDGBS_CANBLT = 1;
const DDGBS_ISBLTDONE = 2;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_dd_object") (param $type i32) (result i32)
    (call $dx_create_com_obj (local.get $type) (i32.const 0)))

  (func (export "test_dd_surface_get_blt_status")
      (param $surface i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_GetBltStatus
      (local.get $surface) (local.get $flags) (i32.const 0)
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

  assert.strictEqual(
    e.test_dd_surface_get_blt_status(surface, DDGBS_CANBLT) >>> 0,
    DD_OK, 'a live surface can blit immediately');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
    'GetBltStatus pops this, flags, and the return address');
  assert.strictEqual(
    e.test_dd_surface_get_blt_status(surface, DDGBS_ISBLTDONE) >>> 0,
    DD_OK, 'a live surface has completed its synchronous browser blit');

  for (const flags of [0, 3, 0xffffffff]) {
    assert.strictEqual(
      e.test_dd_surface_get_blt_status(surface, flags) >>> 0,
      DDERR_INVALIDPARAMS, `undocumented flags 0x${flags.toString(16)} fail`);
  }

  assert.strictEqual(
    e.test_dd_surface_get_blt_status(0, DDGBS_CANBLT) >>> 0,
    DDERR_INVALIDOBJECT, 'a null interface is not a DirectDraw surface');
  assert.strictEqual(
    e.test_dd_surface_get_blt_status(directDraw, DDGBS_CANBLT) >>> 0,
    DDERR_INVALIDOBJECT, 'another DirectDraw object type is not a surface');

  assert.strictEqual(e.test_dd_release(surface), 0,
    'the surface reaches its final release');
  assert.strictEqual(
    e.test_dd_surface_get_blt_status(surface, DDGBS_ISBLTDONE) >>> 0,
    DDERR_INVALIDOBJECT, 'a released surface cannot report blit completion');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
    'failed GetBltStatus preserves stdcall cleanup');

  assert.strictEqual(e.test_dd_release(directDraw), 0,
    'the foreign DirectDraw object releases cleanly');

  console.log('PASS  DirectDraw GetBltStatus validates surface and query flag');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
