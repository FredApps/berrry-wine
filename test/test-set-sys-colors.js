#!/usr/bin/env node
'use strict';

// SetSysColors is the one Win32 call that changes what GetSysColor answers, so
// it is only implemented if the two agree afterwards. A stub returning TRUE and
// keeping the stock palette reads as success everywhere except on screen, and
// the programs that call this are exactly the ones that then paint their whole
// window out of GetSysColor -- Exile II (1996) does both on its way in.
//
// The pair is backed by USER_SYS_COLORS, an override table rather than a copy
// of the palette: an index nobody has written still comes from the stock Win98
// values, which is what this checks alongside the round trip.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const COLOR_WINDOW = 5;
const COLOR_WINDOWTEXT = 8;
const COLOR_BTNFACE = 15;

const extraWat = String.raw`
  (func (export "test_call_SetSysColors")
        (param $count i32) (param $indices i32) (param $values i32)
        (param $api i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0))
    (call $handle_SetSysColors
      (local.get $count) (local.get $indices) (local.get $values)
      (i32.const 0) (i32.const 0) (call $g2w (local.get $api)))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_sys_colors_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_call_GetSysColor") (param $index i32) (result i32)
    (call $win98_sys_color (local.get $index)))
`;

async function main() {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = harness.exports;
  const api = (() => {
    const text = 'SetSysColors';
    const ptr = e.guest_alloc(text.length + 1) >>> 0;
    for (let i = 0; i < text.length; i++) e.guest_write8(ptr + i, text.charCodeAt(i));
    e.guest_write8(ptr + text.length, 0);
    return ptr;
  })();
  const array = (values) => {
    const ptr = e.guest_alloc(values.length * 4) >>> 0;
    values.forEach((value, i) => e.guest_write32(ptr + i * 4, value >>> 0));
    return ptr;
  };
  const get = index => e.test_call_GetSysColor(index) >>> 0;

  // The stock Windows 98 classic palette, before anyone has asked for another.
  assert.strictEqual(get(COLOR_BTNFACE), 0x00c0c0c0, 'BTNFACE starts at the stock grey');
  assert.strictEqual(get(COLOR_WINDOW), 0x00ffffff, 'WINDOW starts white');
  assert.strictEqual(get(COLOR_WINDOWTEXT), 0x00000000, 'WINDOWTEXT starts black');

  // Two colours at once, which is the shape a program actually uses: both
  // arrays are cElements long and indexed together.
  const written = e.test_call_SetSysColors(
    2, array([COLOR_BTNFACE, COLOR_WINDOW]), array([0x00112233, 0x00445566]), api);
  assert.strictEqual(written, 1, 'SetSysColors reports success');
  assert.strictEqual(e.test_sys_colors_esp(), 16,
    'SetSysColors pops its three stdcall arguments');
  assert.strictEqual(get(COLOR_BTNFACE), 0x00112233,
    'GetSysColor answers with what SetSysColors was given');
  assert.strictEqual(get(COLOR_WINDOW), 0x00445566,
    'and with the second element of the same call');
  assert.strictEqual(get(COLOR_WINDOWTEXT), 0x00000000,
    'an index nobody wrote still comes from the stock palette');

  // Setting one again replaces it rather than accumulating.
  e.test_call_SetSysColors(1, array([COLOR_BTNFACE]), array([0x00aabbcc]), api);
  assert.strictEqual(get(COLOR_BTNFACE), 0x00aabbcc, 'a later write wins');
  assert.strictEqual(get(COLOR_WINDOW), 0x00445566,
    'and leaves the other overridden index alone');

  // A COLOR_ constant past the end of the table is ignored, the way Windows
  // ignores one it does not know -- and must not write over a real slot.
  e.test_call_SetSysColors(1, array([9999]), array([0x00ff00ff]), api);
  assert.strictEqual(get(COLOR_BTNFACE), 0x00aabbcc,
    'an out-of-range index writes nothing at all');
  assert.strictEqual(get(9999), 0x00c0c0c0,
    'and reads back as the unknown-index fallback');

  // Null arrays are a caller bug, not a reason to trap.
  assert.strictEqual(e.test_call_SetSysColors(2, 0, 0, api), 1,
    'null arrays are survivable');
  assert.strictEqual(get(COLOR_BTNFACE), 0x00aabbcc, 'and change nothing');

  console.log('PASS  SetSysColors changes what GetSysColor answers, per index');
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exit(1);
});
