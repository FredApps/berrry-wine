#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const wrappers = ['ReadConsoleA', 'ReadConsoleW', 'WriteConsoleA', 'WriteConsoleW'].map(name => `
  (func (export "text_${name}") (param $buf i32) (param $n i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_${name} (i32.const ${name.startsWith('Read') ? 1 : 0x30001})
      (local.get $buf) (local.get $n) (local.get $out) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))`).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: wrappers + `
    (func (export "text_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "text_reset") (param $mode i32)
      (i32.store (global.get $CONSOLE_INPUT) (i32.const 0))
      (i32.store (region.addr $CONSOLE_INPUT 4) (i32.const 0))
      (call $console_input_set_mode (local.get $mode)))
    (func (export "text_push") (param i32) (call $console_input_push (local.get 0) (local.get 0)))
    (func (export "text_count") (result i32) (call $console_input_count))
    (func (export "text_cursor_reset")
      (drop (call $console_buffer_enter (i32.const 0x30001)))
      (global.set $console_cursor_x (i32.const 0))
      (global.set $console_cursor_y (i32.const 0))
      (call $console_buffer_finish (i32.const 0)))
    (func (export "text_cell") (param i32) (result i32)
      (i32.load16_u (i32.add (global.get $console_text_base) (i32.shl (local.get 0) (i32.const 1)))))
  ` });
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.text_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const count = e.guest_alloc(4) >>> 0;
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(other + i, 0xa5);
  for (const wide of [false, true]) {
    const suffix = wide ? 'W' : 'A', chars = [65, wide ? 0x3a9 : 0xa9, 90];
    const encode = values => values.flatMap(c => wide ? [c & 255, c >> 8] : [c & 255]);
    const source = encode(chars);
    for (let split = 1; split < source.length; split++) {
      const ptr = page + 4096 - split;
      source.forEach((b, i) => e.guest_write8(ptr + i, b));
      e.text_cursor_reset();
      assert.strictEqual(e[`text_WriteConsole${suffix}`](ptr, chars.length, count), 1);
      assert.deepStrictEqual(chars.map((_, i) => e.text_cell(i)), chars);
      assert.strictEqual(e.guest_read32(count), chars.length);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
    }
    for (const line of [false, true]) for (const limited of [false, true]) {
      const queued = line ? [...chars, 13] : chars;
      const expectedChars = limited ? chars.slice(0, 2) : line ? [...chars, 13, 10] : chars;
      const bytes = encode(expectedChars);
      for (let split = 1; split < bytes.length; split++) {
        const ptr = page + 4096 - split;
        e.text_reset(line ? 2 : 0); queued.forEach(c => e.text_push(c));
        for (let i = -1; i <= bytes.length; i++) e.guest_write8(ptr + i, 0xcc);
        assert.strictEqual(e[`text_ReadConsole${suffix}`](ptr, expectedChars.length, count), 1);
        assert.deepStrictEqual(read(ptr - 1, bytes.length + 2), [0xcc, ...bytes, 0xcc]);
        assert.strictEqual(e.guest_read32(count), expectedChars.length);
        assert.strictEqual(e.text_count(), limited ? queued.length - 2 : 0);
        assert.strictEqual(e.get_esp() >>> 0, 0x074ff018);
      }
    }
  }
  assert.deepStrictEqual(read(other, 4096), new Array(4096).fill(0xa5));
  console.log('PASS console text: sparse A/W reads/writes, CRLF, bounded reads, queue consumption and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
