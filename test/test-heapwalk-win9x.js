#!/usr/bin/env node
'use strict';

// HeapWalk and GetProcessHeaps are NT-only. On Windows 95/98 both fail with
// ERROR_CALL_NOT_IMPLEMENTED, and SmartHeap (SHW32.DLL, Disciples demo) picks
// its Win9x path on exactly that code.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

let extraWat = String.raw`
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

const rows = require('../src/api_table.json');
const toolhelp = ['CreateToolhelp32Snapshot', 'Heap32ListFirst', 'Heap32ListNext', 'Heap32First', 'Heap32Next'];
for (const name of [...toolhelp, 'GetModuleHandleA', 'GetProcAddress', 'GetCurrentProcessId',
  'HeapCreate', 'HeapDestroy', 'HeapAlloc', 'HeapReAlloc', 'HeapFree', 'CloseHandle']) {
  const row = rows.find(r => r.name === name);
  extraWat += `
    (func (export "${name}") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x00430000))
      ${row ? `(call $handle_${row.handler || name} (local.get $a) (local.get $b) (local.get $c) (local.get $d) (i32.const 0) (i32.const 0))` : '(i32.store (global.get $reg_base) (i32.const 0))'}
      (i32.load (global.get $reg_base)))`;
}

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const { exports: wat } = await bootRenderHarness({ extraWat, memory });
  const { exports: worker } = await bootRenderHarness({ extraWat, memory });
  const entry = wat.guest_alloc(28) >>> 0;
  assert.strictEqual(wat.test_heapwalk(0x00beef00, entry), 0, 'HeapWalk fails on Win9x');
  assert.strictEqual(wat.test_hw_last_error(), 120, 'with ERROR_CALL_NOT_IMPLEMENTED');
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x0043000c, 'HeapWalk pops two stdcall arguments');
  assert.strictEqual(wat.test_getprocessheaps(0, 0), 0, 'GetProcessHeaps reports no heaps on Win9x');
  assert.strictEqual(wat.test_hw_last_error(), 120, 'with ERROR_CALL_NOT_IMPLEMENTED');
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x0043000c, 'GetProcessHeaps pops two stdcall arguments');
  const writeString = text => {
    const p = wat.guest_alloc(text.length + 1) >>> 0;
    for (let i = 0; i <= text.length; i++) wat.guest_write8(p + i, text.charCodeAt(i) || 0);
    return p;
  };
  const module = wat.GetModuleHandleA(writeString('kernel32.dll')) >>> 0;
  for (const name of toolhelp) assert.notStrictEqual(wat.GetProcAddress(module, writeString(name)) >>> 0, 0,
    `Toolhelp export ${name} must resolve for SmartHeap`);
  const read = p => wat.guest_read32(p) >>> 0;
  const write = (p, v) => wat.guest_write32(p, v);
  const pid = wat.GetCurrentProcessId() >>> 0, heap = wat.HeapCreate(0, 0, 0) >>> 0;
  assert.ok(heap);
  const block1 = wat.HeapAlloc(heap, 0, 37) >>> 0, block2 = wat.HeapAlloc(heap, 0, 91) >>> 0;
  assert.ok(block1 && block2);
  const snapshot = wat.CreateToolhelp32Snapshot(1, pid) >>> 0;
  assert.notStrictEqual(snapshot, 0xffffffff);
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x0043000c);
  const list = wat.guest_alloc(16) >>> 0, block = wat.guest_alloc(36) >>> 0;
  write(list, 16); write(block, 36);
  const heaps = [];
  for (let ok = wat.Heap32ListFirst(snapshot, list); ok; ok = wat.Heap32ListNext(snapshot, list)) {
    assert.strictEqual(read(list + 4), pid); heaps.push(read(list + 8));
    assert.ok(heaps.length < 32, 'heap enumeration terminates');
  }
  assert.ok(heaps.includes(heap)); assert.ok(heaps.includes(0x00beef00));
  assert.strictEqual(wat.test_hw_last_error(), 18, 'end of heap list');
  const blocks = () => {
    const result = new Map(); write(block, 36);
    for (let ok = wat.Heap32First(block, pid, heap); ok; ok = wat.Heap32Next(block)) {
      assert.strictEqual(read(block + 28), pid); assert.strictEqual(read(block + 32), heap);
      assert.strictEqual(read(block + 16), 1, 'fixed live allocation');
      result.set(read(block + 8), read(block + 12)); assert.ok(result.size < 32);
    }
    return result;
  };
  assert.deepStrictEqual(blocks(), new Map([[block1, 37], [block2, 91]]));
  assert.strictEqual(wat.test_hw_esp() >>> 0, 0x00430008, 'Heap32Next stdcall');
  assert.strictEqual(worker.Heap32First(block, pid, heap), 1, 'Worker sees main allocations');
  assert.strictEqual(worker.test_hw_esp() >>> 0, 0x00430010, 'Heap32First stdcall');
  assert.strictEqual(worker.Heap32ListFirst(snapshot, list), 1, 'snapshot is shared across instances');
  assert.strictEqual(worker.test_hw_esp() >>> 0, 0x0043000c, 'Heap32ListFirst stdcall');
  assert.strictEqual(worker.Heap32ListNext(snapshot, list), 1);
  assert.strictEqual(worker.test_hw_esp() >>> 0, 0x0043000c, 'Heap32ListNext stdcall');
  assert.strictEqual(wat.HeapFree(0x00beef00, 0, block1), 0, 'wrong heap cannot free allocation');
  assert.strictEqual(wat.HeapReAlloc(0x00beef00, 0, block1, 4096), 0, 'wrong heap cannot realloc allocation');
  assert.strictEqual(wat.HeapReAlloc(heap, 0x10, block1, 4096), 0, 'in-place growth failure');
  assert.deepStrictEqual(blocks(), new Map([[block1, 37], [block2, 91]]), 'failed realloc preserves enumeration');
  const sharedBlock = worker.HeapAlloc(heap, 0, 123) >>> 0;
  assert.strictEqual(blocks().get(sharedBlock), 123, 'main sees Worker allocation');
  assert.strictEqual(wat.HeapFree(heap, 0, sharedBlock), 1);
  const grown = wat.HeapReAlloc(heap, 8, block1, 4096) >>> 0; assert.ok(grown);
  assert.strictEqual(blocks().get(grown), 4096);
  assert.strictEqual(wat.HeapFree(heap, 0, block2), 1);
  assert.deepStrictEqual(blocks(), new Map([[grown, 4096]]));
  const newerHeap = wat.HeapCreate(0, 0, 0) >>> 0;
  const oldHeaps = []; write(list, 16);
  for (let ok = wat.Heap32ListFirst(snapshot, list); ok; ok = wat.Heap32ListNext(snapshot, list)) oldHeaps.push(read(list + 8));
  assert.ok(!oldHeaps.includes(newerHeap), 'snapshot excludes heaps created later');
  assert.strictEqual(worker.CloseHandle(snapshot), 1, 'Worker can close shared snapshot');
  assert.strictEqual(wat.Heap32ListFirst(snapshot, list), 0); assert.strictEqual(wat.test_hw_last_error(), 6);
  assert.strictEqual(wat.HeapDestroy(heap), 1);
  assert.strictEqual(wat.Heap32First(block, pid, heap), 0);
  assert.strictEqual(wat.HeapDestroy(newerHeap), 1);
  write(block, 0); assert.strictEqual(wat.Heap32First(block, pid, 0x00beef00), 0);
  assert.strictEqual(wat.test_hw_last_error(), 24, 'invalid structure size');
  assert.strictEqual(wat.CreateToolhelp32Snapshot(1, pid + 1) >>> 0, 0xffffffff);
  assert.strictEqual(wat.Heap32Next(0), 0);
  assert.strictEqual(wat.test_hw_last_error(), 87, 'null entry rejected');
  console.log('PASS  Win9x Toolhelp heap enumeration, shared lifetime, realloc failure and NT-only errors');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
