#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// DPA/DSA are opaque comctl32 handles, but their operations are exported only
// through the API dispatcher.  These narrow wrappers drive the real handlers
// while giving each stdcall entry a disposable guest stack.
const extraWat = String.raw`
  (func $test_api_stack
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288))))
  (func (export "test_heap_alloc") (param $size i32) (result i32)
    (call $heap_alloc (local.get $size)))

  (func (export "test_comctl_alloc") (param $size i32) (result i32)
    (call $test_api_stack)
    (call $handle_Comctl32_Alloc
      (local.get $size) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_comctl_realloc")
      (param $ptr i32) (param $size i32) (result i32)
    (call $test_api_stack)
    (call $handle_Comctl32_ReAlloc
      (local.get $ptr) (local.get $size) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_comctl_free") (param $ptr i32) (result i32)
    (call $test_api_stack)
    (call $handle_Comctl32_Free
      (local.get $ptr) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_comctl_get_size") (param $ptr i32) (result i32)
    (call $test_api_stack)
    (call $handle_Comctl32_GetSize
      (local.get $ptr) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dsa_create") (param $size i32) (param $grow i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_Create
      (local.get $size) (local.get $grow) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dsa_destroy") (param $dsa i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_Destroy
      (local.get $dsa) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dsa_insert")
      (param $dsa i32) (param $index i32) (param $item i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_InsertItem
      (local.get $dsa) (local.get $index) (local.get $item)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dsa_get")
      (param $dsa i32) (param $index i32) (param $item i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_GetItem
      (local.get $dsa) (local.get $index) (local.get $item)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dsa_get_ptr") (param $dsa i32) (param $index i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_GetItemPtr
      (local.get $dsa) (local.get $index) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dsa_delete") (param $dsa i32) (param $index i32) (result i32)
    (call $test_api_stack)
    (call $handle_DSA_DeleteItem
      (local.get $dsa) (local.get $index) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dpa_create") (param $grow i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_Create
      (local.get $grow) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dpa_destroy") (param $dpa i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_Destroy
      (local.get $dpa) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dpa_insert")
      (param $dpa i32) (param $index i32) (param $value i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_InsertPtr
      (local.get $dpa) (local.get $index) (local.get $value)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dpa_get") (param $dpa i32) (param $index i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_GetPtr
      (local.get $dpa) (local.get $index) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dpa_delete") (param $dpa i32) (param $index i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_DeletePtr
      (local.get $dpa) (local.get $index) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dpa_delete_all") (param $dpa i32) (result i32)
    (call $test_api_stack)
    (call $handle_DPA_DeleteAllPtrs
      (local.get $dpa) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const wasm = guest => e.guest_to_wasm(guest) >>> 0;

  let comctl = e.test_comctl_alloc(13) >>> 0;
  assert(comctl, 'Comctl32_Alloc returns a live allocation');
  assert.strictEqual(e.test_comctl_get_size(comctl), 13,
    'Comctl32_GetSize reports the requested allocation extent');
  assert.deepStrictEqual([...bytes.subarray(wasm(comctl), wasm(comctl) + 13)],
    new Array(13).fill(0), 'Comctl32_Alloc zero-initializes caller bytes');
  for (let i = 0; i < 13; i++) bytes[wasm(comctl) + i] = 0x40 + i;

  const oldComctl = comctl;
  comctl = e.test_comctl_realloc(comctl, 29) >>> 0;
  assert(comctl, 'Comctl32_ReAlloc grows a live allocation');
  assert.strictEqual(e.test_comctl_get_size(comctl), 29);
  for (let i = 0; i < 13; i++) {
    assert.strictEqual(bytes[wasm(comctl) + i], 0x40 + i,
      `Comctl32_ReAlloc preserves byte ${i}`);
  }
  assert.deepStrictEqual([...bytes.subarray(wasm(comctl) + 13, wasm(comctl) + 29)],
    new Array(16).fill(0), 'Comctl32_ReAlloc zeroes the grown tail');
  if (comctl !== oldComctl) {
    assert.strictEqual(e.test_comctl_get_size(oldComctl), -1,
      'a moved reallocation retires its old pointer');
  }

  const shrunk = e.test_comctl_realloc(comctl, 5) >>> 0;
  assert(shrunk, 'Comctl32_ReAlloc shrinks a live allocation');
  assert.strictEqual(e.test_comctl_get_size(shrunk), 5,
    'GetSize tracks a shrink rather than returning allocator padding');
  assert.deepStrictEqual([...bytes.subarray(wasm(shrunk), wasm(shrunk) + 5)],
    [0x40, 0x41, 0x42, 0x43, 0x44]);
  assert.strictEqual(e.test_comctl_free(shrunk), 1,
    'Comctl32_Free releases a live allocation');
  assert.strictEqual(e.test_comctl_get_size(shrunk), -1,
    'GetSize rejects freed pointers');
  assert.strictEqual(e.test_comctl_free(shrunk), 0,
    'Comctl32_Free rejects double free');
  assert.strictEqual(e.test_comctl_realloc(shrunk, 10), 0,
    'Comctl32_ReAlloc rejects a retired pointer');

  const nullRealloc = e.test_comctl_realloc(0, 7) >>> 0;
  assert(nullRealloc, 'Comctl32_ReAlloc(NULL) allocates');
  assert.strictEqual(e.test_comctl_get_size(nullRealloc), 7);
  assert.deepStrictEqual([...bytes.subarray(wasm(nullRealloc), wasm(nullRealloc) + 7)],
    new Array(7).fill(0));
  assert.strictEqual(e.test_comctl_free(nullRealloc), 1);
  assert.strictEqual(e.test_comctl_alloc(0x7ffffff0), 0,
    'Comctl32_Alloc rejects private-header overflow');
  assert.strictEqual(e.test_comctl_free(0), 0);
  assert.strictEqual(e.test_comctl_get_size(0x1234567c), -1,
    'Comctl32_GetSize rejects a non-heap pointer without trapping');

  const itemA = e.test_heap_alloc(8) >>> 0;
  const itemB = e.test_heap_alloc(8) >>> 0;
  const itemC = e.test_heap_alloc(8) >>> 0;
  const itemOut = e.test_heap_alloc(8) >>> 0;
  view.setUint32(wasm(itemA), 0x11111111, true);
  view.setUint32(wasm(itemA) + 4, 0xaaaaaaaa, true);
  view.setUint32(wasm(itemB), 0x22222222, true);
  view.setUint32(wasm(itemB) + 4, 0xbbbbbbbb, true);
  view.setUint32(wasm(itemC), 0x33333333, true);
  view.setUint32(wasm(itemC) + 4, 0xcccccccc, true);

  assert.strictEqual(e.test_dsa_create(0, 2), 0,
    'DSA_Create rejects a zero-byte item instead of constructing a corrupt array');
  assert.strictEqual(e.test_dsa_create(0x40000000, 8), 0,
    'DSA_Create rejects overflowing capacity multiplication');
  const dsa = e.test_dsa_create(8, 2) >>> 0;
  assert(dsa, 'DSA_Create returns an opaque live handle');
  assert.strictEqual(e.test_dsa_insert(dsa, 0, itemA), 0);
  assert.strictEqual(e.test_dsa_insert(dsa, 0x7fffffff, itemC), 1);
  assert.strictEqual(e.test_dsa_insert(dsa, 1, itemB), 1,
    'DSA insertion grows storage and shifts the trailing item');
  assert.strictEqual(e.test_dsa_get(dsa, 1, itemOut), 1);
  assert.strictEqual(view.getUint32(wasm(itemOut), true), 0x22222222);
  assert.strictEqual(view.getUint32(wasm(itemOut) + 4, true), 0xbbbbbbbb);
  const dsaItem = e.test_dsa_get_ptr(dsa, 2) >>> 0;
  assert(dsaItem, 'DSA_GetItemPtr returns the third live item');
  assert.strictEqual(view.getUint32(wasm(dsaItem), true), 0x33333333);

  assert.strictEqual(e.test_dsa_destroy(dsa), 1,
    'DSA_Destroy releases a live array');
  assert.strictEqual(e.test_dsa_destroy(dsa), 0,
    'DSA_Destroy rejects a retired handle');
  assert.strictEqual(e.test_dsa_get_ptr(dsa, 0), 0,
    'DSA reads reject a retired handle');
  assert.strictEqual(e.test_dsa_insert(dsa, 0, itemA), -1,
    'DSA writes reject a retired handle');
  assert.strictEqual(e.test_dsa_delete(dsa, 0), 0,
    'DSA deletion rejects a retired handle');
  const recycledDsa = e.test_dsa_create(8, 2) >>> 0;
  assert.strictEqual(recycledDsa, dsa,
    'DSA_Destroy returns the handle block to the process heap');
  assert.strictEqual(e.test_dsa_destroy(recycledDsa), 1);

  assert.strictEqual(e.test_dpa_create(536870912), 0,
    'DPA_Create rejects an overflowing pointer-array allocation');
  const dpa = e.test_dpa_create(2) >>> 0;
  assert(dpa, 'DPA_Create returns an opaque live handle');
  assert.strictEqual(e.test_dpa_insert(dpa, 0, 0x11111111), 0);
  assert.strictEqual(e.test_dpa_insert(dpa, 0x7fffffff, 0x33333333), 1);
  assert.strictEqual(e.test_dpa_insert(dpa, 1, 0x22222222), 1,
    'DPA insertion grows storage and shifts the trailing pointer');
  assert.strictEqual(e.test_dpa_get(dpa, 0) >>> 0, 0x11111111);
  assert.strictEqual(e.test_dpa_get(dpa, 1) >>> 0, 0x22222222);
  assert.strictEqual(e.test_dpa_get(dpa, 2) >>> 0, 0x33333333);

  assert.strictEqual(e.test_dpa_destroy(dpa), 1,
    'DPA_Destroy releases a live array');
  assert.strictEqual(e.test_dpa_destroy(dpa), 0,
    'DPA_Destroy rejects a retired handle');
  assert.strictEqual(e.test_dpa_get(dpa, 0), 0,
    'DPA reads reject a retired handle');
  assert.strictEqual(e.test_dpa_insert(dpa, 0, 1), -1,
    'DPA writes reject a retired handle');
  assert.strictEqual(e.test_dpa_delete(dpa, 0), 0,
    'DPA deletion rejects a retired handle');
  assert.strictEqual(e.test_dpa_delete_all(dpa), 0,
    'DPA_DeleteAllPtrs rejects a retired handle');
  const recycledDpa = e.test_dpa_create(2) >>> 0;
  assert.strictEqual(recycledDpa, dpa,
    'DPA_Destroy returns the handle block to the process heap');
  assert.strictEqual(e.test_dpa_destroy(recycledDpa), 1);

  const arbitrary = 0x1234567c;
  assert.strictEqual(e.test_dsa_destroy(0), 0);
  assert.strictEqual(e.test_dpa_destroy(0), 0);
  assert.strictEqual(e.test_dsa_destroy(arbitrary), 0,
    'DSA rejects an aligned non-heap handle without trapping');
  assert.strictEqual(e.test_dpa_destroy(arbitrary), 0,
    'DPA rejects an aligned non-heap handle without trapping');

  console.log('PASS  comctl32 heap and dynamic arrays own storage and reject retired handles');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
