#!/usr/bin/env node
'use strict';

// The store-side self-modifying-code filter (src/04-cache.wat
// $code_page_test, inlined into src/03-registers.wat $gs8/16/32/64).
//
// What it must do, and what it used to get wrong:
//   - a store to a page code was decoded from reaches the retire walk and the
//     block dies (a miss here is a silent stale-code bug);
//   - a store to a DATA page lying between two generated-code islands does
//     not -- the old filter ORed in the sparse min..max span, so StarCraft's
//     framebuffer/heap pages between Storm's blitters (0x7c6d0000..0x7ef81000)
//     sent 7.55M no-op stores per route down the walk;
//   - every page of the 4GB space has a bit (the old bitmap stopped at
//     0x10000000), and the slot fold is the page number below 0x10000000;
//   - the inline test in the store helpers agrees with $code_page_test;
//   - --code-write-legacy still reproduces the span answer for the A/B.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_cwg_map") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_cwg_probe") (param $guest i32) (result i32)
    (call $page_probe (local.get $guest)))
  (func (export "test_cwg_page_test") (param $ga i32) (result i32)
    (call $code_page_test (local.get $ga)))
  (func (export "test_cwg_is_code") (param $ga i32) (result i32)
    (call $code_write_is_code (local.get $ga)))
  (func (export "test_cwg_page_mark") (param $ga i32)
    (call $code_page_mark (local.get $ga)))
  (func (export "test_cwg_slot") (param $ga i32) (result i32)
    (call $code_page_slot (local.get $ga)))
  (func (export "test_cwg_gs64") (param $ga i32) (param $lo i32) (param $hi i32)
    (call $gs64 (local.get $ga)
      (i64.or (i64.extend_i32_u (local.get $lo))
              (i64.shl (i64.extend_i32_u (local.get $hi)) (i64.const 32)))))
  (func (export "test_cwg_span_start") (result i32)
    (global.get $generated_sparse_code_start))
  (func (export "test_cwg_span_end") (result i32)
    (global.get $generated_sparse_code_end))
`;

async function main() {
  const bytes = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = { exports: null, getMemory: () => memory.buffer };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  imports.host.exit = () => {};
  imports.host.log = () => {};
  imports.host.log_i32 = () => {};
  imports.host.crash_unimplemented = () => {};
  imports.host.wait_multiple = () => 0;
  imports.host.terminate_thread = () => 0;
  imports.host.shell_execute = () => 33;
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  context.exports = instance.exports;
  const e = instance.exports;

  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);

  const stack = (e.get_image_base() + 0xd00000) >>> 0;
  const le32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 0xff);
  const writeBytes = (ga, bytes) => bytes.forEach((b, i) => e.guest_write8(ga + i, b));
  const install = (ga, value) => writeBytes(ga, [0xb8, ...le32(value), 0xc3]); // mov eax,imm; ret
  const execute = entry => {
    e.set_esp(stack);
    e.guest_write32(stack, 0);
    e.set_eip(entry);
    e.run(1000);
    assert.strictEqual(e.get_eip() >>> 0, 0, `probe at 0x${entry.toString(16)} returns`);
    return e.get_eax() >>> 0;
  };
  const invals = () => e.get_cache_invals() >>> 0;
  const slot = ga => ((((ga >>> 12) ^ (ga >>> 28) ^ ((ga >>> 30) << 15)) & 0xffff) >>> 0);

  // ---- 1. two generated-code islands with a data page between them --------
  // High in the VirtualAlloc arena, where StarCraft's blitters live and where
  // the old 8KB bitmap had no bits at all.
  const islandA = 0x7ef60000;
  const dataB = 0x7ef75000;
  const islandC = 0x7ef90000;
  assert.strictEqual(e.test_cwg_map(islandA, 0x40000) >>> 0, islandA);
  install(islandA, 0x11111111);
  install(islandC, 0x33333333);
  assert.strictEqual(execute(islandA), 0x11111111);
  assert.strictEqual(execute(islandC), 0x33333333);
  assert.ok(e.test_cwg_probe(islandA) && e.test_cwg_probe(islandC), 'both islands decoded');
  assert.ok((e.test_cwg_span_start() >>> 0) <= dataB && (e.test_cwg_span_end() >>> 0) > dataB,
    'the sparse span still covers the data page between the islands (bookkeeping kept)');
  assert.strictEqual(e.test_cwg_page_test(islandA), 1, 'island A page is flagged');
  assert.strictEqual(e.test_cwg_page_test(islandC), 1, 'island C page is flagged');
  assert.strictEqual(e.test_cwg_page_test(dataB), 0,
    'a data page between two code islands is NOT flagged (was: inside the span)');
  assert.strictEqual(e.test_cwg_is_code(dataB), 0,
    '$code_write_is_code (the uop store-window test) agrees: no span');

  let before = invals();
  e.guest_write8(dataB + 0x10, 0x5a);
  e.guest_write16(dataB + 0x20, 0x1234);
  e.guest_write32(dataB + 0x30, 0xdeadbeef);
  e.test_cwg_gs64(dataB + 0x40, 0x01020304, 0x05060708);
  assert.strictEqual(invals(), before,
    'stores to the data page between islands never reach the retire walk');
  assert.strictEqual(e.guest_read32(dataB + 0x30) >>> 0, 0xdeadbeef, 'the data store itself landed');

  // ---- 2. a store to the code page still retires the block, every width ---
  const widths = [
    ['gs8', () => e.guest_write8(islandA + 1, 0x22), 0x11111122],
    ['gs16', () => e.guest_write16(islandA + 1, 0x2233), 0x11112233],
    ['gs32', () => e.guest_write32(islandA + 1, 0x44556677), 0x44556677],
    ['gs64', () => e.test_cwg_gs64(islandA, 0x998877b8, 0x0000c366), 0x66998877],
  ];
  for (const [name, store, expect] of widths) {
    install(islandA, 0x11111111);
    assert.strictEqual(execute(islandA), 0x11111111);
    assert.ok(e.test_cwg_probe(islandA), `${name}: block live before the store`);
    before = invals();
    store();
    assert.ok(invals() > before, `${name}: a store to a code page reaches the retire walk`);
    assert.strictEqual(e.test_cwg_probe(islandA), 0, `${name}: the covering block is retired`);
    assert.strictEqual(execute(islandA), expect, `${name}: re-execution sees the new bytes`);
  }

  // ---- 3. a store into the same code page but not over a block ------------
  // Page granularity: it reaches the walk, and the walk (byte-exact) keeps the
  // block alive.
  install(islandC, 0x33333333);
  assert.strictEqual(execute(islandC), 0x33333333);
  before = invals();
  e.guest_write32(islandC + 0x800, 0x12345678);
  assert.strictEqual(invals(), before + 1, 'same-page store takes the slow path once');
  assert.ok(e.test_cwg_probe(islandC), 'the walk is byte-exact: the block survives');

  // ---- 4. cross-page stores retire a block on the SECOND page -------------
  const crossData = 0x7ef80000;           // plain data page
  const crossCode = crossData + 0x1000;   // code starts at the page boundary
  install(crossCode, 0x0000aa00);
  assert.strictEqual(execute(crossCode), 0x0000aa00);
  assert.strictEqual(e.test_cwg_page_test(crossData), 0, 'the first page is data');
  // bytes [crossData+0xffe .. crossCode+1]: keep the 0xb8 opcode, patch imm[0]
  e.guest_write32(crossData + 0xffe, (0x00 | (0x00 << 8) | (0xb8 << 16) | (0x5c << 24)) >>> 0);
  assert.strictEqual(e.test_cwg_probe(crossCode), 0, 'gs32 across the page edge retires the next page');
  assert.strictEqual(execute(crossCode), 0x0000aa5c);
  e.guest_write16(crossData + 0xfff, 0xb800);
  assert.strictEqual(e.test_cwg_probe(crossCode), 0, 'gs16 across the page edge retires the next page');
  assert.strictEqual(execute(crossCode), 0x0000aa5c);
  e.test_cwg_gs64(crossData + 0xffc, 0, (0xb8 | (0x77 << 8) | (0x66 << 16) | (0x55 << 24)) >>> 0);
  assert.strictEqual(e.test_cwg_probe(crossCode), 0, 'gs64 across the page edge retires the next page');
  assert.strictEqual(execute(crossCode), 0x00556677);

  // ---- 5. every page of the 4GB space has a bit ----------------------------
  for (const ga of [0x00001000, 0x00401000, 0x0abcd000, 0x0ffff000, 0x10000000,
    0x7ef60123, 0x80000000, 0xbfff0000, 0xfffff000, 0xffffffff]) {
    assert.strictEqual(e.test_cwg_slot(ga) >>> 0, slot(ga), `slot fold for 0x${ga.toString(16)}`);
  }
  for (let pi = 0; pi < 0x10000; pi += 0x1111) {
    assert.strictEqual(e.test_cwg_slot(pi << 12) >>> 0, pi, 'slot is the page number below 0x10000000');
  }
  // A page up at the top of the space: marked, its neighbour not.
  e.test_cwg_page_mark(0xfffe0000);
  assert.strictEqual(e.test_cwg_page_test(0xfffe0abc), 1, 'top-of-space page is flagged');
  assert.strictEqual(e.test_cwg_page_test(0xfffdf000), 0, 'its neighbour is not');
  assert.strictEqual(e.test_cwg_page_test(0xfffff000), 0, 'nor the last page');
  // Within one 256MB segment no two pages share a slot; across segments they
  // may, and that aliasing is conservative (a wasted slow path only).
  assert.strictEqual(e.test_cwg_page_test(slot(0xfffe0000) << 12), 1,
    'the low page with the same slot reads as code (conservative alias)');
  // Section 21: a DIB page is not the low page at its own offset (the exe's
  // .text) any more, nor a DLL at the usual 0x10000000 base.
  e.test_cwg_page_mark(0x00501000);
  e.test_cwg_page_mark(0x10000000);
  assert.strictEqual(e.test_cwg_page_test(0x50504000), 0, 'DIB page is not c3.exe .text 0x501000');
  assert.strictEqual(e.test_cwg_page_test(0x50004000), 0, 'DIB page is not a DLL page at 0x10000000 (the old fold put both on slot 1)');
  assert.strictEqual(slot(0x50504000), 0x8501, 'DIB page shares a slot only with unused 0x08501000');

  // ---- 6. the inline test in the store helpers matches $code_page_test ----
  // Deterministic pseudo-random pages in unmapped high memory (their stores go
  // to the NULL sentinel, so nothing the tests above rely on is touched): half
  // are marked first, and each store's walk count must equal the bit.
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const stores = [
    ga => e.guest_write8(ga, 1),
    ga => e.guest_write16(ga, 1),
    ga => e.guest_write32(ga, 1),
    ga => e.test_cwg_gs64(ga, 1, 2),
  ];
  let flagged = 0;
  for (let i = 0; i < 400; i++) {
    const ga = ((0xc0000000 + (rnd() % 0x3fff0000)) & ~7) >>> 0;
    if (i & 1) e.test_cwg_page_mark(ga);
    const bit = e.test_cwg_page_test(ga);
    flagged += bit;
    before = invals();
    stores[i & 3](ga);
    assert.strictEqual(invals() - before, bit,
      `inline filter agrees with $code_page_test at 0x${ga.toString(16)} (store ${i & 3})`);
  }
  assert.ok(flagged >= 200, 'both outcomes were exercised');

  // ---- 7. stack stores stay off the walk -----------------------------------
  before = invals();
  for (let i = 0; i < 64; i++) e.guest_write32(stack - 4 * i, i);
  assert.strictEqual(invals(), before, 'push/call-shaped stores to the stack never take the slow path');

  // ---- 8. --code-write-legacy restores the span answer --------------------
  assert.strictEqual(e.test_cwg_page_test(dataB), 0);
  e.set_code_write_legacy(1);
  assert.strictEqual(e.test_cwg_page_test(dataB), 1,
    'legacy: enabling marks the current span, so the data page reads as code again');
  before = invals();
  e.guest_write32(dataB + 0x30, 1);
  assert.strictEqual(invals(), before + 1, 'legacy: the data-page store takes the walk again');
  // widening the span under legacy marks the newly covered pages
  const farIsland = 0x7efd0000;
  assert.strictEqual(e.test_cwg_map(farIsland, 0x1000) >>> 0, farIsland);
  install(farIsland, 0x77777777);
  assert.strictEqual(execute(farIsland), 0x77777777);
  assert.strictEqual(e.test_cwg_page_test(0x7efc0000), 1,
    'legacy: a page the span grew over is flagged');

  console.log('PASS  code-write filter: data between code islands skipped, code pages retired at every width and across page edges, whole-space slots, inline == $code_page_test, legacy span arm');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
