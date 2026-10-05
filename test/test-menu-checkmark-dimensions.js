#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_menu_checkmark_dimensions") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_GetMenuCheckMarkDimensions
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_menu_checkmark_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const packed = wat.test_get_menu_checkmark_dimensions() >>> 0;

  assert.strictEqual(packed & 0xffff, 13,
    'low word reports the Win98 classic check-mark width');
  assert.strictEqual(packed >>> 16, 13,
    'high word reports the Win98 classic check-mark height');
  assert.strictEqual(wat.test_menu_checkmark_esp() >>> 0, 0x30004,
    'zero-argument stdcall pops only the return address');

  console.log('PASS  GetMenuCheckMarkDimensions reports the Win98 classic 13x13 bitmap');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
