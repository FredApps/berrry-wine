#!/usr/bin/env node
'use strict';

// GetPrivateProfileString discards one pair of matching quotes around a value,
// GetPrivateProfileInt reads through it, and GetPrivateProfileSection returns
// the line as written. Moorhuhn 3's bonus puzzles store `Version="1"` and put
// up "lt_init: version not found" when the quotes come back.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const fs = require('fs');
const path = require('path');

const extraWat = String.raw`
  (func (export "test_profile_string")
      (param $esp i32) (param $app i32) (param $key i32) (param $def i32)
      (param $buf i32) (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $handle_GetPrivateProfileStringA
      (local.get $app) (local.get $key) (local.get $def)
      (local.get $buf) (local.get $size) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_profile_int")
      (param $app i32) (param $key i32) (param $def i32) (param $file i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetPrivateProfileIntA
      (local.get $app) (local.get $key) (local.get $def) (local.get $file)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_profile_section")
      (param $app i32) (param $buf i32) (param $size i32) (param $file i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetPrivateProfileSectionA
      (local.get $app) (local.get $buf) (local.get $size) (local.get $file)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const bytes = compileSrcWasm((name, source) =>
    name === '13-exports.wat' ? `${source}\n${extraWat}` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const e = ctx.exports = instance.exports;
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);

  const base = e.get_image_base() + 0x100000;
  const app = base, key = base + 0x100, def = base + 0x200, file = base + 0x300;
  const buf = base + 0x1000, esp = base + 0x3000;
  const write = (address, text) => {
    Buffer.from(text + '\0', 'latin1').forEach((byte, i) => e.guest_write8(address + i, byte));
  };
  const read = (address, length) => {
    let text = '';
    for (let i = 0; i < length; i++) text += String.fromCharCode(e.guest_read8(address + i));
    return text;
  };

  const target = 'c:\\sfiles\\lang.ini';
  ctx.vfs.files.set(target, {
    data: Buffer.from([
      '[MAIN]',
      'Version="1"',
      "Single='abc'",
      'Mixed="abc\'',
      'Lone="',
      'Inner=a"b"c',
      'Count="42"',
      '',
    ].join('\r\n'), 'latin1'),
    attrs: 0x80,
  });
  write(app, 'MAIN');
  write(def, 'dflt');
  write(file, target);
  // lpFileName is the sixth stdcall argument: [esp+24] with the return
  // address at [esp].
  e.guest_write32(esp + 24, file);

  const getString = (name, expected) => {
    write(key, name);
    const length = e.test_profile_string(esp, app, key, def, buf, 64);
    assert.strictEqual(read(buf, length), expected, `${name} value`);
    assert.strictEqual(e.guest_read8(buf + length), 0, `${name} is NUL-terminated`);
    assert.strictEqual(e.get_esp(), esp + 28, 'stdcall pops return address and six arguments');
  };
  getString('Version', '1');
  getString('Single', 'abc');
  getString('Mixed', '"abc\'');
  getString('Lone', '"');
  getString('Inner', 'a"b"c');
  getString('Missing', 'dflt');

  write(key, 'Count');
  assert.strictEqual(e.test_profile_int(app, key, 7, file), 42, 'Int reads through the quotes');

  const length = e.test_profile_section(app, buf, 256, file);
  const section = read(buf, length).split('\0');
  assert(section.includes('Version="1"'), 'Section returns lines as written');
  assert(section.includes('Count="42"'));

  console.log('PASS  GetPrivateProfileString/Int strip one pair of matching quotes; Section keeps them');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
