#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const GMEM_INVALID_HANDLE = 0x8000;
const PROCESS_HEAP = 0x00beef00;

function globalFreeWorker() {
  const { parentPort, workerData } = require('worker_threads');
  const { module, memory, barrier, ptr, tid } = workerData;
  const imports = { host: { memory } };
  for (const imp of WebAssembly.Module.imports(module)) {
    if (!imports[imp.module]) imports[imp.module] = {};
    if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
  }
  const e = new WebAssembly.Instance(module, imports).exports;
  e.init_thread(tid, 0x00400000, 0, 0, 0, 0, 0);
  const sync = new Int32Array(barrier);
  Atomics.add(sync, 0, 1);
  Atomics.notify(sync, 0);
  while (!Atomics.load(sync, 1)) Atomics.wait(sync, 1, 0);
  parentPort.postMessage({
    result: e.test_global_free(ptr) >>> 0,
    freeList: e.get_free_list() >>> 0,
  });
}

const extraWat = String.raw`
  (func (export "test_global_alloc") (param $flags i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalAlloc (local.get $flags) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_realloc") (param $ptr i32) (param $size i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalReAlloc (local.get $ptr) (local.get $size) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_free") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalFree (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_size") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalSize (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_global_flags") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GlobalFlags (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_local_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_LocalAlloc (i32.const 0) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_local_size") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_LocalSize (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_heap_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_HeapAlloc (i32.const ${PROCESS_HEAP}) (i32.const 0) (local.get $size)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_heap_size") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_HeapSize (i32.const ${PROCESS_HEAP}) (i32.const 0) (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_heap_realloc_in_place") (param $ptr i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_HeapReAlloc (i32.const ${PROCESS_HEAP}) (i32.const 0x10)
      (local.get $ptr) (local.get $size) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_imalloc_size") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IMalloc_GetSize (i32.const 0) (local.get $ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_lockbytes_capacity") (param $ptr i32) (result i32)
    (local $obj i32)
    (local.set $obj (call $ole_create_lockbytes (local.get $ptr) (i32.const 0)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (call $gl32 (i32.add (local.get $obj) (i32.const 20))))
  (func (export "test_clipboard_binary_size") (param $ptr i32) (result i32)
    (drop (call $clipboard_store_binary_data (i32.const 8) (local.get $ptr)))
    (global.get $clipboard_binary_len))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const main = await bootRenderHarness({ extraWat, fonts: 'none', memory });
  const worker = await bootRenderHarness({ extraWat, fonts: 'none', memory });
  const a = main.exports;
  const b = worker.exports;

  a.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  a.heap_init(0x00420000);
  b.init_thread(2, 0x00400000, 0, 0, 0, 0, 0);

  assert.strictEqual(a.test_global_flags(0) >>> 0, GMEM_INVALID_HANDLE,
    'NULL is not a global memory object');
  assert.strictEqual(a.test_esp() >>> 0, 0x00300008, 'GlobalFlags pops one argument');
  for (const forged of [0x00420005, 0x52544344, 0xfffffff4]) {
    assert.strictEqual(a.test_global_flags(forged) >>> 0, GMEM_INVALID_HANDLE,
      `forged pointer 0x${forged.toString(16)} is rejected without mapping it`);
  }

  const fixed = a.test_global_alloc(0, 64) >>> 0;
  assert(fixed, 'GlobalAlloc succeeds');
  assert.strictEqual(a.test_global_flags(fixed), 0, 'live fixed allocation is unlocked');
  const fixedSize = a.test_global_size(fixed) >>> 0;
  assert(fixedSize >= 64, 'the allocation has the requested capacity');
  assert.strictEqual(a.test_local_size(fixed) >>> 0, fixedSize,
    'the provenance bit is not exposed through LocalSize');
  assert.strictEqual(a.test_heap_size(fixed) >>> 0, fixedSize,
    'the provenance bit is not exposed through HeapSize');
  assert.strictEqual(a.test_heap_realloc_in_place(fixed, fixedSize + 1), 0,
    'HeapReAlloc in-place capacity does not gain one byte from provenance');
  assert.strictEqual(a.test_imalloc_size(fixed) >>> 0, fixedSize,
    'the provenance bit is not exposed through IMalloc::GetSize');
  assert.strictEqual(a.test_lockbytes_capacity(fixed) >>> 0, fixedSize,
    'CreateILockBytesOnHGlobal sees the untagged HGLOBAL capacity');
  assert.strictEqual(a.test_clipboard_binary_size(fixed) >>> 0, fixedSize,
    'binary clipboard snapshots do not copy one provenance byte too far');

  // A marker immediately before an aligned interior pointer is not enough:
  // only a real block boundary reached from the arena base is a valid handle.
  a.guest_write32(fixed + 12, 0x11);
  assert.strictEqual(a.test_global_flags(fixed + 16) >>> 0, GMEM_INVALID_HANDLE,
    'an aligned interior pointer with a plausible tagged header is rejected');

  const local = a.test_local_alloc(32) >>> 0;
  const heap = a.test_heap_alloc(32) >>> 0;
  assert(local && heap);
  assert.strictEqual(a.test_global_flags(local) >>> 0, GMEM_INVALID_HANDLE,
    'LocalAlloc pointers do not acquire Global provenance');
  assert.strictEqual(a.test_global_flags(heap) >>> 0, GMEM_INVALID_HANDLE,
    'HeapAlloc pointers do not acquire Global provenance');

  const foreignFreed = a.test_global_alloc(0, 80) >>> 0;
  assert.strictEqual(b.test_global_flags(foreignFreed), 0,
    'Global provenance is visible in another browser Worker instance');
  assert.strictEqual(b.test_global_free(foreignFreed), 0);
  assert.strictEqual(a.test_global_flags(foreignFreed) >>> 0, GMEM_INVALID_HANDLE,
    'a cross-worker GlobalFree atomically invalidates the shared handle');
  assert.strictEqual(a.test_global_free(foreignFreed) >>> 0, foreignFreed,
    'a second GlobalFree reports the invalid handle instead of succeeding');

  const genericReuse = b.guest_alloc(80) >>> 0;
  assert.strictEqual(genericReuse, foreignFreed, 'generic heap reuses the freed block');
  assert.strictEqual(a.test_global_flags(genericReuse) >>> 0, GMEM_INVALID_HANDLE,
    'generic reuse does not retain stale Global provenance');
  b.guest_free(genericReuse);
  const globalReuse = b.test_global_alloc(0, 80) >>> 0;
  assert.strictEqual(globalReuse, foreignFreed, 'GlobalAlloc reuses the same block');
  assert.strictEqual(a.test_global_flags(globalReuse), 0,
    'Global reuse publishes fresh provenance to every instance');

  assert.strictEqual(a.test_global_realloc(0, 64, 0), 0,
    'NULL is not a GlobalAlloc handle and cannot be reallocated');

  const same = a.test_global_alloc(0, 128) >>> 0;
  assert.strictEqual(a.test_global_realloc(same, 32, 0) >>> 0, same,
    'a fitting GlobalReAlloc keeps its pointer');
  assert.strictEqual(a.test_global_flags(same), 0,
    'same-pointer GlobalReAlloc preserves provenance');

  const oom = a.test_global_alloc(0, 48) >>> 0;
  assert.strictEqual(a.test_global_realloc(oom, 0x7ffffff0, 0), 0,
    'an oversized GlobalReAlloc fails');
  assert.strictEqual(a.test_global_flags(oom), 0,
    'failed GlobalReAlloc restores the original handle provenance');

  const old = a.test_global_alloc(0, 16) >>> 0;
  const moved = a.test_global_realloc(old, 256, 0) >>> 0;
  assert(moved && moved !== old, 'growing GlobalReAlloc moves this block');
  assert.strictEqual(a.test_global_flags(old) >>> 0, GMEM_INVALID_HANDLE,
    'moved-from handle is invalid');
  assert.strictEqual(a.test_global_flags(moved), 0, 'returned handle is live');
  assert(a.test_global_size(moved) >= 256);

  // The liveness transition itself must be atomic: each WebAssembly instance
  // owns a private free-list head, so two successful frees would make the same
  // block independently reusable by two guest threads.
  const raced = a.test_global_alloc(0, 96) >>> 0;
  const barrier = new SharedArrayBuffer(8);
  const sync = new Int32Array(barrier);
  const { Worker } = require('worker_threads');
  const racers = [3, 4].map(tid => new Worker(`(${globalFreeWorker.toString()})()`, {
    eval: true,
    workerData: { module: main.module, memory, barrier, ptr: raced, tid },
  }));
  const messages = racers.map(worker => new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
  }));
  while (Atomics.load(sync, 0) !== 2) Atomics.wait(sync, 0, Atomics.load(sync, 0), 1000);
  Atomics.store(sync, 1, 1);
  Atomics.notify(sync, 1, 2);
  const outcomes = await Promise.all(messages);
  await Promise.all(racers.map(worker => worker.terminate()));
  assert.deepStrictEqual(outcomes.map(item => item.result).sort((x, y) => x - y), [0, raced],
    'exactly one simultaneous GlobalFree claims the live handle');
  assert.deepStrictEqual(outcomes.map(item => item.freeList).sort((x, y) => x - y), [0, raced - 4],
    'the block is linked into exactly one worker-private free list');
  assert.strictEqual(a.test_global_flags(raced) >>> 0, GMEM_INVALID_HANDLE);

  console.log('PASS  GlobalFlags validates exact live Global allocations across workers');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
