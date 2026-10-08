#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');

const extraWat = String.raw`
  (func (export "test_set_resource_root") (param $root i32)
    (global.set $rsrc_rva (i32.sub (local.get $root) (global.get $image_base))))

  (func (export "test_begin_enum_resource_names")
      (param $type i32) (param $callback i32) (param $lparam i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    ;; A zero return address lets the callback continuation halt cleanly after
    ;; the last resource name.
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (call $handle_EnumResourceNamesA
      (i32.const 0) (local.get $type) (local.get $callback) (local.get $lparam)
      (i32.const 0) (i32.const 0))
    (global.get $eip))

  (func (export "test_enum_resource_thunk") (result i32)
    (global.get $enum_rsrc_thunk))

  ;; Suspend the first outer callback with its argument frame still live.
  ;; Returning from the nested enumeration resumes that exact callback.
  (func (export "test_nested_enum_resource_names")
      (param $type i32) (param $callback i32)
    (i32.store offset=16 (global.get $reg_base)
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 20)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (global.get $eip))
    (call $handle_EnumResourceNamesA
      (i32.const 0) (local.get $type) (local.get $callback)
      (i32.const 0) (i32.const 0) (i32.const 0)))

  ;; Resolve the real API hash table, then enter through the normal guest
  ;; thunk dispatcher (including stdcall/nonvolatile-register handling).
  (func (export "test_resource_api_thunk") (param $name i32) (result i32)
    (local $id i32) (local $wa i32)
    (local.set $id (call $lookup_api_id (call $g2w (local.get $name))))
    (if (i32.lt_s (local.get $id) (i32.const 0)) (then (return (i32.const 0))))
    (local.set $wa (i32.add (global.get $THUNK_BASE)
      (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $wa) (i32.const 0x80000001))
    (i32.store offset=4 (local.get $wa) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (i32.add (global.get $image_base) (i32.sub (local.get $wa) (global.get $GUEST_BASE))))
  (func (export "test_resource_program") (param $entry i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $gs32 (i32.const 0x07000000) (i32.const 0))
    (global.set $eip (local.get $entry)))
  (func (export "test_resource_last_error") (result i32) (global.get $last_error))
  (func (export "test_resource_dll") (param $base i32) (param $rva i32)
    (i32.store (i32.add (global.get $DLL_TABLE)
      (i32.mul (global.get $dll_count) (i32.const 32))) (local.get $base))
    (i32.store (i32.add (global.get $DLL_RSRC_TABLE)
      (i32.mul (global.get $dll_count) (i32.const 8))) (local.get $rva))
    (global.set $dll_count (i32.add (global.get $dll_count) (i32.const 1))))
`;

function u32(value) {
  return [value, value >>> 8, value >>> 16, value >>> 24].map(v => v & 0xff);
}

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });

  // Loading any PE initializes the callback-thunk table and establishes the
  // guest-address translation used by the synthetic resource directory.
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes callback support');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const write16 = (guest, value) => view.setUint16(toWasm(guest), value, true);
  const write32 = (guest, value) => view.setUint32(toWasm(guest), value >>> 0, true);

  const root = e.guest_alloc(0x200) >>> 0;
  bytes.fill(0, toWasm(root), toWasm(root + 0x200));
  // Root directory: one integer type, 256, whose name directory contains two
  // named entries followed by one MAKEINTRESOURCE entry.
  write16(root + 12, 0);
  write16(root + 14, 1);
  write32(root + 16, 0x100);
  write32(root + 20, 0x80000020);
  write16(root + 0x20 + 12, 2);
  write16(root + 0x20 + 14, 1);
  write32(root + 0x30, 0x80000080);
  write32(root + 0x38, 0x800000a0);
  write32(root + 0x40, 7);
  const putResourceName = (offset, text) => {
    write16(root + offset, text.length);
    for (let i = 0; i < text.length; i++) write16(root + offset + 2 + i * 2, text.charCodeAt(i));
  };
  putResourceName(0x80, 'ALPHA');
  putResourceName(0xa0, 'BETA');
  e.test_set_resource_root(root);

  const observed = e.guest_alloc(32) >>> 0;
  const callback = e.guest_alloc(96) >>> 0;
  bytes.fill(0, toWasm(observed), toWasm(observed + 32));

  // ENUMRESNAMEPROCA: retain type/module/lParam, then record either the first
  // four ANSI bytes of a named resource or the integer ID itself.
  bytes.set(Uint8Array.from([
    0x8b, 0x44, 0x24, 0x08,             // mov eax,[esp+8]  (lpType)
    0xa3, ...u32(observed + 16),
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4]  (hModule)
    0xa3, ...u32(observed + 20),
    0x8b, 0x44, 0x24, 0x10,             // mov eax,[esp+16] (lParam)
    0xa3, ...u32(observed + 24),
    0x8b, 0x44, 0x24, 0x0c,             // mov eax,[esp+12] (lpName)
    0x8b, 0x0d, ...u32(observed),        // mov ecx,[count]
    0x3d, 0x00, 0x00, 0x01, 0x00,       // cmp eax,0x10000
    0x72, 0x04,                         // jb integer_name
    0x8b, 0x10,                         // mov edx,[eax]
    0xeb, 0x02,                         // jmp store_name
    0x89, 0xc2,                         // integer_name: mov edx,eax
    0x89, 0x14, 0x8d, ...u32(observed + 4), // mov [observed+4+ecx*4],edx
    0x41,                               // inc ecx
    0x89, 0x0d, ...u32(observed),        // mov [count],ecx
    0xb8, 0x01, 0x00, 0x00, 0x00,       // mov eax,TRUE
    0xc2, 0x10, 0x00,                   // ret 16
  ]), toWasm(callback));

  assert.notStrictEqual(e.test_enum_resource_thunk() >>> 0, 0,
    'EnumResourceNames continuation thunk is initialized');
  assert.strictEqual(
    e.test_begin_enum_resource_names(0x100, callback, 0xdecafbad) >>> 0,
    callback,
    'enumeration enters the first guest callback');
  for (let i = 0; i < 30 && e.get_eip(); i++) e.run(5000);

  assert.strictEqual(e.get_eip() >>> 0, 0,
    'the final callback resumes the saved API caller');
  assert.strictEqual(e.get_eax() >>> 0, 1,
    'enumerating every name returns TRUE');
  assert.strictEqual(e.get_esp() >>> 0, 0x07000014,
    'EnumResourceNamesA pops its return address and four arguments');
  assert.strictEqual(view.getUint32(toWasm(observed), true), 3,
    'callback runs once for every type-directory entry');
  assert.deepStrictEqual([
    view.getUint32(toWasm(observed + 4), true),
    view.getUint32(toWasm(observed + 8), true),
    view.getUint32(toWasm(observed + 12), true),
  ], [0x48504c41, 0x41544542, 7],
  'named UTF-16 entries become ANSI strings while integer IDs stay integers');
  assert.strictEqual(view.getUint32(toWasm(observed + 16), true), 0x100,
    'callback receives the original resource type');
  assert.strictEqual(view.getUint32(toWasm(observed + 20), true), 0,
    'callback receives the original NULL module');
  assert.strictEqual(view.getUint32(toWasm(observed + 24), true), 0xdecafbad,
    'callback receives the caller lParam unchanged');

  bytes.fill(0, toWasm(observed), toWasm(observed + 32));
  const innerCount = e.guest_alloc(4) >>> 0;
  write32(innerCount, 0);
  const innerCallback = e.guest_alloc(32) >>> 0;
  bytes.set(Uint8Array.from([
    0xff, 0x05, ...u32(innerCount),       // inc dword [innerCount]
    0x31, 0xc0,                          // xor eax,eax: stop after first name
    0xc2, 0x10, 0x00,                    // ret 16
  ]), toWasm(innerCallback));
  e.test_begin_enum_resource_names(0x100, callback, 0xdecafbad);
  e.test_nested_enum_resource_names(0x100, innerCallback);
  for (let i = 0; i < 30 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(view.getUint32(toWasm(innerCount), true), 1,
    'nested enumeration runs its callback and honors FALSE');
  assert.strictEqual(view.getUint32(toWasm(observed), true), 3,
    'outer directory cursor survives nested early termination');
  assert.strictEqual(view.getUint32(toWasm(observed + 4), true), 0x48504c41,
    'outer ANSI name buffer stays alive across the nested callback');
  assert.strictEqual(e.get_eip() >>> 0, 0, 'nested return resumes original caller');
  assert.strictEqual(e.get_esp() >>> 0, 0x07000014, 'nested frames restore ESP');
  assert.strictEqual(e.get_eax() >>> 0, 1, 'outer enumeration completes successfully');

  const allocCode = code => {
    const p = e.guest_alloc(code.length + 16) >>> 0;
    bytes.set(Uint8Array.from(code), toWasm(p));
    return p;
  };
  const thunks = {};
  for (const name of ['Types', 'Names', 'Languages']) {
    const apiName = allocCode([...Buffer.from(`EnumResource${name}A`), 0]);
    thunks[name] = e.test_resource_api_thunk(apiName) >>> 0;
    assert(thunks[name], `${name} resolves through the generated API hash table`);
  }
  const nestedRoot = e.guest_alloc(0x400) >>> 0;
  bytes.fill(0, toWasm(nestedRoot), toWasm(nestedRoot + 0x400));
  const dir = (offset, entries, named = 0) => {
    write16(nestedRoot + offset + 12, named);
    write16(nestedRoot + offset + 14, entries.length - named);
    entries.forEach(([id, child], i) => {
      write32(nestedRoot + offset + 16 + i * 8, id);
      write32(nestedRoot + offset + 20 + i * 8, child);
    });
  };
  const resourceString = (offset, value) => {
    write16(nestedRoot + offset, value.length);
    [...value].forEach((c, i) => write16(nestedRoot + offset + 2 + i * 2, c.charCodeAt(0)));
  };
  dir(0, [[0x80000300, 0x80000020], [256, 0x80000040]], 1);
  dir(0x20, [[0x80000320, 0x80000080], [7, 0x800000a0]], 1);
  dir(0x40, [[0x80000320, 0x800000c0], [7, 0x800000e0]], 1);
  for (const offset of [0x80, 0xa0, 0xc0, 0xe0]) dir(offset, [[0x407, 0x180], [0x411, 0x190]]);
  resourceString(0x300, 'T\u20acPE');
  resourceString(0x320, 'ALP\u0152A');
  e.test_set_resource_root(nestedRoot);
  const results = e.guest_alloc(80) >>> 0;
  bytes.fill(0, toWasm(results), toWasm(results + 80));
  const langCallback = allocCode([
    0x8b, 0x0d, ...u32(results),            // mov ecx,[count]
    0x8b, 0x44, 0x24, 0x10,               // mov eax,[esp+16] LANGID
    0x89, 0x04, 0x8d, ...u32(results + 4), // mov [langs+ecx*4],eax
    0xff, 0x05, ...u32(results),           // inc count
    0x8b, 0x44, 0x24, 0x14,               // mov eax,[esp+20] lParam
    0xa3, ...u32(results + 48),
    0xb8, ...u32(1), 0xc2, 0x14, 0x00,
  ]);
  const call = thunk => [0xb8, ...u32(thunk), 0xff, 0xd0];
  const nameCallback = allocCode([
    0xff, 0x74, 0x24, 0x10,               // push lParam
    0x68, ...u32(langCallback),
    0xff, 0x74, 0x24, 0x14,               // push name
    0xff, 0x74, 0x24, 0x14,               // push type
    0xff, 0x74, 0x24, 0x14,               // push module
    ...call(thunks.Languages),
    0xc2, 0x10, 0x00,                     // propagate BOOL
  ]);
  const typeCallback = allocCode([
    0xff, 0x74, 0x24, 0x0c,               // push lParam
    0x68, ...u32(nameCallback),
    0xff, 0x74, 0x24, 0x10,               // push type
    0xff, 0x74, 0x24, 0x10,               // push module
    ...call(thunks.Names),
    0xc2, 0x0c, 0x00,
  ]);
  const runApi = (thunk, args) => {
    const program = allocCode([
      ...args.slice().reverse().flatMap(arg => [0x68, ...u32(arg)]),
      ...call(thunk), 0xc3,
    ]);
    e.test_resource_program(program);
    for (let i = 0; i < 80 && e.get_eip(); i++) e.run(5000);
    assert.strictEqual(e.get_eip() >>> 0, 0, 'API chain returns to guest caller');
    assert.strictEqual(e.get_esp() >>> 0, 0x07000004, 'all stdcall frames balance');
    return e.get_eax() >>> 0;
  };
  assert.strictEqual(runApi(thunks.Types, [0, typeCallback, 0xdecafbad]), 1);
  assert.strictEqual(view.getUint32(toWasm(results), true), 8, 'two types × two names × two actual languages');
  assert.deepStrictEqual(Array.from({length:8}, (_, i) => view.getUint32(toWasm(results + 4 + i * 4), true)),
    [0x407, 0x411, 0x407, 0x411, 0x407, 0x411, 0x407, 0x411]);
  assert.strictEqual(view.getUint32(toWasm(results + 48), true), 0xdecafbad, 'lParam survives three callback levels');
  const stopLanguage = allocCode([0x31, 0xc0, 0xc2, 0x14, 0x00]);
  assert.strictEqual(runApi(thunks.Languages, [0, 256, 7, stopLanguage, 0]), 0,
    'language callback FALSE stops enumeration');
  assert.strictEqual(e.test_resource_last_error(), 0, 'Win98 callback stop has ERROR_SUCCESS');
  const stopType = allocCode([0x31, 0xc0, 0xc2, 0x0c, 0x00]);
  assert.strictEqual(runApi(thunks.Types, [0, stopType, 0]), 0,
    'type callback FALSE stops enumeration');
  const hashType = allocCode([...Buffer.from('#256'), 0]);
  const hashName = allocCode([...Buffer.from('#7'), 0]);
  assert.strictEqual(runApi(thunks.Languages, [imageBase, hashType, hashName, langCallback, 17]), 1,
    'explicit EXE module and decimal resource names enumerate');
  for (const [args, error] of [
    [[0, 999, 7, langCallback, 0], 1813],
    [[0, 256, 999, langCallback, 0], 1814],
    [[0x12345678, 256, 7, langCallback, 0], 6],
    [[0, 256, 7, 0, 0], 87],
  ]) {
    assert.strictEqual(runApi(thunks.Languages, args), 0);
    assert.strictEqual(e.test_resource_last_error(), error);
  }
  const dllBase = e.guest_alloc(0x800) >>> 0;
  bytes.copyWithin(toWasm(dllBase + 0x400), toWasm(nestedRoot), toWasm(nestedRoot + 0x400));
  e.test_resource_dll(dllBase, 0x400);
  assert.strictEqual(runApi(thunks.Languages, [dllBase, 256, 7, stopLanguage, 0]), 0);
  assert.strictEqual(e.test_resource_last_error(), 0, 'loaded DLL uses its own resource directory');
  const emptyDll = e.guest_alloc(0x100) >>> 0;
  e.test_resource_dll(emptyDll, 0);
  assert.strictEqual(runApi(thunks.Types, [emptyDll, typeCallback, 0]), 0);
  assert.strictEqual(e.test_resource_last_error(), 1812, 'resource-less DLL does not fall back to EXE');
  write16(nestedRoot + 0xe0 + 14, 0);
  assert.strictEqual(runApi(thunks.Languages, [0, 256, 7, langCallback, 0]), 0);
  assert.strictEqual(e.test_resource_last_error(), 1815, 'empty language directory reports missing language');
  e.test_set_resource_root(imageBase);
  assert.strictEqual(runApi(thunks.Types, [0, typeCallback, 0]), 0);
  assert.strictEqual(e.test_resource_last_error(), 1812, 'resource-less EXE fails without touching callbacks');

  console.log('PASS resource enumeration: named/ID types and names, actual LANGIDs, nested callbacks, errors and stack restoration');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
