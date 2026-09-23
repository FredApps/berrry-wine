#!/usr/bin/env node
'use strict';

// Retained-mode object selection is implemented through the DX1 execute-
// buffer Pick API.  Viewer depends on the resulting record before enabling
// Cut/Copy/Delete/Change Color, so returning D3D_OK with untouched outputs
// makes its menus look inert even though the scene renders.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_pick_buffer") (param $p i32) (param $buf i32)
    (store.field DxObject misc0 (call $dx_from_this (local.get $p)) (local.get $buf)))
  (func (export "test_pick_release") (param $p i32)
    (call $handle_IDirect3DExecuteBuffer_Release (local.get $p) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "test_pick_create") (param $desc i32) (param $out i32) (result i32)
    (global.set $DX_VTBL_D3DEXEC (i32.const 0x52000000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice_CreateExecuteBuffer
      (i32.const 0) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_pick_lock") (param $obj i32) (param $desc i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DExecuteBuffer_Lock
      (local.get $obj) (local.get $desc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_pick_set_data") (param $obj i32) (param $data i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DExecuteBuffer_SetExecuteData
      (local.get $obj) (local.get $data) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_pick_run") (param $obj i32) (param $rect i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice_Pick
      (i32.const 0x53000000) (local.get $obj) (i32.const 0x54000000)
      (i32.const 0) (local.get $rect) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_pick_get") (param $count i32) (param $records i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice_GetPickRecords
      (i32.const 0x53000000) (local.get $count) (local.get $records)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_device1_get_stats") (param $stats i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice_GetStats
      (i32.const 0x53000000) (local.get $stats) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_device2_get_stats") (param $stats i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice2_GetStats
      (i32.const 0x53000000) (local.get $stats) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_device3_get_stats") (param $stats i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DDevice3_GetStats
      (i32.const 0x53000000) (local.get $stats) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

const f32bits = value => {
  const a = new Float32Array([value]);
  return new Uint32Array(a.buffer)[0];
};
const bitsf32 = value => {
  const a = new Uint32Array([value >>> 0]);
  return new Float32Array(a.buffer)[0];
};

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });
  const desc = 0x410000;
  const out = 0x410040;
  const lockDesc = 0x410080;
  const data = 0x4100c0;
  const rect = 0x410100;
  const count = 0x410120;
  const record = 0x410140;
  const stats = 0x410180;

  for (const revision of [1, 2, 3]) {
    const getStats = wat[`test_device${revision}_get_stats`];
    for (let offset = 0; offset < 24; offset += 4) {
      wat.guest_write32(stats + offset, offset === 0 ? 24 : 0xa5a5a5a5);
    }
    assert.strictEqual(getStats(stats) >>> 0, 0,
      `Device${revision}::GetStats should succeed for a D3DSTATS buffer`);
    assert.strictEqual(wat.guest_read32(stats) >>> 0, 24,
      `Device${revision}::GetStats should preserve dwSize`);
    for (let offset = 4; offset < 24; offset += 4) {
      assert.strictEqual(wat.guest_read32(stats + offset) >>> 0, 0,
        `Device${revision}::GetStats should initialize counter +${offset}`);
    }
    assert.strictEqual(getStats(0) >>> 0, 0x80070057,
      `Device${revision}::GetStats should reject a null output`);
  }

  wat.guest_write32(desc + 12, 256); // D3DEXECUTEBUFFERDESC.dwBufferSize
  assert.strictEqual(wat.test_pick_create(desc, out) >>> 0, 0);
  const obj = wat.guest_read32(out) >>> 0;
  assert(obj, 'execute buffer should be created');
  assert.strictEqual(wat.test_pick_lock(obj, lockDesc) >>> 0, 0);
  const buf = wat.guest_read32(lockDesc + 16) >>> 0;
  assert(buf, 'Lock should expose execute-buffer storage');

  // Three D3DTLVERTEX records (32 bytes each).
  const vertices = [
    [10, 10, 0.25],
    [100, 10, 0.5],
    [10, 100, 0.75],
  ];
  vertices.forEach((v, i) => {
    const p = buf + i * 32;
    wat.guest_write32(p, f32bits(v[0]));
    wat.guest_write32(p + 4, f32bits(v[1]));
    wat.guest_write32(p + 8, f32bits(v[2]));
    wat.guest_write32(p + 12, f32bits(1));
  });

  // D3DINSTRUCTION TRIANGLE, one 8-byte D3DTRIANGLE, then EXIT.
  const instr = 96;
  wat.guest_write32(buf + instr, 0x00010803); // op=3 size=8 count=1
  wat.guest_write32(buf + instr + 4, 0x00010000); // v1=0, v2=1
  wat.guest_write32(buf + instr + 8, 0x00000002); // v3=2, flags=0
  wat.guest_write32(buf + instr + 12, 0x0000000b); // EXIT
  wat.guest_write32(data, 48);
  wat.guest_write32(data + 4, 0);      // vertex offset
  wat.guest_write32(data + 8, 3);      // vertex count
  wat.guest_write32(data + 12, instr);
  wat.guest_write32(data + 16, 16);
  assert.strictEqual(wat.test_pick_set_data(obj, data) >>> 0, 0);

  wat.guest_write32(rect, 20);
  wat.guest_write32(rect + 4, 20);
  assert.strictEqual(wat.test_pick_run(obj, rect) >>> 0, 0);
  assert.strictEqual(wat.test_pick_get(count, record) >>> 0, 0);
  assert.strictEqual(wat.guest_read32(count) >>> 0, 1, 'inside point should produce one record');
  assert.strictEqual(wat.guest_read32(record) & 0xff, 3, 'record opcode should be TRIANGLE');
  assert.strictEqual(wat.guest_read32(record + 4) >>> 0, 4,
    'record offset should identify the triangle payload');
  const z = bitsf32(wat.guest_read32(record + 8));
  assert(Math.abs(z - 1 / 3) < 0.0001, `expected interpolated z=1/3, got ${z}`);

  wat.guest_write32(rect, 150);
  wat.guest_write32(rect + 4, 150);
  assert.strictEqual(wat.test_pick_run(obj, rect) >>> 0, 0);
  assert.strictEqual(wat.test_pick_get(count, 0) >>> 0, 0);
  assert.strictEqual(wat.guest_read32(count) >>> 0, 0, 'outside point should clear old records');

  // Two records: a degenerate miss followed by the real triangle. This checks
  // record advancement and preserves the instruction-relative hit offset.
  wat.guest_write32(buf + instr, 0x00020803);
  wat.guest_write32(buf + instr + 4, 0);
  wat.guest_write32(buf + instr + 8, 0);
  wat.guest_write32(buf + instr + 12, 0x00010000);
  wat.guest_write32(buf + instr + 16, 2);
  wat.guest_write32(buf + instr + 20, 11);
  wat.guest_write32(data + 16, 24);
  assert.strictEqual(wat.test_pick_set_data(obj, data), 0);
  const original = Array.from({ length: 256 }, (_, i) => wat.guest_read8(buf + i));
  const base = 0x3d000000;
  for (const p of [base, base + 0x10000, base + 4096]) wat.test_virtual_map_commit(p, 4096);
  assert.notStrictEqual(wat.guest_to_wasm(base + 4096), wat.guest_to_wasm(base) + 4096);
  for (let i = 0; i < 4096; i++) wat.guest_write8(base + 0x10000 + i, 0xa7);
  const offsets = [4094, 4090, 4086, 4062, 3998, 3995, 3993, 3991, 3987, 3985, 3983];
  for (const target of [buf, ...offsets.map(n => base + n)]) {
    original.forEach((v, i) => wat.guest_write8(target + i, v));
    wat.test_pick_buffer(obj, target);
    for (const hit of [true, false]) {
      wat.guest_write32(rect, hit ? 20 : 150); wat.guest_write32(rect + 4, hit ? 20 : 150);
      assert.strictEqual(wat.test_pick_run(obj, rect), 0);
      assert.strictEqual(wat.get_esp(), 0x30018, 'Pick stdcall cleanup');
      assert.strictEqual(wat.test_pick_get(count, record), 0);
      assert.strictEqual(wat.get_esp(), 0x30010, 'GetPickRecords stdcall cleanup');
      assert.strictEqual(wat.guest_read32(count), hit ? 1 : 0, `target=${target.toString(16)}`);
      if (hit) {
        assert.strictEqual(wat.guest_read32(record) & 255, 3);
        assert.strictEqual(wat.guest_read32(record + 4), 12, 'second triangle offset');
        assert(Math.abs(bitsf32(wat.guest_read32(record + 8)) - 1 / 3) < 0.0001);
      }
    }
    assert.deepStrictEqual(Array.from({ length: 256 }, (_, i) => wat.guest_read8(target + i)), original);
    for (let i = 0; i < 4096; i++) assert.strictEqual(wat.guest_read8(base + 0x10000 + i), 0xa7);
  }
  wat.test_pick_buffer(obj, buf); // Restore owned payload before releasing.
  const outputBases = [0x3e000000, 0x3f000000];
  for (const base of outputBases) {
    for (const p of [base, base + 0x10000, base + 4096]) wat.test_virtual_map_commit(p, 4096);
    assert.notStrictEqual(wat.guest_to_wasm(base + 4096), wat.guest_to_wasm(base) + 4096);
    for (let i = 0; i < 4096; i++) wat.guest_write8(base + 0x10000 + i, 0xa7);
  }
  for (const hit of [true, false]) for (const offset of [4095, 4094, 4091, 4087])
    for (const sparseCount of [false, true]) {
      wat.guest_write32(rect, hit ? 20 : 150); wat.guest_write32(rect + 4, hit ? 20 : 150);
      assert.strictEqual(wat.test_pick_run(obj, rect), 0);
      const output = outputBases[0] + offset, countOut = sparseCount ? outputBases[1] + 4094 : count;
      for (let i = -4; i < 16; i++) wat.guest_write8(output + i, 0xcc);
      wat.guest_write32(countOut, 0xdeadbeef);
      assert.strictEqual(wat.test_pick_get(countOut, output), 0);
      assert.strictEqual(wat.get_esp(), 0x30010);
      assert.strictEqual(wat.guest_read32(countOut), hit ? 1 : 0);
      if (hit) {
        assert.strictEqual(wat.guest_read8(output), 3);
        assert.strictEqual(wat.guest_read8(output + 1), 0);
        assert.strictEqual(wat.guest_read8(output + 2), 0xcc, 'alignment bytes unchanged');
        assert.strictEqual(wat.guest_read8(output + 3), 0xcc);
        assert.strictEqual(wat.guest_read32(output + 4), 12);
        assert(Math.abs(bitsf32(wat.guest_read32(output + 8)) - 1 / 3) < 0.0001);
      } else {
        for (let i = 0; i < 12; i++) assert.strictEqual(wat.guest_read8(output + i), 0xcc, 'no hit leaves record untouched');
      }
      for (let i = 1; i <= 4; i++) assert.strictEqual(wat.guest_read8(output - i), 0xcc);
      for (let i = 12; i < 16; i++) assert.strictEqual(wat.guest_read8(output + i), 0xcc);
      for (const base of outputBases) for (let i = 0; i < 4096; i++)
        assert.strictEqual(wat.guest_read8(base + 0x10000 + i), 0xa7);
    }
  wat.test_pick_release(obj);
  console.log('PASS D3DIM GetStats/Pick: 12 input layouts + 16 sparse record/count outputs, hit/miss/offset/depth/padding/neighbor/ABI');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
