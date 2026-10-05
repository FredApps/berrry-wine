#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_di_root") (result i32)
    (local $obj i32) (local $entry i32)
    (local.set $obj (call $dx_create_com_obj (i32.const 6) (i32.const 0)))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (store.field DxObject misc0 (local.get $entry) (i32.const 0x0700))
    (local.get $obj))

  (func (export "test_di_device_status")
      (param $root i32) (param $guid i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectInput_GetDeviceStatus
      (local.get $root) (local.get $guid) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const DI_OK = 0;
  const DI_NOTATTACHED = 1;
  const DIERR_INVALIDPARAM = 0x80070057;
  const root = wat.test_di_root() >>> 0;

  const allocGuid = words => {
    const guest = wat.guest_alloc(16) >>> 0;
    words.forEach((word, index) => wat.guest_write32(guest + index * 4, word));
    return guest;
  };
  const sysMouse = allocGuid([
    0x6f1d2b60, 0x11cfd5a0, 0x4544c7bf, 0x00005453,
  ]);
  const sysKeyboard = allocGuid([
    0x6f1d2b61, 0x11cfd5a0, 0x4544c7bf, 0x00005453,
  ]);
  const sameData1Forgery = allocGuid([
    0x6f1d2b60, 0, 0, 0,
  ]);
  const unknown = allocGuid([
    0x12345678, 0x90abcdef, 0x0badf00d, 0xfeedface,
  ]);

  assert.strictEqual(wat.test_di_device_status(root, sysMouse) >>> 0, DI_OK,
    'the browser system mouse is attached');
  assert.strictEqual(wat.test_di_device_status(root, sysKeyboard) >>> 0, DI_OK,
    'the browser system keyboard is attached');
  assert.strictEqual(wat.test_di_device_status(root, sameData1Forgery) >>> 0,
    DI_NOTATTACHED, 'a partial GUID match is not an attached device');
  assert.strictEqual(wat.test_di_device_status(root, unknown) >>> 0,
    DI_NOTATTACHED, 'an unknown device is not attached');
  assert.strictEqual(wat.test_di_device_status(root, 0) >>> 0,
    DIERR_INVALIDPARAM, 'a null device GUID is invalid');
  assert.strictEqual(wat.get_esp(), 0x0030000c,
    'GetDeviceStatus pops this and the GUID argument');

  console.log('PASS DirectInput GetDeviceStatus reports only attached browser devices');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
