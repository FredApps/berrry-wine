#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_load_keyboard_layout") (param $klid i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_LoadKeyboardLayoutA
      (local.get $klid) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const wa = gp => gp - e.get_image_base() + e.get_guest_base();

  function ascii(value) {
    const gp = e.guest_alloc(value.length + 1) >>> 0;
    for (let i = 0; i < value.length; i++) bytes[wa(gp) + i] = value.charCodeAt(i);
    bytes[wa(gp) + value.length] = 0;
    return gp;
  }

  for (const klid of ['00000409', '00000A09', 'abcdef12']) {
    const gp = ascii(klid);
    const before = Buffer.from(bytes.subarray(wa(gp), wa(gp) + klid.length + 1));
    assert.strictEqual(e.test_load_keyboard_layout(gp) >>> 0, 0x04090409,
      `well-formed KLID ${klid} resolves to the available US layout`);
    assert.deepStrictEqual(Buffer.from(bytes.subarray(wa(gp), wa(gp) + klid.length + 1)), before,
      'LoadKeyboardLayoutA does not mutate its input name');
    assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
      'LoadKeyboardLayoutA pops its two arguments and return address');
  }

  for (const klid of ['', '0000040', '00000G09', '000004090']) {
    assert.strictEqual(e.test_load_keyboard_layout(ascii(klid)) >>> 0, 0,
      `malformed KLID ${JSON.stringify(klid)} fails`);
    assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
      'failure preserves stdcall cleanup');
  }
  assert.strictEqual(e.test_load_keyboard_layout(0), 0, 'NULL KLID fails');
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c, 'NULL failure preserves stdcall cleanup');

  console.log('PASS LoadKeyboardLayoutA validates KLID names and returns the available Win98 layout');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
