#!/usr/bin/env node
'use strict';

// DirectDraw gamma control is display state, not a write-only success probe.
// GTA2 snapshots this ramp, installs its own, and later restores the snapshot.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DD_OK = 0;
const DDERR_INVALIDPARAMS = 0x80070057;
const DDERR_INVALIDOBJECT = 0x88760082;
const STACK = 0x00300000;
const RAMP_BYTES = 3 * 256 * 2;

const extraWat = String.raw`
  (func (export "test_gamma_create") (param $primary i32) (result i32)
    (local $obj i32) (local $entry i32)
    (local.set $obj (call $dx_create_com_obj
      (i32.const 2) (call $init_com_vtable (i32.const 3079) (i32.const 5))))
    (if (local.get $obj)
      (then
        (local.set $entry (call $dx_from_this (local.get $obj)))
        (store.field DxObject flags (local.get $entry)
          (select (i32.const 1) (i32.const 0) (local.get $primary)))))
    (local.get $obj))

  (func (export "test_gamma_get")
        (param $obj i32) (param $flags i32) (param $ramp i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawGammaControl_GetGammaRamp
      (local.get $obj) (local.get $flags) (local.get $ramp)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_gamma_set")
        (param $obj i32) (param $flags i32) (param $ramp i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawGammaControl_SetGammaRamp
      (local.get $obj) (local.get $flags) (local.get $ramp)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_gamma_release") (param $obj i32) (result i32)
    (call $dx_com_release_basic (local.get $obj)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const allocRamp = () => e.guest_alloc(RAMP_BYTES) >>> 0;
  const readWord = (ramp, channel, index) =>
    view.getUint16(wa(ramp) + channel * 512 + index * 2, true);
  const fillRamp = (ramp, salt) => {
    for (let channel = 0; channel < 3; channel++) {
      for (let index = 0; index < 256; index++) {
        view.setUint16(wa(ramp) + channel * 512 + index * 2,
          (salt + channel * 0x1111 + index * 193) & 0xffff, true);
      }
    }
  };
  const rampBytes = ramp =>
    Array.from(bytes.slice(wa(ramp), wa(ramp) + RAMP_BYTES));

  const gamma = e.test_gamma_create(1) >>> 0;
  const nonPrimary = e.test_gamma_create(0) >>> 0;
  assert(gamma && nonPrimary, 'gamma-control test surfaces are allocated');

  const initial = allocRamp();
  assert.strictEqual(e.test_gamma_get(gamma, 0, initial) >>> 0, DD_OK,
    'GetGammaRamp succeeds on a primary surface');
  assert.deepStrictEqual([
    readWord(initial, 0, 0), readWord(initial, 0, 127), readWord(initial, 0, 255),
    readWord(initial, 1, 127), readWord(initial, 2, 255),
  ], [0, 127 * 257, 0xffff, 127 * 257, 0xffff],
  'an unset display starts with the identity ramp');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 16,
    'GetGammaRamp pops this, flags, ramp, and return address');

  const supplied = allocRamp();
  const output = allocRamp();
  fillRamp(supplied, 0x1234);
  const expected = rampBytes(supplied);
  assert.strictEqual(e.test_gamma_set(gamma, 0, supplied) >>> 0, DD_OK,
    'SetGammaRamp accepts an uncalibrated ramp');
  view.setUint16(wa(supplied), 0xbeef, true);
  assert.strictEqual(e.test_gamma_get(gamma, 0, output) >>> 0, DD_OK,
    'GetGammaRamp retrieves the installed ramp');
  assert.deepStrictEqual(rampBytes(output), expected,
    'the display owns its ramp instead of aliasing the caller buffer');

  const screenDc = e.test_call_GetDC(0) >>> 0;
  const gdiOutput = allocRamp();
  assert(screenDc, 'a screen DC is available');
  assert.strictEqual(e.test_call_GetDeviceGammaRamp(screenDc, gdiOutput), 1,
    'GDI can read the DirectDraw-installed display state');
  assert.deepStrictEqual(rampBytes(gdiOutput), expected,
    'DirectDraw and GDI expose one display gamma ramp');

  const calibrated = allocRamp();
  fillRamp(calibrated, 0x4321);
  const calibratedExpected = rampBytes(calibrated);
  assert.strictEqual(e.test_gamma_set(gamma, 1, calibrated) >>> 0, DD_OK,
    'DDSGR_CALIBRATE remains accepted without a hardware calibrator');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 16,
    'SetGammaRamp pops this, flags, ramp, and return address');

  fillRamp(output, 0x7777);
  const untouched = rampBytes(output);
  assert.strictEqual(e.test_gamma_set(gamma, 2, supplied) >>> 0, DDERR_INVALIDPARAMS,
    'unknown SetGammaRamp flags fail');
  assert.strictEqual(e.test_gamma_get(gamma, 1, output) >>> 0, DDERR_INVALIDPARAMS,
    'GetGammaRamp requires its documented zero flags');
  assert.deepStrictEqual(rampBytes(output), untouched,
    'a failed GetGammaRamp leaves output untouched');
  assert.strictEqual(e.test_gamma_set(gamma, 0, 0) >>> 0, DDERR_INVALIDPARAMS,
    'SetGammaRamp rejects a null ramp');
  assert.strictEqual(e.test_gamma_get(gamma, 0, 0) >>> 0, DDERR_INVALIDPARAMS,
    'GetGammaRamp rejects a null ramp');
  assert.strictEqual(e.test_gamma_set(nonPrimary, 0, supplied) >>> 0, DDERR_INVALIDOBJECT,
    'gamma state is available only through a primary surface');

  assert.strictEqual(e.test_gamma_get(gamma, 0, output) >>> 0, DD_OK);
  assert.deepStrictEqual(rampBytes(output), calibratedExpected,
    'failed calls do not replace the calibrated ramp');

  assert.strictEqual(e.test_call_ReleaseDC(0, screenDc), 1,
    'screen DC releases cleanly');
  assert.strictEqual(e.test_gamma_release(nonPrimary), 0,
    'non-primary test surface releases cleanly');
  assert.strictEqual(e.test_gamma_release(gamma), 0,
    'primary test surface releases cleanly');

  console.log('PASS  DirectDraw gamma control retains shared display-ramp state');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
