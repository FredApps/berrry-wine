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
  (func (export "test_dz_pte") (param $guest i32) (result i32)
    (call $virtual_query_pte (local.get $guest)))
  (func (export "test_dz_query_state") (param $guest i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualQuery (local.get $guest) (i32.const 0x00510000)
      (i32.const 28) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $gl32 (i32.const 0x00510010)))
  (func (export "test_dz_protect") (param $guest i32) (param $protect i32) (result i32)
    (call $guest_page_protect_range (local.get $guest) (i32.const 0x1000)
      (local.get $protect)))
  (func (export "test_dz_reserve") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x2000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
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
  for (const p of [2, 3, 4]) {
    assert.strictEqual(wasm.test_dz_pte(a + p * PAGE), 0, `page ${p} unmapped by decommit`);
    assert.strictEqual(wasm.test_dz_query_state(a + p * PAGE), 0x2000,
      `VirtualQuery reports page ${p} reserved`);
  }
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
  for (const p of [2, 3, 4]) {
    assert.strictEqual(wasm.test_dz_query_state(a + p * PAGE), 0x1000,
      `VirtualQuery reports page ${p} committed again`);
    assert(pageIsZero(a, p), `page ${p} still zero after re-commit`);
  }
  for (const p of [0, 1, 5, 6, 7]) {
    assert(pageMatches(a, p, 0x11110000), `page ${p} survives the re-commit`);
  }

  // 3. size == 0 means "to the end of the allocation at this base".
  wasm.test_dz_reset();
  const before = wasm.test_dz_alloc(2 * PAGE) >>> 0;
  const b = wasm.test_dz_alloc(4 * PAGE) >>> 0;
  const after = wasm.test_dz_alloc(2 * PAGE) >>> 0;
  assert(b && after, 'second fixture allocations');
  fill(b, 4, 0x33330000);
  fill(before, 2, 0x77770000);
  fill(after, 2, 0x44440000);
  assert.strictEqual(wasm.test_dz_decommit(b, 0), 1, 'sizeless decommit returns TRUE');
  for (let p = 0; p < 4; p++) assert.strictEqual(wasm.test_dz_pte(b + p * PAGE), 0);
  assert.strictEqual(wasm.test_dz_commit_at(b, 4 * PAGE) >>> 0, b);
  for (let p = 0; p < 4; p++) assert(pageIsZero(b, p), `page ${p} zero after sizeless recommit`);
  for (let p = 0; p < 2; p++) {
    assert(pageMatches(after, p, 0x44440000), `neighbouring allocation page ${p} untouched`);
    assert(pageMatches(before, p, 0x77770000), `higher allocation page ${p} untouched`);
  }

  // 4. Existing backing is not proof of committed pages. Restore holes in a
  // mixed range, keep live bytes/protections, and do not republish outside it.
  wasm.test_dz_reset();
  const c = wasm.test_dz_alloc(8 * PAGE) >>> 0;
  fill(c, 8, 0x55550000);
  wasm.test_dz_decommit(c + PAGE, PAGE);
  wasm.test_dz_decommit(c + 5 * PAGE, PAGE);
  assert.strictEqual(wasm.test_dz_pte(c + PAGE), 0, 'fixture has an absent page');
  assert.strictEqual(wasm.test_dz_protect(c + 2 * PAGE, 0x02), 0x04);
  assert.strictEqual(wasm.test_dz_commit_at(c, 4 * PAGE) >>> 0, c);
  assert.strictEqual(wasm.test_dz_pte(c + PAGE) & 0xfff, 0x804,
    'recommit publishes absent page with requested protection');
  assert.strictEqual(wasm.test_dz_pte(c + 2 * PAGE) & 0xfff, 0x802,
    'recommit preserves existing read-only protection');
  assert(pageIsZero(c, 1), 'recommitted backing is zero');
  for (const p of [0, 2, 3, 4, 6, 7]) {
    assert(pageMatches(c, p, 0x55550000), `live page ${p} retains bytes`);
  }
  assert.strictEqual(wasm.test_dz_pte(c + 5 * PAGE), 0,
    'hole outside the requested range stays absent');
  wasm.test_dz_write32(c + PAGE, 0x12345678);
  assert.strictEqual(wasm.test_dz_read32(c + PAGE), 0x12345678,
    'recommitted page is genuinely writable, not the null sentinel');

  // 5. A request can recommit an old prefix and allocate a new tail. The
  // recursive tail path must not leave that prefix absent after success.
  wasm.test_dz_reset();
  const d = wasm.test_dz_reserve(8 * PAGE) >>> 0;
  assert(d, 'reserved range');
  assert.strictEqual(wasm.test_dz_commit_at(d, 4 * PAGE) >>> 0, d);
  fill(d, 4, 0x66660000);
  wasm.test_dz_decommit(d + 2 * PAGE, PAGE);
  assert.strictEqual(wasm.test_dz_commit_at(d + PAGE, 5 * PAGE) >>> 0, d + PAGE);
  for (const p of [2, 4, 5]) {
    assert.strictEqual(wasm.test_dz_pte(d + p * PAGE) & 0xfff, 0x804);
    assert(pageIsZero(d, p), `prefix/tail page ${p} is freshly committed`);
    wasm.test_dz_write32(d + p * PAGE, 0x12340000 + p);
    assert.strictEqual(wasm.test_dz_read32(d + p * PAGE), 0x12340000 + p);
  }
  for (const p of [0, 1, 3]) assert(pageMatches(d, p, 0x66660000));
  assert.strictEqual(wasm.test_dz_pte(d + 6 * PAGE), 0, 'unused reservation stays absent');
  wasm.test_dz_decommit(d + PAGE, PAGE);
  assert.strictEqual(wasm.test_dz_commit_at(d, 0x70000000), 0,
    'impossible backing allocation fails');
  assert.strictEqual(wasm.test_dz_pte(d + PAGE), 0,
    'failed allocation does not recommit the old prefix');

  // 6. A request beginning before an old map must preserve its backing and
  // protections, even when new pages on both sides are needed.
  wasm.test_dz_reset();
  const e = wasm.test_dz_reserve(8 * PAGE) >>> 0;
  assert.strictEqual(wasm.test_dz_commit_at(e + 2 * PAGE, 2 * PAGE) >>> 0, e + 2 * PAGE);
  fill(e + 2 * PAGE, 2, 0x12340000);
  wasm.test_dz_protect(e + 2 * PAGE, 0x02);
  assert.strictEqual(wasm.test_dz_commit_at(e, 6 * PAGE) >>> 0, e);
  assert.strictEqual(wasm.test_dz_pte(e + 2 * PAGE) & 0xfff, 0x802);
  assert(pageMatches(e + 2 * PAGE, 0, 0x12340000));
  assert(pageMatches(e + 2 * PAGE, 1, 0x12340000));
  for (const p of [0, 1, 4, 5]) assert(pageIsZero(e, p));
  assert.strictEqual(wasm.test_dz_decommit(e + PAGE - 1, 2), 1,
    'an unaligned range decommits both touched pages');
  assert.strictEqual(wasm.test_dz_pte(e), 0);
  assert.strictEqual(wasm.test_dz_pte(e + PAGE), 0);
  assert.strictEqual(wasm.test_dz_pte(e + 2 * PAGE) & 0xfff, 0x802);

  console.log('test-virtual-decommit-zero: OK');
}

main().catch(err => { console.error(err); process.exit(1); });
