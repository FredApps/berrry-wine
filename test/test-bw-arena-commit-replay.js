#!/usr/bin/env node
'use strict';

// Replay the exact allocator state Black & White 2 crashed on, in seconds.
//
// Reaching that state by playing the game costs hours of software rendering
// and ends in a process that cannot be restarted, so it is worth exactly one
// data point. The state itself is durable: the probe's allocation observer
// captured all 170 sparse map records at batch 221408, the moment the guest
// asked for its level arena and got NULL back. test/fixtures/ holds them.
//
// Seed those records into a fresh instance, ask for the same arena, and the
// question "does the split fallback place this allocation" is answered
// against the real fragmentation rather than a synthetic imitation.
//
// The records are absolute guest and backing addresses. VIRTUAL_BACKING_BASE
// is pinned at 0x08000000, so they stay valid across a region-layout change;
// only the table's own address moves, and that comes from the region map.

const assert = require('assert');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const RegionMap = require('../lib/region-map.generated.js');
const capture = require('./fixtures/bw-alloc-capture-221408.json');

const MAP_STATE = RegionMap.BASE.VIRTUAL_MAP_STATE;
const MAP_TABLE = RegionMap.BASE.VIRTUAL_MAP_TABLE;
const UNMAPPED = 0xf0;

const extraWat = String.raw`
  (func (export "test_backing_base") (result i32) (global.get $VIRTUAL_BACKING_BASE))
  (func (export "test_backing_size") (result i32) (global.get $VIRTUAL_BACKING_BASE_SIZE))
  (func (export "test_virtual_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE)
        (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE)
      (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store (i32.add (global.get $VIRTUAL_MAP_STATE) (i32.const 4))
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT)))
  (func (export "test_virtual_commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_virtual_release") (param $guest i32) (result i32)
    (call $virtual_map_release (local.get $guest)))
  (func (export "test_virtual_write32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_virtual_read32") (param $guest i32) (result i32)
    (call $gl32 (local.get $guest)))
`;

async function main() {
  const wasmBytes = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = {
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  for (const name of ['create_thread', 'exit_thread', 'terminate_thread',
    'create_event', 'set_event', 'reset_event', 'wait_single', 'wait_multiple']) {
    imports.host[name] = () => 0;
  }
  imports.host.com_create_instance = () => 0x80004002;
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const wasm = instance.exports;
  context.exports = wasm;
  const state = new DataView(memory.buffer);

  // The capture is only meaningful against the pool it was taken from.
  assert.strictEqual(wasm.test_backing_base() >>> 0, capture.backingBase,
    'the backing pool base is pinned; a moved one invalidates every record');
  assert.strictEqual(wasm.test_backing_size() >>> 0, capture.backingBytes,
    'the backing pool size changed since the capture — re-capture before trusting this');
  assert.deepStrictEqual(capture.recordFields, ['guest', 'size', 'backing', 'protect']);

  wasm.test_virtual_reset();
  for (const [i, [guest, size, backing, protect]] of capture.records.entries()) {
    const rec = MAP_TABLE + i * 16;
    state.setUint32(rec, guest, true);
    state.setUint32(rec + 4, size, true);
    state.setUint32(rec + 8, backing, true);
    state.setUint32(rec + 12, protect, true);
  }
  state.setUint32(MAP_STATE, capture.records.length, true);
  state.setUint32(MAP_STATE + 4, capture.backingCursor, true);
  state.setUint32(MAP_STATE + 8, capture.reservationTop, true);

  // What the guest actually asked for: $heap_sparse_alloc rounds its need up
  // to a page, floors it at 1MB and then rounds to a 64KB granule.
  const need = capture.requestBytes;
  const arena = ((Math.max((need + 0xfff) & ~0xfff, 0x100000) + 0xffff) & ~0xffff) >>> 0;
  assert.strictEqual(arena, 10878976, 'the replayed arena must be the size the capture failed on');

  // Independently re-derive the constraint from the seeded table, so this
  // fixture cannot quietly become trivial if the capture is ever replaced:
  // the free space is there in total, but not in one piece.
  const live = capture.records.map(([, size, backing]) => [backing, backing + size])
    .sort((a, b) => a[0] - b[0]);
  let cursor = capture.backingBase;
  let largestGap = 0;
  let freeTotal = 0;
  for (const [start, end] of live) {
    if (start > cursor) { largestGap = Math.max(largestGap, start - cursor); freeTotal += start - cursor; }
    cursor = Math.max(cursor, end);
  }
  const poolEnd = capture.backingBase + capture.backingBytes;
  if (poolEnd > cursor) { largestGap = Math.max(largestGap, poolEnd - cursor); freeTotal += poolEnd - cursor; }
  assert(largestGap < arena,
    `the fixture is void unless no single extent fits: gap ${largestGap} vs arena ${arena}`);
  assert(freeTotal >= arena,
    `the fixture is void unless the pool holds the bytes in total: free ${freeTotal}`);
  assert.strictEqual(largestGap, capture.largestFreeBackingGap,
    'the re-derived largest gap must agree with the one the observer recorded');

  // A guest range of its own, below the reservation top and clear of every
  // range the capture already maps — $virtual_reserve_down's own arithmetic.
  const guest = ((capture.reservationTop - arena) & 0xFFFF0000) >>> 0;
  for (const [base, size] of capture.records.map(r => [r[0], r[1]])) {
    assert(guest + arena <= base || guest >= base + size,
      'the replayed arena must not overlap a mapped guest range');
  }

  const placed = wasm.test_virtual_commit(guest, arena) >>> 0;
  assert.strictEqual(placed, guest,
    'the arena Black & White 2 loads a level into must be placed, not refused');
  const records = state.getUint32(MAP_STATE, true);
  assert(records >= capture.records.length + 2,
    `placement must have taken more than one extent (records ${records})`);

  // Every page of it is real, distinct storage.
  const seen = new Set();
  for (let offset = 0; offset < arena; offset += 4096) {
    const physical = wasm.guest_to_wasm(guest + offset) >>> 0;
    assert.notStrictEqual(physical, UNMAPPED, `page +0x${offset.toString(16)} must translate`);
    assert(!seen.has(physical), `page +0x${offset.toString(16)} aliases another page`);
    seen.add(physical);
    assert.strictEqual(wasm.test_virtual_read32(guest + offset) >>> 0, 0,
      `page +0x${offset.toString(16)} must be zeroed`);
  }
  // The seams are seams in the backing only: the arena is one flat buffer to
  // the guest, which is what it will memset and fill with level data.
  const probes = [0, (arena >> 1) - 4, arena >> 1, arena - 4];
  probes.forEach((offset, i) => wasm.test_virtual_write32(guest + offset, 0xbb000000 + i));
  probes.forEach((offset, i) => assert.strictEqual(
    wasm.test_virtual_read32(guest + offset) >>> 0, 0xbb000000 + i,
    `offset +0x${offset.toString(16)} must read back what was written to it`));

  assert.strictEqual(wasm.test_virtual_release(guest) >>> 0, 1,
    'releasing the arena must succeed');
  assert.strictEqual(state.getUint32(MAP_STATE, true), capture.records.length,
    'release must give back every chunk the split placed');
  assert.strictEqual(wasm.guest_to_wasm(guest) >>> 0, UNMAPPED);

  console.log(`PASS  replayed B&W arena: ${arena} bytes placed across ` +
    `${records - capture.records.length} extents where the largest gap was ${largestGap}`);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
