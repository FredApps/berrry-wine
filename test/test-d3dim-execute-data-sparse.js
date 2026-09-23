'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "cache_swap") (param $p i32) (param $new i32) (result i32)
   (local $tbl i32) (local $old i32)
   (local.set $tbl (i32.add (global.get $D3DIM_EB_CACHE_PTRS)
     (i32.mul (call $dx_slot_of (call $dx_from_this (local.get $p))) (i32.const 4))))
   (local.set $old (i32.load (local.get $tbl)))
   (i32.store (local.get $tbl) (local.get $new)) (local.get $old))
 (func (export "status") (param $p i32) (param $rec i32)
   (call $d3dim_exec_set_status (i32.const 0) (local.get $p) (local.get $rec)))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_dx_com_thunks();
  const sp = e.guest_alloc(128), desc = e.guest_alloc(20), out = e.guest_alloc(4);
  const regularInput = e.guest_alloc(64) + 4, regularOutput = e.guest_alloc(64) + 4;
  const bases = [0x36000000, 0x37000000, 0x39000000];
  const status = e.guest_alloc(24);
  [1, 0xabcdef01, 11, 22, 33, 44].forEach((v, i) => e.guest_write32(status + i * 4, v));
  for (const base of bases) {
    for (const p of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(p, 4096);
    assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
    for (let i = 0; i < 4096; i++) e.guest_write8(base + 0x10000 + i, 0xa7);
  }
  const call = (name, pop, a, b = 0, c = 0) => {
    e.guest_write32(sp + pop, 0xdeadbeef);
    const result = e.invoke(apis.find(api => api.name === name).id, sp, a, b, c) >>> 0;
    assert.strictEqual(e.get_esp(), sp + pop);
    assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
    assert.strictEqual(result, 0, name);
  };
  const read = p => Array.from({ length: 48 }, (_, i) => e.guest_read8(p + i));
  let cases = 0;
  // Cross either dwSize or dsStatus; vary input/output independently.
  for (const cached of [0, 1, 2, 3]) for (const offset of [4094, 4066])
    for (const sparseIn of [false, true]) for (const sparseOut of [false, true]) {
      [20, 1, 0, 64, 0].forEach((v, i) => e.guest_write32(desc + i * 4, v));
      call('IDirect3DDevice_CreateExecuteBuffer', 20, 0, desc, out);
      const p = e.guest_read32(out);
      if (cached) call('IDirect3DExecuteBuffer_Unlock', 8, p);
      let savedCache = 0;
      if (cached >= 2) {
        // Borrow a relocated cache: cross the identity header or status tail.
        const relocated = bases[2] + (cached === 2 ? 4094 : 4078);
        savedCache = e.cache_swap(p, relocated);
        for (let i = 0; i < 96; i++) e.guest_write8(relocated + i, e.guest_read8(savedCache + i));
      }
      const input = sparseIn ? bases[0] + offset : regularInput;
      const output = sparseOut ? bases[1] + offset : regularOutput;
      const words = [48, 4, 2, 32, 8, 0, 1, 0x12345678, 10, 20, 30, 40];
      words.forEach((v, i) => e.guest_write32(input + i * 4, v));
      const before = read(input);
      for (let i = -4; i < 52; i++) e.guest_write8(output + i, 0xcc);
      call('IDirect3DExecuteBuffer_SetExecuteData', 12, p, input);
      call('IDirect3DExecuteBuffer_GetExecuteData', 12, p, output);
      const expected = before.slice();
      if (!cached) expected.fill(0, 24);
      assert.deepStrictEqual(read(output), expected, `cached=${cached} offset=${offset} input=${sparseIn} output=${sparseOut}`);
      // Exercise the opcode status writer too, independently of SetExecuteData.
      e.status(p, e.guest_to_wasm(status));
      call('IDirect3DExecuteBuffer_GetExecuteData', 12, p, output);
      if (cached) for (let i = 0; i < 24; i++) expected[24 + i] = e.guest_read8(status + i);
      assert.deepStrictEqual(read(output), expected, 'opcode status readback');
      assert.deepStrictEqual(read(input), before, 'input untouched');
      for (let i = 1; i <= 4; i++) assert.strictEqual(e.guest_read8(output - i), 0xcc);
      for (let i = 48; i < 52; i++) assert.strictEqual(e.guest_read8(output + i), 0xcc);
      for (const base of bases) for (let i = 0; i < 4096; i++)
        assert.strictEqual(e.guest_read8(base + 0x10000 + i), 0xa7, 'adjacent backing page untouched');
      if (savedCache) e.cache_swap(p, savedCache); // Release only real heap ownership.
      call('IDirect3DExecuteBuffer_Release', 8, p); cases++;
    }
  console.log(`PASS ExecuteData: ${cases} cached/uncached input/output layouts, crossing size/status, all bytes and neighbor/ABI guards`);
})().catch(error => { console.error(error); process.exitCode = 1; });
