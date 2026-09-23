'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const extraWat = String.raw`
 (global $test_fail (mut i32) (i32.const 0))
 (func $test_cache_alloc (param $n i32) (result i32)
   (if (global.get $test_fail) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $n)))
 (func (export "fail") (param $v i32) (global.set $test_fail (local.get $v)))
 (func (export "make") (param $buf i32) (result i32)
   (local $p i32)
   (local.set $p (call $dx_create_com_obj (i32.const 21) (global.get $DX_VTBL_D3DEXEC)))
   (store.field DxObject misc0 (call $dx_from_this (local.get $p)) (local.get $buf))
   (local.get $p))
 (func (export "size") (param $p i32) (param $n i32)
   (i32.store offset=12 (call $dx_from_this (local.get $p)) (local.get $n)))
 (func (export "source") (param $buf i32) (result i32) (call $d3dim_execbuf_source_base (local.get $buf)))
 (func (export "refresh") (param $p i32) (call $d3dim_execbuf_cache_refresh (local.get $p)))
 (func (export "cache") (param $p i32) (result i32)
   (i32.load (i32.add (global.get $D3DIM_EB_CACHE_PTRS)
     (i32.mul (call $dx_slot_of (call $dx_from_this (local.get $p))) (i32.const 4)))))
 (func (export "close") (param $p i32)
   ;; Payload is a borrowed fixture; do not heap_free the sparse test mapping.
   (store.field DxObject misc0 (call $dx_from_this (local.get $p)) (i32.const 0))
   (call $handle_IDirect3DExecuteBuffer_Release (local.get $p) (i32.const 0) (i32.const 0)
     (i32.const 0) (i32.const 0) (i32.const 0)))
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
`;
(async () => {
  let patched = 0;
  const wasm = compileSrcWasm((file, source) => {
    if (file === '09ab-handlers-d3dim-core.wat') {
      const start = source.indexOf('  (func $d3dim_execbuf_cache_ensure');
      const end = source.indexOf('  (func $d3dim_execbuf_source_base', start);
      assert(start >= 0 && end > start);
      const body = source.slice(start, end);
      assert.strictEqual(body.split('(call $heap_alloc').length, 2);
      patched++;
      return source.slice(0, start) + body.replace('(call $heap_alloc', '(call $test_cache_alloc') + source.slice(end);
    }
    return file === '13-exports.wat' ? source + '\n' + extraWat : source;
  });
  assert.strictEqual(patched, 1);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer }, imports = createHostImports(ctx); imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(wasm, imports), e = instance.exports; ctx.exports = e;
  e.init_dx_com_thunks();
  const direct = e.guest_alloc(256), base = 0x38000000;
  for (const p of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(p, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  for (let i = 0; i < 4096; i++) e.guest_write8(base + 0x10000 + i, 0xa7);
  for (const buf of [direct, base + 4090]) for (const refresh of [false, true]) {
    const heap = e.live_heap(), p = e.make(buf);
    e.size(p, 64); e.fail(1);
    if (refresh) e.refresh(p); else assert.strictEqual(e.source(buf), e.guest_to_wasm(buf));
    assert.strictEqual(e.cache(p), 0); assert.strictEqual(e.live_heap(), heap);
    e.fail(0);
    for (let n = 0; n < 8; n++) {
      const size = n & 1 ? 128 : 64;
      for (let i = 0; i < size; i++) e.guest_write8(buf + i, (n + i * 13) & 255);
      e.size(p, size);
      if (refresh) e.refresh(p); else assert(e.source(buf));
      assert.strictEqual(e.live_heap(), heap + 1, 'replacement retires old cache');
      const cache = e.cache(p); assert(cache);
      assert.strictEqual(e.guest_read32(cache), buf);
      assert.strictEqual(e.guest_read32(cache + 4), size);
      for (let i = 0; i < size; i++) assert.strictEqual(e.guest_read8(cache + 32 + i), (n + i * 13) & 255, 'snapshot bytes');
      for (let i = 8; i < 32; i++) assert.strictEqual(e.guest_read8(cache + i), 0, 'new status cleared');
      e.guest_write32(cache + 12, 0x12345678);
      e.guest_write8(buf, 0xee);
      assert(e.source(buf)); assert.strictEqual(e.cache(p), cache, 'lazy reuse');
      assert.strictEqual(e.guest_read8(cache + 32), n, 'lazy source preserves original');
      e.refresh(p);
      assert.strictEqual(e.cache(p), cache, 'Unlock reuses matching cache');
      assert.strictEqual(e.guest_read8(cache + 32), 0xee, 'Unlock refreshes original');
      assert.strictEqual(e.guest_read32(cache + 12), 0x12345678, 'matching refresh preserves status');
      for (let i = 0; i < 4096; i++) assert.strictEqual(e.guest_read8(base + 0x10000 + i), 0xa7);
    }
    const old = e.cache(p), snapshot = Array.from({ length: 160 }, (_, i) => e.guest_read8(old + i));
    e.size(p, 64); e.fail(1);
    if (refresh) e.refresh(p); else assert.strictEqual(e.source(buf), e.guest_to_wasm(buf));
    assert.strictEqual(e.cache(p), old, 'failed replacement retains old owner');
    assert.strictEqual(e.live_heap(), heap + 1);
    assert.deepStrictEqual(Array.from({ length: 160 }, (_, i) => e.guest_read8(old + i)), snapshot);
    e.fail(0);
    if (refresh) e.refresh(p); else assert(e.source(buf));
    assert.strictEqual(e.guest_read32(e.cache(p) + 4), 64);
    assert.strictEqual(e.live_heap(), heap + 1, 'retry retires old owner');
    e.close(p); assert.strictEqual(e.live_heap(), heap, 'final cache released');
  }
  console.log('PASS ExecuteBuffer cache: 32 direct/sparse snapshots/replacements, eight allocation failures/retries, ownership, reuse/status and guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
