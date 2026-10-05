#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_map") (param $ga i32) (result i32)
    (call $virtual_map_commit (local.get $ga) (i32.const 4096)))
  (func (export "test_compare_pointers") (param $a i32) (param $b i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_CompareFileTime (local.get $a) (local.get $b)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_compare_file_time")
      (param $stack i32) (param $a_lo i32) (param $a_hi i32)
      (param $b_lo i32) (param $b_hi i32) (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (call $heap_alloc (i32.const 8)))
    (local.set $b (call $heap_alloc (i32.const 8)))
    (call $gs32 (local.get $a) (local.get $a_lo))
    (call $gs32 (i32.add (local.get $a) (i32.const 4)) (local.get $a_hi))
    (call $gs32 (local.get $b) (local.get $b_lo))
    (call $gs32 (i32.add (local.get $b) (i32.const 4)) (local.get $b_hi))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_CompareFileTime
      (local.get $a) (local.get $b) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const api = apiTable.find(entry => entry.name === 'CompareFileTime');
  assert(api, 'CompareFileTime is registered for imported and dynamic calls');
  assert.strictEqual(api.nargs, 2, 'CompareFileTime has two stdcall arguments');

  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = 0x074ff000;
  const compare = (aLo, aHi, bLo, bHi) =>
    wat.test_compare_file_time(stack, aLo, aHi, bLo, bHi) | 0;

  assert.strictEqual(compare(0, 0, 0, 0), 0, 'equal FILETIMEs compare equal');
  assert.strictEqual(compare(0xffffffff, 0, 0, 1), -1,
    'high DWORD takes precedence over the low DWORD');
  assert.strictEqual(compare(0, 1, 0xffffffff, 0), 1,
    'higher high DWORD compares greater');
  assert.strictEqual(compare(0x80000000, 7, 0x7fffffff, 7), 1,
    'low DWORD comparison is unsigned');
  assert.strictEqual(compare(1, 7, 2, 7), -1,
    'lower low DWORD compares less when high DWORDs match');
  assert.strictEqual(wat.get_esp() >>> 0, stack + 12,
    'CompareFileTime pops two arguments and the return address');

  const page = 0x30000000;
  for (const ga of [page, 0x28000000, page + 4096]) assert.strictEqual(wat.test_map(ga) >>> 0, ga);
  assert.notStrictEqual(wat.guest_to_wasm(page + 4096), wat.guest_to_wasm(page) + 4096);
  const put = (ga, n) => {
    wat.guest_write32(ga, Number(n & 0xffffffffn));
    wat.guest_write32(ga + 4, Number(n >> 32n));
  };
  const values = [0n, 1n, 0x7fffffffn, 0x80000000n, 0xffffffffn,
    0x100000000n, 0x7fffffffffffffffn, 0x8000000000000000n, 0xffffffffffffffffn];
  for (let split = 1; split < 8; split++) for (const reverse of [false, true]) {
    const a = reverse ? page + 128 : page + 4096 - split;
    const b = reverse ? page + 4096 - split : page + 128;
    for (const av of values) for (const bv of values) {
      put(a, av); put(b, bv);
      assert.strictEqual(wat.test_compare_pointers(a, b), av < bv ? -1 : av > bv ? 1 : 0,
        `split ${split}, reverse ${reverse}, ${av} vs ${bv}`);
      assert.strictEqual(wat.get_esp() >>> 0, stack + 12);
    }
    assert.strictEqual(wat.test_compare_pointers(a, a), 0);
  }
  console.log('PASS  CompareFileTime: unsigned 64-bit ordering, both sparse inputs and stdcall');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
