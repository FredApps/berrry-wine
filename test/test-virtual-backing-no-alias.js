#!/usr/bin/env node
'use strict';

// Two guest ranges must never be published onto one backing extent.
//
// The backing pool is a bump cursor plus a list of extents earlier releases
// left behind. Both are claims ABOUT the record table rather than the table
// itself, and a stale entry in either is silent: the commit succeeds, g2w
// resolves both guest ranges, and a write through one address appears through
// the other. Black & White 2's land load is what that looks like from the
// outside -- guest 0x2e040000 and 0x2de00000 shared backing 0x18299000, so the
// loader's 128x128 spatial grid and the guest pool's free list of 32-byte
// blocks were the same bytes; the grid query at 0x9e5272 read a free-list link
// as a vector length and scanned ~770 million entries of nothing.
//
// So the record table gets the last word: a candidate extent that intersects a
// live record is treated exactly like an exhausted pool, and the placement scan
// finds somewhere nothing else owns.
//
// The fixture poisons the hole list with an extent that covers a live record's
// backing -- the shape of every way this can go wrong, without needing the
// exact release sequence that produced it in the game -- and then checks that
// the next commit lands elsewhere and that the two guest ranges are genuinely
// independent memory.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_na_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE)
        (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $VIRTUAL_HOLE_TABLE)
      (global.get $VIRTUAL_HOLE_TABLE_SIZE))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE)
      (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store (i32.add (global.get $VIRTUAL_MAP_STATE) (i32.const 4))
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT))
    (global.set $heap_sparse_ptr (i32.const 0))
    (global.set $heap_sparse_end (i32.const 0)))
  (func (export "test_na_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_na_records") (result i32)
    (i32.load (global.get $VIRTUAL_MAP_STATE)))
  (func (export "test_na_rec_guest") (param $i i32) (result i32)
    (i32.load (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4)))))
  (func (export "test_na_rec_size") (param $i i32) (result i32)
    (i32.load offset=4 (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4)))))
  (func (export "test_na_rec_backing") (param $i i32) (result i32)
    (i32.load offset=8 (i32.add (global.get $VIRTUAL_MAP_TABLE) (i32.shl (local.get $i) (i32.const 4)))))
  ;; Put an extent on the hole list without releasing anything -- the stale
  ;; bookkeeping this fix exists to survive.
  (func (export "test_na_poison_hole") (param $backing i32) (param $size i32)
    (call $virtual_hole_add (local.get $backing) (local.get $size)))
  (func (export "test_na_write32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_na_read32") (param $guest i32) (result i32)
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

  const records = () => {
    const n = wasm.test_na_records();
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        guest: wasm.test_na_rec_guest(i) >>> 0,
        size: wasm.test_na_rec_size(i) >>> 0,
        backing: wasm.test_na_rec_backing(i) >>> 0,
      });
    }
    return out;
  };
  const assertNoAlias = (where) => {
    const recs = records();
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i], b = recs[j];
        assert(a.backing >= b.backing + b.size || b.backing >= a.backing + a.size,
          `${where}: guest 0x${a.guest.toString(16)} and 0x${b.guest.toString(16)} `
          + `share backing 0x${a.backing.toString(16)}/0x${b.backing.toString(16)}`);
      }
    }
    return recs;
  };

  const MB = 0x100000;

  // 1. Ordinary commits never alias.
  wasm.test_na_reset();
  const a = wasm.test_na_alloc(MB) >>> 0;
  const b = wasm.test_na_alloc(2 * MB) >>> 0;
  assert(a && b, 'baseline allocations');
  assertNoAlias('baseline');

  // 2. A hole list that claims a live record's extent must not be believed.
  const live = records().find(r => r.guest === a);
  assert(live, 'record for the first allocation');
  wasm.test_na_poison_hole(live.backing, live.size);
  const c = wasm.test_na_alloc(MB) >>> 0;
  assert(c, 'allocation after the hole list was poisoned');
  const recs = assertNoAlias('after a poisoned hole');
  const got = recs.find(r => r.guest === c);
  assert(got, 'record for the third allocation');
  assert.notStrictEqual(got.backing, live.backing,
    'a stale hole must not place a new commit on a live extent');

  // 3. The two guest ranges are really separate memory.
  wasm.test_na_write32(a, 0xA5A5A5A5 | 0);
  wasm.test_na_write32(c, 0x5A5A5A5A | 0);
  assert.strictEqual(wasm.test_na_read32(a) >>> 0, 0xA5A5A5A5,
    'the first allocation keeps its own bytes');
  assert.strictEqual(wasm.test_na_read32(c) >>> 0, 0x5A5A5A5A,
    'the third allocation keeps its own bytes');
  assert.strictEqual(wasm.test_na_read32(a + 0x1000) >>> 0, 0,
    'nothing else wrote through the first allocation');

  console.log('test-virtual-backing-no-alias: OK');
}

main().catch(err => { console.error(err); process.exit(1); });
