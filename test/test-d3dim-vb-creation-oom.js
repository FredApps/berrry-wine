'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const apis = require('../src/api_table.json');
const extra = String.raw`
 (global $test_fail (mut i32) (i32.const 0))
 (global $test_attempts (mut i32) (i32.const 0))
 (func $test_vb_alloc (param $size i32) (param $stage i32) (result i32)
   (if (i32.eq (global.get $test_fail) (local.get $stage)) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $size)))
 (func $test_vb_object (param $type i32) (param $vtbl i32) (result i32)
   (global.set $test_attempts (i32.add (global.get $test_attempts) (i32.const 1)))
   (if (i32.eq (global.get $test_fail) (i32.const 3)) (then (return (i32.const 0))))
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
 (func (export "data") (param $p i32) (result i32)
   (load.field DxObject misc0 (call $dx_from_this (local.get $p))))
 (func (export "desc") (param $p i32) (result i32)
   (i32.load offset=16 (call $dx_from_this (local.get $p))))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $p i32) (param $desc i32) (param $out i32) (param $fourth i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $p) (local.get $desc) (local.get $out)
     (local.get $fourth) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  let patched = 0;
  const wasm = compileSrcWasm((file, source) => {
    if (file === '09ab-handlers-d3dim-core.wat') {
      const start = source.indexOf('  (func $d3dim_create_vb ');
      const end = source.indexOf('  (func $d3dim_vb_free_entry ', start);
      assert(start >= 0 && end > start);
      let body = source.slice(start, end);
      for (const [from, to] of [
        ['(call $heap_alloc (i32.const 32))', '(call $test_vb_alloc (i32.const 32) (i32.const 1))'],
        ['(call $heap_alloc (local.get $size))', '(call $test_vb_alloc (local.get $size) (i32.const 2))'],
        ['(call $dx_create_com_obj (i32.const 22) (local.get $vtbl))', '(call $test_vb_object (i32.const 22) (local.get $vtbl))'],
      ]) {
        assert.strictEqual(body.split(from).length, 2, 'one production allocation site');
        body = body.replace(from, to); patched++;
      }
      return source.slice(0, start) + body + source.slice(end);
    }
    return file === '13-exports.wat' ? source + '\n' + extra : source;
  });
  assert.strictEqual(patched, 3);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer }, imports = createHostImports(ctx); imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(wasm, imports), e = instance.exports; ctx.exports = e;
  e.init_dx_com_thunks();
  const desc = e.guest_alloc(32), out = e.guest_alloc(4), sp = e.guest_alloc(128);
  [16, 0x800, 2, 4].forEach((word, i) => e.guest_write32(desc + i * 4, word));
  const base = 0x34000000, sparseDesc = base + 4090;
  for (const page of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(page, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  [16, 0x800, 2, 4].forEach((word, i) => e.guest_write32(sparseDesc + i * 4, word));
  const heap = e.live_heap(), objects = e.live_dx();
  for (const version of [3, 7]) for (const mode of [1, 2, 3]) for (let n = 0; n < 4; n++) {
    const input = n % 2 ? sparseDesc : desc;
    const create = apis.find(a => a.name === `IDirect3D${version}_CreateVertexBuffer`).id;
    const release = apis.find(a => a.name === `IDirect3DVertexBuffer${version === 7 ? '7' : ''}_Release`).id;
    const pop = version === 3 ? 24 : 20;
    e.fail(mode); e.guest_write32(out, 0xdeadbeef); e.guest_write32(sp + pop, 0xdeadbeef);
    assert.strictEqual(e.invoke(create, sp, 0, input, out) >>> 0, mode === 3 ? 0x80004005 : 0x8007000e, 'failed allocation must not succeed');
    assert.strictEqual(e.guest_read32(out), 0); assert.strictEqual(e.live_heap(), heap);
    assert.strictEqual(e.live_dx(), objects); assert.strictEqual(e.attempts(), mode === 3 ? 1 : 0);
    assert.strictEqual(e.get_esp(), sp + pop); assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
    e.fail(0); assert.strictEqual(e.invoke(create, sp, 0, input, out), 0);
    const p = e.guest_read32(out); assert(p && e.data(p) && e.desc(p));
    assert.strictEqual(e.guest_read32(e.desc(p) + 8), 2);
    for (let i = 0; i < 48; i++) assert.strictEqual(e.guest_read8(e.data(p) + i), 0);
    assert.strictEqual(e.live_heap(), heap + 2);
    assert.strictEqual(e.invoke(release, sp, p, 0, 0), 0);
    assert.strictEqual(e.get_esp(), sp + 8);
    assert.strictEqual(e.live_heap(), heap); assert.strictEqual(e.live_dx(), objects);
  }
  console.log('PASS VB creation: 24 descriptor/data/object failures + successful retries, no leaks or premature DX slots');
  for (const version of [3, 7]) {
    const create = apis.find(a => a.name === `IDirect3D${version}_CreateVertexBuffer`).id;
    const release = apis.find(a => a.name === `IDirect3DVertexBuffer${version === 7 ? '7' : ''}_Release`).id;
    const lock = apis.find(a => a.name === `IDirect3DVertexBuffer${version === 7 ? '7' : ''}_Lock`).id;
    for (const count of [0x40000000, 0x15555556, 0xffffffff, 0x10000000]) {
      e.fail(0); e.guest_write32(desc + 12, count); e.guest_write32(out, 0xdeadbeef);
      assert.strictEqual(e.invoke(create, sp, 0, desc, out) >>> 0, 0x8007000e, 'oversized product cannot wrap or truncate into success');
      assert.strictEqual(e.guest_read32(out), 0); assert.strictEqual(e.attempts(), 0);
      assert.strictEqual(e.live_heap(), heap); assert.strictEqual(e.live_dx(), objects);
    }
    const count = Math.floor(0x400000 / 12) + 1, bytes = count * 12;
    e.guest_write32(desc + 12, count);
    assert.strictEqual(e.invoke(create, sp, 0, desc, out), 0);
    const p = e.guest_read32(out), data = e.data(p);
    assert.strictEqual(e.guest_read32(e.desc(p) + 12), count);
    assert.strictEqual(e.invoke(lock, sp, p, 0, 0, out), 0);
    assert.strictEqual(e.guest_read32(out), bytes, 'Lock reports exact storage beyond 4MiB');
    for (let i = 0; i < bytes; i += 4096) assert.strictEqual(e.guest_read8(data + i), 0);
    assert.strictEqual(e.guest_read8(data + bytes - 1), 0);
    e.guest_write8(data + bytes - 1, 0xa5);
    assert.strictEqual(e.guest_read8(data + bytes - 1), 0xa5);
    assert.strictEqual(e.invoke(release, sp, p, 0, 0), 0);
    assert.strictEqual(e.live_heap(), heap); assert.strictEqual(e.live_dx(), objects);
  }
  console.log('PASS VB sizes: eight overflow/oversize rejections and exact >4MiB allocation/Lock/release on both versions');
})().catch(error => { console.error(error); process.exitCode = 1; });
