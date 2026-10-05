#!/usr/bin/env node
'use strict';

// 7-Zip File Manager 9.20 and Far Manager 1.70 resolve this complete MPR
// family at load time.  The browser machine has no network provider, so every
// call must report that state without inventing enum handles or drive maps and
// without partially rewriting an output buffer on failure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const ROOT = path.join(__dirname, '..');
const STACK = 0x00300000;
const ERROR_BAD_PROVIDER = 1204;
const ERROR_NO_NETWORK = 1222;
const ERROR_NOT_CONNECTED = 2250;
const LAST_ERROR_SENTINEL = 0x4d50524f;

const extraWat = String.raw`
  (func $mpr_test_begin
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0x4d50524f)))

  (func (export "test_mpr_last_error") (result i32)
    (global.get $last_error))

  (func (export "test_mpr_first_api_id") (result i32)
    (call $lookup_api_id "WNetAddConnection2W"))
  (func (export "test_mpr_last_api_id") (result i32)
    (call $lookup_api_id "WNetGetUniversalNameA"))

  (func (export "test_mpr_open_a") (param $out i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetOpenEnumA
      (i32.const 2) (i32.const 1) (i32.const 0) (i32.const 0)
      (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_open_w") (param $out i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetOpenEnumW
      (i32.const 2) (i32.const 1) (i32.const 0) (i32.const 0)
      (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_enum_a")
        (param $h i32) (param $count i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetEnumResourceA
      (local.get $h) (local.get $count) (local.get $buf) (local.get $size)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_enum_w")
        (param $h i32) (param $count i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetEnumResourceW
      (local.get $h) (local.get $count) (local.get $buf) (local.get $size)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_close") (param $h i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetCloseEnum
      (local.get $h) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_parent_a")
        (param $nr i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetResourceParentA
      (local.get $nr) (local.get $buf) (local.get $size) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_parent_w")
        (param $nr i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetResourceParentW
      (local.get $nr) (local.get $buf) (local.get $size) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_info_a")
        (param $nr i32) (param $buf i32) (param $size i32) (param $system i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetResourceInformationA
      (local.get $nr) (local.get $buf) (local.get $size) (local.get $system)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_info_w")
        (param $nr i32) (param $buf i32) (param $size i32) (param $system i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetResourceInformationW
      (local.get $nr) (local.get $buf) (local.get $size) (local.get $system)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_add_a") (param $nr i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetAddConnection2A
      (local.get $nr) (i32.const 0) (i32.const 0) (i32.const 1)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_add_w") (param $nr i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetAddConnection2W
      (local.get $nr) (i32.const 0) (i32.const 0) (i32.const 1)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_cancel_a") (param $name i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetCancelConnection2A
      (local.get $name) (i32.const 1) (i32.const 1) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_connection_a")
        (param $name i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetConnectionA
      (local.get $name) (local.get $buf) (local.get $size) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mpr_universal_a")
        (param $name i32) (param $level i32) (param $buf i32) (param $size i32) (result i32)
    (call $mpr_test_begin)
    (call $handle_WNetGetUniversalNameA
      (local.get $name) (local.get $level) (local.get $buf) (local.get $size)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

function importedMprNames(exe) {
  if (!fs.existsSync(exe)) return null;
  const output = execFileSync('node', [
    path.join(ROOT, 'tools', 'pe-imports.js'), exe, '--dll=mpr.dll',
  ], { cwd: ROOT, encoding: 'utf8' });
  return [...output.matchAll(/^\s+\[\d+\]\s+(WNet\S+)\s+/gm)].map(match => match[1]);
}

(async () => {
  const sevenZip = path.join(ROOT, 'test', 'binaries', 'candidates',
    '7zip-file-manager', '7zFM.exe');
  const far = path.join(ROOT, 'test', 'binaries', 'candidates',
    'far-manager-170', 'FarManager170', 'Far.exe');
  const sevenZipImports = importedMprNames(sevenZip);
  const farImports = importedMprNames(far);
  if (sevenZipImports) assert.deepStrictEqual(sevenZipImports, [
    'WNetAddConnection2W',
    'WNetOpenEnumA', 'WNetOpenEnumW', 'WNetCloseEnum',
    'WNetEnumResourceA', 'WNetEnumResourceW',
    'WNetGetResourceParentA', 'WNetGetResourceParentW',
    'WNetGetResourceInformationA', 'WNetGetResourceInformationW',
    'WNetAddConnection2A',
  ], 'focused family covers every 7zFM MPR import');
  if (farImports) assert.deepStrictEqual(farImports, [
    'WNetCancelConnection2A', 'WNetGetConnectionA', 'WNetGetUniversalNameA',
  ], 'focused family covers every Far MPR import');

  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const expectedApis = [
    ['WNetAddConnection2W', 4],
    ['WNetOpenEnumA', 5], ['WNetOpenEnumW', 5], ['WNetCloseEnum', 1],
    ['WNetEnumResourceA', 4], ['WNetEnumResourceW', 4],
    ['WNetGetResourceParentA', 3], ['WNetGetResourceParentW', 3],
    ['WNetGetResourceInformationA', 4], ['WNetGetResourceInformationW', 4],
    ['WNetAddConnection2A', 4], ['WNetCancelConnection2A', 3],
    ['WNetGetConnectionA', 3], ['WNetGetUniversalNameA', 4],
  ];
  expectedApis.forEach(([name, nargs], index) => {
    const api = apiTable.find(entry => entry.name === name);
    assert.deepStrictEqual(
      api && { id: api.id, nargs: api.nargs, convention: api.convention },
      { id: 3620 + index, nargs, convention: 'stdcall' },
      `${name} keeps its append-only MPR identity and ABI`);
  });
  assert.strictEqual(e.test_mpr_first_api_id() >>> 0, 3620,
    'generated lookup resolves the first MPR API');
  assert.strictEqual(e.test_mpr_last_api_id() >>> 0, 3633,
    'generated lookup resolves the last MPR API');
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const view = new DataView(memory.buffer);
  const nr = e.guest_alloc(32) >>> 0;
  const out = e.guest_alloc(128) >>> 0;
  const count = e.guest_alloc(4) >>> 0;
  const size = e.guest_alloc(4) >>> 0;
  const system = e.guest_alloc(4) >>> 0;
  const name = e.guest_alloc(16) >>> 0;

  const fillOutputs = () => {
    new Uint8Array(memory.buffer, wa(out), 128).fill(0xa5);
    view.setUint32(wa(count), 0x11111111, true);
    view.setUint32(wa(size), 0x22222222, true);
    view.setUint32(wa(system), 0x33333333, true);
  };
  const assertUntouched = label => {
    assert(new Uint8Array(memory.buffer, wa(out), 128).every(byte => byte === 0xa5),
      `${label} leaves its data buffer untouched`);
    assert.strictEqual(view.getUint32(wa(count), true), 0x11111111,
      `${label} leaves its count untouched`);
    assert.strictEqual(view.getUint32(wa(size), true), 0x22222222,
      `${label} leaves its size untouched`);
    assert.strictEqual(view.getUint32(wa(system), true), 0x33333333,
      `${label} leaves its system-tail pointer untouched`);
    assert.strictEqual(e.test_mpr_last_error() >>> 0, LAST_ERROR_SENTINEL,
      `${label} returns its status directly without changing LastError`);
  };
  const check = (label, invoke, expected, cleanup) => {
    fillOutputs();
    assert.strictEqual(invoke() >>> 0, expected, `${label} reports the modeled machine state`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + cleanup, `${label} has exact stdcall cleanup`);
    assertUntouched(label);
  };

  check('WNetOpenEnumA', () => e.test_mpr_open_a(out), ERROR_NO_NETWORK, 24);
  check('WNetOpenEnumW', () => e.test_mpr_open_w(out), ERROR_NO_NETWORK, 24);
  check('WNetEnumResourceA', () => e.test_mpr_enum_a(0xdeadbeef, count, out, size),
    ERROR_NO_NETWORK, 20);
  check('WNetEnumResourceW', () => e.test_mpr_enum_w(0xdeadbeef, count, out, size),
    ERROR_NO_NETWORK, 20);
  check('WNetCloseEnum', () => e.test_mpr_close(0xdeadbeef), ERROR_NO_NETWORK, 8);
  check('WNetGetResourceParentA', () => e.test_mpr_parent_a(nr, out, size),
    ERROR_BAD_PROVIDER, 16);
  check('WNetGetResourceParentW', () => e.test_mpr_parent_w(nr, out, size),
    ERROR_BAD_PROVIDER, 16);
  check('WNetGetResourceInformationA', () => e.test_mpr_info_a(nr, out, size, system),
    ERROR_NO_NETWORK, 20);
  check('WNetGetResourceInformationW', () => e.test_mpr_info_w(nr, out, size, system),
    ERROR_NO_NETWORK, 20);
  check('WNetAddConnection2A', () => e.test_mpr_add_a(nr), ERROR_NO_NETWORK, 20);
  check('WNetAddConnection2W', () => e.test_mpr_add_w(nr), ERROR_NO_NETWORK, 20);
  check('WNetCancelConnection2A', () => e.test_mpr_cancel_a(name),
    ERROR_NOT_CONNECTED, 16);
  check('WNetGetConnectionA', () => e.test_mpr_connection_a(name, out, size),
    ERROR_NO_NETWORK, 16);
  check('WNetGetUniversalNameA', () => e.test_mpr_universal_a(name, 1, out, size),
    ERROR_NO_NETWORK, 20);

  // A failed add cannot create a hidden mapping: the same local-name query is
  // still a no-network failure and still preserves both outputs.
  assert.strictEqual(e.test_mpr_add_a(nr) >>> 0, ERROR_NO_NETWORK);
  fillOutputs();
  assert.strictEqual(e.test_mpr_connection_a(name, out, size) >>> 0, ERROR_NO_NETWORK);
  assertUntouched('post-add WNetGetConnectionA');

  console.log('PASS  7zFM/Far MPR family exposes one failure-atomic no-network-provider state');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
