#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const ERROR_INVALID_HANDLE = 6;

const extraWat = String.raw`
  (func (export "test_global_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalAlloc (i32.const 0) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_free") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalFree (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_lock") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalLock (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_unlock") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalUnlock (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_handle") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalHandle (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_local_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_LocalAlloc (i32.const 0) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "set_error") (param $value i32) (global.set $last_error (local.get $value)))
  (func (export "get_error") (result i32) (global.get $last_error))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);

  const live = e.test_global_alloc(64) >>> 0;
  assert(live, 'GlobalAlloc succeeds');
  assert.strictEqual(e.test_global_lock(live) >>> 0, live,
    'GlobalLock returns the fixed block pointer');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300008, 'GlobalLock pops one argument');
  assert.strictEqual(e.test_global_handle(live) >>> 0, live,
    'GlobalHandle converts the live pointer back to its identical fixed handle');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300008, 'GlobalHandle pops one argument');
  assert.strictEqual(e.test_global_unlock(live), 1,
    'GlobalUnlock succeeds for the fixed direct-pointer representation');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300008, 'GlobalUnlock pops one argument');

  const local = e.test_local_alloc(32) >>> 0;
  const heap = e.guest_alloc(32) >>> 0;
  const invalid = [0, 0x52544344, live + 8, local, heap];
  for (const ptr of invalid) {
    for (const [name, call] of [
      ['GlobalLock', e.test_global_lock],
      ['GlobalHandle', e.test_global_handle],
      ['GlobalUnlock', e.test_global_unlock],
    ]) {
      e.set_error(0x1234);
      assert.strictEqual(call(ptr) >>> 0, 0, `${name} rejects 0x${ptr.toString(16)}`);
      assert.strictEqual(e.get_error(), ERROR_INVALID_HANDLE,
        `${name} reports ERROR_INVALID_HANDLE for 0x${ptr.toString(16)}`);
    }
  }

  assert.strictEqual(e.test_global_free(live), 0, 'GlobalFree retires the live handle');
  for (const [name, call] of [
    ['GlobalLock', e.test_global_lock],
    ['GlobalHandle', e.test_global_handle],
    ['GlobalUnlock', e.test_global_unlock],
  ]) {
    e.set_error(0x1234);
    assert.strictEqual(call(live), 0, `${name} rejects a freed global handle`);
    assert.strictEqual(e.get_error(), ERROR_INVALID_HANDLE,
      `${name} reports ERROR_INVALID_HANDLE after GlobalFree`);
  }

  console.log('PASS  GlobalLock/GlobalUnlock/GlobalHandle validate live Global memory');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
