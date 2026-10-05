#!/usr/bin/env node
'use strict';

// VirtualFree(MEM_DECOMMIT) has to clear the backing it stops describing.
//
// Windows hands back zero-filled pages the next time a decommitted range is
// committed, and the MSVC small-block heap depends on it: __sbh decommits
// 32KB groups (BW2Demo.exe does it at 0x00ade6aa) whose free-list links are
// still written through them, then commits the same addresses again and reads
// the result as fresh memory. Our commit path returns an already-mapped range
// untouched -- right for re-committing pages nobody decommitted -- so before
// this fixture the guest got its own stale free list back. Black & White 2's
// land load then read a 128x128 spatial grid full of old 32-byte-granular
// links, found a cell with data=NULL and a pointer-shaped count, and scanned
// guest address `i*4` for 770 million iterations without ever finishing.
//
// What this pins: a decommit zeroes exactly its own range, leaves neighbouring
// pages of the same allocation alone, leaves other allocations alone, survives
// a re-commit, and accepts the size==0 form meaning "to the end of this
// allocation".

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_dz_reset")
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
  (func (export "test_dz_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dz_commit_at") (param $guest i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (local.get $guest) (local.get $size) (i32.const 0x1000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dz_decommit") (param $guest i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualFree
      (local.get $guest) (local.get $size) (i32.const 0x4000)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_dz_write32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_dz_read32") (param $guest i32) (result i32)
    (call $gl32 (local.get $guest)))
`;

const PAGE = 0x1000;

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

  const fill = (base, pages, seed) => {
    for (let p = 0; p < pages; p++) {
      for (let off = 0; off < PAGE; off += 4) {
        wasm.test_dz_write32(base + p * PAGE + off, (seed + p * PAGE + off) >>> 0);
      }
    }
  };
  const pageIsZero = (base, p) => {
    for (let off = 0; off < PAGE; off += 4) {
      if ((wasm.test_dz_read32(base + p * PAGE + off) >>> 0) !== 0) return false;
    }
    return true;
  };
  const pageMatches = (base, p, seed) => {
    for (let off = 0; off < PAGE; off += 4) {
      const want = (seed + p * PAGE + off) >>> 0;
      if ((wasm.test_dz_read32(base + p * PAGE + off) >>> 0) !== want) return false;
    }
    return true;
  };

  // 1. A decommit clears exactly its own pages.
  wasm.test_dz_reset();
  const a = wasm.test_dz_alloc(8 * PAGE) >>> 0;
  const other = wasm.test_dz_alloc(4 * PAGE) >>> 0;
  assert(a && other, 'fixture allocations');
  fill(a, 8, 0x11110000);
  fill(other, 4, 0x22220000);

  assert.strictEqual(wasm.test_dz_decommit(a + 2 * PAGE, 3 * PAGE), 1, 'decommit returns TRUE');
  for (const p of [2, 3, 4]) assert(pageIsZero(a, p), `page ${p} cleared by decommit`);
  for (const p of [0, 1, 5, 6, 7]) {
    assert(pageMatches(a, p, 0x11110000), `page ${p} untouched by a neighbour's decommit`);
  }
  for (let p = 0; p < 4; p++) {
    assert(pageMatches(other, p, 0x22220000), `unrelated allocation page ${p} untouched`);
  }

  // 2. Committing the range again still reads zero -- this is the step the
  //    small-block heap takes, and the one that used to return stale bytes.
  assert.strictEqual(wasm.test_dz_commit_at(a + 2 * PAGE, 3 * PAGE) >>> 0, (a + 2 * PAGE) >>> 0,
    're-commit returns the same base');
  for (const p of [2, 3, 4]) assert(pageIsZero(a, p), `page ${p} still zero after re-commit`);
  for (const p of [0, 1, 5, 6, 7]) {
    assert(pageMatches(a, p, 0x11110000), `page ${p} survives the re-commit`);
  }

  // 3. size == 0 means "to the end of the allocation at this base".
  wasm.test_dz_reset();
  const b = wasm.test_dz_alloc(4 * PAGE) >>> 0;
  const after = wasm.test_dz_alloc(2 * PAGE) >>> 0;
  assert(b && after, 'second fixture allocations');
  fill(b, 4, 0x33330000);
  fill(after, 2, 0x44440000);
  assert.strictEqual(wasm.test_dz_decommit(b, 0), 1, 'sizeless decommit returns TRUE');
  for (let p = 0; p < 4; p++) assert(pageIsZero(b, p), `page ${p} cleared by sizeless decommit`);
  for (let p = 0; p < 2; p++) {
    assert(pageMatches(after, p, 0x44440000), `neighbouring allocation page ${p} untouched`);
  }

  console.log('test-virtual-decommit-zero: OK');
}

main().catch(err => { console.error(err); process.exit(1); });
