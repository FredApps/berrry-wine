#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const RegionMap = require('../lib/region-map.generated.js');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_proc_version_ex") (param $stack i32) (result i32)
    (local $name i32)
    (local.set $name (call $heap_alloc (i32.const 13)))
    (i32.store (call $g2w (local.get $name)) (i32.const 0x56746547)) ;; "GetV"
    (i32.store offset=4 (call $g2w (local.get $name)) (i32.const 0x69737265)) ;; "ersi"
    (i32.store offset=8 (call $g2w (local.get $name)) (i32.const 0x78456e6f)) ;; "onEx"
    (i32.store8 offset=12 (call $g2w (local.get $name)) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetProcAddress
      (global.get $image_base) (local.get $name) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_version_ex") (param $stack i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetVersionEx
      (local.get $info) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_call_version_ex_a") (param $stack i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetVersionExA
      (local.get $info) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_call_version_ex_w") (param $stack i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetVersionExW
      (local.get $info) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_get_proc_system_windows_directory") (param $stack i32) (result i32)
    (local $name i32)
    (local.set $name (call $heap_alloc (i32.const 27)))
    (i32.store (call $g2w (local.get $name)) (i32.const 0x53746547)) ;; "GetS"
    (i32.store offset=4 (call $g2w (local.get $name)) (i32.const 0x65747379)) ;; "yste"
    (i32.store offset=8 (call $g2w (local.get $name)) (i32.const 0x6e69576d)) ;; "mWin"
    (i32.store offset=12 (call $g2w (local.get $name)) (i32.const 0x73776f64)) ;; "dows"
    (i32.store offset=16 (call $g2w (local.get $name)) (i32.const 0x65726944)) ;; "Dire"
    (i32.store offset=20 (call $g2w (local.get $name)) (i32.const 0x726f7463)) ;; "ctor"
    (i32.store offset=24 (call $g2w (local.get $name)) (i32.const 0x00004179)) ;; "yA"
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetProcAddress
      (global.get $image_base) (local.get $name) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_system_windows_directory")
        (param $stack i32) (param $buf i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetSystemWindowsDirectoryA
      (local.get $buf) (i32.const 260) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_get_proc_system_default_ui_language") (param $stack i32) (result i32)
    (local $name i32)
    (local.set $name (call $heap_alloc (i32.const 27)))
    (i32.store (call $g2w (local.get $name)) (i32.const 0x53746547)) ;; "GetS"
    (i32.store offset=4 (call $g2w (local.get $name)) (i32.const 0x65747379)) ;; "yste"
    (i32.store offset=8 (call $g2w (local.get $name)) (i32.const 0x6665446d)) ;; "mDef"
    (i32.store offset=12 (call $g2w (local.get $name)) (i32.const 0x746c7561)) ;; "ault"
    (i32.store offset=16 (call $g2w (local.get $name)) (i32.const 0x614c4955)) ;; "UILa"
    (i32.store offset=20 (call $g2w (local.get $name)) (i32.const 0x6175676e)) ;; "ngua"
    (i32.store offset=24 (call $g2w (local.get $name)) (i32.const 0x00006567)) ;; "ge"
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetProcAddress
      (global.get $image_base) (local.get $name) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_system_default_ui_language") (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetSystemDefaultUILanguage
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_get_proc_lstrlen") (param $stack i32) (result i32)
    (local $name i32)
    (local.set $name (call $heap_alloc (i32.const 8)))
    (i32.store (call $g2w (local.get $name)) (i32.const 0x7274736c)) ;; "lstr"
    (i32.store offset=4 (call $g2w (local.get $name)) (i32.const 0x006e656c)) ;; "len"
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetProcAddress
      (global.get $image_base) (local.get $name) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_lstrlen")
        (param $stack i32) (param $text i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_lstrlen
      (local.get $text) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_call_lstrlen_a")
        (param $stack i32) (param $text i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_lstrlenA
      (local.get $text) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const api = apiTable.find(entry => entry.name === 'GetVersionEx');
  assert(api, 'the historical unsuffixed GetVersionEx export exists');
  assert.strictEqual(api.nargs, 1, 'GetVersionEx has one stdcall argument');
  const apiA = apiTable.find(entry => entry.name === 'GetVersionExA');
  assert(apiA, 'GetVersionExA exists');
  assert.strictEqual(apiA.nargs, 1, 'GetVersionExA has one stdcall argument');
  const apiW = apiTable.find(entry => entry.name === 'GetVersionExW');
  assert(apiW, 'GetVersionExW exists');
  assert.strictEqual(apiW.nargs, 1, 'GetVersionExW has one stdcall argument');

  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = 0x074ff000;
  const info = wat.guest_alloc(148) >>> 0;
  const infoA = wat.guest_alloc(148) >>> 0;
  const infoW = wat.guest_alloc(276) >>> 0;
  const infoWasm = RegionMap.g2w(info, wat.get_image_base());
  const infoAWasm = RegionMap.g2w(infoA, wat.get_image_base());
  const infoWWasm = RegionMap.g2w(infoW, wat.get_image_base());
  const view = new DataView(memory.buffer);
  new Uint8Array(memory.buffer, infoWasm, 148).fill(0xcc);
  new Uint8Array(memory.buffer, infoAWasm, 148).fill(0xcc);
  new Uint8Array(memory.buffer, infoWWasm, 276).fill(0xcc);
  view.setUint32(infoWasm, 148, true);
  view.setUint32(infoAWasm, 148, true);
  view.setUint32(infoWWasm, 276, true);

  assert.notStrictEqual(wat.test_get_proc_version_ex(stack) >>> 0, 0,
    'GetProcAddress(GetVersionEx) returns a callable thunk');
  assert.strictEqual(wat.test_call_version_ex_a(stack, infoA) >>> 0, stack + 8,
    'GetVersionExA pops its argument and return address');
  assert.strictEqual(wat.get_eax(), 1, 'GetVersionExA succeeds');
  assert.strictEqual(wat.test_call_version_ex_w(stack, infoW) >>> 0, stack + 8,
    'GetVersionExW pops its argument and return address');
  assert.strictEqual(wat.get_eax(), 1, 'GetVersionExW succeeds');
  assert.strictEqual(wat.test_call_version_ex(stack, info) >>> 0, stack + 8,
    'GetVersionEx pops its argument and return address');
  assert.strictEqual(wat.get_eax(), 1, 'GetVersionEx succeeds');
  assert.deepStrictEqual(
    Buffer.from(new Uint8Array(memory.buffer, infoWasm, 148)),
    Buffer.from(new Uint8Array(memory.buffer, infoAWasm, 148)),
    'GetVersionEx exactly matches the ANSI structure fill');
  assert.strictEqual(view.getUint32(infoWasm + 4, true), 4, 'reports Windows 98 major version');
  assert.strictEqual(view.getUint32(infoWasm + 8, true), 10, 'reports Windows 98 minor version');
  assert.strictEqual(view.getUint32(infoWasm + 16, true), 1,
    'reports VER_PLATFORM_WIN32_WINDOWS');
  assert.deepStrictEqual(
    Buffer.from(new Uint8Array(memory.buffer, infoWWasm + 4, 18)),
    Buffer.from(new Uint8Array(memory.buffer, infoAWasm + 4, 18)),
    'GetVersionExW shares the numeric version prefix and empty CSD string');
  assert.strictEqual(view.getUint16(infoWWasm + 20, true), 0,
    'GetVersionExW terminates the WCHAR CSD string');
  assert.strictEqual(view.getUint8(infoWWasm + 22), 0xcc,
    'the empty WCHAR CSD string does not overwrite the caller-owned tail');

  wat.set_winver(0x05650004);
  for (const [ptr, at, call] of [
    [infoA, infoAWasm, wat.test_call_version_ex_a],
    [infoW, infoWWasm, wat.test_call_version_ex_w],
  ]) {
    new Uint8Array(memory.buffer, at, ptr === infoW ? 276 : 148).fill(0xcc);
    view.setUint32(at, ptr === infoW ? 276 : 148, true);
    assert.strictEqual(call(stack, ptr) >>> 0, stack + 8,
      'version aliases retain stdcall cleanup under the NT compatibility profile');
  }
  assert.deepStrictEqual(
    Buffer.from(new Uint8Array(memory.buffer, infoWWasm + 4, 18)),
    Buffer.from(new Uint8Array(memory.buffer, infoAWasm + 4, 18)),
    'GetVersionExW tracks GetVersionExA when the reported platform changes');
  assert.strictEqual(view.getUint32(infoWWasm + 16, true), 2,
    'GetVersionExW reports VER_PLATFORM_WIN32_NT under the NT profile');

  const systemWindowsApi = apiTable.find(entry => entry.name === 'GetSystemWindowsDirectoryA');
  assert(systemWindowsApi, 'GetSystemWindowsDirectoryA is exposed to dynamic callers');
  assert.strictEqual(systemWindowsApi.nargs, 2, 'GetSystemWindowsDirectoryA has two arguments');
  assert.notStrictEqual(wat.test_get_proc_system_windows_directory(stack) >>> 0, 0,
    'GetProcAddress(GetSystemWindowsDirectoryA) returns a callable thunk');
  const path = wat.guest_alloc(260) >>> 0;
  assert.strictEqual(wat.test_call_system_windows_directory(stack, path) >>> 0, stack + 12,
    'GetSystemWindowsDirectoryA pops its arguments and return address');
  assert.strictEqual(wat.get_eax(), 10, 'GetSystemWindowsDirectoryA returns the path length');
  const pathWasm = RegionMap.g2w(path, wat.get_image_base());
  assert.strictEqual(Buffer.from(new Uint8Array(memory.buffer, pathWasm, 10)).toString('latin1'),
    'C:\\WINDOWS', 'GetSystemWindowsDirectoryA returns the Win98 Windows directory');

  const systemUiLanguageApi = apiTable.find(entry => entry.name === 'GetSystemDefaultUILanguage');
  assert(systemUiLanguageApi, 'GetSystemDefaultUILanguage is exposed to dynamic callers');
  assert.strictEqual(systemUiLanguageApi.nargs, 0,
    'GetSystemDefaultUILanguage has no arguments');
  assert.notStrictEqual(wat.test_get_proc_system_default_ui_language(stack) >>> 0, 0,
    'GetProcAddress(GetSystemDefaultUILanguage) returns a callable thunk');
  assert.strictEqual(wat.test_call_system_default_ui_language(stack) >>> 0, stack + 4,
    'GetSystemDefaultUILanguage pops only its return address');
  assert.strictEqual(wat.get_eax(), 0x0409,
    'GetSystemDefaultUILanguage reports English (United States)');

  const lstrlenApi = apiTable.find(entry => entry.name === 'lstrlen');
  assert(lstrlenApi, 'the unsuffixed lstrlen compatibility export exists');
  assert.strictEqual(lstrlenApi.nargs, 1, 'lstrlen has one argument');
  assert.notStrictEqual(wat.test_get_proc_lstrlen(stack) >>> 0, 0,
    'GetProcAddress(lstrlen) returns a callable thunk');
  const text = wat.guest_alloc(14) >>> 0;
  const textWasm = RegionMap.g2w(text, wat.get_image_base());
  new Uint8Array(memory.buffer, textWasm, 14).set(
    Buffer.from('Black & White\0', 'latin1'));
  assert.strictEqual(wat.test_call_lstrlen(stack, text) >>> 0, stack + 8,
    'lstrlen pops its argument and return address');
  assert.strictEqual(wat.get_eax(), 13, 'lstrlen uses ANSI byte-string semantics');
  assert.strictEqual(wat.test_call_lstrlen_a(stack, text) >>> 0, stack + 8,
    'lstrlenA pops its argument and return address');
  assert.strictEqual(wat.get_eax(), 13, 'lstrlen and lstrlenA return the same ANSI length');

  const highBytes = wat.guest_alloc(3) >>> 0;
  const highBytesWasm = RegionMap.g2w(highBytes, wat.get_image_base());
  new Uint8Array(memory.buffer, highBytesWasm, 3).set([0x80, 0xff, 0]);
  wat.test_call_lstrlen(stack, highBytes);
  assert.strictEqual(wat.get_eax(), 2, 'lstrlen counts ANSI high bytes as characters');
  wat.test_call_lstrlen_a(stack, highBytes);
  assert.strictEqual(wat.get_eax(), 2, 'lstrlenA matches the ANSI high-byte count');

  wat.test_call_lstrlen(stack, 0);
  assert.strictEqual(wat.get_eax(), 0, 'lstrlen returns zero for NULL');
  wat.test_call_lstrlen_a(stack, 0);
  assert.strictEqual(wat.get_eax(), 0, 'lstrlenA returns zero for NULL');

  console.log('PASS  InstallShield dynamic KERNEL32 compatibility exports resolve');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
