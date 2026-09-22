#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create") (param $vb i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (if (local.get $vb)
      (then (call $handle_IVBDirectDraw7_CreateClipper
        (i32.const 0) (i32.const 0) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_DirectDrawCreateClipper
        (i32.const 0) (local.get $out) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.load (global.get $reg_base)))
  (func (export "test_query") (param $vb i32) (param $obj i32)
      (param $iid i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (if (local.get $vb)
      (then (call $handle_IVBDirectDrawClipper_QueryInterface
        (local.get $obj) (local.get $iid) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_IDirectDrawClipper_QueryInterface
        (local.get $obj) (local.get $iid) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.load (global.get $reg_base)))
  (func (export "test_release") (param $obj i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawClipper_Release
      (local.get $obj) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_refs") (param $obj i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $obj))))
  (func (export "test_type") (param $obj i32) (result i32)
    (load.field DxObject type (call $dx_from_this (local.get $obj))))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;
(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(exe, wat.get_staging());
  assert(wat.load_pe(exe.length)); wat.init_dx_com_thunks();
  const guid = words => {
    const p = wat.guest_alloc(16) >>> 0;
    words.forEach((word, i) => wat.guest_write32(p + i * 4, word));
    return p;
  };
  const ids = [
    [0x6c14db85, 0x11cea733, 0x200021a5, 0x60e50baf],
    [0x9f76fdca, 0x11d18e92, 0xc0000888, 0x02c6c24f],
  ];
  const iids = ids.map(guid), unknown = guid([0, 0, 0xc0, 0x46000000]);
  const dispatch = guid([0x20400, 0, 0xc0, 0x46000000]);
  const out = wat.guest_alloc(4) >>> 0;
  const vtables = [];
  for (const vb of [0, 1]) {
    assert.strictEqual(wat.test_create(vb, out), 0, 'actual creation handler succeeds');
    const obj = wat.guest_read32(out) >>> 0;
    assert(obj); assert.strictEqual(wat.test_refs(obj), 1);
    const vtable = wat.guest_read32(obj) >>> 0; vtables.push(vtable);
    const query = (iid, dest = out) => {
      const hr = wat.test_query(vb, obj, iid, dest) >>> 0;
      assert.strictEqual(wat.test_esp(), 0x30010);
      return hr;
    };
    for (const iid of [iids[vb], unknown, iids[vb]]) {
      assert.strictEqual(query(iid), 0);
      assert.strictEqual(wat.guest_read32(out) >>> 0, obj, 'stable per-object identity');
      assert.strictEqual(wat.guest_read32(obj) >>> 0, vtable, 'QI preserves native/VB ABI');
    }
    assert.strictEqual(wat.test_refs(obj), 4, 'three queries acquire three references');
    const rejected = [iids[1 - vb], dispatch];
    for (let word = 0; word < 4; word++) {
      const bad = ids[vb].slice(); bad[word] ^= 1; rejected.push(guid(bad));
    }
    for (const iid of rejected) {
      wat.guest_write32(out, 0xdeadbeef);
      assert.strictEqual(query(iid), 0x80004002, 'reject other family/forged IID');
      assert.strictEqual(wat.guest_read32(out), 0);
      assert.strictEqual(wat.test_refs(obj), 4);
    }
    assert.strictEqual(query(iids[vb], 0), 0x80004003);
    assert.strictEqual(wat.test_refs(obj), 4);
    for (const remaining of [3, 2, 1, 0]) {
      assert.strictEqual(wat.test_release(obj), remaining);
      assert.strictEqual(wat.test_esp(), 0x30008);
    }
    assert.strictEqual(wat.test_type(obj), 0, 'specialized Release retires object');
  }
  assert.notStrictEqual(vtables[0], vtables[1], 'VB and native interfaces are not interchangeable');
  console.log('PASS native/VB clipper QI: full IDs, distinct vtables, identity, refcounts and ABI');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
