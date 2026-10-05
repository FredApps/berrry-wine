#!/usr/bin/env node
'use strict';

// SHCreateDirectoryExA walks a private copy while temporarily replacing path
// separators with NUL. Verify that recursive creation succeeds without
// changing the caller-owned source string.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const ERROR_SUCCESS = 0;
const ERROR_ALREADY_EXISTS = 183;
const ERROR_BAD_PATHNAME = 161;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_sh_create_directory_ex") (param $path i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_SHCreateDirectoryExA
      (i32.const 0) (local.get $path) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const { exports: e, memory, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.heap_init(0x00420000);
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);

  const write = value => {
    const pointer = e.guest_alloc(value.length + 1) >>> 0;
    bytes.set(Buffer.from(`${value}\0`, 'latin1'), wa(pointer));
    return pointer;
  };
  const read = pointer => {
    let value = '';
    for (let offset = 0; offset < 260; offset++) {
      const byte = bytes[wa(pointer) + offset];
      if (!byte) return value;
      value += String.fromCharCode(byte);
    }
    throw new Error('unterminated directory path');
  };
  const invoke = pointer => {
    const packed = e.test_sh_create_directory_ex(pointer);
    assert.strictEqual(Number(packed >> 32n) >>> 0, STACK + 16,
      'SHCreateDirectoryExA pops its three arguments and return address');
    return Number(packed & 0xffffffffn) >>> 0;
  };

  const path = 'C:\\Pass5\\Nested\\Profile';
  const source = write(path);
  assert.strictEqual(invoke(source), ERROR_SUCCESS,
    'the first recursive directory creation succeeds');
  assert.strictEqual(read(source), path,
    'temporary prefix terminators never modify the caller buffer');
  for (const directory of ['c:\\pass5', 'c:\\pass5\\nested', 'c:\\pass5\\nested\\profile']) {
    assert(hostCtx.vfs.dirs.has(directory), `created ${directory}`);
  }
  assert.strictEqual(invoke(source), ERROR_ALREADY_EXISTS,
    'creating the existing leaf reports ERROR_ALREADY_EXISTS');
  assert.strictEqual(invoke(write('')), ERROR_BAD_PATHNAME,
    'an empty path remains invalid');

  console.log('PASS  SHCreateDirectoryExA owns its recursive path walk');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
