#!/usr/bin/env node
'use strict';

// Classic games often attempt joystick capture before falling back to mouse or
// keyboard. A well-formed request should report the browser's unplugged device,
// while malformed Win98 IDs and a NULL notification window are parameter errors.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_joy_set_capture")
      (param $hwnd i32) (param $id i32) (param $period i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_joySetCapture
      (local.get $hwnd) (local.get $id) (local.get $period)
      (i32.const 1) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;
  const notificationWindow = 0x10000;

  assert.strictEqual(e.test_joy_set_capture(notificationWindow, 0, 10), 167,
    'a well-formed JOYSTICKID1 request reports the browser device unplugged');
  assert.strictEqual(e.test_joy_set_capture(notificationWindow, 15, 10), 167,
    'the final Win98 joystick ID remains a well-formed unplugged request');
  assert.strictEqual(e.get_esp() >>> 0, stack + 20,
    'joySetCapture pops four parameters and the return address');

  assert.strictEqual(e.test_joy_set_capture(0, 0, 10), 11,
    'a NULL notification window returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_set_capture(notificationWindow, 16, 10), 11,
    'the first out-of-range Win98 joystick ID returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_set_capture(notificationWindow, -1, 10), 11,
    'UINT_MAX is not a valid joystick ID');
  assert.strictEqual(e.get_esp() >>> 0, stack + 20,
    'failed joySetCapture preserves stdcall cleanup');

  console.log('PASS  joySetCapture distinguishes invalid Win98 parameters from unplugged input');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
