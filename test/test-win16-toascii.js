#!/usr/bin/env node
'use strict';

// KEYBOARD.4 ToAscii(wVirtKey, wScanCode, lpKeyState, lpChar, wFlags).
// Civilization II's Civilopedia runtime stays resident after EXIT and runs
// every keystroke through it; before this entry point existed, typing a save
// name in Civ2 killed that task with `unreachable`.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_win16_toascii") (param $vk i32) (param $shift i32) (result i32)
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00110100))
    ;; Key state at 2:0200 (only VK_SHIFT set or clear), lpChar at 2:0400.
    (call $zero_memory (call $g2w (i32.const 0x00110200)) (i32.const 256))
    (call $gs8 (i32.const 0x00110210) (select (i32.const 0x80) (i32.const 0) (local.get $shift)))
    (call $gs32 (i32.const 0x00110400) (i32.const 0xAAAAAAAA))
    ;; Far return, then the Pascal arguments last-first.
    (call $gs16 (i32.const 0x00110100) (i32.const 0x004d))
    (call $gs16 (i32.const 0x00110102) (call $win16_index_to_sel (i32.const 1)))
    (call $gs16 (i32.const 0x00110104) (i32.const 0))                    ;; wFlags
    (call $gs16 (i32.const 0x00110106) (i32.const 0x0400))               ;; lpChar
    (call $gs16 (i32.const 0x00110108) (call $win16_index_to_sel (i32.const 2)))
    (call $gs16 (i32.const 0x0011010A) (i32.const 0x0200))               ;; lpKeyState
    (call $gs16 (i32.const 0x0011010C) (call $win16_index_to_sel (i32.const 2)))
    (call $gs16 (i32.const 0x0011010E) (i32.const 0x1E))                 ;; wScanCode
    (call $gs16 (i32.const 0x00110110) (local.get $vk))                  ;; wVirtKey
    (drop (call $win16_keyboard (i32.const 4)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_win16_toascii_char") (result i32) (call $gl16 (i32.const 0x00110400)))
  (func (export "test_win16_toascii_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_win16_toascii_eip") (result i32) (global.get $eip))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat });

  assert.strictEqual(e.test_win16_toascii(0x41, 0), 1, 'VK_A translates to one character');
  assert.strictEqual(e.test_win16_toascii_char(), 0x61, 'without Shift it is lowercase');
  assert.strictEqual(e.test_win16_toascii_esp(), 0x00110112,
    'ToAscii removes its far return and 14 bytes of Pascal arguments');
  assert.strictEqual(e.test_win16_toascii_eip(), 0x0010004d, 'ToAscii returns to its Win16 caller');

  assert.strictEqual(e.test_win16_toascii(0x41, 1), 1, 'Shift+A translates');
  assert.strictEqual(e.test_win16_toascii_char(), 0x41, 'with Shift it is uppercase');

  assert.strictEqual(e.test_win16_toascii(0x70, 0), 0, 'F1 has no character');

  console.log('PASS  Win16 KEYBOARD.4 ToAscii translates through far pointers and pops its frame');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
