#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const LEFT = 0x00428000;
const RIGHT = 0x00428100;
const DEST = 0x00428200;

const extraWat = String.raw`
  (func (export "test_write16") (param $addr i32) (param $value i32)
    (call $gs16 (local.get $addr) (local.get $value)))
  (func (export "test_read16") (param $addr i32) (result i32)
    (call $gl16 (local.get $addr)))
  (func (export "test_wcsicmp") (param $a i32) (param $b i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__wcsicmp (local.get $a) (local.get $b)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_wcscmp") (param $a i32) (param $b i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_wcscmp (local.get $a) (local.get $b)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_wcslen") (param $s i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_wcslen (local.get $s)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_wcsncpy") (param $dst i32) (param $src i32) (param $count i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle_wcsncpy (local.get $dst) (local.get $src) (local.get $count)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

function writeWide(e, addr, units) {
  units.forEach((unit, index) => e.test_write16(addr + index * 2, unit));
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);

  writeWide(e, LEFT, [0x0041, 0x0062, 0x00e9, 0]);
  writeWide(e, RIGHT, [0x0061, 0x0042, 0x00e9, 0]);
  assert.strictEqual(e.test_wcslen(LEFT), 3, 'wcslen counts UTF-16 code units');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, 'wcslen is cdecl');
  assert.strictEqual(e.test_wcsicmp(LEFT, RIGHT), 0,
    '_wcsicmp folds ASCII case while retaining equal non-ASCII code units');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, '_wcsicmp is cdecl');
  assert(e.test_wcscmp(LEFT, RIGHT) < 0, 'wcscmp retains case-sensitive ordering');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, 'wcscmp is cdecl');

  writeWide(e, RIGHT, [0x0041, 0x0062, 0x00ea, 0]);
  assert(e.test_wcscmp(LEFT, RIGHT) < 0, 'wcscmp compares full UTF-16 code units');
  assert(e.test_wcsicmp(RIGHT, LEFT) > 0, '_wcsicmp returns signed lexical ordering');

  writeWide(e, DEST, [0x7777, 0x7777, 0x7777, 0x7777, 0x7777]);
  writeWide(e, RIGHT, [0x0058, 0, 0x9999]);
  assert.strictEqual(e.test_wcsncpy(DEST, RIGHT, 4) >>> 0, DEST,
    'wcsncpy returns its destination');
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(i => e.test_read16(DEST + i * 2)),
    [0x0058, 0, 0, 0, 0x7777],
    'wcsncpy pads the requested tail with NULs and stops at count');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, 'wcsncpy is cdecl');

  console.log('PASS  CRT wide-string basics use real UTF-16 comparison, length, and padding');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
