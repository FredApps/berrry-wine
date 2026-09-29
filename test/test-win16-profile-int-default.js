#!/usr/bin/env node

'use strict';

// KERNEL.127 GetPrivateProfileInt / KERNEL.57 GetProfileInt hand back nDefault
// unchanged when the key is missing, 0x8000 included.
//
// nDefault is a UINT. The Win16 shims used to read it through $win16_coord,
// the helper that exists to turn the *window coordinate* 0x8000 into the
// 32-bit CW_USEDEFAULT sentinel 0x80000000 — and the WORD result these calls
// return then masked that straight back to 0. CW_USEDEFAULT is exactly the
// default an app passes when it keeps its window rectangle in an INI file, so
// ScrabOut read 0 for x, y, cx and cy, created a 0x0 main window and drew
// nothing at all. Every other default was already correct, which is why this
// only ever surfaced as one app with a blank screen.
//
// The call is driven the way the dispatcher drives it: a real selector from
// the Win16 arena, a Pascal frame on a real 16-bit stack, and the shim's own
// far-return epilogue. A hand-faked frame would not survive that epilogue, and
// the epilogue is part of what the shim has to get right.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { setIniValue } = require('../lib/storage');

const extraWat = String.raw`
  ;; One arena slot, used as this fake task's stack, data and code selector.
  ;; Index 0 is the null selector and is never allocated, so start at 1 the way
  ;; the NE loader does.
  (func (export "twpi_selector") (result i32)
    (call $win16_next_seg_set (i32.const 1))
    (call $win16_index_to_sel (call $win16_alloc_segment)))

  (func (export "twpi_seg_base") (param $sel i32) (result i32)
    (call $win16_seg_base (call $win16_sel_to_index (local.get $sel))))

  ;; The strings have to be written through the guest's own translation, so the
  ;; segment really is the one $win16_far_to_guest resolves the far pointers to.
  (func (export "twpi_g2w") (param $ga i32) (result i32)
    (call $g2w (local.get $ga)))

  ;; Lay a Pascal frame down at SS:off — far return address first, then the
  ;; caller's words, last-pushed nearest the top. $win16_arg16(n) reads the
  ;; word at ESP+4+2n, and ESP is linear (SS base already folded in).
  (func $twpi_frame (param $esp i32) (param $n i32) (param $v i32)
    (call $gs16 (i32.add (local.get $esp)
                         (i32.add (i32.const 4) (i32.shl (local.get $n) (i32.const 1))))
                (local.get $v)))

  (func $twpi_begin (param $esp i32) (param $sel i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))                  ;; return IP
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (local.get $sel))) ;; return CS

  ;; GetPrivateProfileInt(lpAppName, lpKeyName, nDefault, lpFileName), Pascal:
  ;; word 6:5 = lpAppName, 4:3 = lpKeyName, 2 = nDefault, 1:0 = lpFileName.
  (func (export "twpi_private") (param $esp i32) (param $sel i32) (param $app i32)
      (param $key i32) (param $def i32) (param $file i32) (result i32)
    (call $twpi_begin (local.get $esp) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 6) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 5) (local.get $app))
    (call $twpi_frame (local.get $esp) (i32.const 4) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 3) (local.get $key))
    (call $twpi_frame (local.get $esp) (i32.const 2) (local.get $def))
    (call $twpi_frame (local.get $esp) (i32.const 1) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 0) (local.get $file))
    (call $win16_GetPrivateProfileInt)
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))

  ;; GetProfileInt(lpAppName, lpKeyName, nDefault): 4:3 = app, 2:1 = key,
  ;; 0 = default. WIN.INI is supplied by the handler underneath.
  (func (export "twpi_win_ini") (param $esp i32) (param $sel i32) (param $app i32)
      (param $key i32) (param $def i32) (result i32)
    (call $twpi_begin (local.get $esp) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 4) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 3) (local.get $app))
    (call $twpi_frame (local.get $esp) (i32.const 2) (local.get $sel))
    (call $twpi_frame (local.get $esp) (i32.const 1) (local.get $key))
    (call $twpi_frame (local.get $esp) (i32.const 0) (local.get $def))
    (call $win16_GetProfileInt)
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const sel = e.twpi_selector() >>> 0;
  const segBase = e.twpi_seg_base(sel) >>> 0;
  assert(segBase, 'the fake task got a mapped selector');

  const mem = new Uint8Array(memory.buffer);
  const put = (off, s) => {
    const base = e.twpi_g2w(segBase + off) >>> 0;
    for (let i = 0; i < s.length; i++) mem[base + i] = s.charCodeAt(i);
    mem[base + s.length] = 0;
    return off;
  };

  const esp = segBase + 0x8000;            // a stack offset well clear of the strings
  const appOff = put(0x100, 'Window');
  const missingKeyOff = put(0x140, 'Left');
  const presentKeyOff = put(0x160, 'Top');
  const fileOff = put(0x180, 'scrabout.ini');

  const priv = (def, key = missingKeyOff) =>
    e.twpi_private(esp, sel, appOff, key, def, fileOff) >>> 0;

  assert.strictEqual(priv(0x8000), 0x8000,
    'a missing key returns the 0x8000 (CW_USEDEFAULT) default, not 0');
  assert.strictEqual(priv(0xFFFF), 0xFFFF, 'a 0xFFFF default survives the WORD return');
  assert.strictEqual(priv(0x7FFF), 0x7FFF, 'the top of the signed range is unchanged');
  assert.strictEqual(priv(0), 0, 'a zero default is still zero');
  assert.strictEqual(priv(320), 320, 'an ordinary default is unchanged');

  // A key that is present still wins, so the fix did not turn the lookup into
  // a constant.
  setIniValue('scrabout.ini', 'Window', 'Top', 77);
  assert.strictEqual(priv(0x8000, presentKeyOff), 77, 'a present key beats the default');

  assert.strictEqual(e.twpi_win_ini(esp, sel, appOff, missingKeyOff, 0x8000) >>> 0, 0x8000,
    'GetProfileInt has the same contract as the private form');

  console.log('PASS  Win16 GetPrivateProfileInt returns a 0x8000 default intact');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
