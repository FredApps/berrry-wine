#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const names = ['WriteConsoleInputA', 'WriteConsoleInputW', 'ReadConsoleInputA', 'ReadConsoleInputW',
  'PeekConsoleInputA', 'PeekConsoleInputW'];
const wrappers = names.map(name => `(func (export "record_${name}")
  (param $buf i32) (param $count i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
  (call $handle_${name} (i32.const 1) (local.get $buf) (i32.const 3)
    (local.get $count) (i32.const 0) (i32.const 0))
  (i32.load (global.get $reg_base)))`).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: wrappers + `
    (func (export "record_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "record_reset")
      (i32.store (global.get $CONSOLE_INPUT) (i32.const 0))
      (i32.store (region.addr $CONSOLE_INPUT 4) (i32.const 0)))
    (func (export "record_count") (result i32) (call $console_input_count))
  ` });
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.record_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const aligned = e.guest_alloc(128) >>> 0, count = e.guest_alloc(4) >>> 0;
  const bytes = new Uint8Array(60), dv = new DataView(bytes.buffer);
  dv.setUint16(0, 1, true); dv.setUint32(4, 1, true); dv.setUint16(8, 3, true);
  dv.setUint16(10, 0x70, true); dv.setUint16(12, 0x3b, true); dv.setUint16(14, 0x3a9, true);
  dv.setUint32(16, 0x104, true);
  dv.setUint16(20, 2, true); dv.setUint32(24, (7 << 16) | 12, true);
  dv.setUint32(28, 5, true); dv.setUint32(32, 0x18, true); dv.setUint32(36, 4, true);
  dv.setUint16(40, 4, true);
  for (let i = 44; i < 60; i++) bytes[i] = i * 3;
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(other + i, 0xa5);
  for (const wide of [false, true]) for (let split = 1; split < 60; split++) {
    for (const inputSplit of [false, true]) {
      const edge = page + 4096 - split, src = inputSplit ? edge : aligned;
      const dst = inputSplit ? aligned : edge, suffix = wide ? 'W' : 'A';
      e.record_reset();
      bytes.forEach((b, i) => e.guest_write8(src + i, b));
      assert.strictEqual(e[`record_WriteConsoleInput${suffix}`](src, count), 1);
      assert.strictEqual(e.guest_read32(count), 3);
      assert.strictEqual(e.record_count(), 3);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff014);
      const expected = Array.from(bytes);
      for (const off of [2, 3, 22, 23, 42, 43]) expected[off] = 0xcc;
      if (!wide) expected[15] = 0;
      for (const peek of [true, false]) {
        for (let i = -1; i <= 60; i++) e.guest_write8(dst + i, 0xcc);
        assert.strictEqual(e[`record_${peek ? 'Peek' : 'Read'}ConsoleInput${suffix}`](dst, count), 1);
        assert.deepStrictEqual(read(dst - 1, 62), [0xcc, ...expected, 0xcc],
          `${suffix}, split=${split}, inputSplit=${inputSplit}, peek=${peek}`);
        assert.strictEqual(e.guest_read32(count), 3);
        assert.strictEqual(e.record_count(), peek ? 3 : 0);
        assert.strictEqual(e.get_esp() >>> 0, 0x074ff014);
      }
    }
  }
  assert.deepStrictEqual(read(other, 4096), new Array(4096).fill(0xa5));
  console.log('PASS console INPUT_RECORD arrays: all sparse splits, A/W, key/mouse/raw union, peek/read consumption');
})().catch(error => { console.error(error); process.exitCode = 1; });
