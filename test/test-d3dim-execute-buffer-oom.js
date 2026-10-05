'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const apis = require('../src/api_table.json');
const extra = String.raw`
 (global $test_fail (mut i32) (i32.const 0))
 (global $test_attempts (mut i32) (i32.const 0))
 (func $test_exec_alloc (param $size i32) (result i32)
   (if (i32.eq (global.get $test_fail) (i32.const 1)) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $size)))
 (func $test_exec_object (param $type i32) (param $vtbl i32) (result i32)
   (global.set $test_attempts (i32.add (global.get $test_attempts) (i32.const 1)))
   (if (i32.eq (global.get $test_fail) (i32.const 2)) (then (return (i32.const 0))))
   (call $dx_create_com_obj (local.get $type) (local.get $vtbl)))
 (func (export "fail") (param $mode i32)
   (global.set $test_fail (local.get $mode)) (global.set $test_attempts (i32.const 0)))
 (func (export "attempts") (result i32) (global.get $test_attempts))
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
 (func (export "live_dx") (result i32)
   (local $i i32) (local $n i32)
   (loop $scan
     (if (i32.load (i32.add (global.get $DX_OBJECTS) (i32.mul (local.get $i) (global.get $DX_ENTRY_SIZE))))
       (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br_if $scan (i32.lt_u (local.get $i) (global.get $DX_MAX))))
   (local.get $n))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  let patched = 0;
  const wasm = compileSrcWasm((file, source) => {
    if (file === '09aa-handlers-d3dim.wat') {
      const start = source.indexOf('  (func $handle_IDirect3DDevice_CreateExecuteBuffer ');
      const end = source.indexOf('  (func $handle_IDirect3DDevice_GetStats ', start);
      assert(start >= 0 && end > start);
      let body = source.slice(start, end);
      for (const [from, to] of [
        ['(call $heap_alloc (local.get $sz))', '(call $test_exec_alloc (local.get $sz))'],
        ['(call $dx_create_com_obj (i32.const 21) (global.get $DX_VTBL_D3DEXEC))',
          '(call $test_exec_object (i32.const 21) (global.get $DX_VTBL_D3DEXEC))'],
      ]) {
        assert.strictEqual(body.split(from).length, 2, 'unique production allocation site');
        body = body.replace(from, to); patched++;
      }
      return source.slice(0, start) + body + source.slice(end);
    }
    return file === '13-exports.wat' ? source + '\n' + extra : source;
  });
  assert.strictEqual(patched, 2);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer }, imports = createHostImports(ctx); imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(wasm, imports), e = instance.exports; ctx.exports = e;
  e.init_dx_com_thunks();
  const desc = e.guest_alloc(20), out = e.guest_alloc(4), lock = e.guest_alloc(20), sp = e.guest_alloc(128);
  const base = 0x35000000;
  for (const p of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(p, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  const call = (name, pop, a, b = 0, c = 0) => {
    e.guest_write32(sp + pop, 0xdeadbeef);
    const result = e.invoke(apis.find(api => api.name === name).id, sp, a, b, c) >>> 0;
    assert.strictEqual(e.get_esp(), sp + pop);
    assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
    return result;
  };
  const heap = e.live_heap(), objects = e.live_dx();
  for (const mode of [1, 2]) for (let n = 0; n < 8; n++) {
    // Alternate a crossing size field and a crossing output pointer.
    const input = n & 1 ? base + 4082 : desc, output = n & 1 ? out : base + 4094;
    const size = 64 + n * 16;
    [20, 1, 0, size, 0].forEach((v, i) => e.guest_write32(input + i * 4, v));
    const before = Array.from({ length: 20 }, (_, i) => e.guest_read8(input + i));
    e.fail(mode); e.guest_write32(output, 0xdeadbeef);
    assert.strictEqual(call('IDirect3DDevice_CreateExecuteBuffer', 20, 0, input, output),
      mode === 1 ? 0x8007000e : 0x80004005, 'allocation failure cannot succeed');
    assert.strictEqual(e.guest_read32(output), 0, 'failed output cleared');
    assert.strictEqual(e.live_heap(), heap); assert.strictEqual(e.live_dx(), objects);
    assert.strictEqual(e.attempts(), mode === 1 ? 0 : 1, 'no permanent object attempt before payload exists');
    assert.deepStrictEqual(Array.from({ length: 20 }, (_, i) => e.guest_read8(input + i)), before);
    e.fail(0);
    assert.strictEqual(call('IDirect3DDevice_CreateExecuteBuffer', 20, 0, input, output), 0);
    const p = e.guest_read32(output);
    assert(p); assert.strictEqual(e.live_dx(), objects + 1); assert.strictEqual(e.live_heap(), heap + 1);
    assert.strictEqual(call('IDirect3DExecuteBuffer_Lock', 12, p, lock), 0);
    assert.strictEqual(e.guest_read32(lock + 12), size);
    const data = e.guest_read32(lock + 16); assert(data);
    e.guest_write8(data + size - 1, 0xa5); assert.strictEqual(e.guest_read8(data + size - 1), 0xa5);
    assert.strictEqual(call('IDirect3DExecuteBuffer_Release', 8, p), 0);
    assert.strictEqual(e.live_heap(), heap); assert.strictEqual(e.live_dx(), objects);
  }
  console.log('PASS ExecuteBuffer creation: 16 allocation failures/retries, sparse descriptor/output, balanced heap/DX, no premature slots and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
