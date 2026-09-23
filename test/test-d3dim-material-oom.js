'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const apis = require('../src/api_table.json');
const extra = String.raw`
 (global $test_fail (mut i32) (i32.const 0))
 (global $test_attempts (mut i32) (i32.const 0))
 (func $test_material_alloc (param $size i32) (result i32)
   (global.set $test_attempts (i32.add (global.get $test_attempts) (i32.const 1)))
   (if (global.get $test_fail) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $size)))
 (func (export "fail") (param $mode i32)
   (global.set $test_fail (local.get $mode)) (global.set $test_attempts (i32.const 0)))
 (func (export "attempts") (result i32) (global.get $test_attempts))
 (func (export "sentinel") (result i32) (global.get $NULL_SENTINEL))
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
 (func (export "make") (result i32)
   (call $dx_create_com_obj (i32.const 25) (global.get $DX_VTBL_D3DMAT3)))
 (func (export "entry") (param $p i32) (result i32) (call $dx_from_this (local.get $p)))
 (func (export "invoke") (param $id i32) (param $p i32) (param $arg i32) (param $sp i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $p) (local.get $arg)
     (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  let patched = 0;
  const wasm = compileSrcWasm((file, source) => {
    if (file === '09ab-handlers-d3dim-core.wat') {
      const start = source.indexOf('  (func $d3dim_material_set ');
      const end = source.indexOf('  (func $d3dim_material_get ', start);
      assert(start >= 0 && end > start);
      const body = source.slice(start, end), from = '(call $heap_alloc (i32.const 80))';
      assert.strictEqual(body.split(from).length, 2); patched++;
      return source.slice(0, start) + body.replace(from, '(call $test_material_alloc (i32.const 80))') + source.slice(end);
    }
    return file === '13-exports.wat' ? source + '\n' + extra : source;
  });
  assert.strictEqual(patched, 1);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer }, imports = createHostImports(ctx); imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(wasm, imports), e = instance.exports; ctx.exports = e;
  e.init_dx_com_thunks();
  const input = e.guest_alloc(80), output = e.guest_alloc(80), sp = e.guest_alloc(64), view = new DataView(memory.buffer);
  for (let i = 0; i < 80; i++) e.guest_write8(input + i, (i * 19) & 255);
  e.guest_write32(input, 80);
  const bytes = Array.from({ length: 80 }, (_, i) => e.guest_read8(input + i));
  const sentinel = () => Array.from(new Uint8Array(memory.buffer, e.sentinel(), 80));
  for (const version of ['', '2', '3']) for (let repeat = 0; repeat < 4; repeat++) {
    const p = e.make(), entry = e.entry(p), heap = e.live_heap(), before = sentinel();
    function call(method, arg, expected, pop = 12) {
      e.guest_write32(sp + pop, 0xdeadbeef);
      const id = apis.find(a => a.name === `IDirect3DMaterial${version}_${method}`).id;
      assert.strictEqual(e.invoke(id, p, arg, sp) >>> 0, expected);
      assert.strictEqual(e.get_esp(), sp + pop);
      assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
    }
    e.fail(1); call('SetMaterial', input, 0x8007000e);
    assert.strictEqual(e.attempts(), 1); assert.strictEqual(e.live_heap(), heap);
    assert.strictEqual(view.getUint32(entry + 8, true), 0, 'no published payload');
    assert.strictEqual(view.getUint32(entry + 12, true), 0, 'stored size unchanged');
    assert.strictEqual(view.getUint32(entry + 4, true), 1, 'refcount unchanged');
    assert.deepStrictEqual(sentinel(), before, 'allocation failure must not write through null');
    e.fail(0); call('SetMaterial', input, 0); assert.strictEqual(e.live_heap(), heap + 1);
    e.fail(1); call('SetMaterial', input, 0); assert.strictEqual(e.attempts(), 0, 'reuse existing payload');
    e.guest_write32(output, 80); call('GetMaterial', output, 0);
    assert.deepStrictEqual(Array.from({ length: 80 }, (_, i) => e.guest_read8(output + i)), bytes);
    call('Release', 0, 0, 8); assert.strictEqual(e.live_heap(), heap);
  }
  console.log('PASS material allocation: 12 failures preserve state/sentinel, retries/reuse/readback/final public Release and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
