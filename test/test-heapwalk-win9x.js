#!/usr/bin/env node
'use strict';

// HeapWalk and GetProcessHeaps are NT-only. On Windows 95/98 both fail with
// ERROR_CALL_NOT_IMPLEMENTED, and SmartHeap (SHW32.DLL, Disciples demo) picks
// its Win9x path on exactly that code.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_heapwalk") (param $h i32) (param $entry i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00430000))
    (global.set $last_error (i32.const 0))
    (call $handle_HeapWalk (local.get $h) (local.get $entry) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_getprocessheaps") (param $n i32) (param $arr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00430000))
    (global.set $last_error (i32.const 0))
    (call $handle_GetProcessHeaps (local.get $n) (local.get $arr) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_hw_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_hw_last_error") (result i32) (global.get $last_error))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });
  const entry = wat.guest_alloc(28) >>> 0;
  assert.strictEqual(wat.test_heapwalk(0x00beef00, entry), 0, 'HeapWalk fails on Win9x');
  assert.strictEqual(wat.test_hw_last_error(), 120, 'with ERROR_CALL_NOT_IMPLEMENTED');
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x0043000c, 'HeapWalk pops two stdcall arguments');
  assert.strictEqual(wat.test_getprocessheaps(0, 0), 0, 'GetProcessHeaps reports no heaps on Win9x');
  assert.strictEqual(wat.test_hw_last_error(), 120, 'with ERROR_CALL_NOT_IMPLEMENTED');
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x0043000c, 'GetProcessHeaps pops two stdcall arguments');
  console.log('PASS  HeapWalk/GetProcessHeaps fail with the Win9x ERROR_CALL_NOT_IMPLEMENTED');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
