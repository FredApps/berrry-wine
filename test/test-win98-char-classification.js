#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

for (const name of ['IsCharAlphaW', 'IsCharUpperW']) {
  const api = apiTable.find(entry => entry.name === name);
  assert(api, `${name} is registered`);
  assert.strictEqual(api.nargs, 1, `${name} consumes one WCHAR argument`);
  assert.strictEqual(api.convention, 'stdcall', `${name} uses stdcall`);
}

const extraWat = String.raw`
  (func (export "test_ctype1_ansi") (param $ch i32) (result i32)
    (call $ctype1_ascii_flags (local.get $ch)))
  (func (export "test_ctype1_unicode") (param $ch i32) (result i32)
    (call $ctype1_unicode_flags (local.get $ch)))

  (func (export "test_is_char_alpha_w")
      (param $ch i32) (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $handle_IsCharAlphaW
      (local.get $ch) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_is_char_upper_w")
      (param $ch i32) (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $handle_IsCharUpperW
      (local.get $ch) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_get_string_type_ansi")
      (param $api i32) (param $src i32) (param $count i32) (param $out i32)
      (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $dispatch_api_table
      (local.get $api) (i32.const 0x0409) (i32.const 1)
      (local.get $src) (local.get $count) (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_string_type_w")
      (param $src i32) (param $count i32) (param $out i32)
      (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $handle_GetStringTypeW
      (i32.const 1) (local.get $src) (local.get $count)
      (local.get $out) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

function writeWide(e, address, values) {
  values.forEach((value, index) => {
    e.guest_write8(address + index * 2, value & 0xff);
    e.guest_write8(address + index * 2 + 1, value >>> 8);
  });
}

function readWords(e, address, count) {
  return Array.from({ length: count }, (_, index) =>
    e.guest_read8(address + index * 2)
      | (e.guest_read8(address + index * 2 + 1) << 8));
}

(async () => {
  const stringTypeA = apiTable.find(entry => entry.name === 'GetStringTypeA');
  const stringTypeExA = apiTable.find(entry => entry.name === 'GetStringTypeExA');
  assert(stringTypeA && stringTypeExA,
    'both public ANSI character-classification APIs remain registered');
  assert.strictEqual(stringTypeA.id, 309, 'GetStringTypeA API id remains stable');
  assert.strictEqual(stringTypeExA.id, 2041, 'GetStringTypeExA API id remains stable');
  assert.strictEqual(stringTypeA.nargs, 5);
  assert.strictEqual(stringTypeExA.nargs, 5);
  assert.strictEqual(stringTypeA.convention, 'stdcall');
  assert.strictEqual(stringTypeExA.convention, 'stdcall');
  assert.strictEqual(stringTypeExA.handler, 'GetStringTypeA',
    'GetStringTypeExA metadata aliases the canonical ANSI classifier');

  const root = path.join(__dirname, '..');
  const dispatch = fs.readFileSync(
    path.join(root, 'src/09b2-dispatch-table.generated.wat'), 'utf8');
  assert.match(dispatch,
    /;; 2041: GetStringTypeExA[\s\S]*?call \$handle_GetStringTypeA/,
    'generated dispatch routes GetStringTypeExA through the canonical handler');
  const lateSource = fs.readFileSync(
    path.join(root, 'src/09a0b-handlers-base-late.wat'), 'utf8');
  assert(!lateSource.includes('(func $handle_GetStringTypeExA'),
    'the duplicate GetStringTypeExA wrapper is absent');

  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);

  for (const [ch, flags, reason] of [
    [0x0041, 0x101, 'ASCII uppercase'],
    [0x0061, 0x102, 'ASCII lowercase'],
    [0x0039, 0x004, 'ASCII digit'],
    [0x0021, 0x010, 'ASCII punctuation'],
    [0x000a, 0x028, 'ASCII whitespace control'],
    [0x007f, 0x020, 'Unicode DEL control'],
    [0x008a, 0x020, 'Unicode C1 control U+008A'],
    [0x00c9, 0x101, 'Latin-1 uppercase E acute'],
    [0x00e9, 0x102, 'Latin-1 lowercase e acute'],
    [0x0160, 0x101, 'CP1252-mapped Unicode uppercase S caron'],
    [0x0161, 0x102, 'CP1252-mapped Unicode lowercase s caron'],
    [0x0410, 0x000, 'Unicode outside the bounded Win98 en-US model'],
  ]) {
    assert.strictEqual(e.test_ctype1_unicode(ch), flags, reason);
  }

  assert.strictEqual(e.test_ctype1_ansi(0x8a), 0x101,
    'ANSI byte 0x8A remains CP1252 uppercase S caron');
  assert.strictEqual(e.test_ctype1_ansi(0x9a), 0x102,
    'ANSI byte 0x9A remains CP1252 lowercase s caron');

  const esp0 = 0x00700000;
  for (const [ch, expected, reason] of [
    [0x0041, 1, 'ASCII A is alphabetic'],
    [0x00e9, 1, 'Latin-1 e acute is alphabetic'],
    [0x0160, 1, 'Unicode S caron is alphabetic'],
    [0x0161, 1, 'Unicode s caron is alphabetic'],
    [0x008a, 0, 'Unicode C1 control is not alphabetic'],
    [0x0021, 0, 'punctuation is not alphabetic'],
    [0x0410, 0, 'unmodeled Unicode is not guessed from its low byte'],
  ]) {
    assert.strictEqual(e.test_is_char_alpha_w(ch, esp0), expected, reason);
    assert.strictEqual(e.test_get_esp() >>> 0, esp0 + 8,
      `${reason}: IsCharAlphaW pops one stdcall argument`);
  }
  assert.strictEqual(e.test_is_char_alpha_w(0x12340160, esp0), 1,
    'IsCharAlphaW classifies its promoted WCHAR code unit');

  for (const [ch, expected, reason] of [
    [0x0041, 1, 'ASCII uppercase'],
    [0x0061, 0, 'ASCII lowercase'],
    [0x0160, 1, 'Unicode uppercase S caron'],
    [0x0161, 0, 'Unicode lowercase s caron'],
    [0x008a, 0, 'Unicode C1 control'],
  ]) {
    assert.strictEqual(e.test_is_char_upper_w(ch, esp0), expected, reason);
    assert.strictEqual(e.test_get_esp() >>> 0, esp0 + 8,
      `${reason}: IsCharUpperW pops one stdcall argument`);
  }

  const ansi = e.guest_alloc(8) >>> 0;
  const wide = e.guest_alloc(16) >>> 0;
  const out = e.guest_alloc(16) >>> 0;
  [0x8a, 0x9a, 0x21].forEach((value, index) => e.guest_write8(ansi + index, value));
  for (const api of [stringTypeA, stringTypeExA]) {
    e.guest_write32(out, 0xdeadbeef);
    e.guest_write32(out + 4, 0xdeadbeef);
    assert.strictEqual(e.test_get_string_type_ansi(api.id, ansi, 3, out, esp0), 1,
      `${api.name} returns TRUE`);
    assert.deepStrictEqual(readWords(e, out, 3), [0x101, 0x102, 0x010],
      `${api.name} keeps CP1252 byte classification`);
    assert.strictEqual(e.test_get_esp() >>> 0, esp0 + 24,
      `${api.name} pops five stdcall arguments`);
  }

  writeWide(e, wide, [0x008a, 0x0160, 0x0161, 0x0021]);
  assert.strictEqual(e.test_get_string_type_w(wide, 4, out, esp0), 1);
  assert.deepStrictEqual(readWords(e, out, 4), [0x020, 0x101, 0x102, 0x010],
    'GetStringTypeW classifies Unicode WCHARs rather than CP1252 byte values');
  assert.strictEqual(e.test_get_esp() >>> 0, esp0 + 20,
    'GetStringTypeW pops four stdcall arguments');

  console.log('PASS  Win98 en-US ANSI and Unicode character classes stay distinct');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
