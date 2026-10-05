#!/usr/bin/env node
'use strict';

// timeEndPeriod must use the same supported timer-resolution domain as
// timeBeginPeriod/timeGetDevCaps; ending an impossible period cannot succeed.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const TIMERR_NOERROR = 0;
const TIMERR_NOCANDO = 97;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_time_get_dev_caps")
        (param $caps i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_timeGetDevCaps
      (local.get $caps) (local.get $size) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_time_begin_period") (param $period i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_timeBeginPeriod
      (local.get $period) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_time_end_period") (param $period i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_timeEndPeriod
      (local.get $period) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const view = new DataView(memory.buffer);

  const caps = e.guest_alloc(8) >>> 0;
  assert(caps, 'TIMECAPS buffer is allocated');
  assert.strictEqual(e.test_time_get_dev_caps(caps, 8) >>> 0, TIMERR_NOERROR);
  const minimum = view.getUint32(wa(caps), true);
  const maximum = view.getUint32(wa(caps) + 4, true);

  for (const period of [minimum, 16, maximum]) {
    assert.strictEqual(e.test_time_begin_period(period) >>> 0, TIMERR_NOERROR,
      `timeBeginPeriod accepts ${period} ms before its matching release`);
    assert.strictEqual(e.test_time_end_period(period) >>> 0, TIMERR_NOERROR,
      `timeEndPeriod accepts matching in-range ${period} ms`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      'timeEndPeriod pops one argument and the return address');
  }

  for (const period of [0, maximum + 1, 0xffffffff]) {
    assert.strictEqual(e.test_time_end_period(period) >>> 0, TIMERR_NOCANDO,
      `timeEndPeriod rejects out-of-range ${period >>> 0} ms`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      'failed timeEndPeriod preserves stdcall cleanup');
  }

  console.log('PASS  timeEndPeriod enforces the advertised timer range');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
