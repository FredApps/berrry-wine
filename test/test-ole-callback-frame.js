#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (func (export "test_seed_callback")
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x300000))
    (global.set $eip (i32.const 123))
    (global.set $steps (i32.const 77))
    (global.set $font_enum_ret_thunk (i32.const 456)))
  (func (export "test_steps") (result i32) (global.get $steps))
` + Array.from({ length: 6 }, (_, i) => {
  const n = i + 1;
  return `(func (export "test_invoke${n}") (param $ctx i32) (param $iface i32) (result i32)
    (call $ole_guest_callback_invoke${n} (local.get $ctx) (local.get $iface) (i32.const 2)
      ${Array.from({ length: i }, (_, j) => `(i32.const ${1001 + j})`).join(' ')}))`;
}).join('\n');
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.guest_alloc(128), ctx = stack + 64;
  const iface = e.guest_alloc(4), table = e.guest_alloc(12);
  const sentinel = 0xaabbccdd;
  const snapshot = () => Array.from({ length: 32 }, (_, i) => e.guest_read32(stack + i * 4) >>> 0);
  for (let n = 1; n <= 6; n++) for (const mode of ['valid', 'null-interface', 'null-vtable', 'null-method']) {
    for (let i = 0; i < 32; i++) e.guest_write32(stack + 4 * i, sentinel);
    e.guest_write32(iface, mode === 'null-vtable' ? 0 : table);
    e.guest_write32(table + 8, mode === 'null-method' ? 0 : 789);
    e.test_seed_callback();
    const result = e[`test_invoke${n}`](ctx, mode === 'null-interface' ? 0 : iface);
    const expected = Array(32).fill(sentinel);
    if (mode === 'valid') {
      const start = 16 - n - 1;
      expected[start] = 456;
      expected[start + 1] = iface;
      for (let i = 1; i < n; i++) expected[start + 1 + i] = 1000 + i;
      assert.strictEqual(result, 1);
      assert.strictEqual(e.get_esp(), ctx - 4 * (n + 1));
      assert.strictEqual(e.get_eip(), 789);
      assert.strictEqual(e.test_steps(), 0);
    } else {
      assert.strictEqual(result, 0);
      assert.strictEqual(e.get_esp(), 0x300000);
      assert.strictEqual(e.get_eip(), 123);
      assert.strictEqual(e.test_steps(), 77);
    }
    assert.deepStrictEqual(snapshot(), expected, `arity=${n} mode=${mode}: exact frame, context and guards`);
  }
  console.log('PASS OLE callback frames: six arities, argument order, exact footprint and mutation-free NULL rejection');
})().catch(error => { console.error(error); process.exit(1); });
