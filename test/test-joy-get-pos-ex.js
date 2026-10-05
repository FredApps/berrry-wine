#!/usr/bin/env node
'use strict';

// joyGetPosEx is a common classic-game input probe. Win98 requires callers to
// initialize both JOYINFOEX version fields; malformed probes must not look like
// valid but unplugged hardware or modify the caller's structure.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_joy_get_pos_ex")
      (param $id i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_joyGetPosEx
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

  const initialize = (size = 52, flags = 0xff) => {
    for (let offset = 0; offset < 52; offset += 4) {
      view.setUint32(info + offset, 0xc3c30000 + offset, true);
    }
    view.setUint32(info, size, true);
    view.setUint32(info + 4, flags, true);
  };
  const snapshot = () => new Uint8Array(memory.buffer.slice(info, info + 52));

  initialize();
  const validBefore = snapshot();
  assert.strictEqual(e.test_joy_get_pos_ex(0, info), 167,
    'a well-formed JOYSTICKID1 request reports the browser device unplugged');
  assert.strictEqual(e.test_joy_get_pos_ex(15, info), 167,
    'the final Win98 joystick ID remains a well-formed unplugged request');
  assert.deepStrictEqual(snapshot(), validBefore,
    'unplugged probes preserve the caller-initialized JOYINFOEX');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'joyGetPosEx pops two parameters and the return address');

  assert.strictEqual(e.test_joy_get_pos_ex(16, info), 2,
    'an out-of-range joystick ID returns MMSYSERR_BADDEVICEID');
  assert.strictEqual(e.test_joy_get_pos_ex(0, 0), 11,
    'a NULL JOYINFOEX pointer returns MMSYSERR_INVALPARAM');

  for (const badSize of [0, 51, 56]) {
    initialize(badSize, 0xff);
    const before = snapshot();
    assert.strictEqual(e.test_joy_get_pos_ex(0, info), 11,
      `dwSize=${badSize} returns MMSYSERR_INVALPARAM`);
    assert.deepStrictEqual(snapshot(), before,
      `invalid dwSize=${badSize} preserves JOYINFOEX`);
  }

  initialize(52, 0);
  const flagsBefore = snapshot();
  assert.strictEqual(e.test_joy_get_pos_ex(0, info), 11,
    'an unset dwFlags returns MMSYSERR_INVALPARAM');
  assert.deepStrictEqual(snapshot(), flagsBefore,
    'invalid dwFlags preserves JOYINFOEX');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'failed joyGetPosEx preserves stdcall cleanup');

  console.log('PASS  joyGetPosEx validates Win98 JOYINFOEX version fields');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
