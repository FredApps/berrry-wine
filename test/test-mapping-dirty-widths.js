#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

// Correctness-only source transform. Unlike the cost prototype, this handles
// every scalar width and both pages of a crossing. It is NOT a production hook
// implementation. Bulk wrappers below are also experimental. Staging is unused:
// no PE is loaded here.
const widths = [1, 2, 4, 8];
const repOps = ['movsb', 'movsd', 'stosb', 'stosd'];
const extra = String.raw`
  (import "host" "dirty_pause" (func $dirty_pause))
  (global $dirty_table (mut i32) (i32.const 0))
  (global $dirty_repair (mut i32) (i32.const 1))
  (func (export "dirty_setup") (param $table i32) (param $repair i32)
    (global.set $dirty_table (local.get $table))
    (global.set $dirty_repair (local.get $repair)))
  (func (export "dirty_map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))
  (func $dirty_begin (param $page i32) (result i32)
    (local $cell i32) (local $stamp i32)
    (if (i32.eqz (global.get $dirty_table)) (then (return (i32.const 0))))
    (local.set $cell (i32.add (global.get $dirty_table) (i32.shl (local.get $page) (i32.const 2))))
    (local.set $stamp (i32.atomic.load (local.get $cell)))
    (if (i32.eq (i32.and (local.get $stamp) (i32.const 3)) (i32.const 1))
      (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2)))))
    (local.get $stamp))
  (func $dirty_end (param $page i32) (param $stamp i32)
    (local $cell i32)
    (if (i32.eqz (global.get $dirty_repair)) (then (return)))
    (if (i32.eqz (i32.and (local.get $stamp) (i32.const 1))) (then (return)))
    (local.set $cell (i32.add (global.get $dirty_table) (i32.shl (local.get $page) (i32.const 2))))
    (if (i32.ne (i32.shr_u (local.get $stamp) (i32.const 2))
                (i32.shr_u (i32.atomic.load (local.get $cell)) (i32.const 2)))
      (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2))))))
` + widths.map(width => `
  (func $gs${width * 8} (export "dirty_store${width}")
      (param $ga i32) (param $v ${width === 8 ? 'i64' : 'i32'})
    (local $first i32) (local $last i32) (local $a i32) (local $b i32)
    (local.set $first (i32.shr_u (local.get $ga) (i32.const 12)))
    (local.set $last (i32.shr_u (i32.add (local.get $ga) (i32.const ${width - 1})) (i32.const 12)))
    (local.set $a (call $dirty_begin (local.get $first)))
    (if (i32.ne (local.get $first) (local.get $last))
      (then (local.set $b (call $dirty_begin (local.get $last)))))
    (call $dirty_pause)
    (call $original_gs${width * 8} (local.get $ga) (local.get $v))
    (call $dirty_end (local.get $first) (local.get $a))
    (if (i32.ne (local.get $first) (local.get $last))
      (then (call $dirty_end (local.get $last) (local.get $b)))))
`).join('') + String.raw`
  (func $dirty_range (param $ga i32) (param $size i32)
    (local $page i32) (local $last i32)
    (if (i32.eqz (local.get $size)) (then (return)))
    (local.set $page (i32.shr_u (local.get $ga) (i32.const 12)))
    (local.set $last (i32.shr_u
      (i32.add (local.get $ga) (i32.sub (local.get $size) (i32.const 1))) (i32.const 12)))
    (loop $pages
      (drop (call $dirty_begin (local.get $page)))
      (local.set $page (i32.add (local.get $page) (i32.const 1)))
      (br_if $pages (i32.le_u (local.get $page) (local.get $last)))))
` + ['memmove', 'memset'].map(name => `
  (func $guest_${name} (export "dirty_${name}")
      (param $dst i32) (param $arg i32) (param $size i32)
    (if (i32.eqz (local.get $size)) (then (return)))
    (call $dirty_range (local.get $dst) (local.get $size))
    (call $dirty_pause)
    (call $original_guest_${name} (local.get $dst) (local.get $arg) (local.get $size))
    ;; Postmark avoids retaining an unbounded array of per-page generations.
    ;; This is deliberately not the scalar generation-recheck cost candidate.
    (if (global.get $dirty_repair)
      (then (call $dirty_range (local.get $dst) (local.get $size)))))
`).join('') + String.raw`
  (func (export "dirty_regs") (param $dst i32) (param $src i32)
      (param $count i32) (param $value i32) (param $direction i32)
    (i32.store offset=28 (global.get $reg_base) (local.get $dst))
    (i32.store offset=24 (global.get $reg_base) (local.get $src))
    (i32.store offset=4 (global.get $reg_base) (local.get $count))
    (i32.store (global.get $reg_base) (local.get $value))
    (global.set $df (local.get $direction)))
` + repOps.map(op => {
  const width = op.endsWith('d') ? 4 : 1;
  return `
  (func $rep_${op}_do (export "dirty_rep_${op}")
    (local $n i32) (local $dst i32) (local $size i32)
    (local.set $n (i32.load offset=4 (global.get $reg_base)))
    (if (i32.eqz (local.get $n)) (then (call $original_rep_${op}_do) (return)))
    (local.set $size (i32.mul (local.get $n) (i32.const ${width})))
    (local.set $dst (i32.load offset=28 (global.get $reg_base)))
    (if (global.get $df)
      (then (local.set $dst (i32.sub (local.get $dst)
        (i32.sub (local.get $size) (i32.const ${width}))))))
    (call $dirty_range (local.get $dst) (local.get $size))
    (call $dirty_pause)
    (call $original_rep_${op}_do)
    (if (global.get $dirty_repair)
      (then (call $dirty_range (local.get $dst) (local.get $size)))))
`;
}).join('');

(async () => {
  const wasm = compileSrcWasm((file, source) => {
    if (file === '03-registers.wat') for (const width of widths) {
      const name = `(func $gs${width * 8} `;
      assert(source.includes(name));
      source = source.replace(name, `(func $original_gs${width * 8} `);
    }
    if (file === '05b-string-ops.wat') for (const op of ['memmove', 'memset']) {
      const name = `(func $guest_${op} `;
      assert(source.includes(name));
      source = source.replace(name, `(func $original_guest_${op} `);
    }
    if (file === '05b-string-ops.wat') for (const op of repOps) {
      const name = `(func $rep_${op}_do\n`;
      assert(source.includes(name));
      source = source.replace(name, `(func $original_rep_${op}_do\n`);
    }
    return file === '13-exports.wat' ? source + extra : source;
  });
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, exports: null };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  let flush;
  imports.host.dirty_pause = () => { const f = flush; flush = null; if (f) f(); };
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = ctx.exports = instance.exports;
  const page = 0x30000000;
  for (const ga of [page, 0x28000000, page + 4096]) assert.strictEqual(e.dirty_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const table = e.get_staging();
  const flags = new Int32Array(memory.buffer, table, 1 << 20);
  flags.fill(0);
  const bytes = new Uint8Array(memory.buffer);
  const unrelated = e.guest_to_wasm(0x28000000);
  bytes.fill(0xa5, unrelated, unrelated + 4096);
  const read = (ga, n) => Array.from({ length: n }, (_, i) => bytes[e.guest_to_wasm(ga + i)]);
  const first = page >>> 12;
  const value = 0x8877665544332211n;
  let cases = 0;
  for (const width of widths) {
    const offsets = [16, 4096 - width, ...Array.from({ length: width - 1 }, (_, i) => 4095 - i)];
    for (const offset of offsets) for (let mask = 0; mask < 4; mask++) for (const race of [false, true]) {
      e.dirty_setup(table, 1);
      const ga = page + offset;
      for (let i = -1; i <= width; i++) bytes[e.guest_to_wasm(ga + i)] = 0xcc;
      flags[first] = 0x100 | (mask & 1);
      flags[first + 1] = 0x100 | ((mask >>> 1) & 1);
      const last = (ga + width - 1) >>> 12;
      flush = race ? () => {
        for (let p = first; p <= last; p++)
          if (Atomics.load(flags, p) & 1) Atomics.store(flags, p, (Atomics.load(flags, p) + 4) & ~2);
      } : null;
      e[`dirty_store${width}`](ga, width === 8 ? value : Number(value & 0xffffffffn));
      const expected = Array.from({ length: width }, (_, i) => Number((value >> BigInt(i * 8)) & 255n));
      assert.deepStrictEqual(read(ga - 1, width + 2), [0xcc, ...expected, 0xcc]);
      for (let p = first; p <= first + 1; p++) {
        const tracked = (mask >>> (p - first)) & 1;
        const touched = p <= last;
        assert.strictEqual(flags[p], 0x100 + (race && tracked && touched ? 4 : 0)
          + tracked + (tracked && touched ? 2 : 0), `width ${width} offset ${offset} mask ${mask} race ${race}`);
      }
      cases++;
    }
  }
  // Negative control: a single-width store cannot inherit repair from nested
  // scalar helpers. Clearing after notification must lose DIRTY without repair.
  e.dirty_setup(table, 0);
  flags[first] = 1;
  flush = () => Atomics.store(flags, first, 5);
  e.dirty_store1(page, 7);
  assert.strictEqual(flags[first], 5);
  assert.strictEqual(e.guest_read8(page), 7);
  assert(bytes.subarray(unrelated, unrelated + 4096).every(v => v === 0xa5));
  console.log(`PASS full-source scalar dirty candidate: ${cases} width/page/ownership/race cases and negative control`);

  const bulk = 0x31000000, bulkPage = bulk >>> 12, length = 4 * 4096;
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(e.dirty_map(bulk + i * 4096) >>> 0, bulk + i * 4096);
    assert.strictEqual(e.dirty_map(0x29000000 + i * 4096) >>> 0, 0x29000000 + i * 4096);
    const peer = e.guest_to_wasm(0x29000000 + i * 4096);
    bytes.fill(0xa5, peer, peer + 4096);
    if (i) assert.notStrictEqual(e.guest_to_wasm(bulk + i * 4096),
      e.guest_to_wasm(bulk + (i - 1) * 4096) + 4096);
  }
  const initial = Uint8Array.from({ length }, (_, i) => (i * 37 + (i >>> 8)) & 255);
  let bulkCases = 0;
  for (const [op, dst, arg, size] of [
    ['memset', 4010, 0x5a, 10000],
    ['memmove', 300, 100, 12000],
    ['memmove', 100, 300, 12000],
    ['memmove', 8192, 0, 1024],
    ['memset', 0, 0, 0],
    ['memmove', 0, 0, 0],
  ]) for (const mask of [0, 5, 10, 15]) for (const race of [false, true]) {
    e.dirty_setup(table, 1);
    for (let i = 0; i < length; i++) bytes[e.guest_to_wasm(bulk + i)] = initial[i];
    const expected = initial.slice();
    if (op === 'memset') expected.fill(arg, dst, dst + size);
    else expected.copyWithin(dst, arg, arg + size);
    for (let p = 0; p < 4; p++) flags[bulkPage + p] = 0x100 | ((mask >>> p) & 1);
    let pauses = 0;
    flush = () => {
      pauses++;
      if (!race) return;
      for (let p = dst >>> 12; p <= (dst + size - 1) >>> 12; p++) {
        if ((mask >>> p) & 1) {
          assert(flags[bulkPage + p] & 2, 'every tracked page marked before bulk write');
          Atomics.store(flags, bulkPage + p, (flags[bulkPage + p] + 4) & ~2);
        }
      }
    };
    e[`dirty_${op}`](size ? bulk + dst : 0xffffffff,
      op === 'memmove' ? bulk + arg : arg, size);
    flush = null;
    assert.strictEqual(pauses, size ? 1 : 0, 'zero-length operations do not touch tracker');
    assert.deepStrictEqual(Uint8Array.from(read(bulk, length)), expected);
    for (let p = 0; p < 4; p++) {
      const tracked = (mask >>> p) & 1;
      const touched = size > 0 && p >= (dst >>> 12) && p <= ((dst + size - 1) >>> 12);
      assert.strictEqual(flags[bulkPage + p], 0x100 + tracked
        + (tracked && touched ? 2 + (race ? 4 : 0) : 0), `${op} destination-only page ${p}`);
    }
    bulkCases++;
  }
  e.dirty_setup(table, 0);
  flags[bulkPage] = 1;
  flush = () => Atomics.store(flags, bulkPage, 5);
  e.dirty_memset(bulk, 0x77, 4);
  assert.strictEqual(flags[bulkPage], 5, 'disabled bulk postmark loses dirty bit');
  assert.strictEqual(e.guest_read32(bulk) >>> 0, 0x77777777);
  assert(read(0x29000000, length).every(v => v === 0xa5), 'unrelated bulk backing preserved');
  console.log(`PASS bulk dirty candidate: ${bulkCases} range/overlap/zero/ownership/race cases and negative control`);

  let repCases = 0;
  for (const op of repOps) for (const direction of [0, 1])
    for (const count of [0, 3, 1025]) for (const mask of [0, 5, 10, 15])
      for (const race of [false, true]) {
        const width = op.endsWith('d') ? 4 : 1, size = count * width;
        const dst = 8190, src = 16, value = 0x5a5a5a5a;
        const dstStart = bulk + dst + (direction && count ? size - width : 0);
        const srcStart = bulk + src + (direction && count ? size - width : 0);
        e.dirty_setup(table, 1);
        for (let i = 0; i < length; i++) bytes[e.guest_to_wasm(bulk + i)] = initial[i];
        const expected = initial.slice();
        if (op.startsWith('mov')) expected.set(initial.slice(src, src + size), dst);
        else expected.fill(0x5a, dst, dst + size);
        for (let p = 0; p < 4; p++) flags[bulkPage + p] = 0x100 | ((mask >>> p) & 1);
        flush = race && count ? () => {
          for (let p = dst >>> 12; p <= ((dst + size - 1) >>> 12); p++)
            if ((mask >>> p) & 1) {
              assert(flags[bulkPage + p] & 2);
              Atomics.store(flags, bulkPage + p, (flags[bulkPage + p] + 4) & ~2);
            }
        } : null;
        e.dirty_regs(dstStart, srcStart, count, value, direction);
        e[`dirty_rep_${op}`]();
        flush = null;
        assert.deepStrictEqual(Uint8Array.from(read(bulk, length)), expected, `${op} DF=${direction} count=${count}`);
        assert.strictEqual(e.get_ecx(), 0);
        assert.strictEqual(e.get_edi() >>> 0, (dstStart + (direction ? -size : size)) >>> 0);
        assert.strictEqual(e.get_esi() >>> 0,
          (srcStart + (op.startsWith('mov') ? (direction ? -size : size) : 0)) >>> 0);
        for (let p = 0; p < 4; p++) {
          const tracked = (mask >>> p) & 1;
          const touched = size > 0 && p >= (dst >>> 12) && p <= ((dst + size - 1) >>> 12);
          assert.strictEqual(flags[bulkPage + p], 0x100 + tracked
            + (tracked && touched ? 2 + (race ? 4 : 0) : 0), `${op} dirty page ${p}`);
        }
        repCases++;
      }
  assert(read(0x29000000, length).every(v => v === 0xa5));
  e.dirty_setup(table, 0);
  flags[bulkPage] = 1;
  flush = () => Atomics.store(flags, bulkPage, 5);
  e.dirty_regs(bulk + 16, bulk, 8, 0x66, 0);
  e.dirty_rep_stosb();
  assert.strictEqual(flags[bulkPage], 5, 'disabled REP postmark loses dirty bit on raw fill path');
  assert.deepStrictEqual(read(bulk + 16, 8), Array(8).fill(0x66));
  console.log(`PASS REP dirty candidate: ${repCases} byte/DWORD/direction/count/ownership/race cases`);
})().catch(error => { console.error(error); process.exitCode = 1; });
