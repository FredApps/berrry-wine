#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MCW_EM = 0x0008001f;
const EM_ZERODIVIDE = 0x00000008;
const EM_DENORMAL = 0x00080000;
const MCW_RC = 0x00000300;
const RC_DOWN = 0x00000100;
const RC_CHOP = 0x00000300;
const MCW_PC = 0x00030000;
const PC_24 = 0x00020000;
const MCW_IC = 0x00040000;
const IC_AFFINE = 0x00040000;

const extraWat = String.raw`
  (func (export "test_controlfp") (param $new i32) (param $mask i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle__controlfp (local.get $new) (local.get $mask)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_set_cw") (param $cw i32) (global.set $fpu_cw (local.get $cw)))
  (func (export "test_get_cw") (result i32) (global.get $fpu_cw))
  (func (export "test_round") (param $value f64) (result f64)
    (call $fpu_round (local.get $value)))
`;

(async () => {
  const first = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = first.exports;
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);

  e.test_set_cw(0x027f); // CRT default: 53-bit, round-to-nearest, all masked.
  assert.strictEqual(e.test_controlfp(0, 0) >>> 0, 0x0009001f,
    'mask zero queries the current Microsoft-format control word');
  assert.strictEqual(e.test_get_cw(), 0x027f, 'a query does not mutate x87 state');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300004, '_controlfp is cdecl');

  assert.strictEqual(e.test_controlfp(RC_CHOP, MCW_RC) >>> 0, 0x0009031f,
    'round-toward-zero is retained and reported');
  assert.strictEqual(e.test_get_cw(), 0x0e7f, 'CRT rounding bits reach x87 bits 10..11');
  assert.strictEqual(e.test_round(1.75), 1, 'x87 rounding observes RC_CHOP');
  assert.strictEqual(e.test_round(-1.75), -1, 'RC_CHOP truncates negative values toward zero');

  assert.strictEqual(e.test_controlfp(RC_DOWN, MCW_RC) >>> 0, 0x0009011f,
    'round-down replaces only the requested field');
  assert.strictEqual(e.test_round(-1.25), -2, 'x87 rounding observes RC_DOWN');

  e.test_set_cw(0x027f);
  assert.strictEqual(e.test_controlfp(PC_24, MCW_PC) >>> 0, 0x000a001f,
    '24-bit precision uses the documented CRT encoding');
  assert.strictEqual(e.test_get_cw(), 0x007f, 'PC_24 maps to x87 precision bits 00');
  assert.strictEqual(e.test_controlfp(IC_AFFINE, MCW_IC) >>> 0, 0x000e001f,
    'affine infinity control is retained and reported');
  assert.strictEqual(e.test_get_cw(), 0x107f, 'infinity control reaches x87 bit 12');

  e.test_set_cw(0x027f);
  assert.strictEqual(e.test_controlfp(0, EM_ZERODIVIDE) >>> 0, 0x00090017,
    'clearing an exception mask exposes it');
  assert.strictEqual(e.test_get_cw(), 0x027b, 'zero-divide mask maps to x87 bit 2');
  assert.strictEqual(e.test_controlfp(EM_ZERODIVIDE, EM_ZERODIVIDE) >>> 0, 0x0009001f,
    'setting an exception mask hides it again');
  assert.strictEqual(e.test_get_cw(), 0x027f);

  e.test_set_cw(0x027d); // denormal exception unmasked.
  assert.strictEqual(e.test_controlfp(EM_DENORMAL, EM_DENORMAL) >>> 0, 0x0001001f,
    '_controlfp preserves the x86 denormal exception bit');
  assert.strictEqual(e.test_get_cw(), 0x027d,
    'denormal remains unmasked even when requested directly');
  e.test_set_cw(0x027f);
  assert.strictEqual(e.test_controlfp(0x10, MCW_EM) >>> 0, 0x00090010,
    'MCW_EM updates the five portable masks but retains denormal masking');
  assert.strictEqual(e.test_get_cw(), 0x0243,
    'portable exception masks map to x87 while denormal remains masked');

  const second = await bootRenderHarness({ extraWat, fonts: 'none' });
  second.exports.init_thread(2, 0x00400000, 0, 0, 0, 0, 0);
  second.exports.test_set_cw(0x027f);
  e.test_controlfp(RC_CHOP, MCW_RC);
  assert.strictEqual(second.exports.test_controlfp(0, 0) >>> 0, 0x0009001f,
    'each browser process instance owns its floating-point control state');

  console.log('PASS  _controlfp queries and updates the live x87 control word');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
