#!/usr/bin/env node
'use strict';

const assert = require('assert');
const apis = require('../src/api_table.json').filter(api => api.test_call && api.nargs > 5);
const compiler = require('./compile-src');
const compile = compiler.compileSrcWasm;
// Keep the generated wrappers intact; replace only their called endpoint with
// an ABI recorder. Real-handler behavior is covered by the GDI/Winsock suites.
compiler.compileSrcWasm = (transform, options) => compile((file, source) => {
  if (file === '09b2-dispatch-table.generated.wat') {
    for (const api of apis) {
      const start = source.indexOf(`  (func (export "test_call_${api.name}")`);
      assert(start >= 0, `${api.name}: generated wrapper missing`);
      const next = source.indexOf('\n  (func', start + 1);
      const end = next < 0 ? source.length : next;
      const body = source.slice(start, end);
      const target = `(call $handle_${api.handler || api.name}`;
      assert.strictEqual(body.split(target).length, 2, `${api.name}: one endpoint`);
      source = source.slice(0, start) + body.replace(target, '(call $test_stack_capture') + source.slice(end);
    }
  }
  return transform ? transform(file, source) : source;
}, options);
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_stack_output (mut i32) (i32.const 0))
  (global $test_stack_count (mut i32) (i32.const 0))
  (func (export "test_stack_setup") (param $out i32) (param $count i32)
    (global.set $test_stack_output (local.get $out))
    (global.set $test_stack_count (local.get $count)))
  (func $test_stack_capture (param $a i32) (param $b i32) (param $c i32)
      (param $d i32) (param $e i32) (param $name i32)
    (local $i i32) (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (global.get $test_stack_output) (local.get $a))
    (call $gs32 (i32.add (global.get $test_stack_output) (i32.const 4)) (local.get $b))
    (call $gs32 (i32.add (global.get $test_stack_output) (i32.const 8)) (local.get $c))
    (call $gs32 (i32.add (global.get $test_stack_output) (i32.const 12)) (local.get $d))
    (call $gs32 (i32.add (global.get $test_stack_output) (i32.const 16)) (local.get $e))
    (call $gs32 (i32.add (global.get $test_stack_output) (i32.const 20)) (local.get $name))
    (loop $copy
      (call $gs32
        (i32.add (global.get $test_stack_output) (i32.add (i32.const 24) (i32.mul (local.get $i) (i32.const 4))))
        (call $gl32 (i32.add (local.get $sp) (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 4)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $i) (global.get $test_stack_count))))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x76543210))
    (i32.store offset=16 (global.get $reg_base)
      (i32.add (local.get $sp) (i32.mul (i32.add (global.get $test_stack_count) (i32.const 1)) (i32.const 4)))))
`;

(async () => {
  assert(apis.length >= 23, 'stack-wrapper inventory must include migrated GDI and Winsock APIs');
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.guest_alloc(256) >>> 0;
  const out = e.guest_alloc(128) >>> 0;
  const read = ptr => e.guest_read32(ptr) >>> 0;
  let count = 0;
  for (const api of apis) {
    const args = Array.from({ length: api.nargs }, (_, i) => (0x81020304 + i * 0x01010101) >>> 0);
    for (let alignment = 0; alignment < 4; alignment++) {
      const sp = stack + 8 + alignment;
      for (let i = 0; i < 256; i++) e.guest_write8(stack + i, 0xcc);
      for (let i = 0; i < 128; i++) e.guest_write8(out + i, 0xdd);
      e.test_stack_setup(out, api.nargs);
      e.set_esp(sp);
      assert.strictEqual(e[`test_call_${api.name}`](...args) >>> 0, 0x76543210, api.name);
      assert.strictEqual(e.get_esp() >>> 0, sp, `${api.name}: restore ESP`);
      assert.deepStrictEqual(Array.from({ length: 5 }, (_, i) => read(out + i * 4)), args.slice(0, 5),
        `${api.name}: first five handler arguments`);
      assert.strictEqual(read(out + 20), 0, `${api.name}: zero name pointer`);
      assert.deepStrictEqual(Array.from({ length: api.nargs }, (_, i) => read(out + 24 + i * 4)), args,
        `${api.name}: all stack words observed inside the handler at alignment ${alignment}`);
      assert.strictEqual(read(sp - 4), 0xcccccccc, 'before-frame guard');
      assert.strictEqual(read(sp), 0xcccccccc, 'return address untouched');
      assert.strictEqual(read(sp + 4 * (api.nargs + 1)), 0xcccccccc, 'after-frame guard');
      count++;
    }
  }
  console.log(`PASS ${count} generated stack-wrapper calls: arguments, alignment, guards, result and ESP`);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
