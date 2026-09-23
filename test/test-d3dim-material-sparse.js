'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
 (func (export "make") (param $v i32) (result i32)
   (if (i32.eq (local.get $v) (i32.const 7)) (then
     (return (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV7)))))
   (if (i32.eq (local.get $v) (i32.const 1)) (then
     (return (call $dx_create_com_obj (i32.const 25) (global.get $DX_VTBL_D3DMAT1)))))
   (if (i32.eq (local.get $v) (i32.const 2)) (then
     (return (call $dx_create_com_obj (i32.const 25) (global.get $DX_VTBL_D3DMAT2)))))
   (call $dx_create_com_obj (i32.const 25) (global.get $DX_VTBL_D3DMAT3)))
 (func (export "enable_device_state") (param $p i32)
   (local $state i32)
   (local.set $state (call $heap_alloc (i32.const 4096)))
   (call $guest_memset (local.get $state) (i32.const 0) (i32.const 4096))
   (i32.store offset=16 (call $dx_from_this (local.get $p)) (local.get $state)))
 (func (export "cleanup_device") (param $p i32)
   (local $entry i32) (local $payload i32)
   (local.set $entry (call $dx_from_this (local.get $p)))
   (local.set $payload (i32.load offset=16 (local.get $entry)))
   (if (local.get $payload) (then (call $heap_free (local.get $payload))))
   (call $dx_free (local.get $entry)))
 (func (export "invoke") (param $id i32) (param $p i32) (param $arg i32) (param $sp i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $p) (local.get $arg)
     (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' }); e.init_dx_com_thunks();
  const stack = e.guest_alloc(64), linearIn = e.guest_alloc(96), linearOut = e.guest_alloc(104) + 4;
  const sparse = [], neighbors = [];
  for (const base of [0x38000000, 0x39000000]) {
    for (const page of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(page, 4096);
    assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
    sparse.push(base + 4094); neighbors.push(base + 0x10000);
  }
  const write = (p, bytes) => bytes.forEach((b, i) => e.guest_write8(p + i, b));
  const read = (p, n) => Array.from({ length: n }, (_, i) => e.guest_read8(p + i));
  const fill = (p, n, b) => write(p, Array(n).fill(b));
  for (const version of [1, 2, 3, 7]) {
    const heap = e.live_heap();
    const p = e.make(version), size = version === 7 ? 68 : 80;
    const prefix = version === 7 ? 'IDirect3DDevice7' : 'IDirect3DMaterial' + (version === 1 ? '' : version);
    function call(method, arg, expected = 0, pop = 12) {
      e.guest_write32(stack + pop, 0xdeadbeef);
      assert.strictEqual(e.invoke(apis.find(a => a.name === prefix + '_' + method).id, p, arg, stack), expected);
      assert.strictEqual(e.get_esp(), stack + pop);
      assert.strictEqual(e.guest_read32(stack + pop) >>> 0, 0xdeadbeef);
    }
    function get(output, expected) {
      fill(output - 4, size + 8, 0xcc);
      for (const n of neighbors) fill(n, 128, 0xa7);
      if (version !== 7) e.guest_write32(output, size);
      call('GetMaterial', output);
      assert.deepStrictEqual(read(output, size), expected, prefix + ' readback');
      assert.deepStrictEqual(read(output - 4, 4), [204, 204, 204, 204]);
      assert.deepStrictEqual(read(output + size, 4), [204, 204, 204, 204]);
      for (const n of neighbors) assert(read(n, 128).every(b => b === 0xa7), 'unrelated backing page unchanged');
    }
    const empty = Array(size).fill(0); if (version !== 7) empty[0] = size;
    get(sparse[1], empty);
    if (version === 7) e.enable_device_state(p);
    for (const input of [linearIn, sparse[0]]) for (const output of [linearOut, sparse[1]]) {
      const bytes = Array.from({ length: size }, (_, i) => (i * 17 + version) & 255);
      if (version !== 7) bytes.splice(0, 4, size, 0, 0, 0);
      write(input, bytes); call('SetMaterial', input); get(output, bytes);
      assert.deepStrictEqual(read(input, size), bytes, 'setter leaves input intact');
    }
    if (version === 7) e.cleanup_device(p);
    else {
      assert.strictEqual(e.live_heap(), heap + 1, 'one lazy material payload');
      call('AddRef', 0, 2, 8); call('Release', 0, 1, 8);
      assert.strictEqual(e.live_heap(), heap + 1, 'non-final release retains payload');
      get(linearOut, read(sparse[0], size));
      call('Release', 0, 0, 8);
    }
    assert.strictEqual(e.live_heap(), heap, 'final release frees material payload');
    if (version !== 7) {
      const emptyMaterial = e.make(version);
      const release = apis.find(a => a.name === prefix + '_Release').id;
      e.guest_write32(stack + 8, 0xdeadbeef);
      assert.strictEqual(e.invoke(release, emptyMaterial, 0, stack), 0);
      assert.strictEqual(e.get_esp(), stack + 8);
      assert.strictEqual(e.guest_read32(stack + 8) >>> 0, 0xdeadbeef);
      assert.strictEqual(e.live_heap(), heap, 'uninitialized material has no payload to free');
    }
  }
  console.log('PASS material1/2/3 + device7: 16 input/output layouts, empty fills, sparse size field, neighbor guards and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
