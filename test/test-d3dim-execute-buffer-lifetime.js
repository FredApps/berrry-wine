'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "invoke") (param $id i32) (param $sp i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
 (func (export "entry") (param $p i32) (result i32) (call $dx_from_this (local.get $p)))
 (func (export "cache") (param $p i32) (result i32)
   (i32.load (i32.add (global.get $D3DIM_EB_CACHE_PTRS)
     (i32.mul (call $dx_slot_of (call $dx_from_this (local.get $p))) (i32.const 4)))))
`;
(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_dx_com_thunks();
  const sp = e.guest_alloc(128), desc = e.guest_alloc(20), out = e.guest_alloc(4);
  const lock = e.guest_alloc(20);
  const call = (name, pop, a, b = 0, c = 0) => {
    e.guest_write32(sp + pop, 0xdeadbeef);
    const result = e.invoke(apis.find(api => api.name === name).id, sp, a, b, c) >>> 0;
    assert.strictEqual(e.get_esp(), sp + pop);
    assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
    return result;
  };
  const method = (p, name, b = 0, pop = 8) => call(`IDirect3DExecuteBuffer_${name}`, pop, p, b);
  // Public creation owns the payload; test both never-unlocked and cached objects.
  for (const cached of [false, true]) for (let n = 0; n < 4; n++) {
    const heap = e.live_heap(), size = 64 + n * 16;
    [20, 1, 0, size, 0].forEach((value, i) => e.guest_write32(desc + i * 4, value));
    assert.strictEqual(call('IDirect3DDevice_CreateExecuteBuffer', 20, 0, desc, out), 0);
    const p = e.guest_read32(out), entry = e.entry(p);
    assert.strictEqual(e.live_heap(), heap + 1, 'one owned payload');
    e.guest_write32(lock, 20);
    assert.strictEqual(method(p, 'Lock', lock, 12), 0);
    const data = e.guest_read32(lock + 16);
    assert(data); assert.strictEqual(e.guest_read32(lock + 12), size);
    for (let i = 0; i < size; i++) e.guest_write8(data + i, (i * 17 + n) & 255);
    if (cached) {
      assert.strictEqual(method(p, 'Unlock'), 0);
      assert(e.cache(p), 'decoded-cache allocation exercised');
    }
    const allocated = e.live_heap();
    assert.strictEqual(allocated, heap + (cached ? 2 : 1));
    assert.strictEqual(method(p, 'AddRef'), 2);
    assert.strictEqual(method(p, 'Release'), 1);
    assert.strictEqual(e.live_heap(), allocated, 'nonfinal Release retains all allocations');
    assert.strictEqual(method(p, 'Lock', lock, 12), 0);
    assert.strictEqual(e.guest_read32(lock + 16), data);
    for (let i = 0; i < size; i++) assert.strictEqual(e.guest_read8(data + i), (i * 17 + n) & 255);
    assert.strictEqual(method(p, 'Release'), 0);
    assert.strictEqual(e.live_heap(), heap, 'final Release frees payload and cache');
    assert.strictEqual(e.cache(p), 0, 'retired cache table entry cleared');
    assert.strictEqual(new DataView(memory.buffer).getUint32(entry, true), 0, 'DX object retired');
  }
  console.log('PASS ExecuteBuffer lifetime: eight cached/uncached public creation/Lock/ref/release cycles, heap balance and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
