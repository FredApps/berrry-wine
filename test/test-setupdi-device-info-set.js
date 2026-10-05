#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (global $setupdi_test_delta (mut i32) (i32.const 0))

  (func (export "setupdi_create")
      (param $stack i32) (param $guid i32) (param $parent i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_SetupDiCreateDeviceInfoList
      (local.get $guid) (local.get $parent) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $setupdi_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "setupdi_destroy")
      (param $stack i32) (param $set i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_SetupDiDestroyDeviceInfoList
      (local.get $set) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $setupdi_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "setupdi_delta") (result i32)
    (global.get $setupdi_test_delta))
  (func (export "setupdi_last_error") (result i32)
    (global.get $last_error))
  (func (export "setupdi_record_word")
      (param $set i32) (param $offset i32) (result i32)
    (local $rec i32)
    (local.set $rec (call $setupdi_record_from_handle (local.get $set)))
    (if (i32.eqz (local.get $rec)) (then (return (i32.const 0))))
    (i32.load (i32.add (local.get $rec) (local.get $offset))))

  (func (export "setupdi_make_guid") (result i32)
    (local $guid i32)
    (local.set $guid (call $heap_alloc (i32.const 16)))
    (call $gs32 (local.get $guid) (i32.const 0x11223344))
    (call $gs32 (i32.add (local.get $guid) (i32.const 4)) (i32.const 0x55667788))
    (call $gs32 (i32.add (local.get $guid) (i32.const 8)) (i32.const 0x99AABBCC))
    (call $gs32 (i32.add (local.get $guid) (i32.const 12)) (i32.const 0xDDEEFF00))
    (local.get $guid))
  (func (export "setupdi_free") (param $ptr i32)
    (call $heap_free (local.get $ptr)))

  (func (export "setupdi_make_forged_set") (result i32)
    (local $set i32)
    (local.set $set (call $heap_alloc (i32.const 32)))
    (call $gs32 (local.get $set) (i32.const 0x4C494453))
    (call $gs32 (i32.add (local.get $set) (i32.const 4)) (local.get $set))
    (local.get $set))

  (export "setupdi_sparse_map" (func $virtual_map_commit))
  (export "setupdi_g2w" (func $g2w))

  (func (export "setupdi_make_window") (param $style i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (local.get $hwnd))
`;

(async () => {
  for (const [name, nargs] of [
    ['SetupDiCreateDeviceInfoList', 2],
    ['SetupDiDestroyDeviceInfoList', 1],
  ]) {
    const row = apiTable.find(entry => entry.name === name);
    assert(row, `${name} is registered`);
    assert.strictEqual(row.nargs, nargs, `${name} has the documented ABI`);
    assert.strictEqual(row.convention, 'stdcall');
    assert.strictEqual(row.stub, undefined, `${name} has a real handler`);
  }

  const first = await bootRenderHarness({ extraWat, fonts: 'none' });
  const second = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    memory: first.memory,
  });
  const a = first.exports;
  const b = second.exports;
  const stack = 0x074ff000;
  const invalid = 0xffffffff;

  assert.strictEqual(a.setupdi_create(stack, 0x7ff00000, 0) >>> 0, invalid,
    'an unmapped class GUID is rejected');
  assert.strictEqual(a.setupdi_last_error(), 87,
    'bad class GUID reports ERROR_INVALID_PARAMETER');
  assert.strictEqual(a.setupdi_delta(), 12,
    'create pops the return address and two arguments');

  const halfMappedPage = 0x31000000;
  assert.strictEqual(a.setupdi_sparse_map(halfMappedPage, 0x1000) >>> 0,
    halfMappedPage);
  assert.strictEqual(
    a.setupdi_create(stack, halfMappedPage + 0xff8, 0) >>> 0,
    invalid,
    'a GUID whose second sparse page is unmapped is rejected');
  assert.strictEqual(a.setupdi_last_error(), 87);

  const sparsePage = 0x30000000;
  assert.strictEqual(a.setupdi_sparse_map(sparsePage, 0x1000) >>> 0, sparsePage);
  assert.strictEqual(a.setupdi_sparse_map(0x28000000, 0x3000) >>> 0, 0x28000000);
  assert.strictEqual(a.setupdi_sparse_map(sparsePage + 0x1000, 0x1000) >>> 0,
    sparsePage + 0x1000);
  assert.notStrictEqual(
    (a.setupdi_g2w(sparsePage + 0xfff) + 1) >>> 0,
    a.setupdi_g2w(sparsePage + 0x1000) >>> 0,
    'fixture places adjacent guest pages in non-contiguous backing');
  const sparseGuid = sparsePage + 0xff8;
  const sparseGuidBytes = Array.from({ length: 16 }, (_, i) => 0xa0 + i);
  sparseGuidBytes.forEach((value, i) => a.guest_write8(sparseGuid + i, value));
  const sparseTyped = a.setupdi_create(stack, sparseGuid, 0) >>> 0;
  assert(sparseTyped && sparseTyped !== invalid,
    'a GUID spanning non-affine sparse pages remains a valid input');
  assert.strictEqual(sparseTyped >>> 24, 0xfc,
    'HDEVINFO uses the private SetupAPI handle namespace');
  assert.deepStrictEqual(
    [12, 16, 20, 24].map(offset => a.setupdi_record_word(sparseTyped, offset) >>> 0),
    [0xa3a2a1a0, 0xa7a6a5a4, 0xabaaa9a8, 0xafaeadac],
    'the non-affine sparse GUID is retained byte-for-byte in private state');
  assert.strictEqual(a.setupdi_destroy(stack, sparseTyped), 1);
  const sparseReplacement = a.setupdi_create(stack, 0, 0) >>> 0;
  assert.notStrictEqual(sparseReplacement, sparseTyped,
    'slot reuse advances the opaque handle generation');
  assert.strictEqual(a.setupdi_destroy(stack, sparseTyped), 0,
    'the old generation stays stale after slot reuse');
  assert.strictEqual(a.setupdi_destroy(stack, sparseReplacement), 1);

  assert.strictEqual(a.setupdi_create(stack, 0, 0x12345678) >>> 0, invalid,
    'a non-window UI parent is rejected');
  assert.strictEqual(a.setupdi_last_error(), 1400,
    'bad parent reports ERROR_INVALID_WINDOW_HANDLE');

  const child = a.setupdi_make_window(0x50000000) >>> 0; // WS_CHILD|WS_VISIBLE
  assert.strictEqual(a.setupdi_create(stack, 0, child) >>> 0, invalid,
    'the optional UI owner must be a top-level window');
  assert.strictEqual(a.setupdi_last_error(), 1400);

  const desktopSet = a.setupdi_create(stack, 0, 0x10000) >>> 0;
  assert(desktopSet && desktopSet !== invalid,
    'the permanent desktop is a valid top-level UI parent');
  assert.strictEqual(a.setupdi_destroy(stack, desktopSet), 1);

  const foreignParent = 0x20000;
  first.renderer.windows[foreignParent] = {
    hwnd: foreignParent, style: 0x10000000, visible: true,
  };
  const foreignSet = a.setupdi_create(stack, 0, foreignParent) >>> 0;
  assert(foreignSet && foreignSet !== invalid,
    'a renderer-owned top-level window from another process is accepted');
  assert.strictEqual(a.setupdi_destroy(stack, foreignSet), 1);
  const foreignChild = 0x20001;
  first.renderer.windows[foreignChild] = {
    hwnd: foreignChild, style: 0x50000000, visible: true,
  };
  assert.strictEqual(a.setupdi_create(stack, 0, foreignChild) >>> 0, invalid,
    'a renderer-owned WS_CHILD is not a top-level UI parent');
  assert.strictEqual(a.setupdi_last_error(), 1400);

  const empty = a.setupdi_create(stack, 0, 0) >>> 0;
  const other = a.setupdi_create(stack, 0, 0) >>> 0;
  assert(empty && empty !== invalid, 'NULL class/parent creates an empty set');
  assert(other && other !== invalid && other !== empty,
    'simultaneous empty sets have distinct owned handles');
  assert.strictEqual(a.setupdi_record_word(empty, 0) >>> 0, empty,
    'the private record publishes the exact opaque handle');
  assert(a.setupdi_record_word(empty, 4) > 0,
    'the private record retains a nonzero generation');
  assert.strictEqual(a.setupdi_record_word(empty, 8), 0,
    'NULL ClassGuid leaves the set class-neutral');

  const parent = a.setupdi_make_window(0x10000000) >>> 0; // top-level visible
  const guid = a.setupdi_make_guid() >>> 0;
  const typed = a.setupdi_create(stack, guid, parent) >>> 0;
  assert(typed && typed !== invalid, 'a class-associated empty set is created');
  assert.strictEqual(a.setupdi_record_word(typed, 8), 1);
  assert.deepStrictEqual(
    [12, 16, 20, 24].map(offset => a.setupdi_record_word(typed, offset) >>> 0),
    [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00],
    'the optional setup-class GUID is retained by value');
  assert.strictEqual(a.setupdi_record_word(typed, 28) >>> 0, parent,
    'the optional top-level UI parent is retained');
  a.setupdi_free(guid);

  assert.strictEqual(b.setupdi_record_word(typed, 0) >>> 0, typed,
    'another Worker-style WASM instance sees the shared handle state');
  assert.strictEqual(b.setupdi_destroy(stack, typed), 1,
    'the owning set can be destroyed from another process thread');
  assert.strictEqual(b.setupdi_delta(), 8,
    'destroy pops the return address and one argument');
  assert.strictEqual(a.setupdi_destroy(stack, typed), 0,
    'a consumed HDEVINFO cannot be destroyed twice');
  assert.strictEqual(a.setupdi_last_error(), 6,
    'a stale HDEVINFO reports ERROR_INVALID_HANDLE');
  assert.strictEqual(a.setupdi_destroy(stack, 0), 0,
    'NULL is not a device information set');
  assert.strictEqual(a.setupdi_destroy(stack, invalid), 0,
    'INVALID_HANDLE_VALUE is not destructible');
  const forged = a.setupdi_make_forged_set() >>> 0;
  assert.strictEqual(a.setupdi_destroy(stack, forged), 0,
    'magic and self words in an ordinary heap block do not forge HDEVINFO ownership');
  a.setupdi_free(forged);
  assert.strictEqual(a.setupdi_destroy(stack, empty), 1);
  assert.strictEqual(a.setupdi_destroy(stack, other), 1);

  const capacity = Array.from({ length: 32 }, () => a.setupdi_create(stack, 0, 0) >>> 0);
  assert(capacity.every(handle => handle && handle !== invalid));
  assert.strictEqual(new Set(capacity).size, 32,
    'all shared device-info-set slots publish distinct handles');
  assert.strictEqual(a.setupdi_create(stack, 0, 0) >>> 0, invalid,
    'a full private handle table fails instead of overwriting a live set');
  assert.strictEqual(a.setupdi_last_error(), 8,
    'table exhaustion reports ERROR_NOT_ENOUGH_MEMORY');
  for (const handle of capacity) assert.strictEqual(b.setupdi_destroy(stack, handle), 1);

  console.log('PASS  SetupAPI owns distinct empty device-info sets and rejects invalid/stale destruction');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
