#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const names = ['ReadConsoleOutputA', 'ReadConsoleOutputW', 'WriteConsoleOutputA', 'WriteConsoleOutputW'];
const wrappers = names.map(name => `(func (export "rect_${name}") (param $buf i32) (param $rect i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
  (call $handle_${name} (i32.const 0x30001) (local.get $buf) (i32.const 65539)
    (i32.const 0) (local.get $rect) (i32.const 0))
  (i32.load (global.get $reg_base)))`).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: wrappers + `
    (func (export "rect_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "rect_seed") (param $i i32) (param $ch i32) (param $attr i32)
      (drop (call $console_buffer_enter (i32.const 0x30001)))
      (call $console_cells_ensure)
      (i32.store16 (i32.add (global.get $console_text_base) (i32.shl (local.get $i) (i32.const 1))) (local.get $ch))
      (i32.store16 (i32.add (global.get $console_attr_base) (i32.shl (local.get $i) (i32.const 1))) (local.get $attr))
      (call $console_buffer_finish (i32.const 0)))
    (func (export "rect_cell") (param $i i32) (param $attr i32) (result i32)
      (i32.load16_u (i32.add (select (global.get $console_attr_base) (global.get $console_text_base) (local.get $attr))
        (i32.shl (local.get $i) (i32.const 1)))))
  ` });
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.rect_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const aligned = e.guest_alloc(64) >>> 0;
  const chars = [0x3a9, 66, 67], attrs = [0x1234, 0x4567, 0x89ab];
  const words = vs => vs.flatMap(v => [v & 255, (v >>> 8) & 255]);
  const data = words(chars.flatMap((c, i) => [c, attrs[i]]));
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  const cases = [
    [[0, 0, 2, 0], [0, 0, 2, 0], [[0, 0], [1, 1], [2, 2]]],
    [[79, 24, 81, 24], [79, 24, 79, 24], [[0, 1999]]],
    [[-1, 0, 1, 0], [0, 0, 1, 0], [[1, 0], [2, 1]]],
    [[80, 0, 82, 0], [0, 0, -1, -1], []],
  ];
  for (let i = 0; i < 4096; i++) e.guest_write8(other + i, 0xa5);
  for (const name of names) for (const splitRect of [false, true]) {
    for (let split = 1; split < (splitRect ? 8 : 12); split++) for (const [requested, actual, mapping] of cases) {
      const buf = splitRect ? aligned : page + 4096 - split;
      const rect = splitRect ? page + 4096 - split : aligned + 32;
      const writing = name.startsWith('Write'), wide = name.endsWith('W');
      for (let i = -1; i <= 12; i++) e.guest_write8(buf + i, 0xcc);
      for (let i = -1; i <= 8; i++) e.guest_write8(rect + i, 0xcc);
      words(requested).forEach((b, i) => e.guest_write8(rect + i, b));
      if (writing) data.forEach((b, i) => e.guest_write8(buf + i, b));
      for (const [i, screen] of mapping) e.rect_seed(screen, writing ? 32 : chars[i], writing ? 7 : attrs[i]);
      assert.strictEqual(e[`rect_${name}`](buf, rect), 1, name);
      assert.deepStrictEqual(read(rect - 1, 10), [0xcc, ...words(actual), 0xcc], `${name}: rectangle split=${split}`);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
      const expected = writing ? data.slice() : new Array(12).fill(0xcc);
      for (const [i, screen] of mapping) {
        const ch = wide ? chars[i] : chars[i] & 255;
        if (writing) {
          assert.strictEqual(e.rect_cell(screen, 0), ch);
          assert.strictEqual(e.rect_cell(screen, 1), attrs[i]);
        } else expected.splice(i * 4, 4, ...words([ch, attrs[i]]));
      }
      assert.deepStrictEqual(read(buf - 1, 14), [0xcc, ...expected, 0xcc], `${name}: data split=${split}`);
    }
  }
  assert.deepStrictEqual(read(other, 4096), new Array(4096).fill(0xa5));
  console.log('PASS console rectangles: sparse CHAR_INFO/SMALL_RECT, signed clipping, empty transfers and A/W');
})().catch(error => { console.error(error); process.exitCode = 1; });
