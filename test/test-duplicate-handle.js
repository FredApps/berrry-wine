#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_call_DuplicateHandle")
    (param $stack i32) (param $target i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    ;; Sixth/seventh arguments: bInheritHandle=FALSE,
    ;; dwOptions=DUPLICATE_SAME_ACCESS.
    (call $gs32 (i32.add (local.get $stack) (i32.const 24)) (i32.const 0))
    (call $gs32 (i32.add (local.get $stack) (i32.const 28)) (i32.const 2))
    (call $handle_DuplicateHandle
      (i32.const -1) (i32.const -2) (i32.const -1)
      (local.get $target) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_read_guest32") (param $address i32) (result i32)
    (call $gl32 (local.get $address)))
  (func (export "test_file_duplicate") (param $handle i32) (param $target i32)
    (param $access i32) (param $options i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $gs32 (i32.const 0x074ff018) (i32.const 1))
    (call $gs32 (i32.const 0x074ff01c) (local.get $options))
    (call $handle_DuplicateHandle (i32.const -1) (local.get $handle) (i32.const -1)
      (local.get $target) (local.get $access) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_crt_dup") (param $handle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle__dup (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x074ff004))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_dup_error") (result i32) (global.get $last_error))
  (func (export "test_public_read") (param $handle i32) (param $count i32) (result i32)
    (global.set $last_error (i32.const 0x1234))
    (global.set $yield_flag (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $gs32 (i32.const 0x00490110) (i32.const -1))
    (call $handle_ReadFile (local.get $handle) (i32.const 0x00490100)
      (local.get $count) (i32.const 0x00490110) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base))
        (select (i32.const 0x074ff000) (i32.const 0x074ff018) (global.get $yield_flag)))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_read_parked") (result i32) (global.get $yield_flag))
  (func (export "test_public_write") (param $handle i32) (param $count i32) (result i32)
    (global.set $last_error (i32.const 0x1234))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $gs32 (i32.const 0x00490100) (i32.const 0x44434241))
    (call $gs32 (i32.const 0x00490110) (i32.const -1))
    (call $handle_WriteFile (local.get $handle) (i32.const 0x00490100)
      (local.get $count) (i32.const 0x00490110) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x074ff018))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_dup_errno") (result i32)
    (call $gl32 (global.get $msvcrt_errno_ptr)))
  (func (export "test_public_close") (param $handle i32) (result i32)
    (global.set $last_error (i32.const 0x1234))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_CloseHandle (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x074ff008))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const duplicateCalls = [];
  const realCurrentThreadHandle = 0x0e200001;
  const { exports: wat, hostCtx } = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      duplicate_current_thread: threadId => {
        duplicateCalls.push(threadId >>> 0);
        return realCurrentThreadHandle;
      },
    },
  });
  const stack = 0x074ff000;
  const target = 0x00490000;

  assert.strictEqual(wat.test_call_DuplicateHandle(stack, target) >>> 0, stack + 32,
    'DuplicateHandle pops its return address and seven stdcall arguments');
  assert.strictEqual(wat.get_eax(), 1, 'DuplicateHandle succeeds with an output pointer');
  assert.strictEqual(wat.test_read_guest32(target) >>> 0, realCurrentThreadHandle,
    'DuplicateHandle materializes a real handle for the current-thread pseudo handle');
  assert.deepStrictEqual(duplicateCalls, [1],
    'the host resolves GetCurrentThread against the calling guest thread');

  assert.strictEqual(wat.test_call_DuplicateHandle(stack, 0) >>> 0, stack + 32,
    'failed DuplicateHandle still cleans up its stdcall frame');
  assert.strictEqual(wat.get_eax(), 0, 'DuplicateHandle rejects a NULL output pointer');

  const vfs = hostCtx.vfs;
  const writeHandle = vfs.createFile('c:\\write-result.bin', 0xc0000000, 2) >>> 0;
  assert.strictEqual(wat.test_public_write(writeHandle, 4), 1);
  assert.strictEqual(wat.test_dup_error(), 0x1234);
  assert.strictEqual(wat.test_read_guest32(0x00490110), 4);
  assert.deepStrictEqual(Array.from(vfs.files.get('c:\\write-result.bin').data), [65, 66, 67, 68]);
  vfs.setFilePointer(writeHandle, 0, 0);
  assert.strictEqual(wat.test_public_read(writeHandle, 4), 1);
  assert.strictEqual(wat.test_read_guest32(0x00490100), 0x44434241);
  assert.strictEqual(wat.test_read_guest32(0x00490110), 4);
  assert.strictEqual(wat.test_dup_error(), 0x1234);
  vfs.closeHandle(writeHandle);
  for (const count of [0, 4]) {
    assert.strictEqual(wat.test_public_read(writeHandle, count), 0);
    assert.strictEqual(wat.test_dup_error(), 6, 'closed ReadFile reports ERROR_INVALID_HANDLE');
    assert.strictEqual(wat.test_read_guest32(0x00490110), 0);
    assert.strictEqual(wat.test_read_parked(), 0);
    assert.strictEqual(wat.test_public_write(writeHandle, count), 0);
    assert.strictEqual(wat.test_dup_error(), 6, 'closed WriteFile reports its operation error');
    assert.strictEqual(wat.test_read_guest32(0x00490110), 0, 'failure clears bytes written');
  }
  const realWrite = vfs.writeFile;
  const errorHandle = vfs.createFile('c:\\write-error.bin', 0xc0000000, 2) >>> 0;
  const realRead = vfs.readFile;
  try {
    for (const error of [5, 30]) {
      vfs.readFile = () => ({ ok: false, bytesRead: 0, error });
      assert.strictEqual(wat.test_public_read(errorHandle, 4), 0);
      assert.strictEqual(wat.test_dup_error(), error);
      assert.strictEqual(wat.test_read_parked(), 0, 'ordinary errors do not park');
      assert.strictEqual(wat.test_read_guest32(0x00490110), 0);
    }
    vfs.readFile = () => ({ ok: false, bytesRead: 0, pending: { handle: errorHandle } });
    assert.strictEqual(wat.test_public_read(errorHandle, 4), 0);
    assert.strictEqual(wat.test_read_parked(), 1, 'lazy retry preserves the caller frame and parks');
    assert.strictEqual(wat.test_dup_error(), 0x1234, 'internal lazy retry does not publish an error');
    vfs.readFile = () => ({ ok: false, bytesRead: 0, faulted: true, error: 23 });
    assert.strictEqual(wat.test_public_read(errorHandle, 4), 0);
    assert.strictEqual(wat.test_read_parked(), 0);
    assert.strictEqual(wat.test_dup_error(), 23, 'terminal provider error retains its code');
  } finally {
    vfs.readFile = realRead;
  }
  assert.strictEqual(wat.test_public_read(errorHandle, 4), 1, 'EOF is a successful zero-byte synchronous read');
  assert.strictEqual(wat.test_read_guest32(0x00490110), 0);
  assert.strictEqual(wat.test_dup_error(), 0x1234);
  try {
    for (const error of [19, 112]) {
      vfs.writeFile = () => ({ ok: false, bytesWritten: 0, error });
      assert.strictEqual(wat.test_public_write(errorHandle, 4), 0);
      assert.strictEqual(wat.test_dup_error(), error, 'write error is returned with this operation');
      assert.strictEqual(wat.test_read_guest32(0x00490110), 0);
    }
  } finally {
    vfs.writeFile = realWrite;
  }
  assert.strictEqual(wat.test_public_write(errorHandle, 0), 1, 'success after failure does not reuse a host error');
  assert.strictEqual(wat.test_dup_error(), 0x1234);
  vfs.setDriveReadOnly('c', true);
  try {
    assert.strictEqual(wat.test_public_write(errorHandle, 4), 0);
    assert.strictEqual(wat.test_dup_error(), 19, 'write-protected media reports ERROR_WRITE_PROTECT');
    assert.strictEqual(vfs.files.get('c:\\write-error.bin').data.length, 0);
  } finally {
    vfs.setDriveReadOnly('c', false);
  }
  console.log('PASS  public ReadFile/WriteFile preserve operation errors, byte counts, retry frames and stdcall cleanup');
  const original = vfs.createFile('c:\\duplicate.bin', 0xc0000000, 2) >>> 0;
  vfs.writeFile(original, Uint8Array.from([10, 20, 30, 40]), 4);
  vfs.setFilePointer(original, 0, 0);
  assert.strictEqual(wat.test_file_duplicate(original, target, 0, 2), 1);
  assert.strictEqual(wat.get_esp() >>> 0, stack + 32);
  const alias = wat.test_read_guest32(target) >>> 0;
  assert.notStrictEqual(alias, original, 'file duplication allocates a distinct handle');
  assert.strictEqual(vfs.handles.get(alias).inherit, true);
  const byte = new Uint8Array(1);
  assert.strictEqual(vfs.readFile(alias, byte, 1).bytesRead, 1);
  assert.strictEqual(byte[0], 10);
  assert.strictEqual(vfs.handles.get(original).pos, 1, 'duplicate reads advance the original position');
  const independent = vfs.createFile('c:\\duplicate.bin', 0x80000000, 3) >>> 0;
  assert.strictEqual(vfs.handles.get(independent).pos, 0, 'separate opens do not share position');
  const crtAlias = wat.test_crt_dup(alias) >>> 0;
  assert.notStrictEqual(crtAlias, alias);
  assert.notStrictEqual(crtAlias, 0xffffffff);
  vfs.setFilePointer(crtAlias, 2, 0);
  assert.strictEqual(vfs.handles.get(original).pos, 2, 'duplicates of duplicates share the same position');
  assert.strictEqual(wat.test_public_close(original), 1, 'public CloseHandle closes a live file');
  assert.strictEqual(wat.test_dup_error(), 0x1234, 'successful close does not manufacture an error');
  assert.strictEqual(wat.test_public_close(original), 0, 'public CloseHandle must propagate double-close failure');
  assert.strictEqual(wat.test_dup_error(), 6, 'double close reports ERROR_INVALID_HANDLE');
  assert.strictEqual(vfs.handles.get(alias).closed, false, 'closing source does not close an alias');
  assert.strictEqual(vfs.readFile(alias, byte, 1).bytesRead, 1);
  assert.strictEqual(byte[0], 30);
  assert.strictEqual(wat.test_file_duplicate(original, target, 0, 2), 0);
  assert.strictEqual(wat.test_dup_error(), 6, 'closed source is not duplicable');
  assert.strictEqual(wat.test_crt_dup(original), -1);
  assert.strictEqual(wat.test_crt_dup(0x77777777), -1, 'fabricated file descriptor fails');
  assert.strictEqual(wat.test_dup_errno(), 9, '_dup reports EBADF through errno');
  assert.strictEqual(wat.test_file_duplicate(alias, target, 0, 3), 1);
  const transferred = wat.test_read_guest32(target) >>> 0;
  assert.strictEqual(vfs.handles.get(alias).closed, true, 'DUPLICATE_CLOSE_SOURCE closes only source');
  assert.strictEqual(vfs.handles.get(transferred).closed, false);
  assert.strictEqual(vfs.handles.get(transferred).pos, 3);
  assert.strictEqual(wat.test_file_duplicate(independent, target, 0xc0000000, 1), 0);
  assert.strictEqual(wat.test_dup_error(), 5, 'file duplication cannot grant additional access');
  assert.strictEqual(vfs.handles.get(independent).closed, true, 'close-source also applies on error');
  assert.strictEqual(wat.test_file_duplicate(transferred, target, 0, 8), 0);
  assert.strictEqual(wat.test_dup_error(), 87, 'unknown duplication options fail');

  console.log('PASS  DuplicateHandle materializes current-thread handles and preserves stdcall cleanup');
  console.log('PASS  Win32/CRT file duplicates share position and retain independent close state');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
