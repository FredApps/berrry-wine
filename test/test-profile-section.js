#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_profile_write")
      (param $app i32) (param $strings i32) (param $file i32) (param $wide i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 4660))
    (if (local.get $wide)
      (then (call $handle_WritePrivateProfileSectionW
        (local.get $app) (local.get $strings) (local.get $file)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_WritePrivateProfileSectionA
        (local.get $app) (local.get $strings) (local.get $file)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_profile_error") (result i32) (global.get $last_error))
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
  const app = e.get_image_base() + 0x100000;
  const strings = app + 0x1000;
  const file = app + 0x2000;
  const write = (address, text, wide) => {
    const data = Buffer.from(text + '\0', wide ? 'utf16le' : 'latin1');
    data.forEach((byte, i) => e.guest_write8(address + i, byte));
  };
  const call = (a, s, f, wide, expected, error) => {
    assert.strictEqual(e.test_profile_write(a, s, f, wide), expected);
    assert.strictEqual(e.test_profile_error(), error);
    assert.strictEqual(e.get_esp(), 0x00300010, 'stdcall pops return address and three arguments');
  };

  for (const wide of [0, 1]) {
    const target = `c:\\windows\\compiled-profile-${wide}.ini`;
    ctx.vfs.files.set(target, {
      data: Buffer.from((wide ? '\ufeff' : '') + '[Other]\r\nKeep=yes\r\n', wide ? 'utf16le' : 'latin1'),
      attrs: 0x80,
    });
    write(app, 'Alias', wide);
    write(strings, `HD0:=C:\\Games\0Name=${wide ? '\u03a9' : 'demo'}\0`, wide);
    write(file, target, wide);
    call(app, strings, file, wide, 1, 0x1234);
    let text = Buffer.from(ctx.vfs.files.get(target).data).toString(wide ? 'utf16le' : 'latin1');
    assert(text.includes('[Alias]\r\nHD0:=C:\\Games'));
    assert(text.includes(`Name=${wide ? '\u03a9' : 'demo'}`));
    assert(text.includes('[Other]\r\nKeep=yes'));
    call(app, 0, file, wide, 1, 0x1234);
    text = Buffer.from(ctx.vfs.files.get(target).data).toString(wide ? 'utf16le' : 'latin1');
    assert(!text.includes('[Alias]'), 'NULL strings survive guest-to-host translation');
    assert(text.includes('[Other]'));
    ctx.vfs.files.get(target).attrs = 1;
    call(app, strings, file, wide, 0, 5);
    call(0, strings, file, wide, 0, 87);
    call(0, 0, 0, wide, 1, 0x1234);
  }
  console.log('PASS compiled profile-section A/W: guest pointers, Unicode, deletion, BOOL, LastError, and stdcall');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
