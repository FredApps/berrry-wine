#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const RegionMap = require('../lib/region-map.generated.js');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_call_itoa")
        (param $stack i32) (param $value i32) (param $buffer i32)
        (param $radix i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle__itoa
      (local.get $value) (local.get $buffer) (local.get $radix)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_call_ltoa")
        (param $stack i32) (param $value i32) (param $buffer i32)
        (param $radix i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle__ltoa
      (local.get $value) (local.get $buffer) (local.get $radix)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))
`;

function readCString(memory, wasmAddress) {
  const bytes = new Uint8Array(memory.buffer);
  let end = wasmAddress;
  while (bytes[end] !== 0) end++;
  return Buffer.from(bytes.subarray(wasmAddress, end)).toString('ascii');
}

(async () => {
  for (const name of ['_itoa', '_ltoa']) {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} is exported`);
    assert.strictEqual(api.nargs, 3, `${name} accepts value, buffer, and radix`);
    assert.strictEqual(api.convention, 'cdecl', `${name} uses the CRT cdecl convention`);
  }

  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = 0x074ff000;
  const itoaBuffer = wat.guest_alloc(40) >>> 0;
  const ltoaBuffer = wat.guest_alloc(40) >>> 0;
  const imageBase = wat.get_image_base();
  const itoaWasm = RegionMap.g2w(itoaBuffer, imageBase);
  const ltoaWasm = RegionMap.g2w(ltoaBuffer, imageBase);
  const cases = [
    { value: -2147483648, radix: 10, expected: '-2147483648' },
    { value: -1, radix: 16, expected: 'ffffffff' },
    { value: 0, radix: 2, expected: '0' },
    { value: 35, radix: 36, expected: 'z' },
  ];

  for (const { value, radix, expected } of cases) {
    assert.strictEqual(wat.test_call_itoa(stack, value, itoaBuffer, radix) >>> 0,
      stack + 4, `_itoa leaves its cdecl arguments for radix ${radix}`);
    assert.strictEqual(wat.get_eax() >>> 0, itoaBuffer,
      `_itoa returns its buffer for radix ${radix}`);
    assert.strictEqual(readCString(memory, itoaWasm), expected,
      `_itoa formats ${value} in radix ${radix}`);

    assert.strictEqual(wat.test_call_ltoa(stack, value, ltoaBuffer, radix) >>> 0,
      stack + 4, `_ltoa leaves its cdecl arguments for radix ${radix}`);
    assert.strictEqual(wat.get_eax() >>> 0, ltoaBuffer,
      `_ltoa returns its buffer for radix ${radix}`);
    assert.strictEqual(readCString(memory, ltoaWasm), expected,
      `_ltoa matches _itoa for ${value} in radix ${radix}`);
  }

  console.log('PASS  Microsoft CRT _itoa and _ltoa share 32-bit conversion semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
