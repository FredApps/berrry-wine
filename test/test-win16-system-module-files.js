#!/usr/bin/env node
'use strict';

// The 16-bit system modules the emulator implements must also exist as files
// in C:\WINDOWS\SYSTEM, because apps probe the path before using them.
// Authorware (Civilization II's Civilopedia) _lopen's SYSTEM\MMSYSTEM.DLL and,
// when that fails, never resolves waveOut and later far-calls a null pointer.
//
// Checks each file is mounted by the shared boot helper, is a well-formed NE
// library naming its module, and that an already-mounted real file is kept.

const assert = require('assert');
const boot = require('../lib/process-boot');

const vfs = { files: new Map() };
const shipped = { data: new Uint8Array([1, 2, 3]), attrs: 0x20 };
vfs.files.set('c:\\windows\\system\\user.exe', shipped);
boot.mountSystemDataFiles(vfs, []);

assert.strictEqual(vfs.files.get('c:\\windows\\system\\user.exe'), shipped,
  'a file already at the path is not replaced');
for (const [file, module] of boot.WIN16_SYSTEM_MODULE_FILES) {
  const entry = vfs.files.get('c:\\windows\\system\\' + file.toLowerCase());
  assert(entry, `${file} is mounted`);
  if (module === 'USER') continue;
  const b = entry.data;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.strictEqual(String.fromCharCode(b[0], b[1]), 'MZ', `${file} MZ`);
  const ne = dv.getUint32(0x3c, true);
  assert.strictEqual(String.fromCharCode(b[ne], b[ne + 1]), 'NE', `${file} NE`);
  assert(dv.getUint16(ne + 0x0C, true) & 0x8000, `${file} is a library`);
  assert.strictEqual(dv.getUint16(ne + 0x1C, true), 0, `${file} has no segments`);
  const res = ne + dv.getUint16(ne + 0x26, true);
  const name = String.fromCharCode(...b.subarray(res + 1, res + 1 + b[res]));
  assert.strictEqual(name, module, `${file} resident name`);
  assert.strictEqual(b[ne + dv.getUint16(ne + 0x04, true)], 0, `${file} entry table ends`);
  const nonres = dv.getUint32(ne + 0x2C, true);
  assert(nonres + dv.getUint16(ne + 0x20, true) <= b.length, `${file} non-resident table in bounds`);
}
console.log('PASS  Win16 system modules exist as NE files in C:\\WINDOWS\\SYSTEM');
