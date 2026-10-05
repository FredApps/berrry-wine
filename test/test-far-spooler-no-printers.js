#!/usr/bin/env node
'use strict';

// FAR's print dialog first enumerates local printers and remembered printer
// connections, then opens the selected name and streams a RAW document.  This
// browser machine has neither source, so enumeration is an empty success and
// every handle-producing/consuming step must fail without inventing output.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const ROOT = path.join(__dirname, '..');
const FAR = path.join(ROOT, 'test', 'binaries', 'candidates',
  'far-manager-170', 'FarManager170', 'Far.exe');
const STACK = 0x00300000;
const SENTINEL = 0xa5a55a5a;
const LAST_ERROR_SENTINEL = 0x5a5aa55a;
const ERROR_INVALID_HANDLE = 6;
const ERROR_INVALID_PARAMETER = 87;
const ERROR_INVALID_LEVEL = 124;
const ERROR_INVALID_FLAGS = 1004;
const ERROR_INVALID_USER_BUFFER = 1784;
const ERROR_INVALID_PRINTER_NAME = 1801;

const extraWat = String.raw`
  (func $test_spool_begin
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x12345678)))

  (func (export "test_EnumPrintersA")
      (param $flags i32) (param $name i32) (param $level i32)
      (param $buffer i32) (param $size i32)
      (param $needed i32) (param $returned i32) (result i32)
    (call $test_spool_begin)
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24))
      (local.get $needed))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28))
      (local.get $returned))
    (call $handle_EnumPrintersA
      (local.get $flags) (local.get $name) (local.get $level)
      (local.get $buffer) (local.get $size) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_OpenPrinterA")
      (param $name i32) (param $out i32) (param $defaults i32) (result i32)
    (call $test_spool_begin)
    (call $handle_OpenPrinterA
      (local.get $name) (local.get $out) (local.get $defaults)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ClosePrinter") (param $handle i32) (result i32)
    (call $test_spool_begin)
    (call $handle_ClosePrinter
      (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_StartDocPrinterA")
      (param $handle i32) (param $level i32) (param $info i32) (result i32)
    (call $test_spool_begin)
    (call $handle_StartDocPrinterA
      (local.get $handle) (local.get $level) (local.get $info)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_EndDocPrinter") (param $handle i32) (result i32)
    (call $test_spool_begin)
    (call $handle_EndDocPrinter
      (local.get $handle) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_WritePrinter")
      (param $handle i32) (param $buffer i32) (param $size i32)
      (param $written i32) (result i32)
    (call $test_spool_begin)
    (call $handle_WritePrinter
      (local.get $handle) (local.get $buffer) (local.get $size)
      (local.get $written) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_spool_set_error") (param $value i32)
    (global.set $last_error (local.get $value)))
  (func (export "test_spool_get_error") (result i32)
    (global.get $last_error))
  (func (export "test_spool_first_api_id") (result i32)
    (call $lookup_api_id "ClosePrinter"))
  (func (export "test_spool_last_api_id") (result i32)
    (call $lookup_api_id "EnumPrintersA"))
`;

function assertStack(e, bytes, name) {
  assert.strictEqual(e.get_esp() >>> 0, STACK + bytes,
    `${name} pops its return address and documented arguments`);
}

(async () => {
  if (fs.existsSync(FAR)) {
    const imports = execFileSync('node', [
      path.join(ROOT, 'tools', 'pe-imports.js'), FAR, '--dll=winspool.drv',
    ], { cwd: ROOT, encoding: 'utf8' });
    const names = [...imports.matchAll(/^\s+\[\d+\]\s+(\w+)\s+/gm)]
      .map(match => match[1]);
    assert.deepStrictEqual(names, [
      'ClosePrinter', 'EndDocPrinter', 'WritePrinter', 'StartDocPrinterA',
      'OpenPrinterA', 'EnumPrintersA',
    ], 'focused surface is FAR 1.70\'s complete WINSPOOL import set');
  }

  const { exports: e } = await bootRenderHarness({
    extraWat, fonts: 'none',
  });
  const names = [
    'ClosePrinter', 'EndDocPrinter', 'WritePrinter', 'StartDocPrinterA',
    'OpenPrinterA', 'EnumPrintersA',
  ];
  const rows = names.map(name => apiTable.find(entry => entry.name === name));
  assert(rows.every(Boolean), 'all six FAR spooler APIs are registered');
  assert.deepStrictEqual(rows.map(row => row.nargs), [1, 1, 4, 3, 3, 7]);
  assert(rows.every(row => row.convention === 'stdcall'));
  assert.strictEqual(e.test_spool_first_api_id(), rows[0].id);
  assert.strictEqual(e.test_spool_last_api_id(), rows[5].id);
  const buffer = e.guest_alloc(128) >>> 0;
  const needed = e.guest_alloc(4) >>> 0;
  const returned = e.guest_alloc(4) >>> 0;
  const handleOut = e.guest_alloc(4) >>> 0;
  const written = e.guest_alloc(4) >>> 0;
  const name = e.guest_alloc(16) >>> 0;
  Buffer.from('Printer\0', 'latin1').forEach((byte, i) =>
    e.guest_write8(name + i, byte));

  const resetEnum = () => {
    for (let i = 0; i < 128; i++) e.guest_write8(buffer + i, 0x7b);
    e.guest_write32(needed, SENTINEL);
    e.guest_write32(returned, SENTINEL);
    e.test_spool_set_error(LAST_ERROR_SENTINEL);
  };
  const assertEnumAtomic = label => {
    assert.strictEqual(e.guest_read32(needed) >>> 0, SENTINEL,
      `${label}: pcbNeeded is unchanged`);
    assert.strictEqual(e.guest_read32(returned) >>> 0, SENTINEL,
      `${label}: pcReturned is unchanged`);
    for (let i = 0; i < 128; i++) assert.strictEqual(e.guest_read8(buffer + i), 0x7b,
      `${label}: enumeration buffer byte ${i} is unchanged`);
  };

  for (const [flags, level, label] of [
    [2, 2, 'local level 2'],
    [4, 5, 'connections level 5'],
    [6, 1, 'combined level 1'],
    [6, 4, 'combined level 4'],
  ]) {
    resetEnum();
    assert.strictEqual(e.test_EnumPrintersA(
      flags, 0, level, buffer, 128, needed, returned) >>> 0, 1,
    `${label} is a successful empty enumeration`);
    assertStack(e, 32, 'EnumPrintersA');
    assert.strictEqual(e.guest_read32(needed) >>> 0, 0,
      `${label} needs no output bytes`);
    assert.strictEqual(e.guest_read32(returned) >>> 0, 0,
      `${label} returns no printer structures`);
    assert.strictEqual(e.test_spool_get_error() >>> 0, LAST_ERROR_SENTINEL,
      `${label} preserves successful LastError`);
    for (let i = 0; i < 128; i++) assert.strictEqual(e.guest_read8(buffer + i), 0x7b,
      `${label} does not invent printer data at byte ${i}`);
  }

  resetEnum();
  assert.strictEqual(e.test_EnumPrintersA(
    2, 0, 2, 0, 0, needed, returned) >>> 0, 1,
  'NULL/zero-byte size query succeeds when the empty set needs zero bytes');
  assert.strictEqual(e.guest_read32(needed) >>> 0, 0);
  assert.strictEqual(e.guest_read32(returned) >>> 0, 0);

  for (const [flags, enumName, level, enumBuffer, size, expected, label] of [
    [2, 0, 3, buffer, 128, ERROR_INVALID_LEVEL, 'unsupported level'],
    [0, 0, 2, buffer, 128, ERROR_INVALID_FLAGS, 'missing source flags'],
    [0x102, 0, 2, buffer, 128, ERROR_INVALID_FLAGS, 'unknown source flag'],
    [2, 0, 2, 0, 128, ERROR_INVALID_USER_BUFFER, 'NULL nonzero buffer'],
    [2, name, 4, buffer, 128, ERROR_INVALID_PARAMETER, 'named level 4 query'],
  ]) {
    resetEnum();
    assert.strictEqual(e.test_EnumPrintersA(
      flags, enumName, level, enumBuffer, size, needed, returned) >>> 0, 0,
    `${label} fails`);
    assertStack(e, 32, 'EnumPrintersA');
    assert.strictEqual(e.test_spool_get_error() >>> 0, expected, label);
    assertEnumAtomic(label);
  }

  resetEnum();
  assert.strictEqual(e.test_EnumPrintersA(
    2, 0, 2, buffer, 128, 0, returned) >>> 0, 0,
  'pcbNeeded is required');
  assert.strictEqual(e.test_spool_get_error() >>> 0, ERROR_INVALID_PARAMETER);
  assert.strictEqual(e.guest_read32(returned) >>> 0, SENTINEL,
    'a required-output failure does not publish pcReturned');

  for (const printerName of [name, 0]) {
    e.guest_write32(handleOut, SENTINEL);
    e.test_spool_set_error(LAST_ERROR_SENTINEL);
    assert.strictEqual(e.test_OpenPrinterA(printerName, handleOut, 0) >>> 0, 0,
      'OpenPrinterA cannot fabricate a printer or server handle');
    assertStack(e, 16, 'OpenPrinterA');
    assert.strictEqual(e.test_spool_get_error() >>> 0,
      ERROR_INVALID_PRINTER_NAME);
    assert.strictEqual(e.guest_read32(handleOut) >>> 0, SENTINEL,
      'failed OpenPrinterA preserves phPrinter');
  }
  assert.strictEqual(e.test_OpenPrinterA(name, 0, 0) >>> 0, 0,
    'OpenPrinterA requires phPrinter');
  assert.strictEqual(e.test_spool_get_error() >>> 0, ERROR_INVALID_PARAMETER);

  for (const [call, pop, label] of [
    [() => e.test_ClosePrinter(0x71000001), 8, 'ClosePrinter'],
    [() => e.test_StartDocPrinterA(0x71000001, 1, 0), 16, 'StartDocPrinterA'],
    [() => e.test_EndDocPrinter(0x71000001), 8, 'EndDocPrinter'],
  ]) {
    e.test_spool_set_error(LAST_ERROR_SENTINEL);
    assert.strictEqual(call() >>> 0, 0, `${label} rejects a nonexistent handle`);
    assertStack(e, pop, label);
    assert.strictEqual(e.test_spool_get_error() >>> 0, ERROR_INVALID_HANDLE);
  }

  for (let i = 0; i < 128; i++) e.guest_write8(buffer + i, 0x3c);
  e.guest_write32(written, SENTINEL);
  e.test_spool_set_error(LAST_ERROR_SENTINEL);
  assert.strictEqual(e.test_WritePrinter(
    0x71000001, buffer, 128, written) >>> 0, 0,
  'WritePrinter rejects a nonexistent spool handle');
  assertStack(e, 20, 'WritePrinter');
  assert.strictEqual(e.test_spool_get_error() >>> 0, ERROR_INVALID_HANDLE);
  assert.strictEqual(e.guest_read32(written) >>> 0, SENTINEL,
    'failed WritePrinter preserves pcWritten');
  for (let i = 0; i < 128; i++) assert.strictEqual(e.guest_read8(buffer + i), 0x3c,
    `failed WritePrinter preserves input byte ${i}`);

  console.log('PASS FAR spooler exposes one coherent no-printers-installed machine');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
