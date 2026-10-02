#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseShellLink } = require('../lib/shell-link');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_shell_link_create") (result i32)
    (call $shell_link_init_vtables)
    (call $dx_create_com_obj (i32.const 36) (global.get $SHELL_LINK_VTBL)))

  (func (export "test_cocreate")
      (param $clsid i32) (param $iid i32) (param $outer i32) (param $out i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_CoCreateInstance
      (local.get $clsid) (local.get $outer) (i32.const 1) (local.get $iid)
      (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_refcount") (param $this i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $this))))

  (func (export "test_release_basic") (param $this i32) (result i32)
    (call $dx_com_release_basic (local.get $this)))

  (func (export "test_shell_link_string") (param $this i32) (param $which i32) (result i32)
    (local $entry i32)
    (local.set $entry (call $dx_from_this (local.get $this)))
    (if (result i32) (i32.eqz (local.get $which))
      (then (load.field DxObject misc0 (local.get $entry)))
      (else
        (if (result i32) (i32.eq (local.get $which) (i32.const 1))
          (then (load.field DxObject misc1 (local.get $entry)))
          (else (load.field DxObject misc2 (local.get $entry)))))))

  (func (export "test_heap_free_again") (param $ptr i32) (result i32)
    (call $heap_free_impl (local.get $ptr) (i32.const 0)))

  (global $test_shell_link_last_esp (mut i32) (i32.const 0))
  (func (export "test_shell_link_get_path")
      (param $this i32) (param $buffer i32) (param $chars i32)
      (param $find_data i32) (param $flags i32) (result i32)
    (local $saved_esp i32) (local $result i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IShellLinkA_GetPath
      (local.get $this) (local.get $buffer) (local.get $chars)
      (local.get $find_data) (local.get $flags) (i32.const 0))
    (local.set $result (i32.load offset=0 (global.get $reg_base)))
    (global.set $test_shell_link_last_esp (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (local.get $result))

  (func (export "test_shell_link_get_path_esp") (result i32)
    (global.get $test_shell_link_last_esp))

  (func (export "test_live_count") (result i32)
    (local $i i32) (local $count i32)
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (global.get $DX_MAX)))
      (if (i32.load (i32.add (global.get $DX_OBJECTS)
            (i32.mul (local.get $i) (i32.const 32))))
        (then (local.set $count (i32.add (local.get $count) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan)))
    (local.get $count))
`;

async function main() {
  const wasm = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = { exports: null, getMemory: () => memory.buffer };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  Object.assign(imports.host, {
    exit: () => {},
    log: () => {},
    log_i32: () => {},
    crash_unimplemented: () => {},
    wait_multiple: () => 0,
    terminate_thread: () => 0,
  });
  let hostCreates = 0;
  imports.host.com_create_instance = () => {
    hostCreates++;
    return 0x80040154;
  };

  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  context.exports = e;
  const exe = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length), 'fixture PE initializes COM thunks');
  e.init_dx_com_thunks();

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const dv = new DataView(memory.buffer);
  const read = guest => e.guest_read32(guest) >>> 0;
  const write = (guest, value) => e.guest_write32(guest, value >>> 0);
  const alloc = bytes => e.guest_alloc(bytes) >>> 0;

  function ansi(text) {
    const bytes = Buffer.from(text, 'latin1');
    const guest = alloc(bytes.length + 1);
    new Uint8Array(memory.buffer).set(bytes, wa(guest));
    dv.setUint8(wa(guest) + bytes.length, 0);
    return guest;
  }

  function readAnsi(guest, max = 4096) {
    const bytes = new Uint8Array(memory.buffer);
    let end = wa(guest);
    const limit = end + max;
    while (end < limit && bytes[end]) end++;
    return Buffer.from(bytes.subarray(wa(guest), end)).toString('latin1');
  }

  function wide(text) {
    const guest = alloc((text.length + 1) * 2);
    for (let i = 0; i < text.length; i++) {
      dv.setUint16(wa(guest) + i * 2, text.charCodeAt(i), true);
    }
    dv.setUint16(wa(guest) + text.length * 2, 0, true);
    return guest;
  }

  function iid(data1, validSuffix = true) {
    const guest = alloc(16);
    write(guest, data1);
    write(guest + 4, 0);
    write(guest + 8, validSuffix ? 0x000000c0 : 0x000000c1);
    write(guest + 12, 0x46000000);
    return guest;
  }

  function clsidShellLink() {
    return iid(0x00021401);
  }

  function runThunk(fn, args, label) {
    e.call_func(fn, args[0] || 0, args[1] || 0, args[2] || 0, args[3] || 0);
    for (let i = 0; i < 300 && e.get_eip(); i++) e.run(5000);
    assert.strictEqual(e.get_eip(), 0, label + ' must terminate');
    return e.get_eax() >>> 0;
  }

  function callMethod(object, slot, ...args) {
    const fn = read(read(object) + slot * 4);
    assert(fn, `COM slot ${slot} has a thunk`);
    return runThunk(fn, [object, ...args], `COM slot ${slot}`);
  }

  const shell = e.test_shell_link_create() >>> 0;
  assert(shell, 'Shell Link object is allocated');
  assert.strictEqual(e.test_refcount(shell), 1, 'new Shell Link owns one reference');
  assert(Array.from({ length: 21 }, (_, slot) => read(read(shell) + slot * 4)).every(Boolean),
    'IShellLinkA exposes all 21 methods');

  const pathSource = ansi('C:\\Games\\Pocket Tanks\\ptanks.exe');
  const argsSource = ansi('-windowed');
  const workSource = ansi('C:\\Games\\Pocket Tanks');
  const pathOut = alloc(260);
  const argsOut = alloc(32);
  const workOut = alloc(32);
  const findData = alloc(320);

  new Uint8Array(memory.buffer).fill(0xcc, wa(pathOut), wa(pathOut) + 260);
  new Uint8Array(memory.buffer).fill(0xcc, wa(findData), wa(findData) + 320);
  assert.strictEqual(e.test_shell_link_get_path(shell, pathOut, 260, findData, 0), 1,
    'GetPath reports S_FALSE before a target is configured');
  assert.strictEqual(readAnsi(pathOut), '', 'empty GetPath output is terminated');
  assert(new Uint8Array(memory.buffer).subarray(wa(findData), wa(findData) + 320).every(byte => byte === 0),
    'GetPath initializes optional WIN32_FIND_DATAA output');
  assert.strictEqual(e.test_shell_link_get_path_esp() >>> 0, 0x30018,
    'GetPath consumes this plus four stdcall arguments');

  assert.strictEqual(callMethod(shell, 20, pathSource), 0,
    'SetPath succeeds');
  assert.strictEqual(callMethod(shell, 11, argsSource), 0, 'SetArguments succeeds');
  assert.strictEqual(callMethod(shell, 9, workSource), 0,
    'SetWorkingDirectory succeeds');

  const ownedPath = e.test_shell_link_string(shell, 0) >>> 0;
  const ownedArgs = e.test_shell_link_string(shell, 1) >>> 0;
  const ownedWork = e.test_shell_link_string(shell, 2) >>> 0;
  assert(ownedPath && ownedPath !== pathSource, 'SetPath owns a private string copy');
  assert(ownedArgs && ownedArgs !== argsSource, 'SetArguments owns a private string copy');
  assert(ownedWork && ownedWork !== workSource, 'SetWorkingDirectory owns a private string copy');

  dv.setUint8(wa(pathSource), 'X'.charCodeAt(0));
  dv.setUint8(wa(argsSource), 'Y'.charCodeAt(0));
  dv.setUint8(wa(workSource), 'Z'.charCodeAt(0));
  assert.strictEqual(e.test_shell_link_get_path(shell, pathOut, 260, 0, 0), 0,
    'GetPath reports S_OK when a configured target is retrieved');
  assert.strictEqual(readAnsi(pathOut), 'C:\\Games\\Pocket Tanks\\ptanks.exe',
    'GetPath survives caller-buffer mutation');
  assert.strictEqual(callMethod(shell, 10, argsOut, 32), 0);
  assert.strictEqual(readAnsi(argsOut), '-windowed', 'GetArguments returns owned state');
  assert.strictEqual(callMethod(shell, 8, workOut, 32), 0);
  assert.strictEqual(readAnsi(workOut), 'C:\\Games\\Pocket Tanks',
    'GetWorkingDirectory returns owned state');

  assert.strictEqual(e.test_shell_link_get_path(shell, pathOut, 5, 0, 0), 0);
  assert.strictEqual(readAnsi(pathOut), 'C:\\G', 'GetPath honors cch including the terminator');
  assert.strictEqual(callMethod(shell, 10, argsOut, 5), 0);
  assert.strictEqual(readAnsi(argsOut), '-win', 'GetArguments truncates to cch-1 and terminates');
  assert.strictEqual(callMethod(shell, 8, workOut, 8), 0);
  assert.strictEqual(readAnsi(workOut), 'C:\\Game',
    'GetWorkingDirectory truncates to cch-1 and terminates');

  assert.strictEqual(callMethod(shell, 20, 0), 0x80070057,
    'SetPath rejects a null input without discarding its target');
  assert.strictEqual(e.test_shell_link_string(shell, 0) >>> 0, ownedPath,
    'failed SetPath preserves the owned target');

  const replacementSource = ansi('D:\\Tools\\ptanks.exe');
  assert.strictEqual(callMethod(shell, 20, replacementSource), 0,
    'SetPath replaces an existing target');
  const finalOwnedPath = e.test_shell_link_string(shell, 0) >>> 0;
  assert(finalOwnedPath && finalOwnedPath !== replacementSource && finalOwnedPath !== ownedPath,
    'replacement target has a new private owner');
  assert.strictEqual(e.test_heap_free_again(ownedPath), 0,
    'successful replacement frees the previous owned target once');
  assert.strictEqual(e.test_shell_link_get_path(shell, pathOut, 260, 0, 0), 0);
  assert.strictEqual(readAnsi(pathOut), 'D:\\Tools\\ptanks.exe',
    'GetPath returns replacement state');

  const persistOut = alloc(4);
  assert.strictEqual(callMethod(shell, 0, iid(0x0000010b), persistOut), 0,
    'QueryInterface exposes IPersistFile');
  const persist = read(persistOut);
  assert(persist && persist !== shell, 'IPersistFile has its own interface pointer');
  assert(Array.from({ length: 9 }, (_, slot) => read(read(persist) + slot * 4)).every(Boolean),
    'IPersistFile exposes all 9 methods');
  assert.strictEqual(e.test_refcount(shell), 2, 'successful interface query AddRefs');

  assert.strictEqual(callMethod(shell, 0, iid(0x000214ee), 0), 0x80004003,
    'QueryInterface reports E_POINTER for a null output');
  assert.strictEqual(e.test_refcount(shell), 2, 'null-output query does not AddRef');

  const badOut = alloc(4);
  write(badOut, 0xcccccccc);
  assert.strictEqual(callMethod(shell, 0, iid(0x0000010b, false), badOut), 0x80004002,
    'QueryInterface validates the full IID');
  assert.strictEqual(read(badOut), 0, 'failed QueryInterface clears its output');
  assert.strictEqual(e.test_refcount(shell), 2, 'failed interface query does not AddRef');

  const identityOut = alloc(4);
  assert.strictEqual(callMethod(persist, 0, iid(0), identityOut), 0,
    'IPersistFile exposes the controlling IUnknown');
  assert.strictEqual(read(identityOut), shell, 'IUnknown identity is the primary Shell Link wrapper');
  assert.strictEqual(e.test_refcount(shell), 3, 'IUnknown query AddRefs the shared object');
  assert.strictEqual(callMethod(read(identityOut), 2), 2, 'IUnknown reference balances');

  const persistBaseOut = alloc(4);
  assert.strictEqual(callMethod(shell, 0, iid(0x0000010c), persistBaseOut), 0,
    'Shell Link exposes inherited IPersist');
  assert.strictEqual(read(persistBaseOut), persist,
    'IPersist and IPersistFile share the compatible persistence wrapper');
  assert.strictEqual(e.test_refcount(shell), 3, 'IPersist query AddRefs the shared object');
  assert.strictEqual(callMethod(read(persistBaseOut), 2), 2, 'IPersist reference balances');

  // InstallShield names the shortcut's icon (an .ico beside an exe that has
  // none) and a description; both must survive into the saved file.
  const descOut = alloc(64);
  assert.strictEqual(callMethod(shell, 6, descOut, 64), 0);
  assert.strictEqual(readAnsi(descOut), '', 'GetDescription is empty before SetDescription');
  const descSource = ansi('Pocket Tanks Deluxe');
  const iconSource = ansi('C:\\Games\\Pocket Tanks\\tanks.ico');
  assert.strictEqual(callMethod(shell, 7, descSource), 0, 'SetDescription succeeds');
  assert.strictEqual(callMethod(shell, 17, iconSource, 2), 0, 'SetIconLocation succeeds');
  dv.setUint8(wa(descSource), 'Q'.charCodeAt(0));
  dv.setUint8(wa(iconSource), 'Q'.charCodeAt(0));
  assert.strictEqual(callMethod(shell, 6, descOut, 64), 0);
  assert.strictEqual(readAnsi(descOut), 'Pocket Tanks Deluxe', 'GetDescription returns an owned copy');
  const iconOut = alloc(260);
  const iconIndexOut = alloc(4);
  assert.strictEqual(callMethod(shell, 16, iconOut, 260, iconIndexOut), 0);
  assert.strictEqual(readAnsi(iconOut), 'C:\\Games\\Pocket Tanks\\tanks.ico',
    'GetIconLocation returns an owned copy');
  assert.strictEqual(read(iconIndexOut), 2, 'GetIconLocation returns the icon index');

  const linkPath = 'C:\\WINDOWS\\Desktop\\Pocket Tanks.lnk';
  assert.strictEqual(callMethod(persist, 6, wide(linkPath), 1), 0,
    'IPersistFile::Save writes the shortcut');
  const saved = context.vfs.files.get(linkPath.toLowerCase());
  assert(saved, 'shortcut exists in the VFS');
  // The configured target, directory and arguments are in the file, not
  // just a header: the browser desktop launches installed games from it.
  assert.deepStrictEqual(parseShellLink(saved.data), {
    target: 'D:\\Tools\\ptanks.exe', workingDir: 'C:\\Games\\Pocket Tanks',
    args: '-windowed', description: 'Pocket Tanks Deluxe',
    iconLocation: 'C:\\Games\\Pocket Tanks\\tanks.ico', iconIndex: 2, showCmd: 1,
  }, 'shortcut names its target, working directory, arguments, description and icon');
  const header = new DataView(saved.data.buffer, saved.data.byteOffset, saved.data.byteLength);
  assert.strictEqual(header.getUint32(0, true), 0x4c, 'shortcut header size is canonical');
  assert.strictEqual(header.getUint32(4, true), 0x00021401, 'shortcut carries CLSID_ShellLink');
  assert.strictEqual(header.getUint32(12, true), 0x000000c0);
  assert.strictEqual(header.getUint32(16, true), 0x46000000);
  assert.strictEqual(header.getUint32(60, true), 1, 'shortcut defaults to SW_SHOWNORMAL');

  const classOut = alloc(16);
  assert.strictEqual(callMethod(persist, 3, classOut), 0);
  assert.deepStrictEqual([read(classOut), read(classOut + 4), read(classOut + 8), read(classOut + 12)],
    [0x00021401, 0, 0x000000c0, 0x46000000], 'GetClassID is exact');
  assert.strictEqual(callMethod(persist, 4), 1, 'saved link reports clean state');

  assert.strictEqual(callMethod(shell, 2), 1, 'IShellLinkA release preserves the persistence wrapper');
  assert.strictEqual(callMethod(persist, 2), 0,
    'final IPersistFile release destroys the shared Shell Link object');
  assert.strictEqual(e.test_live_count(), 0, 'direct QueryInterface path leaks no object');
  assert.strictEqual(e.test_shell_link_string(shell, 0), 0, 'final Release clears the path owner');
  assert.strictEqual(e.test_shell_link_string(shell, 1), 0, 'final Release clears the argument owner');
  assert.strictEqual(e.test_shell_link_string(shell, 2), 0, 'final Release clears the directory owner');
  assert.strictEqual(e.test_heap_free_again(finalOwnedPath), 0, 'final Release frees the path copy once');
  assert.strictEqual(e.test_heap_free_again(ownedArgs), 0, 'final Release frees the argument copy once');
  assert.strictEqual(e.test_heap_free_again(ownedWork), 0, 'final Release frees the directory copy once');

  const clsid = clsidShellLink();
  const shellIid = iid(0x000214ee);
  const persistIid = iid(0x0000010b);
  const unsupportedIid = iid(0x000214ee, false);
  const factoryOut = alloc(4);

  assert.strictEqual(e.test_cocreate(clsid, shellIid, 0, factoryOut) >>> 0, 0,
    'CoCreateInstance returns the requested IShellLinkA interface');
  assert.strictEqual(hostCreates, 0, 'exact CLSID_ShellLink stays on the local path');
  assert.strictEqual(e.test_esp() >>> 0, 0x30018,
    'CoCreateInstance consumes its return address and five arguments');
  const factoryShell = read(factoryOut);
  assert(factoryShell, 'Shell Link factory returns an interface pointer');
  assert.strictEqual(e.test_refcount(factoryShell), 1,
    'factory transfers exactly one caller-owned Shell Link reference');
  assert.strictEqual(e.test_release_basic(factoryShell), 0, 'factory IShellLinkA releases cleanly');
  assert.strictEqual(e.test_live_count(), 0, 'factory IShellLinkA final release retires its object');

  assert.strictEqual(e.test_cocreate(clsid, persistIid, 0, factoryOut) >>> 0, 0,
    'CoCreateInstance can return IPersistFile directly');
  const factoryPersist = read(factoryOut);
  assert(factoryPersist, 'Shell Link factory returns an IPersistFile wrapper');
  assert.strictEqual(e.test_refcount(factoryPersist), 1,
    'direct IPersistFile creation owns one transferred reference');
  assert.strictEqual(e.test_release_basic(factoryPersist), 0, 'factory IPersistFile releases cleanly');
  assert.strictEqual(e.test_live_count(), 0, 'factory IPersistFile final release retires its object');

  write(factoryOut, 0xcccccccc);
  assert.strictEqual(e.test_cocreate(clsid, unsupportedIid, 0, factoryOut) >>> 0, 0x80004002,
    'Shell Link factory rejects a full-IID mismatch');
  assert.strictEqual(read(factoryOut), 0, 'factory IID failure clears output');
  assert.strictEqual(e.test_live_count(), 0,
    'factory IID failure releases its temporary object reference');

  write(factoryOut, 0xcccccccc);
  assert.strictEqual(e.test_cocreate(clsid, shellIid, 1, factoryOut) >>> 0, 0x80040110,
    'Shell Link factory rejects unsupported aggregation');
  assert.strictEqual(read(factoryOut), 0, 'aggregation failure clears output');
  assert.strictEqual(e.test_live_count(), 0, 'aggregation rejection allocates no object');

  assert.strictEqual(e.test_cocreate(clsid, shellIid, 0, 0) >>> 0, 0x80004003,
    'Shell Link factory reports E_POINTER for a null output');
  assert.strictEqual(e.test_live_count(), 0, 'null-output rejection allocates no object');

  // Preserve Data1 but corrupt the suffix: a complete CLSID comparison must
  // fall through to the host registry rather than manufacture a Shell Link.
  write(clsid + 8, 0x000000c1);
  write(factoryOut, 0xcccccccc);
  assert.strictEqual(e.test_cocreate(clsid, shellIid, 0, factoryOut) >>> 0, 0x80040154);
  assert.strictEqual(hostCreates, 1, 'Shell Link factory compares the complete CLSID');
  assert.strictEqual(read(factoryOut), 0, 'failed host fallback clears output');
  assert.strictEqual(e.test_live_count(), 0, 'same-Data1 class mismatch allocates no local object');

  console.log('PASS  Shell Link COM persists a valid minimal .lnk through IPersistFile');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
