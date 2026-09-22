#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "map_layout_page") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "layout_name") (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetKeyboardLayoutNameA (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
    (func (export "layout_list") (param $count i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetKeyboardLayoutList (local.get $count) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) assert.strictEqual(e.map_layout_page(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  const fill = (ga, n, value) => { for (let i = 0; i < n; i++) e.guest_write8(ga + i, value); };
  fill(unrelated, 4096, 0xa5);
  for (let split = 1; split <= 9; split++) {
    const out = page + 4096 - split;
    fill(out - 1, 11, 0xcc);
    assert.strictEqual(e.layout_name(out), 1);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
    assert.deepStrictEqual(read(out - 1, 11), [0xcc, ...Buffer.from('00000409\0'), 0xcc],
      `name split ${split}`);
  }
  assert.strictEqual(e.layout_name(0), 0, 'NULL name output rejected');
  assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  assert.strictEqual(e.layout_list(0, 0), 1, 'size query reports existing single-layout policy');
  for (let split = 1; split <= 4; split++) for (const count of [0, 1, 2]) {
    const out = page + 4096 - split;
    fill(out - 1, 10, 0xcc);
    assert.strictEqual(e.layout_list(count, out), 1);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff00c);
    assert.deepStrictEqual(read(out - 1, 10), count
      ? [0xcc, 9, 4, 9, 4, ...Array(5).fill(0xcc)] : Array(10).fill(0xcc),
    `list split ${split} capacity ${count}`);
  }
  assert.deepStrictEqual(read(unrelated, 4096), Array(4096).fill(0xa5));
  console.log('PASS keyboard-layout output boundaries, query-only, guards, capacity tails and stdcall');
})().catch(error => { console.error(error); process.exitCode = 1; });
