#!/usr/bin/env node
'use strict';

const assert = require('assert');
const compiler = require('./compile-src');
const compile = compiler.compileSrcWasm;
// Inject failure at this helper's allocation only; all successful allocations
// and every release still go through the real allocator. No disk source edit.
compiler.compileSrcWasm = (transform, options) => compile((file, source) => {
  if (file === '10-helpers.wat') {
    const start = source.indexOf('  (func $title_table_set ');
    const end = source.indexOf('  ;; $title_table_get_ptr', start);
    assert(start >= 0 && end > start);
    const body = source.slice(start, end);
    assert.strictEqual((body.match(/\(call \$heap_alloc /g) || []).length, 1);
    source = source.slice(0, start) + body
      .replaceAll('(call $heap_alloc ', '(call $test_title_alloc ')
      .replaceAll('(call $heap_free ', '(call $test_title_free ')
      + source.slice(end);
  }
  return transform ? transform(file, source) : source;
}, options);
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_title_fail (mut i32) (i32.const 0))
  (global $test_title_frees (mut i32) (i32.const 0))
  (func $test_title_alloc (param $size i32) (result i32)
    (if (global.get $test_title_fail) (then (return (i32.const 0))))
    (call $heap_alloc (local.get $size)))
  (func $test_title_free (param $ptr i32)
    (global.set $test_title_frees (i32.add (global.get $test_title_frees) (i32.const 1)))
    (call $heap_free (local.get $ptr)))
  (func (export "test_title_fail") (param $fail i32)
    (global.set $test_title_fail (local.get $fail)))
  (func (export "test_title_frees") (result i32) (global.get $test_title_frees))
  (func (export "test_title_create") (param $hwnd i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN)))
  (func (export "test_title_set") (param $hwnd i32) (param $wa i32) (param $len i32)
    (call $title_table_set (local.get $hwnd) (local.get $wa) (local.get $len)))
  (func (export "test_title_ptr") (param $hwnd i32) (result i32)
    (call $title_table_get_ptr (local.get $hwnd)))
  (func (export "test_title_len") (param $hwnd i32) (result i32)
    (call $title_table_get_len (local.get $hwnd)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const hwnd = 0x10001;
  e.test_title_create(hwnd);
  const source = e.guest_to_wasm(e.guest_alloc(512)) >>> 0;
  const set = text => {
    bytes.set(Buffer.from(text, 'latin1'), source);
    e.test_title_set(hwnd, source, text.length);
  };
  const title = () => {
    const ptr = e.test_title_ptr(hwnd) >>> 0;
    const len = e.test_title_len(hwnd);
    if (ptr) assert.strictEqual(bytes[ptr + len], 0, 'owned title is terminated');
    return Buffer.from(bytes.subarray(ptr, ptr + len)).toString('latin1');
  };
  set('Original title');
  const original = e.test_title_ptr(hwnd) >>> 0;
  bytes.fill(0x58, source, source + 14);
  assert.strictEqual(title(), 'Original title', 'caller storage is not retained');

  e.test_title_fail(1);
  set('Replacement');
  assert.strictEqual(e.test_title_frees(), 0, 'failed replacement must not free the current title');
  assert.strictEqual(e.test_title_ptr(hwnd) >>> 0, original);
  assert.strictEqual(title(), 'Original title', 'failure preserves pointer, length and bytes');
  e.test_title_fail(0);

  e.test_title_set(hwnd, original, 14);
  assert.strictEqual(title(), 'Original title', 'whole-title alias survives replacement');
  assert.strictEqual(e.test_title_frees(), 1);
  e.test_title_set(hwnd, (e.test_title_ptr(hwnd) >>> 0) + 9, 5);
  assert.strictEqual(title(), 'title', 'interior alias survives replacement');
  assert.strictEqual(e.test_title_frees(), 2);

  set('Q'.repeat(300));
  assert.strictEqual(title(), 'Q'.repeat(255), 'existing title cap is unchanged');
  assert.strictEqual(e.test_title_frees(), 3);
  e.test_title_set(0x7777, source, 5);
  assert.strictEqual(e.test_title_frees(), 3, 'unknown window does not retire another title');

  e.test_title_fail(1);
  e.test_title_set(hwnd, 0, 99);
  assert.strictEqual(e.test_title_ptr(hwnd), 0, 'NULL clears without allocating');
  assert.strictEqual(e.test_title_len(hwnd), 0);
  assert.strictEqual(e.test_title_frees(), 4);
  e.test_title_set(hwnd, 0, 0);
  assert.strictEqual(e.test_title_frees(), 4, 'repeated clear does not double free');
  e.test_title_fail(0);
  set('Again');
  e.test_title_set(hwnd, source, 0);
  assert.strictEqual(e.test_title_ptr(hwnd), 0, 'zero length clears non-NULL input');
  assert.strictEqual(e.test_title_len(hwnd), 0);
  assert.strictEqual(e.test_title_frees(), 5);
  console.log('PASS title replacement ownership, aliases, allocation failure and clearing');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
