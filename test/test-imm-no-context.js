#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_call_ImmCreateContext") (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_ImmCreateContext
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_call_ImmDestroyContext") (param $himc i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_ImmDestroyContext
      (local.get $himc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_call_ImmGetContext") (param $hwnd i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_ImmGetContext
      (local.get $hwnd) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_call_ImmReleaseContext")
      (param $hwnd i32) (param $himc i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_ImmReleaseContext
      (local.get $hwnd) (local.get $himc) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat });

  let packed = e.test_call_ImmCreateContext();
  assert.strictEqual(Number(packed & 0xffffffffn), 0,
    'the no-IME machine does not fabricate an input context');
  assert.strictEqual(Number(packed >> 32n), 0x00300004,
    'ImmCreateContext pops only the return address');

  packed = e.test_call_ImmDestroyContext(0x494d4301);
  assert.strictEqual(Number(packed & 0xffffffffn), 0,
    'a fabricated input context cannot be destroyed');
  assert.strictEqual(Number(packed >> 32n), 0x00300008,
    'ImmDestroyContext pops its one stdcall argument');

  packed = e.test_call_ImmGetContext(0x10001);
  assert.strictEqual(Number(packed & 0xffffffffn), 0,
    'the plain en-US machine exposes no input context');
  assert.strictEqual(Number(packed >> 32n), 0x00300008,
    'ImmGetContext pops its one stdcall argument');

  packed = e.test_call_ImmReleaseContext(0x10001, 0);
  assert.strictEqual(Number(packed & 0xffffffffn), 0,
    'NULL cannot balance a context acquisition that never succeeded');
  assert.strictEqual(Number(packed >> 32n), 0x0030000c,
    'ImmReleaseContext pops its two stdcall arguments');

  packed = e.test_call_ImmReleaseContext(0x10001, 0x494d4301);
  assert.strictEqual(Number(packed & 0xffffffffn), 0,
    'an invented HIMC is not accepted by the no-IME machine');

  console.log('PASS  no-IME context acquisition and release stay consistent');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
