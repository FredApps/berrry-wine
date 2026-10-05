#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');
const names = ['GetConsoleMode', 'WriteConsoleA', 'WriteConsoleW', 'ReadConsoleA', 'ReadConsoleW',
  'FillConsoleOutputCharacterW', 'FillConsoleOutputAttribute', 'WriteConsoleOutputCharacterA',
  'WriteConsoleOutputAttribute', 'ReadConsoleOutputAttribute', 'ReadConsoleInputA', 'ReadConsoleInputW',
  'PeekConsoleInputA', 'PeekConsoleInputW', 'GetNumberOfConsoleInputEvents', 'WriteConsoleInputA', 'WriteConsoleInputW'];
const wrappers = names.map(name => `(func (export "count_${name}")
  (param i32 i32 i32 i32 i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
  (call $handle_${name} (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4) (i32.const 0))
  (i32.load (global.get $reg_base)))`).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: wrappers + `
    (func (export "count_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "count_reset")
      (i32.store (global.get $CONSOLE_INPUT) (i32.const 0))
      (i32.store (region.addr $CONSOLE_INPUT 4) (i32.const 0))
      (call $console_input_set_mode (i32.const 0))
      (call $console_input_push (i32.const 88) (i32.const 88)))
  ` });
  const page = 0x30000000;
  for (const ga of [page, 0x28000000, page + 4096]) assert.strictEqual(e.count_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const buffer = e.guest_alloc(128) >>> 0, record = e.guest_alloc(20) >>> 0;
  for (let i = 0; i < 128; i++) e.guest_write8(buffer + i, 65);
  for (let i = 0; i < 20; i++) e.guest_write8(record + i, 0);
  e.guest_write16(record, 1); e.guest_write32(record + 4, 1);
  e.guest_write16(record + 8, 1); e.guest_write16(record + 14, 88);
  for (let split = 1; split < 4; split++) {
    const out = page + 4096 - split;
    const check = (name, args, expected, result = 1) => {
      e.count_reset();
      for (let i = -1; i <= 4; i++) e.guest_write8(out + i, 0xcc);
      assert.strictEqual(e[`count_${name}`](...args, ...new Array(5 - args.length).fill(0)), result, name);
      assert.deepStrictEqual(Array.from({ length: 6 }, (_, i) => e.guest_read8(out - 1 + i)),
        [0xcc, ...Array.from({ length: 4 }, (_, i) => (expected >>> (i * 8)) & 255), 0xcc], `${name}, split ${split}`);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff000 + 4 * (apiTable.find(a => a.name === name).nargs + 1));
    };
    check('GetConsoleMode', [1, out], 0);
    check('GetNumberOfConsoleInputEvents', [1, out], 1);
    for (const name of ['WriteConsoleA', 'WriteConsoleW']) {
      check(name, [0x30001, buffer, 1, out], 1);
      check(name, [0x30001, buffer, 0, out], 0);
      check(name, [0xdead, buffer, 1, out], 0xcccccccc, 0);
    }
    for (const name of ['ReadConsoleA', 'ReadConsoleW']) check(name, [1, buffer, 1, out], 1);
    for (const name of ['FillConsoleOutputCharacterW', 'FillConsoleOutputAttribute',
      'WriteConsoleOutputCharacterA', 'WriteConsoleOutputAttribute', 'ReadConsoleOutputAttribute']) {
      const value = name.startsWith('Fill') ? 65 : buffer;
      check(name, [0x30001, value, 5, (24 << 16) | 79, out], 1);
      check(name, [0x30001, value, 0, 0, out], 0);
      check(name, [0x30001, value, 1, 80, out], 0, 0);
      check(name, [0xdead, value, 1, 0, out], 0xcccccccc, 0);
    }
    for (const name of ['ReadConsoleInputA', 'ReadConsoleInputW', 'PeekConsoleInputA', 'PeekConsoleInputW',
      'WriteConsoleInputA', 'WriteConsoleInputW']) {
      const data = name.startsWith('Write') ? record : buffer;
      check(name, [1, data, 1, out], 1);
      check(name, [1, data, 0, out], 0);
      check(name, [1, 0, 1, out], 0, 0);
      check(name, [0xdead, data, 1, out], 0xcccccccc, 0);
    }
  }
  console.log('PASS console count/mode DWORDs: all splits, success, short/empty and failure paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
