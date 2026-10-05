#!/usr/bin/env node
'use strict';

// Classic games probe joystick position before choosing joystick, mouse, or
// keyboard input. Distinguish malformed Win98 calls from a valid unplugged
// device probe, and never scribble on the caller's structure on failure.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_joy_get_pos")
      (param $id i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_joyGetPos
      (local.get $id) (local.get $info)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
  (func (export "test_info") (result i32)
    (region.addr $TEST_SCRATCH 0))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;
  const info = e.test_info() >>> 0;
  const view = new DataView(memory.buffer);

  for (let offset = 0; offset < 16; offset += 4) {
    view.setUint32(info + offset, 0xa5a50000 + offset, true);
  }

  assert.strictEqual(e.test_joy_get_pos(0, info), 167,
    'a well-formed JOYSTICKID1 request reports the browser device unplugged');
  assert.strictEqual(e.test_joy_get_pos(15, info), 167,
    'the final Win98 joystick ID remains a well-formed unplugged request');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'joyGetPos pops two parameters and the return address');

  assert.strictEqual(e.test_joy_get_pos(0, 0), 11,
    'a NULL JOYINFO pointer returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_get_pos(16, info), 11,
    'the first out-of-range Win98 joystick ID returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_get_pos(-1, info), 11,
    'UINT_MAX is not a valid joystick ID');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'failed joyGetPos preserves stdcall cleanup');

  for (let offset = 0; offset < 16; offset += 4) {
    assert.strictEqual(view.getUint32(info + offset, true), 0xa5a50000 + offset,
      `failed joystick probes preserve JOYINFO +${offset}`);
  }

  console.log('PASS  joyGetPos distinguishes invalid Win98 parameters from unplugged input');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
