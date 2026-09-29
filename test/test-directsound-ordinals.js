#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const apiTable = require('../src/api_table.json');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_system_ordinal_api_id")
        (param $dll_name i32) (param $ordinal i32) (result i32)
    (call $system_ordinal_api_id (local.get $dll_name) (local.get $ordinal)))
  (func (export "test_call") (param $id i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_refs") (param $obj i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $obj))))
  (func (export "test_uninitialize") (param $obj i32)
    (store.field DxObject flags (call $dx_from_this (local.get $obj)) (i32.const 0)))
`;

async function main() {
  // Plain append: src fragments are self-balanced, so there is no trailing `)`
  // for the old splice to match — it silently dropped the fragment.
  const wasm = compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const imports = createHostImports({ getMemory: () => memory.buffer, renderer: null, resourceJson: {} });
  imports.host.memory = memory;
  Object.assign(imports.host, {
    create_thread: () => 0, exit_thread: () => 0, terminate_thread: () => 0,
    create_event: () => 0, set_event: () => 0, reset_event: () => 0,
    wait_single: () => 0, wait_multiple: () => 0,
    com_create_instance: () => 0x80004002,
  });

  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  const exe = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length), 'fixture PE initializes API hashes');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const dllName = e.guest_alloc(16) >>> 0;
  const dllNameWa = (dllName - imageBase + guestBase) >>> 0;
  new Uint8Array(memory.buffer).set(Buffer.from('DSOUND.dll\0', 'latin1'), dllNameWa);
  const id = name => apiTable.find(entry => entry.name === name).id;

  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 1), id('DirectSoundCreate'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 2), id('DirectSoundEnumerateA'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 11), id('DirectSoundCreate8'));
  e.init_dx_com_thunks();
  const out = e.guest_alloc(4), iid = e.guest_alloc(16);
  const read = ga => new DataView(memory.buffer).getUint32(ga - imageBase + guestBase, true);
  const call = (name, a = 0, b = 0, c = 0) => e.test_call(id(name), a, b, c) >>> 0;
  assert.strictEqual(call('DirectSoundCreate8', 0, 0, 0), 0x80070057);
  assert.strictEqual(e.test_esp(), 0x30010);
  assert.strictEqual(call('DirectSoundCreate8', 0, out, 1), 0x80040110);
  assert.strictEqual(read(out), 0);
  [0xdef00002, 0x47ed9c6d, 0xda4df1aa, 0x035c2b8f].forEach((v, i) => e.guest_write32(iid + i * 4, v));
  assert.strictEqual(call('DirectSoundCreate8', iid, out), 0, 'default voice playback alias');
  e.guest_write32(iid, 0xdef00001);
  assert.strictEqual(call('DirectSoundCreate8', iid, out), 0x88780078, 'capture GUID is not a playback device');
  assert.strictEqual(read(out), 0);
  assert.strictEqual(call('DirectSoundCreate8', 0, out, 0), 0);
  const ds8 = read(out), vt = read(ds8);
  // First eleven methods keep their existing ABI, slot eleven is the extension.
  for (let slot = 0; slot < 12; slot++) assert(read(vt + slot * 4), `vtable slot ${slot}`);
  assert.strictEqual(read(read(vt + 11 * 4) + 4), id('IDirectSound8_VerifyCertification'));
  assert.strictEqual(read(read(vt + 6 * 4) + 4), id('IDirectSound_SetCooperativeLevel'));
  [0xc50a7e93, 0x4834f395, 0xa97ff69e, 0x6609e59d].forEach((v, i) => e.guest_write32(iid + i * 4, v));
  assert.strictEqual(call('IDirectSound_QueryInterface', ds8, iid, out), 0);
  assert.strictEqual(read(out), ds8);
  assert.strictEqual(e.test_refs(ds8), 2);
  assert.strictEqual(call('IDirectSound8_VerifyCertification', ds8, out), 0);
  assert.strictEqual(read(out), 1, 'software device is not certified');
  assert.strictEqual(e.test_esp(), 0x3000c);
  assert.strictEqual(call('IDirectSound8_VerifyCertification', ds8, 0), 0x80070057);
  e.test_uninitialize(ds8);
  assert.strictEqual(call('IDirectSound8_VerifyCertification', ds8, out), 0x887800aa);
  assert.strictEqual(call('DirectSoundCreate', 0, out), 0);
  const legacy = read(out);
  assert.strictEqual(call('IDirectSound_QueryInterface', legacy, iid, out), 0x80004002);
  assert.strictEqual(read(out), 0);
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 3), -1,
    'unsupported DSOUND ordinals remain explicit diagnostics');

  // DPLAYX sits at 1-based list position 4 and DSOUND at 6. The DSOUND rule
  // used to test for 4 and therefore answered every dplayx ordinal with a
  // DirectSound id: RollerCoaster Tycoon's ordinal 2 came back as
  // DirectSoundEnumerateA, whose handler pushes four callback arguments where
  // DirectPlayEnumerateA's callback pops five, and the guest returned to EIP 0.
  // Ordinals are the retail DX6 dplayx.dll's (tools/pe-exports.js).
  new Uint8Array(memory.buffer).set(Buffer.from('DPLAYX.dll\0', 'latin1'), dllNameWa);
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 1), id('DirectPlayCreate'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 2), id('DirectPlayEnumerateA'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 4), id('DirectPlayLobbyCreateA'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 9), id('DirectPlayEnumerate'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 3), -1,
    'unsupported DPLAYX ordinals remain explicit diagnostics');

  new Uint8Array(memory.buffer).set(Buffer.from('C:\\WINDOWS\\SYSTEM\\COMCTL32.DLL\0', 'latin1'), dllNameWa);
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 17), id('InitCommonControls'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 18), -1,
    'unsupported COMCTL32 ordinals remain explicit diagnostics');

  new Uint8Array(memory.buffer).set(Buffer.from('C:\\WINDOWS\\SYSTEM\\WS2_32.DLL\0', 'latin1'), dllNameWa);
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 115), id('WSAStartup'),
    'WS2_32 exposes the WinSock 1.1 WSAStartup ordinal used by Baldur\'s Gate');
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 116), id('WSACleanup'));
  assert.strictEqual(e.test_system_ordinal_api_id(dllName, 114), -1,
    'unsupported WS2_32 ordinals remain explicit diagnostics');
  console.log('PASS Win98 system DLL ordinal resolution');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
