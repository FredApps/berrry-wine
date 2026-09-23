'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "create") (result i32)
   (call $dx_create_com_obj (i32.const 24) (global.get $DX_VTBL_D3DLIGHT)))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $p i32) (param $iid i32) (param $out i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $p) (local.get $iid) (local.get $out)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
 (func (export "refs") (param $p i32) (result i32)
   (load.field DxObject refcount (call $dx_from_this (local.get $p))))
 (func (export "span_cursor") (result i32) (global.get $guest_span_cursor))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_dx_com_thunks();
  const sp = e.guest_alloc(128), iid = e.guest_alloc(16), out = e.guest_alloc(4);
  const light = [0x4417c142, 0x11cf33ad, 0x00006f81, 0x6e1520c0];
  const unknown = [0, 0, 0xc0, 0x46000000];
  const foreign = [0x4417c144, 0x11cf33ad, 0x00006f81, 0x6e1520c0];
  const write = (p, words) => words.forEach((word, i) => e.guest_write32(p + i * 4, word));
  function invoke(method, p, a = 0, b = 0, bytes = 16) {
    const api = apis.find(row => row.name === 'IDirect3DLight_' + method);
    e.guest_write32(sp + bytes, 0xdeadbeef);
    const result = e.invoke(api.id, sp, p, a, b) >>> 0;
    assert.strictEqual(e.get_esp(), sp + bytes);
    assert.strictEqual(e.guest_read32(sp + bytes) >>> 0, 0xdeadbeef);
    return result;
  }
  const p = e.create(), vtable = e.guest_read32(p);
  const release = () => invoke('Release', p, 0, 0, 8);
  write(iid, foreign); e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(invoke('QueryInterface', p, iid, out), 0x80004002, 'reject complete material IID');
  assert.strictEqual(e.guest_read32(out), 0); assert.strictEqual(e.refs(p), 1);
  for (const words of [light, unknown, foreign]) for (let i = 0; i < 4; i++) {
    const forged = words.slice(); forged[i] ^= 0x01000000; write(iid, forged);
    e.guest_write32(out, 0xdeadbeef);
    assert.strictEqual(invoke('QueryInterface', p, iid, out), 0x80004002);
    assert.strictEqual(e.guest_read32(out), 0); assert.strictEqual(e.refs(p), 1);
  }
  assert.strictEqual(invoke('QueryInterface', p, iid, 0), 0x80004003);
  e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(invoke('QueryInterface', p, 0, out), 0x80004003);
  assert.strictEqual(e.guest_read32(out), 0);
  for (const words of [light, unknown]) {
    write(iid, words); assert.strictEqual(invoke('QueryInterface', p, iid, out), 0);
    assert.strictEqual(e.guest_read32(out), p);
    assert.strictEqual(e.guest_read32(p), vtable); assert.strictEqual(e.refs(p), 2);
    assert.strictEqual(release(), 1);
  }
  const base = 0x32000000;
  for (const page of [base, base + 0x10000, base + 4096]) e.test_virtual_map_commit(page, 4096);
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  const cursor = e.span_cursor();
  for (let i = 0; i < 64; i++) {
    write(base + 4090, light);
    assert.strictEqual(invoke('QueryInterface', p, base + 4090, out), 0);
    assert.strictEqual(e.guest_read32(out), p); assert.strictEqual(release(), 1);
    assert.strictEqual(e.span_cursor(), cursor);
    write(iid, unknown);
    assert.strictEqual(invoke('QueryInterface', p, iid, base + 4094), 0);
    assert.strictEqual(e.guest_read32(base + 4094), p); assert.strictEqual(release(), 1);
  }
  assert.strictEqual(release(), 0);
  console.log('PASS light QI: full GUIDs, identity, nulls, sparse spans, public Release and ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
