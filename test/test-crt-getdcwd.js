#!/usr/bin/env node
'use strict';

// _getdcwd is a cdecl CRT path query, not GetCurrentDirectory with one extra
// argument.  Pin the active-drive path, the VFS's explicit non-current-drive
// root model, malloc ownership, validation/error results, and stack contract.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');
const STACK = 0x00300000;
const EINVAL = 22;
const ENOMEM = 12;
const ERANGE = 34;

const extraWat = String.raw`
  (global $test_getdcwd_esp_delta (mut i32) (i32.const 0))

  (func (export "test_getdcwd")
      (param $drive i32) (param $buffer i32) (param $maxlen i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__getdcwd
      (local.get $drive) (local.get $buffer) (local.get $maxlen)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_getdcwd_esp_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const ${STACK})))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_getdcwd_esp_delta") (result i32)
    (global.get $test_getdcwd_esp_delta))

  (func (export "test_msvcrt_errno") (result i32)
    (if (result i32) (global.get $msvcrt_errno_ptr)
      (then (call $gl32 (global.get $msvcrt_errno_ptr)))
      (else (i32.const 0))))
`;

function readCString(e, guest, limit = 512) {
  const bytes = [];
  for (let i = 0; i < limit; i++) {
    const byte = e.guest_read8((guest + i) >>> 0);
    if (!byte) return Buffer.from(bytes).toString('latin1');
    bytes.push(byte);
  }
  throw new Error(`unterminated guest string at 0x${guest.toString(16)}`);
}

(async () => {
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);

  const buffer = e.guest_alloc(128) >>> 0;
  assert(buffer, 'caller buffer allocated');

  assert.strictEqual(e.test_getdcwd(0, buffer, 128) >>> 0, buffer,
    'drive 0 returns the caller buffer');
  assert.strictEqual(readCString(e, buffer), 'C:\\',
    'drive 0 reports the default drive root');
  assert.strictEqual(e.test_getdcwd_esp_delta(), 4,
    '_getdcwd is cdecl and pops only the synthetic return address');

  hostCtx.vfs.dirs.add('c:\\games');
  assert.strictEqual(hostCtx.vfs.setCurrentDirectory('C:\\games'), true);
  assert.strictEqual(e.test_getdcwd(0, buffer, 128) >>> 0, buffer);
  assert.strictEqual(readCString(e, buffer), 'c:\\games',
    'drive 0 follows the mutable process current directory');
  assert.strictEqual(e.test_getdcwd(3, buffer, 128) >>> 0, buffer);
  assert.strictEqual(readCString(e, buffer), 'c:\\games',
    'an explicit active drive returns the same current directory');

  assert.strictEqual(e.test_getdcwd(4, buffer, 128) >>> 0, buffer);
  assert.strictEqual(readCString(e, buffer), 'D:\\',
    'the built-in mounted D: drive uses the VFS non-current-drive root');
  hostCtx.vfs.driveTypes = new Map([['z', 3]]);
  assert.strictEqual(e.test_getdcwd(26, buffer, 128) >>> 0, buffer);
  assert.strictEqual(readCString(e, buffer), 'Z:\\',
    'an explicitly mounted drive is exposed without invented per-drive state');

  const allocated = e.test_getdcwd(0, 0, 73) >>> 0;
  assert(allocated, 'a NULL buffer requests CRT allocation');
  assert.strictEqual(readCString(e, allocated), 'c:\\games');
  const allocatedBlockSize = e.guest_read32((allocated - 4) >>> 0) & ~7;
  assert(allocatedBlockSize - 4 >= 73,
    'the returned allocation has at least maxlen usable bytes');
  e.guest_free(allocated);

  for (let i = 0; i < 16; i++) e.guest_write8(buffer + i, 0xa5);
  assert.strictEqual(e.test_getdcwd(0, buffer, 8), 0,
    'a capacity equal to the path length cannot hold the trailing NUL');
  assert.strictEqual(e.test_msvcrt_errno(), ERANGE);
  assert.deepStrictEqual(
    Array.from({ length: 9 }, (_, i) => e.guest_read8(buffer + i)),
    Array(9).fill(0xa5),
    'ERANGE leaves the caller buffer untouched');

  assert.strictEqual(e.test_getdcwd(5, buffer, 128), 0,
    'an unavailable explicit drive fails');
  assert.strictEqual(e.test_msvcrt_errno(), EINVAL);
  assert.strictEqual(e.test_getdcwd(-1, buffer, 128), 0,
    'negative drive numbers fail validation');
  assert.strictEqual(e.test_msvcrt_errno(), EINVAL);
  assert.strictEqual(e.test_getdcwd(27, buffer, 128), 0,
    'drive numbers beyond Z fail validation');
  assert.strictEqual(e.test_msvcrt_errno(), EINVAL);
  assert.strictEqual(e.test_getdcwd(0, buffer, 0), 0,
    'maxlen must be positive');
  assert.strictEqual(e.test_msvcrt_errno(), EINVAL);

  assert.strictEqual(e.test_getdcwd(0, 0xf1000000, 128), 0,
    'an unmapped caller buffer is rejected rather than writing the NULL sentinel');
  assert.strictEqual(e.test_msvcrt_errno(), EINVAL);
  assert.strictEqual(e.test_getdcwd(0, 0, 0x7fffffff), 0,
    'an impossible NULL-buffer allocation fails');
  assert.strictEqual(e.test_msvcrt_errno(), ENOMEM);
  assert.strictEqual(e.test_getdcwd_esp_delta(), 4,
    'failure paths retain the cdecl stack contract');

  const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'api_table.json'), 'utf8'))
    .find(entry => entry.name === '_getdcwd');
  assert.deepStrictEqual({ nargs: api.nargs, convention: api.convention },
    { nargs: 3, convention: 'cdecl' }, 'dispatch metadata preserves the public ABI');

  console.log('PASS  _getdcwd follows bounded Win98 drive/current-directory semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
