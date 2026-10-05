#!/usr/bin/env node

'use strict';

// \\.\NAME is the Win32 device namespace (drivers, Win9x VxDs, volumes). The
// VFS has no devices, so CreateFile there fails with ERROR_FILE_NOT_FOUND for
// every disposition -- in particular OPEN_ALWAYS must not create a plain file.
//
// quartz.dll opens \\.\QUARTZ.VXD with GENERIC_WRITE/OPEN_ALWAYS. Handed a
// file, it trusts the VxD's DeviceIoControl, which fails, and every DirectShow
// Pause/Run then fails with E_OUTOFMEMORY. Morrowind rebuilt its music graph
// every frame after that until the guest heap ran out. On INVALID_HANDLE_VALUE
// quartz takes its file-mapping fallback instead.

const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');

const vfs = new VirtualFS();
const GENERIC_WRITE = 0x40000000, GENERIC_READ = 0x80000000;
const ERROR_FILE_NOT_FOUND = 2;

const names = ['\\\\.\\QUARTZ.VXD', '\\\\.\\vwin32', '//./QUARTZ.VXD', '\\\\.\\C:'];
for (const name of names) {
  for (const creation of [1, 2, 3, 4, 5]) {
    const result = vfs.createFileResult(name, GENERIC_READ | GENERIC_WRITE, creation);
    assert.strictEqual(result.handle, 0, `${name} creation=${creation} opens no handle`);
    assert.strictEqual(result.error, ERROR_FILE_NOT_FOUND,
      `${name} creation=${creation} fails as a missing device`);
  }
}
const created = [...vfs.files.keys()].filter(p => /quartz|vwin32/.test(p));
assert.deepStrictEqual(created, [], 'no device open left a file behind');

// Ordinary absolute, UNC-free and relative paths still create files.
assert(vfs.createFile('C:\\quartz.vxd', GENERIC_WRITE, 4), 'a real file named quartz.vxd still opens');
assert(vfs.createFile('.\\local.dat', GENERIC_WRITE, 4), 'a cwd-relative .\\ path is not the device namespace');

console.log('PASS  VFS CreateFile in the \\\\.\\ device namespace fails with ERROR_FILE_NOT_FOUND and creates nothing');
