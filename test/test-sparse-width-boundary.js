#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_x87_store")
      (param $guest i32) (param $group i32) (param $op i32) (param $value f64)
    (local $i i32)
    (global.set $fpu_top (i32.const 0))
    (global.set $fpu_tag (i32.const 0))
    (global.set $fpu_cw (i32.const 0x37f))
    (global.set $fpu_sw (i32.const 0))
    (global.set $fpu_raw_tag (i32.const 0))
    (loop $regs
      (call $fpu_set_phys (local.get $i) (f64.convert_i32_s (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $regs (i32.lt_u (local.get $i) (i32.const 8))))
    (call $fpu_push (local.get $value))
    (call $fpu_exec_mem (local.get $group) (local.get $op) (local.get $guest)))
  (func (export "test_x87_raw_store") (param $guest i32) (param $value i64)
    (global.set $fpu_top (i32.const 0))
    (global.set $fpu_tag (i32.const 0))
    (call $fpu_push (f64.convert_i64_s (local.get $value)))
    (call $fpu_raw_set (i32.const 0) (local.get $value))
    (call $fpu_exec_mem (i32.const 7) (i32.const 7) (local.get $guest)))
  (func (export "test_mmx_store") (param $guest i32) (param $value i64)
    (call $mmx_store64 (local.get $guest) (local.get $value)))
  (func (export "test_sparse_map") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_g2w") (param $guest i32) (result i32)
    (call $g2w (local.get $guest)))
  (func (export "test_gl16") (param $guest i32) (result i32)
    (call $gl16 (local.get $guest)))
  (func (export "test_gl32") (param $guest i32) (result i32)
    (call $gl32 (local.get $guest)))
  (func (export "test_gs16") (param $guest i32) (param $value i32)
    (call $gs16 (local.get $guest) (local.get $value)))
  (func (export "test_gs32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_guest_memmove") (param $dst i32) (param $src i32) (param $size i32)
    (call $guest_memmove (local.get $dst) (local.get $src) (local.get $size)))
  (func (export "test_guest_memset") (param $dst i32) (param $value i32) (param $size i32)
    (call $guest_memset (local.get $dst) (local.get $value) (local.get $size)))
`;

async function main() {
  const root = path.join(__dirname, '..');
  const srcDir = path.join(root, 'src');
  // Plain append: src fragments are self-balanced now, so there is no trailing
  // `)` to splice before — the old regex matched nothing and dropped extraWat.
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
  const e = instance.exports;
  context.exports = e;

  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);

  // Interleave an unrelated allocation so adjacent guest pages have backing
  // addresses far apart, as happens in the StarCraft installer worker.
  const page1 = 0x30000000;
  const page2 = page1 + 0x1000;
  assert.strictEqual(e.test_sparse_map(page1, 0x1000) >>> 0, page1);
  assert.strictEqual(e.test_sparse_map(0x28000000, 0x3000) >>> 0, 0x28000000);
  assert.strictEqual(e.test_sparse_map(page2, 0x1000) >>> 0, page2);
  assert.notStrictEqual(
    (e.test_g2w(page1 + 0xfff) + 1) >>> 0,
    e.test_g2w(page2) >>> 0,
    'fixture must use non-contiguous WASM backing');
  assert.notStrictEqual(e.test_g2w(page2 + 0x321) >>> 0, 0xf0,
    'another address in the mapped page must translate through its PTE');
  assert.notStrictEqual(e.test_g2w(page1 + 0x234) >>> 0, 0xf0,
    'an older mapping must remain independently addressable');

  const read8 = address => e.guest_read8(address) & 0xff;
  const write8 = (address, value) => e.guest_write8(address, value);
  write8(page1 + 0x345, 0x7b);
  assert.strictEqual(read8(page1 + 0x345), 0x7b,
    'byte reads must retain sparse backing semantics');
  const seed = [0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87];
  const seedBase = page1 + 0xffc;
  for (let i = 0; i < seed.length; i++) write8(seedBase + i, seed[i]);

  assert.strictEqual(e.test_gl16(page1 + 0xfff) >>> 0, 0x5443,
    'word read should gather across sparse backing');
  assert.strictEqual(e.test_gl32(page1 + 0xffd) >>> 0, 0x54433221,
    'dword read at page offset 0xffd should gather across sparse backing');
  assert.strictEqual(e.test_gl32(page1 + 0xffe) >>> 0, 0x65544332,
    'dword read at page offset 0xffe should gather across sparse backing');
  assert.strictEqual(e.test_gl32(page1 + 0xfff) >>> 0, 0x76655443,
    'dword read at page offset 0xfff should gather across sparse backing');

  e.test_gs16(page1 + 0xfff, 0xbbaa);
  assert.deepStrictEqual(
    [read8(page1 + 0xffe), read8(page1 + 0xfff), read8(page2), read8(page2 + 1)],
    [0x32, 0xaa, 0xbb, 0x65],
    'word store should scatter only its two bytes');

  for (const offset of [0xffd, 0xffe, 0xfff]) {
    for (let i = -1; i < 5; i++) write8(page1 + offset + i, 0xcc);
    e.test_gs32(page1 + offset, 0x78563412);
    assert.deepStrictEqual(
      Array.from({ length: 6 }, (_, i) => read8(page1 + offset - 1 + i)),
      [0xcc, 0x12, 0x34, 0x56, 0x78, 0xcc],
      `dword store at page offset 0x${offset.toString(16)} should scatter without touching neighbors`);
  }

  const source = page1 + 0xff8;
  const cases = [
    { group: 1, op: 2, bytes: 4, value: 1.25 },
    { group: 1, op: 3, bytes: 4, value: -2.5 },
    { group: 5, op: 2, bytes: 8, value: 1.25 },
    { group: 5, op: 3, bytes: 8, value: -2.5 },
    { group: 7, op: 7, bytes: 8, value: -1234 },
  ];
  for (const row of cases) {
    const expected = Buffer.alloc(row.bytes);
    if (row.group === 7) expected.writeBigInt64LE(BigInt(row.value));
    else if (row.bytes === 4) expected.writeFloatLE(row.value);
    else expected.writeDoubleLE(row.value);
    for (const offset of [0x80, ...Array.from({ length: row.bytes - 1 }, (_, i) => 4096 - row.bytes + 1 + i)]) {
      const address = page1 + offset;
      for (let i = -1; i <= row.bytes; i++) write8(address + i, 0xcc);
      e.test_x87_store(address, row.group, row.op, row.value);
      assert.deepStrictEqual(Array.from({ length: row.bytes + 2 }, (_, i) => read8(address - 1 + i)),
        [0xcc, ...expected, 0xcc], `x87 ${row.group}/${row.op} at ${offset.toString(16)}`);
    }
  }
  for (const store of [e.test_x87_raw_store, e.test_mmx_store]) {
    const value = -9007199254740995n;
    const expected = Buffer.alloc(8); expected.writeBigInt64LE(value);
    for (let offset = 4089; offset < 4096; offset++) {
      const address = page1 + offset;
      for (let i = -1; i <= 8; i++) write8(address + i, 0xcc);
      store(address, value);
      assert.deepStrictEqual(Array.from({ length: 10 }, (_, i) => read8(address - 1 + i)),
        [0xcc, ...expected, 0xcc], 'raw integer/MMX store preserves all bits and neighboring bytes');
    }
  }

  // Compound x87 outputs: every possible split, checked against a stable
  // aligned encoding. Explicit m80/BCD vectors also prevent a wrong encoder
  // from agreeing with itself at both destinations.
  for (const row of [
    { group: 3, op: 7, size: 10, value: 1.25, hex: '00000000000000a0ff3f' },
    { group: 3, op: 7, size: 10, value: -0, hex: '00000000000000000080' },
    { group: 3, op: 7, size: 10, value: Infinity, hex: '0000000000000080ff7f' },
    { group: 3, op: 7, size: 10, value: NaN, hex: '00000000000000c0ff7f' },
    { group: 7, op: 6, size: 10, value: -123456789, hex: '89674523010000000080' },
    { group: 1, op: 6, size: 28, value: 1.25 },
    { group: 5, op: 6, size: 108, value: 1.25 },
  ]) {
    const aligned = page1 + 0x100;
    e.test_x87_store(aligned, row.group, row.op, row.value);
    const expected = Array.from({ length: row.size }, (_, i) => read8(aligned + i));
    if (row.hex) assert.strictEqual(Buffer.from(expected).toString('hex'), row.hex);
    for (let split = 1; split < row.size; split++) {
      const address = page2 - split;
      for (let i = -1; i <= row.size; i++) write8(address + i, 0xcc);
      e.test_x87_store(address, row.group, row.op, row.value);
      assert.deepStrictEqual(Array.from({ length: row.size + 2 }, (_, i) => read8(address - 1 + i)),
        [0xcc, ...expected, 0xcc], `compound x87 ${row.group}/${row.op}, split ${split}`);
    }
  }

  const destination = page1 + 0xffc;
  for (let i = 0; i < 16; i++) write8(source + i, i + 1);
  e.test_guest_memmove(destination, source, 12);
  assert.deepStrictEqual(
    Array.from({ length: 12 }, (_, i) => read8(destination + i)),
    Array.from({ length: 12 }, (_, i) => i + 1),
    'overlapping memmove should copy backward across non-contiguous backing');

  const copyDestination = page1 + 0xff4;
  e.test_guest_memmove(copyDestination, destination, 12);
  assert.deepStrictEqual(
    Array.from({ length: 12 }, (_, i) => read8(copyDestination + i)),
    Array.from({ length: 12 }, (_, i) => i + 1),
    'forward bulk copy should cross non-contiguous backing');

  e.test_guest_memset(page1 + 0xffa, 0xa5, 12);
  assert.deepStrictEqual(
    Array.from({ length: 12 }, (_, i) => read8(page1 + 0xffa + i)),
    new Array(12).fill(0xa5),
    'bulk fill should cross non-contiguous backing');

  console.log('PASS  scalar, x87, MMX and bulk accesses cross non-contiguous sparse backing safely');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
