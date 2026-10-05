#!/usr/bin/env node
'use strict';

// The browser exposes no WinMM auxiliary output device. All APIs in that
// family must agree with auxGetNumDevs instead of inventing a device 0.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MMSYSERR_BADDEVICEID = 2;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_aux_get_num_devs") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_auxGetNumDevs
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_aux_get_dev_caps") (param $device i32) (param $caps i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_auxGetDevCapsA
      (local.get $device) (local.get $caps) (i32.const 48)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_aux_get_volume") (param $device i32) (param $volume i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_auxGetVolume
      (local.get $device) (local.get $volume) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_aux_set_volume") (param $device i32) (param $volume i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_auxSetVolume
      (local.get $device) (local.get $volume) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_aux_out_message")
        (param $device i32) (param $message i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_auxOutMessage
      (local.get $device) (local.get $message) (i32.const 0x11111111)
      (i32.const 0x22222222) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const view = new DataView(memory.buffer);
  const output = e.guest_alloc(48) >>> 0;

  assert.strictEqual(e.test_aux_get_num_devs() >>> 0, 0,
    'the browser advertises no auxiliary output devices');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4,
    'auxGetNumDevs pops only the return address');

  for (const device of [0, 1, 0xffffffff]) {
    view.setUint32(wa(output), 0xdecafbad, true);
    assert.strictEqual(e.test_aux_get_dev_caps(device, output) >>> 0, MMSYSERR_BADDEVICEID,
      `auxGetDevCapsA rejects unavailable device ${device >>> 0}`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 16,
      'auxGetDevCapsA preserves stdcall cleanup');

    assert.strictEqual(e.test_aux_get_volume(device, output) >>> 0, MMSYSERR_BADDEVICEID,
      `auxGetVolume rejects unavailable device ${device >>> 0}`);
    assert.strictEqual(view.getUint32(wa(output), true), 0xdecafbad,
      'failed auxGetVolume leaves caller output untouched');
    assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
      'auxGetVolume preserves stdcall cleanup');

    assert.strictEqual(e.test_aux_set_volume(device, 0x12345678) >>> 0, MMSYSERR_BADDEVICEID,
      `auxSetVolume rejects unavailable device ${device >>> 0}`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
      'auxSetVolume preserves stdcall cleanup');

    assert.strictEqual(e.test_aux_out_message(device, 0x4000) >>> 0, MMSYSERR_BADDEVICEID,
      `auxOutMessage rejects unavailable device ${device >>> 0}`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 20,
      'auxOutMessage preserves stdcall cleanup');
  }

  console.log('PASS  WinMM auxiliary APIs agree that no aux device exists');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
