#!/usr/bin/env node
'use strict';

// A guest commit larger than any single free backing extent, but smaller than
// the free space in total. Black & White 2's post-Continue allocation asks for
// 10878976 bytes against a largest gap of 10678272 with 96387072 free; before
// the split fallback it returned NULL and the guest copied into it unchecked.
//
// What this fixture pins is the contract, not that game: the allocation
// succeeds, every byte of it translates (including across the seam), the
// chunks land on the free holes without moving a live mapping, MEM_RELEASE
// frees the whole allocation and not just its first chunk, and a request that
// exceeds the free space in total still fails leaving the allocator untouched.

const assert = require('assert');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const RegionMap = require('../lib/region-map.generated.js');

const MAP_STATE = RegionMap.BASE.VIRTUAL_MAP_STATE;
const MAP_TABLE = RegionMap.BASE.VIRTUAL_MAP_TABLE;
const UNMAPPED = 0xf0;

const extraWat = String.raw`
  (func (export "test_backing_size") (result i32)
    (global.get $VIRTUAL_BACKING_BASE_SIZE))
  (func (export "test_virtual_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE)
        (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE)
      (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store (i32.add (global.get $VIRTUAL_MAP_STATE) (i32.const 4))
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT))
    (global.set $heap_sparse_ptr (i32.const 0))
    (global.set $heap_sparse_end (i32.const 0)))
  (func (export "test_virtual_alloc_commit") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_free") (param $guest i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualFree
      (local.get $guest) (i32.const 0) (i32.const 0x8000)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
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

  const unit = 65536;
  const mapCount = () => state.getUint32(MAP_STATE, true);
  const backingCursor = () => state.getUint32(MAP_STATE + 4, true);

  // Leave exactly two four-unit holes and no wilderness: the pool then has
  // eight units free with nothing larger than four contiguous.
  wasm.test_virtual_reset();
  const filler = wasm.test_virtual_alloc_commit(wasm.test_backing_size() - 16 * unit) >>> 0;
  const holeA = wasm.test_virtual_alloc_commit(4 * unit) >>> 0;
  const guardA = wasm.test_virtual_alloc_commit(unit) >>> 0;
  const holeB = wasm.test_virtual_alloc_commit(4 * unit) >>> 0;
  const guardB = wasm.test_virtual_alloc_commit(unit) >>> 0;
  const tail = wasm.test_virtual_alloc_commit(6 * unit) >>> 0;
  for (const p of [filler, holeA, guardA, holeB, guardB, tail]) assert(p, 'fixture setup');
  const guarded = [filler, guardA, guardB, tail].map((p, i) => {
    wasm.test_virtual_write32(p, 0x51510000 + i);
    return [p, wasm.guest_to_wasm(p) >>> 0, 0x51510000 + i];
  });
  const holePhysical = [holeA, holeB].map(p => wasm.guest_to_wasm(p) >>> 0);
  assert.strictEqual(wasm.test_virtual_free(holeA), 1);
  assert.strictEqual(wasm.test_virtual_free(holeB), 1);
  const cursorBeforeSplit = backingCursor();
  const countBeforeSplit = mapCount();

  // Eight units: larger than either hole, no larger than the two together.
  const split = wasm.test_virtual_alloc_commit(8 * unit) >>> 0;
  assert(split, 'a commit that fits the free backing in two pieces must not fail');
  assert.strictEqual(mapCount(), countBeforeSplit + 2,
    'the split allocation must occupy exactly the two recovered holes');
  assert.strictEqual(backingCursor(), cursorBeforeSplit,
    'placing into holes must not consume backing above the high-water mark');

  const chunkPhysical = [wasm.guest_to_wasm(split) >>> 0, wasm.guest_to_wasm(split + 4 * unit) >>> 0];
  for (const physical of chunkPhysical) {
    assert.notStrictEqual(physical, UNMAPPED, 'both chunks must be mapped');
    assert(holePhysical.includes(physical), 'each chunk must land on a recovered hole');
  }
  assert.notStrictEqual(chunkPhysical[0], chunkPhysical[1], 'chunks are distinct extents');
  assert.notStrictEqual(chunkPhysical[1], (chunkPhysical[0] + 4 * unit) >>> 0,
    'the fixture is void unless the two chunks are genuinely discontiguous');

  // Every page translates, and the seam is a seam only in the backing: the
  // dword before it and the dword after it are independent, adjacent storage.
  for (let offset = 0; offset < 8 * unit; offset += 4096) {
    assert.notStrictEqual(wasm.guest_to_wasm(split + offset) >>> 0, UNMAPPED,
      `page at +0x${offset.toString(16)} must translate`);
    assert.strictEqual(wasm.test_virtual_read32(split + offset) >>> 0, 0,
      `page at +0x${offset.toString(16)} must be zeroed`);
  }
  wasm.test_virtual_write32(split + 4 * unit - 4, 0xa1a2a3a4);
  wasm.test_virtual_write32(split + 4 * unit, 0xb1b2b3b4);
  wasm.test_virtual_write32(split + 8 * unit - 4, 0xc1c2c3c4);
  assert.strictEqual(wasm.test_virtual_read32(split + 4 * unit - 4) >>> 0, 0xa1a2a3a4);
  assert.strictEqual(wasm.test_virtual_read32(split + 4 * unit) >>> 0, 0xb1b2b3b4);
  assert.strictEqual(wasm.test_virtual_read32(split + 8 * unit - 4) >>> 0, 0xc1c2c3c4);
  for (const [p, physical, value] of guarded) {
    assert.strictEqual(wasm.guest_to_wasm(p) >>> 0, physical,
      'a split must never move a live mapping: native callers hold its address');
    assert.strictEqual(wasm.test_virtual_read32(p) >>> 0, value);
  }

  // A request larger than the free space in total still fails, and fails
  // clean: the partial chunks it placed on the way down are rolled back.
  const countBeforeFailure = mapCount();
  const cursorBeforeFailure = backingCursor();
  assert.strictEqual(wasm.test_virtual_alloc_commit(4 * unit) >>> 0, 0,
    'a request with no free backing left must fail');
  assert.strictEqual(mapCount(), countBeforeFailure,
    'a failed split must leave no chunk behind');
  assert.strictEqual(backingCursor(), cursorBeforeFailure,
    'a failed split must not move the backing cursor');

  // MEM_RELEASE names only the base. Both chunks must go.
  assert.strictEqual(wasm.test_virtual_free(split) >>> 0, 1, 'release must succeed');
  assert.strictEqual(mapCount(), countBeforeSplit,
    'releasing a split allocation must free every chunk, not only the first');
  assert.strictEqual(wasm.guest_to_wasm(split) >>> 0, UNMAPPED);
  assert.strictEqual(wasm.guest_to_wasm(split + 4 * unit) >>> 0, UNMAPPED);
  for (const [p, physical, value] of guarded) {
    assert.strictEqual(wasm.guest_to_wasm(p) >>> 0, physical);
    assert.strictEqual(wasm.test_virtual_read32(p) >>> 0, value);
  }
  // The freed holes are reusable, which is the proof the release was complete.
  const again = wasm.test_virtual_alloc_commit(8 * unit) >>> 0;
  assert(again, 'the backing a released split occupied must be allocatable again');
  assert.strictEqual(wasm.test_virtual_read32(again + 4 * unit - 4) >>> 0, 0,
    'recycled backing must be zeroed');

  // A commit that fits contiguously must still be one record: the fallback is
  // a fallback, not the normal path.
  wasm.test_virtual_reset();
  const whole = wasm.test_virtual_alloc_commit(8 * unit) >>> 0;
  assert(whole);
  assert.strictEqual(mapCount(), 1, 'an unfragmented pool must place one record');
  assert.strictEqual(state.getUint32(MAP_TABLE + 4, true), 8 * unit);
  assert.strictEqual(state.getUint32(MAP_TABLE + 12, true) & 0x80000000, 0,
    'a single-record allocation must not be flagged as a continuation');

  console.log('PASS  fragmented backing splits one guest commit across extents');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
