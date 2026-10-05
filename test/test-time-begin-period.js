#!/usr/bin/env node
'use strict';

// A WinMM timer-resolution request is valid only within the device range
// reported by timeGetDevCaps. DirectX-era games commonly request 1 ms.

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
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const view = new DataView(memory.buffer);

  const caps = e.guest_alloc(8) >>> 0;
  assert(caps, 'TIMECAPS buffer is allocated');
  assert.strictEqual(e.test_time_get_dev_caps(caps, 8) >>> 0, TIMERR_NOERROR,
    'timeGetDevCaps succeeds for a complete TIMECAPS buffer');
  const minimum = view.getUint32(wa(caps), true);
  const maximum = view.getUint32(wa(caps) + 4, true);
  assert.deepStrictEqual([minimum, maximum], [1, 1000000],
    'the browser timer advertises its supported period range');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
    'timeGetDevCaps pops two arguments and the return address');

  for (const period of [minimum, 16, maximum]) {
    assert.strictEqual(e.test_time_begin_period(period) >>> 0, TIMERR_NOERROR,
      `timeBeginPeriod accepts in-range ${period} ms`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      'timeBeginPeriod pops one argument and the return address');
  }

  for (const period of [0, maximum + 1, 0xffffffff]) {
    assert.strictEqual(e.test_time_begin_period(period) >>> 0, TIMERR_NOCANDO,
      `timeBeginPeriod rejects out-of-range ${period >>> 0} ms`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      'failed timeBeginPeriod preserves stdcall cleanup');
  }

  console.log('PASS  timeBeginPeriod enforces the advertised timer range');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
