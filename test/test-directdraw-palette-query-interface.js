#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create") (result i32)
    (call $dx_create_com_obj (i32.const 3) (global.get $DX_VTBL_DDPAL)))
  (func (export "test_query") (param $obj i32) (param $iid i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawPalette_QueryInterface
      (local.get $obj) (local.get $iid) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_release") (param $obj i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawPalette_Release
      (local.get $obj) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_refs") (param $obj i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $obj))))
  (func (export "test_type") (param $obj i32) (result i32)
    (i32.load (call $dx_from_this (local.get $obj))))
  (func (export "test_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(exe, wat.get_staging());
  assert(wat.load_pe(exe.length), 'initialize guest COM thunks');
  wat.init_dx_com_thunks();
  const guid = words => {
    const p = wat.guest_alloc(16) >>> 0;
    words.forEach((word, i) => wat.guest_write32(p + i * 4, word));
    return p;
  };
  const own = [0x6c14db84, 0x11cea733, 0x200021a5, 0x60e50baf];
  const ownIid = guid(own);
  const unknownIid = guid([0, 0, 0xc0, 0x46000000]);
  const out = wat.guest_alloc(4) >>> 0;
  const obj = wat.test_create() >>> 0;
  assert(obj);
  assert.strictEqual(wat.test_refs(obj), 1);
  const query = (iid, dest = out) => {
    const hr = wat.test_query(obj, iid, dest) >>> 0;
    assert.strictEqual(wat.test_esp(), 0x30010, 'QueryInterface stdcall cleanup');
    return hr;
  };
  for (const iid of [ownIid, unknownIid, ownIid]) {
    assert.strictEqual(query(iid), 0, 'own IID and IUnknown are supported');
    assert.strictEqual(wat.guest_read32(out) >>> 0, obj, 'stable COM identity');
  }
  assert.strictEqual(wat.test_refs(obj), 4, 'each successful query owns a reference');
  for (let word = 0; word < 4; word++) {
    const bad = own.slice();
    bad[word] ^= 1; // Includes IDirectDrawClipper when Data1 changes.
    wat.guest_write32(out, 0xdeadbeef);
    assert.strictEqual(query(guid(bad)), 0x80004002, `reject mismatched GUID word ${word}`);
    assert.strictEqual(wat.guest_read32(out), 0, 'failure clears output');
    assert.strictEqual(wat.test_refs(obj), 4, 'failure does not acquire a reference');
  }
  assert.strictEqual(query(ownIid, 0), 0x80004003, 'NULL output returns E_POINTER');
  assert.strictEqual(wat.test_refs(obj), 4);
  // NULL riid is outside the COM contract; retain the shared helper's defensive policy.
  wat.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(query(0), 0x80004002);
  assert.strictEqual(wat.guest_read32(out), 0);
  for (const remaining of [3, 2, 1, 0]) {
    assert.strictEqual(wat.test_release(obj), remaining, 'balance actual palette Release');
    assert.strictEqual(wat.test_esp(), 0x30008, 'Release stdcall cleanup');
  }
  assert.strictEqual(wat.test_type(obj), 0, 'final Release retires the object');
  console.log('PASS DirectDraw palette full IID, identity, reference ownership and ABI');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
