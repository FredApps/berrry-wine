#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dd_surface") (result i32)
    (call $dx_create_com_obj (i32.const 2) (i32.const 0)))

  (func (export "test_dd_surface_initialize")
      (param $surface i32) (param $ddraw i32) (param $desc i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_Initialize
      (local.get $surface) (local.get $ddraw) (local.get $desc)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const DDERR_ALREADYINITIALIZED = 0x88760005;
  const surface = wat.test_dd_surface() >>> 0;

  assert(surface, 'creates an initialized DirectDrawSurface');
  assert.strictEqual(
    wat.test_dd_surface_initialize(surface, 0x11111111, 0x22222222) >>> 0,
    DDERR_ALREADYINITIALIZED,
    'a created DirectDrawSurface cannot be initialized a second time');
  assert.strictEqual(wat.get_esp(), 0x00300010,
    'Initialize pops this, DirectDraw, and surface description');

  console.log('PASS DirectDrawSurface Initialize reports already-initialized');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
