#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_native_override") (param $name_wa i32) (result i32)
    (call $native_override_export_api_id (local.get $name_wa)))
  (func (export "test_ftol") (param $value f64) (param $cw i32) (result i64)
    (global.set $fpu_cw (local.get $cw))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07600000))
    (call $fpu_push (local.get $value))
    (call $handle__ftol
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=8 (global.get $reg_base))) (i64.const 32))))
  (func (export "test_ftol_cw") (result i32) (global.get $fpu_cw))
  (func (export "test_ftol_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_stricmp") (param $a i32) (param $b i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07600000))
    (call $handle__stricmp
      (local.get $a) (local.get $b) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({
    extraWat: EXTRA_WAT,
    fonts: 'none',
  });
  const bytes = new Uint8Array(memory.buffer);
  const nameGuest = e.guest_alloc(64) >>> 0;
  const nameWasm = e.guest_to_wasm(nameGuest) >>> 0;
  const writeName = name => {
    bytes.fill(0, nameWasm, nameWasm + 64);
    bytes.set(Buffer.from(name, 'ascii'), nameWasm);
  };

  writeName('_ftol');
  assert.strictEqual(e.test_native_override(nameWasm), 759,
    'loaded MSVCRT _ftol remains on the native API thunk');
  writeName('malloc');
  assert.strictEqual(e.test_native_override(nameWasm), -1,
    'allocator ownership remains with authentic MSVCRT');

  const bits = value => BigInt.asUintN(64, e.test_ftol(value, 0x027f));
  assert.strictEqual(bits(255.99), 255n, 'positive value truncates toward zero');
  assert.strictEqual(bits(-255.99), BigInt.asUintN(64, -255n),
    'negative value truncates toward zero');
  assert.strictEqual(bits(0x100000002), 0x100000002n,
    'full EDX:EAX result is returned');
  assert.strictEqual(bits(Number.NaN), 0x8000000000000000n,
    'NaN produces x87 integer-indefinite');
  assert.strictEqual(bits(Infinity), 0x8000000000000000n,
    'overflow produces x87 integer-indefinite');
  assert.strictEqual(e.test_ftol_cw(), 0x027f,
    'caller x87 control word is restored');
  assert.strictEqual(e.test_ftol_esp() >>> 0, 0x07600004,
    'cdecl helper removes only its return address');

  console.log('PASS  native MSVCRT _ftol preserves x87 and EDX:EAX semantics');

  // Morrowind's load looks every object up by name through _stricmp; the
  // authentic byte loop was ~30% of its startup blocks.
  writeName('_stricmp');
  const stricmpId = require('../src/api_table.json').findIndex(api => api.name === '_stricmp');
  assert.ok(stricmpId >= 0, '_stricmp is in the API table');
  assert.strictEqual(e.test_native_override(nameWasm), stricmpId,
    'loaded MSVCRT _stricmp is bound to the native API thunk');
  const a = e.guest_alloc(64) >>> 0, b = e.guest_alloc(64) >>> 0;
  const put = (g, s) => {
    const w = e.guest_to_wasm(g) >>> 0;
    bytes.fill(0, w, w + 64);
    bytes.set(Buffer.from(s, 'latin1'), w);
  };
  // MSVCRT C locale: fold A-Z only, compare as unsigned bytes, return
  // -1/0/1. VC6 msvcrt, msvcr70 and msvcr71 all end in sbb eax,eax /
  // sbb eax,-1 (measured against each in test-crt-native-overrides.js); the
  // byte difference is VC8's C rewrite, not what these builds return.
  const stricmp = (x, y) => { put(a, x); put(b, y); return e.test_stricmp(a, b); };
  assert.strictEqual(stricmp('Jiub', 'JIUB'), 0, 'case folds');
  assert.strictEqual(stricmp('', ''), 0, 'empty strings are equal');
  assert.strictEqual(stricmp('abc', 'ABD'), -1, 'first difference decides');
  assert.strictEqual(stricmp('ab', 'a'), 1, 'longer string compares above its prefix');
  assert.strictEqual(stricmp('[', 'a'), -1, 'punctuation is not folded');
  assert.strictEqual(stricmp('\xe9', 'A'), 1, 'high bytes compare unsigned and unfolded');
  assert.strictEqual(e.test_ftol_esp() >>> 0, 0x07600004,
    'cdecl _stricmp removes only its return address');

  console.log('PASS  native MSVCRT _stricmp matches C-locale folding');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
