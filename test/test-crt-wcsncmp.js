#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');
const LEFT = 0x00428000;
const RIGHT = 0x00428100;
const apiTable = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'src', 'api_table.json'), 'utf8'));

const extraWat = String.raw`
  (global $test_wcsncmp_esp_delta (mut i32) (i32.const 0))

  (func (export "test_wcsncmp")
      (param $a i32) (param $b i32) (param $count i32) (result i32)
    (local $start_esp i32)
    (local.set $start_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_wcsncmp
      (local.get $a) (local.get $b) (local.get $count)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_wcsncmp_esp_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $start_esp)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_wcsncmp_esp_delta") (result i32)
    (global.get $test_wcsncmp_esp_delta))

  (func (export "test_lookup_wcsncmp") (result i32)
    (call $lookup_api_id "wcsncmp"))
`;

function writeWide(e, addr, units) {
  units.forEach((unit, index) => e.guest_write16(addr + index * 2, unit));
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);

  writeWide(e, LEFT, [0x0041, 0x0042, 0x0043, 0]);
  writeWide(e, RIGHT, [0x0041, 0x0042, 0x0058, 0]);
  assert.strictEqual(e.test_wcsncmp(LEFT, RIGHT, 2), 0,
    'a mismatch beyond count is not observed');
  assert(e.test_wcsncmp(LEFT, RIGHT, 3) < 0,
    'the first mismatch within count determines lexical ordering');
  assert.strictEqual(e.test_wcsncmp_esp_delta(), 4,
    'wcsncmp is cdecl and pops only the synthetic return address');

  writeWide(e, LEFT, [0x0041, 0, 0xffff, 0]);
  writeWide(e, RIGHT, [0x0041, 0, 0x0001, 0]);
  assert.strictEqual(e.test_wcsncmp(LEFT, RIGHT, 4), 0,
    'a shared NUL ends comparison before later storage');

  writeWide(e, LEFT, [0x0041, 0, 0]);
  writeWide(e, RIGHT, [0x0041, 0x0042, 0]);
  assert(e.test_wcsncmp(LEFT, RIGHT, 3) < 0,
    'a terminating NUL sorts before a non-NUL code unit');

  writeWide(e, LEFT, [0xffff, 0]);
  writeWide(e, RIGHT, [0x0001, 0]);
  assert(e.test_wcsncmp(LEFT, RIGHT, 1) > 0,
    'wchar_t values compare as unsigned 16-bit code units');
  assert(e.test_wcsncmp(RIGHT, LEFT, 1) < 0,
    'unsigned code-unit ordering is symmetric');

  writeWide(e, LEFT, [0xd800, 0]);
  writeWide(e, RIGHT, [0xe000, 0]);
  assert(e.test_wcsncmp(LEFT, RIGHT, 1) < 0,
    'comparison is ordinal by UTF-16 code unit, not Unicode collation');

  assert.strictEqual(e.test_wcsncmp(0, 0xffffffff, 0), 0,
    'count zero succeeds without usable string pointers');
  assert.strictEqual(e.test_wcsncmp_esp_delta(), 4,
    'the zero-count path preserves the cdecl stack contract');

  const source = fs.readFileSync(
    path.join(ROOT, 'src', '09a6-handlers-crt.wat'), 'utf8');
  const body = source.slice(source.indexOf('(func $handle_wcsncmp'),
    source.indexOf(';; 727: strcpy', source.indexOf('(func $handle_wcsncmp')));
  assert(body.indexOf('(br_if $done (i32.eqz (local.get $arg2)))') >= 0,
    'the handler explicitly guards count zero');
  assert(body.indexOf('(br_if $done (i32.eqz (local.get $arg2)))') <
    body.indexOf('(call $gl16'),
    'the zero-count guard precedes every wide-character load');

  const api = apiTable.find(entry => entry.name === 'wcsncmp');
  assert.deepStrictEqual(
    api && { id: api.id, nargs: api.nargs, convention: api.convention },
    { id: 3616, nargs: 3, convention: 'cdecl' },
    'the API registry retains wcsncmp identity and cdecl argument metadata');
  assert.strictEqual(e.test_lookup_wcsncmp() >>> 0, api.id,
    'the generated hash table resolves wcsncmp by name');

  console.log('PASS  wcsncmp compares a bounded unsigned UTF-16 prefix');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
