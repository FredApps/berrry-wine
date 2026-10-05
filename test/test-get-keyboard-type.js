#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_keyboard_type")
        (param $stack i32) (param $selector i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_GetKeyboardType
      (local.get $selector) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = 0x074ff000;
  const check = (selector, expected) => {
    assert.strictEqual(wat.test_get_keyboard_type(stack, selector), expected,
      `GetKeyboardType(${selector})`);
    assert.strictEqual(wat.get_esp() >>> 0, stack + 8,
      'stdcall removes the return address and one argument');
  };

  check(0, 4);   // enhanced 101/102-key keyboard
  check(1, 0);   // OEM-dependent subtype
  check(2, 12);  // function-key count
  check(3, 0);
  check(-1, 0);
  check(0x7fffffff, 0);

  console.log('PASS  GetKeyboardType reports Win98 enhanced-keyboard selectors and rejects unsupported selectors');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
