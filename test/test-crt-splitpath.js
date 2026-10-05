#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const PATH = 0x00429000;
const DRIVE = 0x00429200;
const DIR = 0x00429300;
const NAME = 0x00429400;
const EXT = 0x00429500;

const extraWat = String.raw`
  (func (export "test_write8") (param $addr i32) (param $value i32)
    (call $gs8 (local.get $addr) (local.get $value)))
  (func (export "test_read8") (param $addr i32) (result i32)
    (call $gl8 (local.get $addr)))
  (func (export "test_set_code_page") (param $value i32)
    (global.set $ansi_code_page (local.get $value)))
  (func (export "test_splitpath") (param $path i32) (param $drive i32)
      (param $dir i32) (param $name i32) (param $ext i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__splitpath (local.get $path) (local.get $drive)
      (local.get $dir) (local.get $name) (local.get $ext) (i32.const 0)))
`;

function writeBytes(e, addr, bytes) {
  bytes.forEach((byte, index) => e.test_write8(addr + index, byte));
}

function writeString(e, addr, value) {
  writeBytes(e, addr, [...Buffer.from(value, 'latin1'), 0]);
}

function readString(e, addr) {
  const bytes = [];
  for (let i = 0; i < 512; i++) {
    const byte = e.test_read8(addr + i);
    if (!byte) return Buffer.from(bytes).toString('latin1');
    bytes.push(byte);
  }
  throw new Error('unterminated split-path output');
}

function split(e, value, outputs = [DRIVE, DIR, NAME, EXT]) {
  writeString(e, PATH, value);
  for (const output of outputs) {
    if (output) writeBytes(e, output, [0x7f, 0x7f, 0]);
  }
  e.test_splitpath(PATH, ...outputs);
  return outputs.map(output => output ? readString(e, output) : null);
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);

  assert.deepStrictEqual(split(e, 'C:\\games/mixed\\archive.tar.gz'),
    ['C:', '\\games/mixed\\', 'archive.tar', '.gz'],
    'drive, mixed-separator directory, basename, and final extension split exactly');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, '_splitpath is cdecl');

  assert.deepStrictEqual(split(e, 'README'), ['', '', 'README', ''],
    'missing components become empty strings');
  assert.deepStrictEqual(split(e, 'D:\\'), ['D:', '\\', '', ''],
    'a trailing separator belongs to the directory');
  assert.deepStrictEqual(split(e, '.profile'), ['', '', '', '.profile'],
    'a leading period begins the extension');

  const optional = split(e, 'E:\\tmp\\file.bin', [0, DIR, 0, EXT]);
  assert.deepStrictEqual(optional, [null, '\\tmp\\', null, '.bin'],
    'every output other than path is independently optional');

  // CP932 lead byte 0x81 followed by 0x5c: the apparent backslash is a trail
  // byte and must remain inside the filename rather than begin a directory.
  e.test_set_code_page(932);
  writeBytes(e, PATH, [0x81, 0x5c, 0x41, 0x2e, 0x78, 0]);
  e.test_splitpath(PATH, DRIVE, DIR, NAME, EXT);
  assert.deepStrictEqual([readString(e, DRIVE), readString(e, DIR)], ['', ''],
    'a DBCS trail byte is not interpreted as a path separator');
  assert.deepStrictEqual([...Buffer.from(readString(e, NAME), 'latin1')], [0x81, 0x5c, 0x41]);
  assert.strictEqual(readString(e, EXT), '.x');

  console.log('PASS  _splitpath separates Win32 path components without crashing');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
