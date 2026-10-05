'use strict';

// Backing released in the extension window has to be reusable.
//
// The extension (everything above 0x20000000, present only at --memory-mb=1024)
// was a pure bump with no reuse at all, on the reasoning that a guest which
// exhausts the 316MB primary pool is growing rather than churning. Black &
// White 2's land loader is the counterexample: it churns hundreds of megabytes
// up there, and at the 191MB step the extension held a single free extent of
// 243.8MB that nothing could reach -- the hole list offered it, and the caller
// then measured it against the *primary* pool's end and threw it away, after
// $virtual_hole_take had already removed it from the list. The primary pool's
// largest free extent at that moment was 4.0MB, so the commit failed, the game
// threw std::bad_alloc and died.
//
// This pins both halves of the fix: a released ext extent is offered and
// accepted, and when the bump cursor is spent the placement slides up through
// the live records instead of giving up.

const assert = require('assert');
const fs = require('fs');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

const MB = 1024 * 1024;
const IMAGE_BASE = 0x400000;
// The module imports (memory 8192 16384 shared); the extension window only
// exists in the half above 0x20000000, so this fixture has to boot the big one.
const PAGES = 16384;
const EXT_BASE = regions.END.THREAD_RPC;
const EXT_END = PAGES * 65536;

const extraWat = `
  (func (export "test_ext_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE) (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $VIRTUAL_RESERVE_TABLE)
      (global.get $VIRTUAL_RESERVE_TABLE_SIZE))
    (call $zero_memory (global.get $VIRTUAL_HOLE_TABLE)
      (global.get $VIRTUAL_HOLE_TABLE_SIZE))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE) (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store offset=4 (global.get $VIRTUAL_MAP_STATE) (global.get $VIRTUAL_BACKING_BASE)))
  (func (export "test_ext_commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_ext_release") (param $guest i32) (result i32)
    (call $virtual_map_release (local.get $guest)))
  (func (export "test_ext_records") (result i32)
    (i32.load (global.get $VIRTUAL_MAP_STATE)))
  (func (export "test_ext_rec") (param $i i32) (param $w i32) (result i32)
    (i32.load (i32.add (i32.add (global.get $VIRTUAL_MAP_TABLE)
      (i32.shl (local.get $i) (i32.const 4))) (i32.shl (local.get $w) (i32.const 2)))))
  (func (export "test_ext_cursor") (result i32)
    (call $virtual_backing_ext_cursor))
  (func (export "test_ext_end") (result i32)
    (call $virtual_backing_ext_end))
`;

(async () => {
  const wasmBytes = process.argv[2] ? fs.readFileSync(process.argv[2])
    : compileSrcWasm((filename, source) =>
      filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const module = await WebAssembly.compile(wasmBytes);

  async function boot() {
    const memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES, shared: true });
    const host = { memory };
    for (const [n, s] of Object.entries(sigs)) host[n] = s.results?.length ? () => 0 : () => {};
    const e = (await WebAssembly.instantiate(module, { host })).exports;
    e.init_thread(0, IMAGE_BASE, 0, 0, 0, 0, 0);
    e.test_ext_reset();
    return e;
  }
  const recs = (e) => {
    const out = [];
    for (let i = 0, n = e.test_ext_records(); i < n; i++) {
      out.push({
        guest: e.test_ext_rec(i, 0) >>> 0,
        size: e.test_ext_rec(i, 1) >>> 0,
        backing: e.test_ext_rec(i, 2) >>> 0,
      });
    }
    return out;
  };
  const inExt = (r) => r.backing >= EXT_BASE;
  // Four words spread across the block; a large commit can be split, so this
  // goes through the translator rather than a view on the WASM buffer.
  const marks = (size) => [0, (size >> 2) & ~3, (size >> 1) & ~3, size - 4];
  const stamp = (e, g, size, seed) => {
    for (const off of marks(size)) e.guest_write32(g + off, (seed ^ off) | 0);
  };
  const check = (e, g, size, seed, where) => {
    for (const off of marks(size)) {
      assert.strictEqual(e.guest_read32(g + off) >>> 0, (seed ^ off) >>> 0,
        `${where}: word at +0x${off.toString(16)} of 0x${g.toString(16)} changed`);
    }
  };

  {
    const e = await boot();
    assert.strictEqual(e.test_ext_end() >>> 0, EXT_END, 'the extension window is present');
    assert.strictEqual(e.test_ext_cursor() >>> 0, EXT_BASE, 'and starts unspent');

    // Spend the primary pool, the way the land loader does: guest ranges laid
    // out upward, each one big enough that nothing is left to fit beside it.
    let guest = 0x10000000;
    for (let i = 0; i < 6; i++, guest += 64 * MB) {
      assert(e.test_ext_commit(guest, 60 * MB), `primary fill ${i}`);
    }
    assert(recs(e).some(inExt), 'the pool is spent and commits have reached the extension');

    // Two large tenants in the extension, then the first is handed back --
    // the abandoned step of a growth series.
    const a = guest; guest += 160 * MB;
    const b = guest; guest += 160 * MB;
    assert(e.test_ext_commit(a, 150 * MB), 'ext tenant A');
    assert(e.test_ext_commit(b, 150 * MB), 'ext tenant B');
    const recA = recs(e).find((r) => r.guest === a);
    const recB = recs(e).find((r) => r.guest === b);
    assert(recA && inExt(recA), 'A is backed by the extension');
    assert(recB && inExt(recB), 'B is backed by the extension');
    stamp(e, b, 150 * MB, 0xb0b00002);
    assert(e.test_ext_release(a), 'A released');

    // The bump cursor is now deep into the window and the only room left is
    // the extent A gave back. Before the fix this returned 0.
    const c = guest; guest += 160 * MB;
    assert(e.test_ext_commit(c, 150 * MB),
      '150MB must land in the extent the released tenant gave back');
    const recC = recs(e).find((r) => r.guest === c);
    assert(recC && inExt(recC), 'and it is backed by the extension, not a split of the pool');
    assert(recC.backing + 150 * MB <= recB.backing || recC.backing >= recB.backing + recB.size,
      'reused backing never overlaps the live tenant');
    assert(e.test_ext_cursor() >>> 0 <= EXT_END,
      'the bump cursor stayed inside the window');
    stamp(e, c, 150 * MB, 0xb0b00003);
    check(e, b, 150 * MB, 0xb0b00002, 'the tenant that stayed');
    check(e, c, 150 * MB, 0xb0b00003, 'the block the reuse made room for');
  }

  // Churn: the same size taken and given back many times must not walk the
  // window, which is the whole failure mode -- 151MB used of 512 and nothing
  // reachable.
  {
    const e = await boot();
    let guest = 0x10000000;
    for (let i = 0; i < 6; i++, guest += 64 * MB) {
      assert(e.test_ext_commit(guest, 60 * MB), `primary fill ${i}`);
    }
    const churnBase = guest;
    for (let i = 0; i < 12; i++) {
      const g = churnBase + i * 128 * MB;
      assert(e.test_ext_commit(g, 100 * MB), `churn ${i}: 100MB refused`);
      stamp(e, g, 100 * MB, 0xc0de0000 | i);
      check(e, g, 100 * MB, 0xc0de0000 | i, `churn ${i}`);
      assert(e.test_ext_release(g), `churn ${i} release`);
    }
  }

  console.log('Virtual backing extension reuse PASS: released extent reclaimed, churn does not walk the window');
})().catch((e) => { console.error(e); process.exitCode = 1; });
