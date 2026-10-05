#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { setEnvironmentVariable } = require('../lib/process-boot');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_environment_strings")
        (param $mode i32) (param $stack i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (if (i32.eq (local.get $mode) (i32.const 2))
      (then
        (call $handle_GetEnvironmentStringsW
          (i32.const 0) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)))
      (else
        (if (local.get $mode)
          (then
            (call $handle_GetEnvironmentStringsA
              (i32.const 0) (i32.const 0) (i32.const 0)
              (i32.const 0) (i32.const 0) (i32.const 0)))
          (else
            (call $handle_GetEnvironmentStrings
              (i32.const 0) (i32.const 0) (i32.const 0)
              (i32.const 0) (i32.const 0) (i32.const 0))))))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_free_environment_strings_a")
        (param $block i32) (param $stack i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_FreeEnvironmentStringsA
      (local.get $block) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_free_environment_strings_w")
        (param $block i32) (param $stack i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_FreeEnvironmentStringsW
      (local.get $block) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

function readEnvironmentBlock(wat, pointer) {
  const bytes = [];
  let previous = -1;
  for (let index = 0; index < 32768; index++) {
    const byte = wat.guest_read8(pointer + index);
    bytes.push(byte);
    if (byte === 0 && previous === 0) return Buffer.from(bytes);
    previous = byte;
  }
  throw new Error('environment block was not double-NUL terminated');
}

function readWideEnvironmentBlock(wat, pointer) {
  const bytes = [];
  let previous = -1;
  for (let index = 0; index < 16384; index++) {
    const low = wat.guest_read8(pointer + index * 2);
    const high = wat.guest_read8(pointer + index * 2 + 1);
    const codeUnit = low | (high << 8);
    bytes.push(low, high);
    if (codeUnit === 0 && previous === 0) return Buffer.from(bytes);
    previous = codeUnit;
  }
  throw new Error('wide environment block was not double-NUL terminated');
}

(async () => {
  for (const name of ['GetEnvironmentStrings', 'GetEnvironmentStringsA',
    'GetEnvironmentStringsW']) {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} is exported`);
    assert.strictEqual(api.nargs, 0, `${name} has no arguments`);
    assert.strictEqual(api.convention, 'stdcall', `${name} uses stdcall`);
  }

  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  assert(setEnvironmentVariable(wat, memory.buffer, 'ALIAS_TEST', 'ansi-value'));
  const stack = 0x074ff000;
  const blocks = [];
  for (const [ansiSuffix, name] of [[0, 'GetEnvironmentStrings'], [1, 'GetEnvironmentStringsA']]) {
    const packed = wat.test_get_environment_strings(ansiSuffix, stack);
    const block = Number(packed & 0xffffffffn) >>> 0;
    const resultingEsp = Number(packed >> 32n) >>> 0;
    assert(block, `${name} returns the current process environment`);
    assert.strictEqual(resultingEsp, stack + 4, `${name} pops only its return address`);
    blocks.push({ pointer: block, bytes: readEnvironmentBlock(wat, block) });
  }
  assert.notStrictEqual(blocks[0].pointer, blocks[1].pointer,
    'each call returns an independently owned environment block');
  assert.deepStrictEqual(blocks[0].bytes, blocks[1].bytes,
    'unsuffixed and A exports return identical ANSI environment bytes');
  assert(blocks[0].bytes.includes(Buffer.from('ALIAS_TEST=ansi-value\0', 'ascii')),
    'the copied block contains the process environment variable');
  assert.deepStrictEqual([...blocks[0].bytes.subarray(-2)], [0, 0],
    'the ANSI environment block ends with two NUL bytes');

  const widePacked = wat.test_get_environment_strings(2, stack);
  const widePointer = Number(widePacked & 0xffffffffn) >>> 0;
  const wideEsp = Number(widePacked >> 32n) >>> 0;
  assert(widePointer, 'GetEnvironmentStringsW returns the current process environment');
  assert(!blocks.some(({ pointer }) => pointer === widePointer),
    'the wide call returns its own independently owned block');
  assert.strictEqual(wideEsp, stack + 4,
    'GetEnvironmentStringsW pops only its return address');
  const wideBytes = readWideEnvironmentBlock(wat, widePointer);
  assert(wideBytes.toString('utf16le').includes('ALIAS_TEST=ansi-value\0'),
    'the wide block contains the same process environment variable');
  assert.deepStrictEqual([...wideBytes.subarray(-4)], [0, 0, 0, 0],
    'the wide environment block ends with two WCHAR NULs');

  for (const { pointer } of blocks) {
    const packed = wat.test_free_environment_strings_a(pointer, stack);
    assert.strictEqual(Number(packed & 0xffffffffn), 1,
      'FreeEnvironmentStringsA releases either ANSI block');
    assert.strictEqual(Number(packed >> 32n) >>> 0, stack + 8,
      'FreeEnvironmentStringsA pops its pointer and return address');
  }

  const wideFreePacked = wat.test_free_environment_strings_w(widePointer, stack);
  assert.strictEqual(Number(wideFreePacked & 0xffffffffn), 1,
    'FreeEnvironmentStringsW releases the wide block');
  assert.strictEqual(Number(wideFreePacked >> 32n) >>> 0, stack + 8,
    'FreeEnvironmentStringsW pops its pointer and return address');

  console.log('PASS  GetEnvironmentStrings A/W and legacy alias share encoded block semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
