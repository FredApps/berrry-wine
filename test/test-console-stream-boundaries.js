#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const names = ['WriteConsoleOutputCharacterA', 'WriteConsoleOutputAttribute',
  'ReadConsoleOutputCharacterA', 'ReadConsoleOutputCharacterW', 'ReadConsoleOutputAttribute'];
const wrappers = names.map(name => `(func (export "stream_${name}")
  (param $buf i32) (param $n i32) (param $coord i32) (param $out i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
  (call $handle_${name} (i32.const 0x30001) (local.get $buf) (local.get $n)
    (local.get $coord) (local.get $out) (i32.const 0))
  (i32.load (global.get $reg_base)))`).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: wrappers + `
    (func (export "stream_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "stream_seed") (param $index i32) (param $ch i32) (param $attr i32)
      (drop (call $console_buffer_enter (i32.const 0x30001)))
      (call $console_cells_ensure)
      (i32.store16 (i32.add (global.get $console_text_base) (i32.shl (local.get $index) (i32.const 1))) (local.get $ch))
      (i32.store16 (i32.add (global.get $console_attr_base) (i32.shl (local.get $index) (i32.const 1))) (local.get $attr))
      (call $console_buffer_finish (i32.const 0)))
    (func (export "stream_cell") (param $index i32) (param $attr i32) (result i32)
      (i32.load16_u (i32.add
        (select (global.get $console_attr_base) (global.get $console_text_base) (local.get $attr))
        (i32.shl (local.get $index) (i32.const 1)))))
  ` });
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.stream_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const count = e.guest_alloc(4) >>> 0;
  const chars = [65, 0x3a9, 90], attrs = [0x1234, 0x4567, 0x89ab];
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(other + i, 0xa5);
  for (const name of names) {
    const attribute = name.endsWith('Attribute'), wide = attribute || name.endsWith('W');
    const values = attribute ? attrs : wide ? chars : chars.map(c => c & 255);
    const bytes = values.flatMap(v => wide ? [v & 255, v >> 8] : [v]);
    for (let split = 1; split < bytes.length; split++) for (const clipped of [false, true]) {
      const coord = clipped ? (24 << 16) | 79 : 79, first = clipped ? 1999 : 79;
      const n = clipped ? 1 : 3, ptr = page + 4096 - split;
      for (let i = 0; i < n; i++) e.stream_seed(first + i, chars[i], attrs[i]);
      for (let i = -1; i <= bytes.length; i++) e.guest_write8(ptr + i, 0xcc);
      if (name.startsWith('Write')) bytes.forEach((b, i) => e.guest_write8(ptr + i, b));
      assert.strictEqual(e[`stream_${name}`](ptr, 3, coord, count), 1, name);
      assert.strictEqual(e.guest_read32(count), n);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
      if (name.startsWith('Read')) {
        const size = n * (wide ? 2 : 1);
        assert.deepStrictEqual(read(ptr - 1, bytes.length + 2),
          [0xcc, ...bytes.slice(0, size), ...new Array(bytes.length - size).fill(0xcc), 0xcc], `${name} split=${split}`);
      } else {
        for (let i = 0; i < n; i++) {
          assert.strictEqual(e.stream_cell(first + i, attribute ? 1 : 0), values[i]);
          assert.strictEqual(e.stream_cell(first + i, attribute ? 0 : 1), attribute ? chars[i] : attrs[i]);
        }
        assert.deepStrictEqual(read(ptr - 1, bytes.length + 2), [0xcc, ...bytes, 0xcc]);
      }
    }
  }
  assert.deepStrictEqual(read(other, 4096), new Array(4096).fill(0xa5));
  console.log('PASS console streams: sparse character/attribute buffers, row wrap, clipping and cell halves');
})().catch(error => { console.error(error); process.exitCode = 1; });
