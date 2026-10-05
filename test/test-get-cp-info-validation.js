#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const ERROR_INVALID_PARAMETER = 87;

const extraWat = String.raw`
  (func (export "test_get_cp_info") (param $cp i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetCPInfo (local.get $cp) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "set_error") (param $value i32) (global.set $last_error (local.get $value)))
  (func (export "get_error") (result i32) (global.get $last_error))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);
  const info = e.guest_alloc(18) >>> 0;

  const read = () => Array.from({ length: 18 }, (_, i) => e.guest_read8(info + i));
  const fill = value => {
    for (let i = 0; i < 18; i++) e.guest_write8(info + i, value);
  };

  assert.strictEqual(e.test_get_cp_info(0, info), 1, 'CP_ACP resolves successfully');
  assert.strictEqual(e.guest_read32(info), 1, 'CP1252 has one-byte characters');
  assert.deepStrictEqual(read().slice(4, 6), [0x3f, 0], 'default character is question mark');
  assert(read().slice(6).every(byte => byte === 0), 'SBCS pages have no lead-byte ranges');

  assert.strictEqual(e.test_get_cp_info(1, info), 1, 'CP_OEMCP resolves successfully');
  assert.strictEqual(e.guest_read32(info), 1, 'CP437 has one-byte characters');

  assert.strictEqual(e.test_get_cp_info(932, info), 1, 'installed CP932 succeeds');
  assert.strictEqual(e.guest_read32(info), 2, 'CP932 has two-byte characters');
  assert.deepStrictEqual(read().slice(6, 11), [0x81, 0x9f, 0xe0, 0xfc, 0],
    'CP932 reports both Win98 lead-byte ranges and a terminator');

  assert.strictEqual(e.test_get_cp_info(1361, info), 1, 'installed CP1361 succeeds');
  assert.deepStrictEqual(read().slice(6, 13), [0x84, 0xd3, 0xd8, 0xde, 0xe0, 0xf9, 0],
    'CP1361 reports all three lead-byte ranges and a terminator');
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c, 'GetCPInfo pops two arguments');

  for (const cp of [2, 42, 65001, 99999]) {
    fill(0xa5);
    e.set_error(0x1234);
    assert.strictEqual(e.test_get_cp_info(cp, info), 0,
      `unsupported code page ${cp} fails`);
    assert.strictEqual(e.get_error(), ERROR_INVALID_PARAMETER,
      `unsupported code page ${cp} reports ERROR_INVALID_PARAMETER`);
    assert(read().every(byte => byte === 0xa5),
      `unsupported code page ${cp} leaves CPINFO untouched`);
  }
  e.set_error(0x1234);
  assert.strictEqual(e.test_get_cp_info(1252, 0), 0, 'NULL CPINFO fails');
  assert.strictEqual(e.get_error(), ERROR_INVALID_PARAMETER,
    'NULL CPINFO reports ERROR_INVALID_PARAMETER');

  console.log('PASS  GetCPInfo validates code pages before writing CPINFO');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
