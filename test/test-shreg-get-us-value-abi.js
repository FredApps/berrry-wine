#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const api = require('../src/api_table.json').find(a => a.name === 'SHRegGetUSValueA');

const extraWat = String.raw`
  (func (export "test_shreg_us_failure") (param $stack i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (call $lookup_api_id "SHRegGetUSValueA")
      (call $gl32 (i32.add (local.get $stack) (i32.const 4)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 8)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 12)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 16)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 20))) (i32.const 0))
    (i64.or (i64.extend_i32_u (i32.load (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.guest_alloc(48) >>> 0;
  const outputs = e.guest_alloc(16) >>> 0;
  const keyBytes = Buffer.from('Software\\WineAssembly\\MissingAbiProbe\0');
  const key = e.guest_alloc(keyBytes.length) >>> 0;
  keyBytes.forEach((byte, i) => e.guest_write8(key + i, byte));
  // Exact ABI: subkey, value, type*, data*, size*, ignoreHKCU, default*, size.
  // No default data: this tests the existing error path, not registry lookup.
  const args = [key, 0, outputs, outputs + 4, outputs + 8, 0, 0, 0];
  const sentinel = 0x5a5aa55a;
  for (let i = 0; i < 12; i++) e.guest_write32(stack + i * 4, sentinel);
  for (let i = 0; i < 4; i++) e.guest_write32(outputs + i * 4, sentinel);
  args.forEach((arg, i) => e.guest_write32(stack + (i + 1) * 4, arg));
  const result = e.test_shreg_us_failure(stack);
  assert.strictEqual(Number(result >> 32n), stack + 36, 'eight arguments plus return address');
  assert.strictEqual(Number(result & 0xffffffffn), 2, 'existing unsupported lookup result');
  for (let i = 0; i < 4; i++) assert.strictEqual(e.guest_read32(outputs + i * 4) >>> 0, sentinel);
  assert.strictEqual(e.guest_read32(stack + 36) >>> 0, sentinel, 'caller stack untouched');
  assert.strictEqual(api.nargs, 8);
  assert.strictEqual(api.convention, 'stdcall');
  console.log('PASS SHRegGetUSValueA name/dispatch failure preserves eight-argument stdcall ABI');
})().catch(error => { console.error(error); process.exitCode = 1; });
