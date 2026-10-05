#!/usr/bin/env node
'use strict';

// The browser stores canonical true-color pixels, so UpdateColors has no
// palette remap work. It must nevertheless require a live device context.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_update_colors") (param $hdc i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_UpdateColors
      (local.get $hdc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;
  const hdc = e.test_call_CreateCompatibleDC(0) >>> 0;
  assert(hdc, 'CreateCompatibleDC returns a live memory DC');

  assert.strictEqual(e.test_update_colors(hdc), 1,
    'a live true-color DC accepts the palette update as a no-op');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'UpdateColors pops its HDC and return address');

  assert.strictEqual(e.test_update_colors(0), 0,
    'a null HDC cannot have its client colors updated');
  assert.strictEqual(e.test_update_colors(0x7777), 0,
    'a fabricated HDC cannot receive a palette update');

  assert.strictEqual(e.test_call_DeleteDC(hdc), 1,
    'the memory DC releases normally');
  assert.strictEqual(e.test_update_colors(hdc), 0,
    'a deleted HDC no longer accepts palette updates');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'failed UpdateColors preserves stdcall cleanup');

  console.log('PASS  UpdateColors validates its browser-backed device context');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
