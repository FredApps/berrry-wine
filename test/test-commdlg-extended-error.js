#!/usr/bin/env node
'use strict';

// Common-dialog FALSE is ambiguous by design: Cancel means no extended
// error, while malformed input has a COMDLG32-specific code. Keep that state
// separate from LastError and reject caller structures before modal/allocation
// side effects.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const NEXT_HWND = 0x2468;

const extraWat = String.raw`
  (func $test_commdlg_begin
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (global.set $next_hwnd (i32.const ${NEXT_HWND}))
    (global.set $modal_restore_pending (i32.const 0)))

  (func (export "test_GetOpenFileNameA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_GetOpenFileNameA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_GetSaveFileNameW") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_GetSaveFileNameW (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ChooseFontA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_ChooseFontA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_FindTextA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_FindTextA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ReplaceTextA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_ReplaceTextA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_PageSetupDlgA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_PageSetupDlgA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_PrintDlgA") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_PrintDlgA (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_GlobalLock") (param $h i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_GlobalLock (local.get $h) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ChooseColorW") (param $ptr i32) (result i32)
    (call $test_commdlg_begin)
    (call $handle_ChooseColorW (local.get $ptr) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_CommDlgExtendedError") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_CommDlgExtendedError (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_commdlg_next_hwnd") (result i32)
    (global.get $next_hwnd))
  (func (export "test_commdlg_modal_capture") (result i32)
    (global.get $modal_restore_pending))
`;

function write32(e, ptr, value) {
  e.guest_write32(ptr, value >>> 0);
}

function write16(e, ptr, value) {
  e.guest_write8(ptr, value & 0xff);
  e.guest_write8(ptr + 1, (value >>> 8) & 0xff);
}

function bytes(e, ptr, length) {
  return Buffer.from(Array.from({ length }, (_, i) => e.guest_read8(ptr + i)));
}

function assertRejected(e, call, ptr, expectedError, label) {
  assert.strictEqual(call(ptr) >>> 0, 0, `${label} returns FALSE/NULL`);
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    `${label} pops one-argument stdcall frame`);
  assert.strictEqual(e.test_commdlg_next_hwnd() >>> 0, NEXT_HWND,
    `${label} does not reserve a dialog HWND`);
  assert.strictEqual(e.test_commdlg_modal_capture() >>> 0, 0,
    `${label} does not enter modal state`);
  assert.strictEqual(e.test_CommDlgExtendedError() >>> 0, expectedError,
    `${label} publishes its common-dialog error`);
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4,
    'CommDlgExtendedError has a zero-argument stdcall frame');
  assert.strictEqual(e.test_CommDlgExtendedError() >>> 0, expectedError,
    'reading CommDlgExtendedError does not consume it');
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  assertRejected(e, e.test_GetOpenFileNameA, 0, 0x0002,
    'NULL OPENFILENAME');

  const wrong = e.guest_alloc(96) >>> 0;
  for (let i = 0; i < 96; i++) e.guest_write8(wrong + i, 0xa5);
  write32(e, wrong, 75);
  const beforeWrong = bytes(e, wrong, 96);
  assertRejected(e, e.test_GetOpenFileNameA, wrong, 0x0001,
    'wrong readable OPENFILENAME size');
  assert.deepStrictEqual(bytes(e, wrong, 96), beforeWrong,
    'structure-size failure leaves the caller buffer byte-for-byte unchanged');

  for (const [size, call, label] of [
    [76, e.test_GetSaveFileNameW, 'wrong OPENFILENAMEW size'],
    [60, e.test_ChooseFontA, 'wrong CHOOSEFONT size'],
    [40, e.test_FindTextA, 'wrong FINDREPLACE size'],
    [84, e.test_PageSetupDlgA, 'wrong PAGESETUPDLG size'],
    [66, e.test_PrintDlgA, 'wrong PRINTDLG size'],
    [36, e.test_ChooseColorW, 'wrong CHOOSECOLOR size'],
  ]) {
    const ptr = e.guest_alloc(size) >>> 0;
    for (let i = 0; i < size; i++) e.guest_write8(ptr + i, 0);
    write32(e, ptr, size - 1);
    assertRejected(e, call, ptr, 0x0001, label);
  }

  const find = e.guest_alloc(40) >>> 0;
  for (let i = 0; i < 40; i++) e.guest_write8(find + i, 0);
  write32(e, find, 40);
  write16(e, find + 24, 0);
  assertRejected(e, e.test_FindTextA, find, 0x4001,
    'zero-length Find buffer');

  const findBuffer = e.guest_alloc(8) >>> 0;
  const replace = e.guest_alloc(40) >>> 0;
  for (let i = 0; i < 40; i++) e.guest_write8(replace + i, 0);
  write32(e, replace, 40);
  write32(e, replace + 16, findBuffer);
  write16(e, replace + 24, 8);
  write16(e, replace + 26, 0);
  assertRejected(e, e.test_ReplaceTextA, replace, 0x4001,
    'zero-length Replace buffer');

  const font = e.guest_alloc(60) >>> 0;
  for (let i = 0; i < 60; i++) e.guest_write8(font + i, 0);
  write32(e, font, 60);
  write32(e, font + 20, 0x00002000); // CF_LIMITSIZE
  write32(e, font + 52, 24);
  write32(e, font + 56, 12);
  assertRejected(e, e.test_ChooseFontA, font, 0x2002,
    'CHOOSEFONT maximum below minimum');

  const print = e.guest_alloc(66) >>> 0;
  for (let i = 0; i < 66; i++) e.guest_write8(print + i, 0x5a);
  write32(e, print, 66);
  write32(e, print + 8, 0x12345678);
  write32(e, print + 12, 0);
  write32(e, print + 20, 0x00000400); // PD_RETURNDEFAULT
  const beforePrint = bytes(e, print, 66);
  assertRejected(e, e.test_PrintDlgA, print, 0x1003,
    'PD_RETURNDEFAULT with existing DEVMODE');
  assert.deepStrictEqual(bytes(e, print, 66), beforePrint,
    'PDERR_RETDEFFAILURE is failure-atomic');

  // A successful synchronous default-printer query starts by clearing the
  // former error, which is also the state an ordinary Cancel path preserves.
  for (let i = 0; i < 66; i++) e.guest_write8(print + i, 0);
  write32(e, print, 66);
  write32(e, print + 20, 0x00000400);
  assert.strictEqual(e.test_PrintDlgA(print) >>> 0, 1,
    'valid PD_RETURNDEFAULT query succeeds synchronously');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8);
  assert.strictEqual(e.test_CommDlgExtendedError() >>> 0, 0,
    'a valid common-dialog entry clears the preceding failure');

  // hDevMode and hDevNames are HGLOBALs: the caller locks them next. MFC's
  // AfxCreateDC gives up on a NULL lock, which closed Paint's Print Preview
  // the moment it opened.
  const hDevMode = e.guest_read32(print + 8) >>> 0;
  const hDevNames = e.guest_read32(print + 12) >>> 0;
  assert.ok(hDevMode && hDevNames, 'PD_RETURNDEFAULT returns DEVMODE and DEVNAMES handles');
  assert.strictEqual(e.test_GlobalLock(hDevMode) >>> 0, hDevMode, 'GlobalLock(hDevMode) succeeds');
  assert.strictEqual(e.test_GlobalLock(hDevNames) >>> 0, hDevNames, 'GlobalLock(hDevNames) succeeds');

  console.log('PASS  CommDlgExtendedError distinguishes validation failures from Cancel');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
