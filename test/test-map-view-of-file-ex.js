#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_map_error") (result i32) (global.get $last_error))
  (func (export "test_map_view_of_file_ex") (param $base i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    ;; Sixth stdcall argument lives beyond the five dispatcher locals.
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $base))
    (call $handle_MapViewOfFileEx
      (i32.const 0xfb000002) (i32.const 2) (i32.const 3)
      (i32.const 4) (i32.const 0x16c) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const calls = [];
  const { exports: wat, memory } = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      fs_map_view_of_file_result: (...args) => {
        calls.push(args.slice(0, 5));
        assert.strictEqual(args[6], 1, 'result call carries the guest thread owner');
        new DataView(memory.buffer).setUint32(args[5], 0x12345000, true);
        return 0;
      },
    },
  });

  const automatic = wat.test_map_view_of_file_ex(0);
  assert.strictEqual(Number(automatic & 0xffffffffn), 0x12345000);
  assert.strictEqual(Number(automatic >> 32n), 0x0030001c,
    'MapViewOfFileEx pops its return address and six stdcall arguments');
  assert.deepStrictEqual(calls, [[0xfb000002 | 0, 2, 3, 4, 0x16c]],
    'a NULL preferred address delegates all mapping fields to MapViewOfFile');

  const fixed = wat.test_map_view_of_file_ex(0x22000000);
  assert.strictEqual(Number(fixed & 0xffffffffn), 0,
    'unsupported fixed placement fails instead of returning the wrong address');
  assert.strictEqual(calls.length, 1,
    'fixed placement does not create an unwanted view at an arbitrary address');
  assert.strictEqual(wat.test_map_error(), 50, 'unsupported placement reports ERROR_NOT_SUPPORTED');

  console.log('PASS  MapViewOfFileEx maps NULL-base views and rejects unsupported fixed placement');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
