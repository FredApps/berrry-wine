#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_shell_pidl_from_path") (param $path i32) (result i32)
    (call $shell_filesystem_pidl_from_path (local.get $path)))
  (func (export "test_shell_virtual_pidl") (param $csidl i32) (result i32)
    (call $shell_virtual_pidl_from_csidl (local.get $csidl)))
  (func (export "test_compare_ids")
      (param $lparam i32) (param $left i32) (param $right i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IShellFolder_CompareIDs
      (i32.const 0) (local.get $lparam) (local.get $left) (local.get $right)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_heap_alloc") (param $size i32) (result i32)
    (call $heap_alloc (local.get $size)))
`;

function signedCode(hr) {
  return (hr << 16) >> 16;
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  function writeAnsi(value) {
    const ptr = e.guest_alloc(value.length + 1) >>> 0;
    for (let i = 0; i < value.length; i++) e.guest_write8(ptr + i, value.charCodeAt(i));
    e.guest_write8(ptr + value.length, 0);
    return ptr;
  }

  function filePidl(path) {
    const pidl = e.test_shell_pidl_from_path(writeAnsi(path)) >>> 0;
    assert.notStrictEqual(pidl, 0, `PIDL allocation for ${path}`);
    return pidl;
  }

  const alpha = filePidl('C:\\Alpha');
  const alphaCase = filePidl('c:\\ALPHA');
  const beta = filePidl('C:\\Beta');

  assert.strictEqual(signedCode(e.test_compare_ids(0, alpha, alphaCase)), 0,
    'Win98 filesystem names compare case-insensitively');
  assert.ok(signedCode(e.test_compare_ids(0, alpha, beta)) < 0,
    'alphabetically earlier filesystem PIDL precedes the later one');
  assert.ok(signedCode(e.test_compare_ids(0, beta, alpha)) > 0,
    'filesystem comparison preserves the reverse ordering');
  assert.strictEqual(e.get_esp(), 0x00300014,
    'four-argument COM method preserves stdcall cleanup');

  const desktop = e.test_shell_virtual_pidl(0x00) >>> 0;
  const drives = e.test_shell_virtual_pidl(0x11) >>> 0;
  const drivesAgain = e.test_shell_virtual_pidl(0x11) >>> 0;
  assert.ok(signedCode(e.test_compare_ids(0, desktop, drives)) < 0,
    'virtual shell roots have a stable Win98 display-name order');
  assert.strictEqual(signedCode(e.test_compare_ids(0, drives, drivesAgain)), 0,
    'equivalent virtual identities compare equal');

  assert.strictEqual(e.test_compare_ids(1, alpha, beta) >>> 0, 0x80070057,
    'unsupported folder-specific sort columns fail honestly');
  assert.strictEqual(e.test_compare_ids(0, 0, beta) >>> 0, 0x80070057,
    'NULL PIDLs fail instead of comparing equal');

  const foreign = e.test_heap_alloc(12) >>> 0;
  e.guest_write8(foreign, 8);
  e.guest_write8(foreign + 1, 0);
  e.guest_write32(foreign + 2, 0x11223344);
  e.guest_write8(foreign + 8, 0);
  e.guest_write8(foreign + 9, 0);
  assert.strictEqual(e.test_compare_ids(0, foreign, beta) >>> 0, 0x80070057,
    'foreign provider PIDLs fail instead of aliasing a private shell item');

  console.log('PASS IShellFolder::CompareIDs orders validated Win98 shell PIDLs');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
