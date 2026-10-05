#!/usr/bin/env node
'use strict';

// The target programs use DeviceIoControl only for real driver/file-system
// facilities which the browser VFS does not expose.  Pin a callable and honest
// failure surface: handle/range validation, known-vs-unknown errors, no partial
// output writes, and the exact eight-argument stdcall cleanup.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const ROOT = path.join(__dirname, '..');
const STACK = 0x00300000;
const ERROR_INVALID_FUNCTION = 1;
const ERROR_INVALID_HANDLE = 6;
const ERROR_NOT_SUPPORTED = 50;
const ERROR_INVALID_PARAMETER = 87;
const SENTINEL = 0xa5a5a5a5;

const extraWat = String.raw`
  (func (export "test_device_io_control")
      (param $handle i32) (param $code i32)
      (param $in i32) (param $in_size i32)
      (param $out i32) (param $out_size i32)
      (param $bytes i32) (param $overlapped i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0x5a5aa55a))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x12345678))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $out_size))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $bytes))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (local.get $overlapped))
    (call $handle_DeviceIoControl
      (local.get $handle) (local.get $code)
      (local.get $in) (local.get $in_size) (local.get $out)
      (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_device_io_last_error") (result i32)
    (global.get $last_error))
  (func (export "test_device_io_api_id") (result i32)
    (call $lookup_api_id "DeviceIoControl"))
`;

function kernelDeviceIoImports(exe) {
  if (!fs.existsSync(exe)) return null;
  const output = execFileSync('node', [
    path.join(ROOT, 'tools', 'pe-imports.js'), exe, '--dll=kernel32.dll',
  ], { cwd: ROOT, encoding: 'utf8' });
  return [...output.matchAll(/^\s+\[\d+\]\s+(DeviceIoControl)\s+/gm)]
    .map(match => match[1]);
}

(async () => {
  const exes = [
    path.join(ROOT, 'test', 'binaries', 'candidates',
      'winrar-310', 'installed', 'WinRAR.exe'),
    path.join(ROOT, 'test', 'binaries', 'candidates',
      'far-manager-170', 'FarManager170', 'Far.exe'),
    path.join(ROOT, 'test', 'binaries', 'candidates',
      '7zip-file-manager', '7zFM.exe'),
  ];
  for (const exe of exes) {
    const names = kernelDeviceIoImports(exe);
    if (names) assert.deepStrictEqual(names, ['DeviceIoControl'],
      `${path.basename(exe)} imports the covered KERNEL32 entry exactly once`);
  }

  const { exports: e, hostCtx } = await bootRenderHarness({
    fonts: 'none', extraWat,
  });
  const api = apiTable.find(entry => entry.name === 'DeviceIoControl');
  assert(api, 'DeviceIoControl is registered in the generated API table');
  assert.strictEqual(api.nargs, 8, 'API metadata records all eight arguments');
  assert.strictEqual(api.convention, 'stdcall');
  assert.strictEqual(e.test_device_io_api_id(), api.id,
    'runtime import hashing resolves DeviceIoControl to its registered id');
  hostCtx.vfs.files.set('c:\\device-io.bin', {
    data: Uint8Array.of(1, 2, 3, 4), attrs: 0x80,
  });
  const handle = hostCtx.vfs.createFile('C:\\device-io.bin', 0x80000000, 3);
  assert(handle, 'focused fixture obtains a live browser-VFS file handle');

  const input = e.guest_alloc(32) >>> 0;
  const output = e.guest_alloc(64) >>> 0;
  const bytes = e.guest_alloc(4) >>> 0;
  const overlap = e.guest_alloc(20) >>> 0;
  const fillSentinels = () => {
    for (let i = 0; i < 32; i++) e.guest_write8(input + i, 0x5a);
    for (let i = 0; i < 64; i++) e.guest_write8(output + i, 0xa5);
    e.guest_write32(bytes, SENTINEL);
  };
  const assertAtomic = label => {
    for (let i = 0; i < 32; i++) assert.strictEqual(e.guest_read8(input + i), 0x5a,
      `${label}: input byte ${i} is unchanged`);
    for (let i = 0; i < 64; i++) assert.strictEqual(e.guest_read8(output + i), 0xa5,
      `${label}: output byte ${i} is unchanged`);
    assert.strictEqual(e.guest_read32(bytes) >>> 0, SENTINEL,
      `${label}: bytes-returned remains failure-atomic`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 36,
      `${label}: stdcall pops return address plus eight arguments`);
  };
  const invoke = (label, expectedError, args) => {
    fillSentinels();
    assert.strictEqual(e.test_device_io_control(...args), 0, `${label}: returns FALSE`);
    assert.strictEqual(e.test_device_io_last_error(), expectedError,
      `${label}: publishes the documented error`);
    assertAtomic(label);
  };

  const auditedControls = [
    [0x00000001, 'FAR VWIN32 DOS ioctl'],
    [0x00000006, 'WinRAR/FAR VWIN32 register request'],
    [0x00074004, '7z partition information'],
    [0x00070000, '7z/FAR disk geometry'],
    [0x0002404c, '7z CD geometry fallback'],
    [0x002d0c04, 'FAR storage media types'],
    [0x0004d004, 'FAR SCSI pass-through'],
    [0x002d1400, 'FAR storage property query'],
    [0x00090018, 'FAR volume lock'],
    [0x0009001c, 'FAR volume unlock'],
    [0x002d4800, 'FAR media eject'],
    [0x002d4804, 'FAR media-removal policy'],
    [0x002d4808, 'FAR media load'],
    [0x002d480c, 'FAR media reservation'],
    [0x0009c040, 'FAR compression request'],
    [0x000900a4, 'FAR set reparse point'],
    [0x000900a8, 'FAR get reparse point'],
    [0x000900ac, 'FAR delete reparse point'],
  ];
  for (const [code, label] of auditedControls) {
    invoke(label, ERROR_NOT_SUPPORTED,
      [handle, code, input, 32, output, 64, bytes, 0]);
  }
  invoke('unknown control', ERROR_INVALID_FUNCTION,
    [handle, 0xdead0042, input, 8, output, 8, bytes, 0]);

  invoke('unknown handle', ERROR_INVALID_HANDLE,
    [0x1234, 0x00070000, 0, 0, output, 24, bytes, 0]);
  invoke('missing synchronous bytes-returned', ERROR_INVALID_PARAMETER,
    [handle, 0x00070000, 0, 0, output, 24, 0, 0]);
  invoke('unmapped input span', ERROR_INVALID_PARAMETER,
    [handle, 0x0009c040, 0x7f000000, 2, 0, 0, bytes, 0]);
  invoke('unmapped output span', ERROR_INVALID_PARAMETER,
    [handle, 0x00070000, 0, 0, 0x7f000000, 24, bytes, 0]);
  invoke('unmapped bytes-returned', ERROR_INVALID_PARAMETER,
    [handle, 0x00070000, 0, 0, output, 24, 0x7f000000, 0]);
  invoke('overlapped request', ERROR_NOT_SUPPORTED,
    [handle, 0x00070000, 0, 0, output, 24, bytes, overlap]);

  console.log('PASS  DeviceIoControl rejects unrepresentable device state honestly');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
