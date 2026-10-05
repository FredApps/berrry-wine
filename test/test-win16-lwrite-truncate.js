#!/usr/bin/env node
'use strict';

// A Win16 _lwrite/_hwrite (and INT 21h AH=40h) of zero bytes sets the end of
// the file at the current position, as DOS and Windows do. Authorware
// preallocates a new .REC file as eight zeroed 512-byte blocks, seeks to 0
// and writes 0 bytes to empty it again; read as "write nothing", the 4KB of
// zeros stayed, and the next launch of Civilization II's Civilopedia called
// get_info.REC damaged and hung waiting on it.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_g2w") (param $ga i32) (result i32) (call $g2w (local.get $ga)))
  (func (export "test_create") (param $path_wa i32) (result i32)
    (call $host_fs_create_file (local.get $path_wa) (i32.const 0xC0000000)
      (i32.const 2) (i32.const 0) (i32.const 0)))
  (func (export "test_write") (param $h i32) (param $buf i32) (param $n i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07400000))
    (call $win16_file_write (local.get $h) (local.get $buf) (local.get $n))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_sp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_seek") (param $h i32) (param $pos i32) (result i32)
    (call $host_fs_set_file_pointer (local.get $h) (local.get $pos) (i32.const 0)))
  (func (export "test_size") (param $h i32) (result i32)
    (call $host_fs_get_file_size (local.get $h)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const mem = new Uint8Array(memory.buffer);

  // Guest heap addresses (g2w'd below), not WASM region bases.
  const PATH_GA = 0x04100A40, BUF_GA = 0x04100C00;
  const pathWa = e.test_g2w(PATH_GA);
  const name = 'c:\\get_info.rec\0';
  for (let i = 0; i < name.length; i++) mem[pathWa + i] = name.charCodeAt(i);
  mem.fill(0, e.test_g2w(BUF_GA), e.test_g2w(BUF_GA) + 0x200);

  const h = e.test_create(pathWa);
  assert.ok(h && h !== -1, 'the file opens');

  for (let i = 0; i < 8; i++) {
    assert.strictEqual(e.test_write(h, BUF_GA, 0x200), 0x200);
    assert.strictEqual(e.test_sp(), 0x07400010, 'a write pops the frame');
  }
  assert.strictEqual(e.test_size(h), 0x1000);

  e.test_seek(h, 0x300);
  assert.strictEqual(e.test_write(h, BUF_GA, 0), 0, 'a zero-byte write returns 0');
  assert.strictEqual(e.test_sp(), 0x07400010, 'and pops the same frame');
  assert.strictEqual(e.test_size(h), 0x300, 'and cuts the file at the current position');

  e.test_seek(h, 0);
  e.test_write(h, BUF_GA, 0);
  assert.strictEqual(e.test_size(h), 0, 'down to empty at position 0');

  e.test_seek(h, 0x80);
  e.test_write(h, BUF_GA, 0);
  assert.strictEqual(e.test_size(h), 0x80, 'and extends the file past its end');

  console.log('PASS  Win16 zero-byte write sets end of file');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
