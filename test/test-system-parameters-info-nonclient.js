#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_spi_handler_eax (mut i32) (i32.const 0))

  (func (export "test_spi")
      (param $action i32) (param $ui_param i32) (param $buffer i32)
      (param $wide i32) (result i32)
    (call $spi_core (local.get $action) (local.get $ui_param)
      (local.get $buffer) (i32.const 0) (local.get $wide)))
  (func (export "test_spi_nonclient")
      (param $ui_param i32) (param $buffer i32) (param $wide i32) (result i32)
    (call $spi_core (i32.const 0x29) (local.get $ui_param)
      (local.get $buffer) (i32.const 0) (local.get $wide)))
  (func (export "test_spi_handler")
      (param $action i32) (param $ui_param i32) (param $buffer i32)
      (param $wide i32) (result i32)
    (local $before i32)
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then
        (call $handle_SystemParametersInfoW
          (local.get $action) (local.get $ui_param) (local.get $buffer)
          (i32.const 0) (i32.const 0) (i32.const 0)))
      (else
        (call $handle_SystemParametersInfoA
          (local.get $action) (local.get $ui_param) (local.get $buffer)
          (i32.const 0) (i32.const 0) (i32.const 0))))
    (global.set $test_spi_handler_eax (i32.load offset=0 (global.get $reg_base)))
    (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
  (func (export "test_spi_handler_eax") (result i32)
    (global.get $test_spi_handler_eax))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const imageBase = wat.get_image_base() >>> 0;
  const wa = guest => (0x12000 + ((guest >>> 0) - imageBase)) >>> 0;
  const allocFilled = (size, value = 0x2f) => {
    const pointer = wat.guest_alloc(size) >>> 0;
    bytes.fill(value, wa(pointer), wa(pointer) + size);
    return pointer;
  };
  const read32 = pointer => view.getUint32(wa(pointer), true) >>> 0;
  const write32 = (pointer, value) => view.setUint32(wa(pointer), value >>> 0, true);
  const readAnsi = (pointer, max) => {
    let value = '';
    for (let i = 0; i < max && bytes[wa(pointer + i)]; i++) {
      value += String.fromCharCode(bytes[wa(pointer + i)]);
    }
    return value;
  };
  const readWide = (pointer, max) => {
    let value = '';
    for (let i = 0; i < max; i++) {
      const code = view.getUint16(wa(pointer + i * 2), true);
      if (!code) break;
      value += String.fromCharCode(code);
    }
    return value;
  };

  const wheel = allocFilled(4);
  assert.strictEqual(wat.test_spi_handler(0x68, 0, wheel, 0), 20,
    'SystemParametersInfoA pops its return address and four arguments');
  assert.strictEqual(wat.test_spi_handler_eax(), 1,
    'SPI_GETWHEELSCROLLLINES succeeds with a writable UINT');
  assert.strictEqual(read32(wheel), 3,
    'Win98 classic wheel scrolling defaults to three lines');

  const drag = allocFilled(4);
  assert.strictEqual(wat.test_spi_handler(0x26, 0, drag, 1), 20,
    'SystemParametersInfoW uses the same four-argument ABI');
  assert.strictEqual(wat.test_spi_handler_eax(), 1,
    'SPI_GETDRAGFULLWINDOWS succeeds with a writable BOOL');
  assert.strictEqual(read32(drag), 1,
    'the browser desktop advertises its full-window drag behavior');

  const iconAnsi = allocFilled(100);
  assert.strictEqual(wat.test_spi_handler(0x1f, 92, iconAnsi, 0), 20,
    'WinRAR\'s newer-sized ANSI icon-title query keeps exact stack cleanup');
  assert.strictEqual(wat.test_spi_handler_eax(), 1,
    'SPI_GETICONTITLELOGFONT succeeds for a large enough ANSI declaration');
  assert.strictEqual(read32(iconAnsi), 0xfffffff5,
    'LOGFONTA receives the classic -11 pixel system-font height');
  assert.strictEqual(read32(iconAnsi + 4), 0,
    'LOGFONTA stale width bytes are cleared');
  assert.strictEqual(readAnsi(iconAnsi + 28, 32), 'MS Sans Serif',
    'LOGFONTA receives the classic icon-title face');
  assert.deepStrictEqual(Array.from(bytes.slice(wa(iconAnsi + 60), wa(iconAnsi + 100))),
    Array(40).fill(0x2f), 'ANSI getter preserves the caller tail beyond LOGFONTA');

  const iconWide = allocFilled(100);
  assert.strictEqual(wat.test_spi(0x1f, 92, iconWide, 1), 1,
    'SPI_GETICONTITLELOGFONT accepts the complete LOGFONTW layout');
  assert.strictEqual(read32(iconWide + 4), 0,
    'LOGFONTW stale width bytes are cleared');
  assert.strictEqual(readWide(iconWide + 28, 32), 'MS Sans Serif',
    'LOGFONTW receives the classic icon-title face');
  assert.deepStrictEqual(Array.from(bytes.slice(wa(iconWide + 92), wa(iconWide + 100))),
    Array(8).fill(0x2f), 'wide getter preserves the caller tail');

  const shortFont = allocFilled(60);
  assert.strictEqual(wat.test_spi(0x1f, 59, shortFont, 0), 0,
    'an undersized LOGFONTA declaration fails');
  assert.deepStrictEqual(Array.from(bytes.slice(wa(shortFont), wa(shortFont + 60))),
    Array(60).fill(0x2f), 'failed sizing leaves LOGFONTA untouched');

  for (const action of [0x1f, 0x26, 0x29, 0x30, 0x68]) {
    assert.strictEqual(wat.test_spi(action, action === 0x1f ? 92 : 0, 0, 1), 0,
      `getter 0x${action.toString(16)} rejects a null output`);
  }
  const unknown = allocFilled(4);
  assert.strictEqual(wat.test_spi(0x7777, 0, unknown, 0), 0,
    'an unimplemented action fails instead of reporting false success');
  assert.strictEqual(read32(unknown), 0x2f2f2f2f,
    'an unimplemented action does not mutate caller storage');

  const ansiSize = 340;
  const ansi = allocFilled(ansiSize + 8);
  write32(ansi, ansiSize);
  assert.strictEqual(wat.test_spi_nonclient(0, ansi, 0), 1,
    'Win9x uiParam=0 must use NONCLIENTMETRICSA.cbSize');
  assert.strictEqual(read32(ansi), ansiSize, 'ANSI cbSize is preserved');
  for (const offset of [24, 92, 160, 220, 280]) {
    assert.strictEqual(read32(ansi + offset + 4), 0,
      `LOGFONTA lfWidth at ${offset} must be initialized`);
    assert.strictEqual(bytes[wa(ansi + offset + 20)], 0,
      `LOGFONTA lfItalic at ${offset} must be initialized`);
    assert.strictEqual(bytes[wa(ansi + offset + 28 + 'MS Sans Serif'.length)], 0,
      `LOGFONTA face at ${offset} must be terminated`);
  }
  assert.deepStrictEqual(Array.from(bytes.slice(wa(ansi + ansiSize), wa(ansi + ansiSize + 8))),
    Array(8).fill(0x2f), 'ANSI fill must not overwrite the caller tail');

  const wideSize = 500;
  const wide = allocFilled(wideSize + 8);
  write32(wide, wideSize);
  assert.strictEqual(wat.test_spi_nonclient(0, wide, 1), 1,
    'Win9x uiParam=0 must use NONCLIENTMETRICSW.cbSize');
  assert.strictEqual(read32(wide), wideSize, 'wide cbSize is preserved');
  for (const offset of [24, 124, 224, 316, 408]) {
    assert.strictEqual(read32(wide + offset + 4), 0,
      `LOGFONTW lfWidth at ${offset} must be initialized`);
    assert.strictEqual(bytes[wa(wide + offset + 20)], 0,
      `LOGFONTW lfItalic at ${offset} must be initialized`);
    const terminator = wide + offset + 28 + 'MS Sans Serif'.length * 2;
    assert.strictEqual(bytes[wa(terminator)] | bytes[wa(terminator + 1)], 0,
      `LOGFONTW face at ${offset} must be terminated`);
  }
  assert.deepStrictEqual(Array.from(bytes.slice(wa(wide + wideSize), wa(wide + wideSize + 8))),
    Array(8).fill(0x2f), 'wide fill must not overwrite the caller tail');

  const short = allocFilled(ansiSize);
  write32(short, ansiSize - 1);
  assert.strictEqual(wat.test_spi_nonclient(0, short, 0), 0,
    'an undersized declared layout must fail atomically');
  assert.strictEqual(read32(short), ansiSize - 1,
    'failed sizing must leave the caller buffer untouched');

  const explicit = allocFilled(ansiSize);
  write32(explicit, 0);
  assert.strictEqual(wat.test_spi_nonclient(ansiSize, explicit, 0), 1,
    'explicit uiParam sizing remains supported');
  assert.strictEqual(read32(explicit), ansiSize,
    'explicit uiParam becomes the returned cbSize');

  console.log('PASS SystemParametersInfo publishes bounded Win98 metrics for A/W callers');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
