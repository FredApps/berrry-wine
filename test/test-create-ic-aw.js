#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create_ic")
        (param $wide i32) (param $stack i32) (param $driver i32)
        (param $device i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (if (local.get $wide)
      (then
        (call $handle_CreateICW
          (local.get $driver) (local.get $device) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)))
      (else
        (call $handle_CreateICA
          (local.get $driver) (local.get $device) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0))))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))

  (func (export "test_get_device_caps")
        (param $hdc i32) (param $index i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetDeviceCaps
      (local.get $hdc) (local.get $index) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  for (const name of ['CreateICA', 'CreateICW']) {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} is exported`);
    assert.strictEqual(api.nargs, 4, `${name} accepts the documented four arguments`);
    assert.strictEqual(api.convention, 'stdcall', `${name} uses stdcall`);
  }

  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const writeAnsi = value => {
    const pointer = wat.guest_alloc(value.length + 1) >>> 0;
    for (let index = 0; index < value.length; index++) {
      wat.guest_write8(pointer + index, value.charCodeAt(index));
    }
    wat.guest_write8(pointer + value.length, 0);
    return pointer;
  };
  const writeWide = value => {
    const pointer = wat.guest_alloc((value.length + 1) * 2) >>> 0;
    for (let index = 0; index < value.length; index++) {
      wat.guest_write16(pointer + index * 2, value.charCodeAt(index));
    }
    wat.guest_write16(pointer + value.length * 2, 0);
    return pointer;
  };

  const stack = 0x074ff000;
  const contexts = [];
  for (const [wide, suffix, writeString] of [[0, 'A', writeAnsi], [1, 'W', writeWide]]) {
    const driver = writeString('DISPLAY');
    const device = writeString('DISPLAY');
    const packed = wat.test_create_ic(wide, stack, driver, device);
    const hdc = Number(packed & 0xffffffffn) >>> 0;
    const resultingEsp = Number(packed >> 32n) >>> 0;
    assert(hdc, `CreateIC${suffix} creates a display information context`);
    assert.strictEqual(resultingEsp, stack + 20,
      `CreateIC${suffix} pops four arguments and its return address`);
    assert(wat.test_get_device_caps(hdc, 8) > 0,
      `CreateIC${suffix} returns a live context with horizontal resolution`);
    assert(wat.test_get_device_caps(hdc, 10) > 0,
      `CreateIC${suffix} returns a live context with vertical resolution`);
    contexts.push(hdc);
  }
  assert.notStrictEqual(contexts[0], contexts[1], 'A and W calls create independent contexts');
  for (const hdc of contexts) {
    assert.strictEqual(wat.test_call_DeleteDC(hdc), 1,
      'DeleteDC releases the information context');
  }

  console.log('PASS  CreateICA/W share the browser display information-context path');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
