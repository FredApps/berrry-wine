#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_find_executable_id") (result i32)
    (call $lookup_api_id "FindExecutableA"))
  (func (export "test_find_executable")
      (param $file i32) (param $directory i32) (param $output i32)
      (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $handle_FindExecutableA
      (local.get $file) (local.get $directory) (local.get $output)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_seed_registry_default")
      (param $path i32) (param $value i32) (param $type i32) (result i32)
    (local $holder i32) (local $handle i32) (local $result i32)
    (local.set $holder (call $heap_alloc (i32.const 4)))
    (if (i32.eqz (local.get $holder)) (then (return (i32.const 8))))
    (local.set $result (call $host_reg_create_key
      (i32.const 0x80000000) (call $g2w (local.get $path))
      (local.get $holder) (i32.const 0) (i32.const 0)))
    (if (i32.eqz (local.get $result))
      (then
        (local.set $handle (call $gl32 (local.get $holder)))
        (local.set $result (call $host_reg_set_value
          (local.get $handle) (i32.const 0) (local.get $type)
          (local.get $value)
          (i32.add (call $guest_strlen (local.get $value)) (i32.const 1))
          (i32.const 0)))
        (drop (call $host_reg_close_key (local.get $handle)))))
    (call $heap_free (local.get $holder))
    (local.get $result))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = harness.exports;
  const vfs = harness.hostCtx.vfs;
  const output = e.guest_alloc(264) >>> 0;
  const esp0 = 0x07380000;

  assert.strictEqual(e.test_find_executable_id(), 3589,
    'generated API hash table exposes the corpus import');

  const writeAnsi = value => {
    const ptr = e.guest_alloc(Buffer.byteLength(value, 'latin1') + 1) >>> 0;
    const bytes = Buffer.from(`${value}\0`, 'latin1');
    for (let i = 0; i < bytes.length; i++) e.guest_write8(ptr + i, bytes[i]);
    return ptr;
  };
  const readAnsi = ptr => {
    const bytes = [];
    for (let i = 0; i < 260; i++) {
      const ch = e.guest_read8(ptr + i);
      if (!ch) return Buffer.from(bytes).toString('latin1');
      bytes.push(ch);
    }
    throw new Error('unterminated ANSI result');
  };
  const fillOutput = value => {
    for (let i = 0; i < 264; i++) e.guest_write8(output + i, value);
  };
  const unchanged = value => {
    for (let i = 0; i < 264; i++) assert.strictEqual(e.guest_read8(output + i), value);
  };
  const seedDefault = (path, value, type = 1) => {
    assert.strictEqual(e.test_seed_registry_default(
      writeAnsi(path), writeAnsi(value), type), 0, `seed HKCR\\${path}`);
  };
  const seedAssociation = (extension, progId, command, type = 1) => {
    seedDefault(extension, progId);
    seedDefault(progId, `${progId} document`);
    seedDefault(`${progId}\\shell\\open\\command`, command, type);
  };
  const find = (file, directory = 0, out = output) => e.test_find_executable(
    typeof file === 'string' ? writeAnsi(file) : file,
    typeof directory === 'string' ? writeAnsi(directory) : directory,
    out, esp0) >>> 0;

  vfs.dirs.add('c:\\docs');
  vfs.dirs.add('c:\\other');
  const mount = name => vfs.files.set(name.toLowerCase(), {
    data: Uint8Array.of(1), attrs: 0x20,
  });
  mount('c:\\docs\\quoted.waq');
  mount('c:\\docs\\plain.wau');
  mount('c:\\docs\\missing-association.wan');
  mount('c:\\docs\\malformed.wam');
  mount('c:\\docs\\huge.wah');
  mount('c:\\docs\\expand.wae');
  mount('c:\\docs\\README');

  seedAssociation('.waq', 'WineAssembly.Quoted',
    '  "C:\\Program Files\\Viewer\\viewer.exe" "%1"');
  seedAssociation('.wau', 'WineAssembly.Unquoted',
    'C:\\TOOLS\\VIEWER.EXE /open %1');
  seedAssociation('.wam', 'WineAssembly.Malformed',
    '"C:\\TOOLS\\BROKEN.EXE %1');
  seedAssociation('.wah', 'WineAssembly.Huge',
    `"C:\\${'x'.repeat(257)}" "%1"`);
  seedAssociation('.wae', 'WineAssembly.Expand',
    '"%SystemRoot%\\VIEWER.EXE" "%1"', 2);

  fillOutput(0xcc);
  assert.strictEqual(find('C:\\docs\\quoted.waq'), 33,
    'an existing document resolves its quoted open-command executable');
  assert.strictEqual(readAnsi(output), 'C:\\Program Files\\Viewer\\viewer.exe');
  assert.strictEqual(e.get_esp() >>> 0, (esp0 + 16) >>> 0,
    'FindExecutableA performs one three-argument stdcall cleanup');
  assert.strictEqual(e.guest_read8(output + 259), 0xcc,
    'success writes only the executable and terminator inside MAX_PATH');

  fillOutput(0xcd);
  assert.strictEqual(find('plain.wau', 'C:\\docs'), 33,
    'lpDirectory resolves a relative document through the VFS');
  assert.strictEqual(readAnsi(output), 'C:\\TOOLS\\VIEWER.EXE',
    'an unquoted command ends argv[0] at its first whitespace');
  assert.strictEqual(e.guest_read8(output + 259), 0xcd);

  for (const [file, directory, expected, reason] of [
    ['C:\\docs\\does-not-exist.waq', 0, 2, 'missing document'],
    ['plain.wau', 'C:\\missing-directory', 3, 'invalid default directory'],
    ['C:\\docs\\missing-association.wan', 0, 31, 'absent extension association'],
    ['C:\\docs\\README', 0, 31, 'document without an extension'],
    ['C:\\docs\\malformed.wam', 0, 31, 'unterminated quoted command'],
    ['C:\\docs\\huge.wah', 0, 8, 'executable at or beyond MAX_PATH'],
    ['C:\\docs\\expand.wae', 0, 31, 'unmodeled REG_EXPAND_SZ environment token'],
  ]) {
    fillOutput(0xa5);
    assert.strictEqual(find(file, directory), expected, reason);
    unchanged(0xa5);
    assert.strictEqual(e.get_esp() >>> 0, (esp0 + 16) >>> 0, `${reason}: stdcall cleanup`);
  }

  fillOutput(0x7e);
  assert.strictEqual(find(0), 2, 'NULL document path is a bounded file-not-found failure');
  unchanged(0x7e);
  assert.strictEqual(find(0xf0000000), 2,
    'unmapped document path does not reach the VFS or NULL sentinel');
  unchanged(0x7e);
  assert.strictEqual(find('C:\\docs\\quoted.waq', 0, 0), 5,
    'NULL output is rejected before registry lookup');
  assert.strictEqual(find('C:\\docs\\quoted.waq', 0, 0xf0000000), 5,
    'unmapped MAX_PATH output is rejected without a partial write');

  console.log('PASS  FindExecutableA resolves bounded Win98 file associations');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
