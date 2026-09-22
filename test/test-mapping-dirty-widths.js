#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

// Correctness-only source transform. Unlike the cost prototype, this handles
// every scalar width and both pages of a crossing. It is NOT a production hook
// or a bulk-write implementation. Staging is unused: no PE is loaded here.
const widths = [1, 2, 4, 8];
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
`).join('');

(async () => {
  const wasm = compileSrcWasm((file, source) => {
    if (file === '03-registers.wat') for (const width of widths) {
      const name = `(func $gs${width * 8} `;
      assert(source.includes(name));
      source = source.replace(name, `(func $original_gs${width * 8} `);
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
})().catch(error => { console.error(error); process.exitCode = 1; });
