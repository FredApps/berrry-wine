#!/usr/bin/env node
'use strict';

// Win98 accepts joystick IDs -1 and 0..15 and, unlike NT-family systems,
// does not reject an unusual cbjc size. Malformed pointers/IDs must remain
// distinguishable from the browser runtime's honest no-driver result.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_joy_get_dev_caps")
      (param $id i32) (param $caps i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_joyGetDevCapsA
      (local.get $id) (local.get $caps) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
  (func (export "test_caps") (result i32)
    (region.addr $TEST_SCRATCH 0))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;
  const caps = e.test_caps() >>> 0;
  const view = new DataView(memory.buffer);

  for (let offset = 0; offset < 32; offset += 4) {
    view.setUint32(caps + offset, 0x5a5a0000 + offset, true);
  }

  assert.strictEqual(e.test_joy_get_dev_caps(0, caps, 404), 6,
    'a well-formed JOYSTICKID1 probe reports no browser joystick driver');
  assert.strictEqual(e.test_joy_get_dev_caps(15, caps, 404), 6,
    'the final Win98 joystick ID remains a well-formed no-driver probe');
  assert.strictEqual(e.test_joy_get_dev_caps(-1, caps, 404), 6,
    'Win98 accepts the documented registry-key query ID');
  assert.strictEqual(e.test_joy_get_dev_caps(0, caps, 1), 6,
    'Win98 does not reject an unusual cbjc size');
  assert.strictEqual(e.get_esp() >>> 0, stack + 16,
    'joyGetDevCapsA pops three parameters and the return address');

  assert.strictEqual(e.test_joy_get_dev_caps(0, 0, 404), 11,
    'a NULL JOYCAPS pointer returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_get_dev_caps(16, caps, 404), 11,
    'the first out-of-range Win98 joystick ID returns MMSYSERR_INVALPARAM');
  assert.strictEqual(e.test_joy_get_dev_caps(-2, caps, 404), 11,
    'only UINT_PTR_MAX has the documented special-ID meaning');
  assert.strictEqual(e.get_esp() >>> 0, stack + 16,
    'failed joyGetDevCapsA preserves stdcall cleanup');

  for (let offset = 0; offset < 32; offset += 4) {
    assert.strictEqual(view.getUint32(caps + offset, true), 0x5a5a0000 + offset,
      `failed capability probes preserve JOYCAPS +${offset}`);
  }

  console.log('PASS  joyGetDevCapsA enforces Win98 pointer and joystick-ID boundaries');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
