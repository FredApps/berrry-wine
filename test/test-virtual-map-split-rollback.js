#!/usr/bin/env node
'use strict';

// A failed split commit must undo only the records that call appended. Win32
// permits committing a range containing pages that are already committed; a
// blanket range rollback used to delete those older maps while leaving their
// MEM_RESERVE entry alive. StarCraft's Storm heap later read such an orphaned
// pool header as zero and entered its fatal allocator path.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const RegionMap = require('../lib/region-map.generated.js');

const MAP_STATE = RegionMap.BASE.VIRTUAL_MAP_STATE;
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
    (i32.store offset=4 (global.get $VIRTUAL_MAP_STATE)
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT)))
  (func (export "test_reserve") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x2000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_commit_at") (param $guest i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (local.get $guest) (local.get $size) (i32.const 0x1000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_alloc_commit") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_write32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_read32") (param $guest i32) (result i32)
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

  wasm.test_virtual_reset();
  const r=wasm.test_reserve(0x20000)>>>0;
  const header=r+0x10000;
  assert.strictEqual(wasm.test_commit_at(header,0x3000)>>>0,header);
  wasm.test_write32(header+12,0xcad00000);
  const before=wasm.guest_to_wasm(header)>>>0;
  assert.strictEqual(wasm.test_commit_at(r+0x9000,0x8000)>>>0,r+0x9000);
  const after=wasm.guest_to_wasm(header)>>>0;
  assert.strictEqual(after,before,'existing island keeps its backing');
  assert.strictEqual(wasm.test_read32(header+12)>>>0,0xcad00000,'prefix overlap preserves existing heap header in same reservation');

  // A whole-range recommit spans two islands inserted in reverse order.
  wasm.test_virtual_reset();
  const islands = wasm.test_reserve(0x20000) >>> 0;
  for (const offset of [0x15000, 0x7000]) {
    assert.strictEqual(wasm.test_commit_at(islands + offset, 0x2000) >>> 0, islands + offset);
    wasm.test_write32(islands + offset, offset);
  }
  assert.strictEqual(wasm.test_commit_at(islands, 0x20000) >>> 0, islands);
  for (const offset of [0x15000, 0x7000])
    assert.strictEqual(wasm.test_read32(islands + offset) >>> 0, offset,
      'unsorted committed islands retain their contents');

  wasm.test_virtual_reset();
  const reservation = wasm.test_reserve(0x20000) >>> 0;
  assert(reservation, 'fixture reservation');
  const oldPage = reservation + 0x8000;
  assert.strictEqual(wasm.test_commit_at(oldPage, 0x1000) >>> 0, oldPage);
  wasm.test_write32(oldPage, 0x53544f52); // "STOR"
  const oldBacking = wasm.guest_to_wasm(oldPage) >>> 0;
  assert.notStrictEqual(oldBacking, UNMAPPED);

  // Leave exactly 64KB free. The 128KB request places its first half over the
  // old page, then cannot place its second half and must roll the first back.
  assert(wasm.test_alloc_commit((wasm.test_backing_size() - 0x11000) >>> 0) >>> 0,
    'backing filler');
  const mapsBefore = state.getUint32(MAP_STATE, true);
  const reservesBefore = state.getUint32(MAP_STATE + 16, true);
  assert.strictEqual(wasm.test_commit_at(reservation, 0x20000) >>> 0, 0,
    'request exceeds remaining backing');

  assert.strictEqual(state.getUint32(MAP_STATE, true), mapsBefore,
    'failed split removes only its speculative map');
  assert.strictEqual(state.getUint32(MAP_STATE + 16, true), reservesBefore,
    'failed split retains the reservation');
  assert.strictEqual(wasm.guest_to_wasm(oldPage) >>> 0, oldBacking,
    'older committed page keeps its translation');
  assert.strictEqual(wasm.test_read32(oldPage) >>> 0, 0x53544f52,
    'older committed page keeps its contents');

  console.log('PASS  failed split rollback preserves older committed pages');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
