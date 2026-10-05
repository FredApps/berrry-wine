#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (func (export "test_module_limit") (result i32)
    (i32.add (global.get $WIN16_DYNAMIC_BASE) (global.get $WIN16_DYNAMIC_MODULES)))
  (func (export "test_module") (param $id i32) (param $base i32) (param $count i32)
    (local $rec i32)
    (local.set $rec (call $win16_dll_rec (local.get $id)))
    (i32.store (local.get $rec) (i32.add (i32.const 4096) (local.get $id)))
    (i32.store offset=4 (local.get $rec) (local.get $base))
    (i32.store offset=8 (local.get $rec) (i32.add (i32.const 8192) (local.get $id)))
    (i32.store offset=12 (local.get $rec) (local.get $count)))
  (func (export "test_image") (param $index i32) (result i64)
    (global.set $win16_ne_off (i32.const 123))
    (global.set $sreg_cs (call $win16_index_to_sel (local.get $index)))
    (i64.or (i64.extend_i32_u (call $win16_image_ne_off))
      (i64.shl (i64.extend_i32_u (call $win16_image_base_addr)) (i64.const 32))))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const limit = e.test_module_limit();
  const unpack = value => [Number(value & 0xffffffffn), Number(value >> 32n)];
  const fallback = [123, e.get_staging() >>> 0];
  const clear = () => { for (let id = 1; id < limit; id++) e.test_module(id, 0, 0); };
  clear();
  assert.deepStrictEqual(unpack(e.test_image(1)), fallback, 'empty registry uses task');
  for (let id = 1; id < limit; id++) {
    clear();
    const base = 100;
    e.test_module(id, base, 3);
    for (const index of [base + 1, base + 2, base + 3])
      assert.deepStrictEqual(unpack(e.test_image(index)), [4096 + id, 8192 + id], `module ${id}, selector ${index}`);
    for (const index of [0, base - 1, base, base + 4])
      assert.deepStrictEqual(unpack(e.test_image(index)), fallback, `module ${id} excludes ${index}`);
    e.test_module(id, base, 0);
    assert.deepStrictEqual(unpack(e.test_image(base + 1)), fallback, 'retired module excluded');
  }
  clear();
  e.test_module(1, 100, 3);
  e.test_module(limit - 1, 100, 3);
  assert.deepStrictEqual(unpack(e.test_image(101)), [4097, 8193], 'first matching record wins');
  e.test_module(1, 100, 0);
  assert.deepStrictEqual(unpack(e.test_image(101)), [4096 + limit - 1, 8192 + limit - 1], 'last dynamic slot included');
  console.log(`PASS Win16 image owner: all ${limit - 1} module slots, bounds, retirement, precedence and task fallback`);
})().catch(error => { console.error(error); process.exit(1); });
