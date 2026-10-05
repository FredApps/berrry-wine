#!/usr/bin/env node
'use strict';

// Win98 accepts JOYSTICKID1 through device ID 15. Releasing a valid joystick
// that was never captured is still successful, which matters to games that
// probe and clean up before falling back to keyboard or mouse input.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_joy_release_capture") (param $id i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_joyReleaseCapture
      (local.get $id) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;

  assert.strictEqual(e.test_joy_release_capture(0), 0,
    'JOYSTICKID1 succeeds even when it was not captured');
  assert.strictEqual(e.test_joy_release_capture(15), 0,
    'the final Win98 joystick ID is valid');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'joyReleaseCapture pops its joystick ID and return address');

  assert.strictEqual(e.test_joy_release_capture(16), 11,
    'the first out-of-range Win98 joystick ID returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_release_capture(-1), 11,
    'UINT_MAX is not a valid joystick ID');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'failed joyReleaseCapture preserves stdcall cleanup');

  console.log('PASS  joyReleaseCapture enforces Win98 joystick ID boundaries');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
