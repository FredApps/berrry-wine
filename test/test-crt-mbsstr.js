#!/usr/bin/env node

// _mbsstr is the MSVCRT substring search Winamp 2.91 calls while scanning its
// plugin directory. It is cdecl, so the handler pops only the return address,
// and on the US code page (no DBCS lead bytes) it must agree with strstr.

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_mbsstr_init")
    (global.set $image_base (i32.const 0)))
  (func (export "test_mbsstr") (param $hay i32) (param $needle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle__mbsstr (local.get $hay) (local.get $needle)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00300004))
      (then (unreachable)))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });
  wat.test_mbsstr_init();

  const writeAscii = (ptr, value) => {
    for (let i = 0; i < value.length; i++) wat.guest_write8(ptr + i, value.charCodeAt(i));
    wat.guest_write8(ptr + value.length, 0);
  };
  const hay = 0x1000;
  const needle = 0x1100;

  writeAscii(hay, 'C:\\Plugins\\in_mp3.dll');
  writeAscii(needle, 'in_');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay + 11,
    '_mbsstr returns the first matching guest pointer');
  writeAscii(needle, '.dll');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay + 17,
    '_mbsstr matches a suffix ending at the terminator');
  writeAscii(needle, 'C:\\Plugins\\in_mp3.dll');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay,
    '_mbsstr matches the whole string');
  writeAscii(needle, 'in_mp3.dllx');
  assert.strictEqual(wat.test_mbsstr(hay, needle), 0,
    '_mbsstr does not match past the haystack terminator');
  writeAscii(needle, 'out_');
  assert.strictEqual(wat.test_mbsstr(hay, needle), 0,
    '_mbsstr returns NULL when absent');
  writeAscii(needle, '');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay,
    '_mbsstr returns the string itself for an empty substring');
  writeAscii(hay, 'aaab');
  writeAscii(needle, 'aab');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay + 1,
    '_mbsstr restarts after a partial match');
  writeAscii(hay, '');
  writeAscii(needle, 'a');
  assert.strictEqual(wat.test_mbsstr(hay, needle), 0,
    '_mbsstr on an empty string finds nothing');
  // Code page 1252 has no lead bytes, so high-bit bytes compare as plain bytes.
  writeAscii(hay, 'caf\xe9 m\xfcsic');
  writeAscii(needle, '\xfcs');
  assert.strictEqual(wat.test_mbsstr(hay, needle) >>> 0, hay + 6,
    '_mbsstr treats code page 1252 high bytes as single-byte characters');

  console.log('PASS  _mbsstr follows the MSVCRT substring contract');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
