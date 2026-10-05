#!/usr/bin/env node
'use strict';

// The MMSYSTEM timer and USER caret calls ClockWerx makes on its way into a
// game. timeGetDevCaps sizes its game timer, timeSetEvent drives it, and the
// Options screen's name field creates and moves a caret; each of these used
// to stop the task as an unimplemented API.
//
// Each call is made the way a task makes it: a far return address and Pascal
// arguments on the 16-bit stack, then the module's dispatcher. A 16-bit
// TimeProc cannot be called from the host, so a due timer is entered the way
// the Win16 pump enters it: a FAR PASCAL frame pushed on the task stack whose
// return address is the pump call's own thunk, and CS:IP at the TimeProc.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "w16_setup")
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x00120000)
      (i32.const 0x10000) (i32.const 0) (i32.const 3))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000)))
  (func (export "w16_put16") (param $a i32) (param $v i32) (call $gs16 (local.get $a) (local.get $v)))
  (func (export "w16_get16") (param $a i32) (result i32) (call $gl16 (local.get $a)))
  (func (export "w16_set_esp") (param $v i32) (i32.store offset=16 (global.get $reg_base) (local.get $v)))
  (func (export "w16_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "w16_ax") (result i32) (i32.and (i32.load (global.get $reg_base)) (i32.const 0xFFFF)))
  (func (export "w16_call") (param $module i32) (param $ordinal i32)
    (if (i32.eqz (local.get $module))
      (then (drop (call $win16_user (local.get $ordinal))))
      (else (drop (call $win16_mmsystem (local.get $ordinal))))))
  (func (export "w16_set_thunk_off") (param $v i32) (global.set $win16_cur_thunk_off (local.get $v)))
  (func (export "w16_thunk_sel") (result i32) (global.get $WIN16_THUNK_SEL))
  (func (export "w16_run_due") (result i32) (call $win16_mm_timer_run_due))
  (func (export "w16_cs") (result i32) (global.get $sreg_cs))
  (func (export "w16_eip") (result i32) (global.get $eip))
  (func (export "w16_caret") (param $i i32) (result i32)
    (if (i32.eq (local.get $i) (i32.const 0)) (then (return (global.get $caret_w))))
    (if (i32.eq (local.get $i) (i32.const 1)) (then (return (global.get $caret_h))))
    (if (i32.eq (local.get $i) (i32.const 2)) (then (return (global.get $caret_x))))
    (if (i32.eq (local.get $i) (i32.const 3)) (then (return (global.get $caret_y))))
    (global.get $caret_visible))
`;

const USER = 0, MMSYSTEM = 1;
const STACK = 0x00110100;          // linear ESP at the call
const SS_BASE = 0x00110000;

let ticks = 1000;

(async () => {
  const { exports: e } = await bootRenderHarness({
    extraWat, width: 64, height: 48,
    extraHostOverrides: { get_ticks: () => ticks },
  });
  e.w16_setup();
  const ss = 0x17;                 // selector of arena index 2
  const cs = 0x0f;                 // selector of arena index 1

  // args are listed first-pushed first, as the Pascal prototype reads.
  const call = (module, ordinal, args) => {
    e.w16_set_esp(STACK);
    e.w16_put16(STACK, 0x004d);
    e.w16_put16(STACK + 2, cs);
    args.slice().reverse().forEach((w, i) => e.w16_put16(STACK + 4 + i * 2, w & 0xffff));
    e.w16_call(module, ordinal);
    assert.strictEqual(e.w16_esp() >>> 0, STACK + 4 + args.length * 2,
      `ordinal ${ordinal} pops its return address and ${args.length * 2} argument bytes`);
    return e.w16_ax();
  };

  // --- MMSYSTEM.604 timeGetDevCaps ---------------------------------------
  assert.strictEqual(call(MMSYSTEM, 604, [ss, 0x200, 4]), 0, 'TIMERR_NOERROR');
  assert.deepStrictEqual([e.w16_get16(SS_BASE + 0x200), e.w16_get16(SS_BASE + 0x202)],
    [1, 0xffff], 'a 16-bit TIMECAPS: 1 ms minimum, 65535 ms maximum');
  assert.strictEqual(call(MMSYSTEM, 604, [ss, 0x200, 2]), 129,
    'a buffer too small for TIMECAPS is TIMERR_STRUCT');
  console.log('PASS  timeGetDevCaps reports the Win 3.1 period range');

  // --- MMSYSTEM.602 timeSetEvent / 603 timeKillEvent -----------------------
  const proc = { sel: 0x1f, off: 0x0300 };  // arena index 3
  assert.strictEqual(call(MMSYSTEM, 602, [0, 1, proc.sel, proc.off, 0xaabb, 0xccdd, 0]), 0,
    'a zero delay is refused with a zero id');
  const id = call(MMSYSTEM, 602, [50, 1, proc.sel, proc.off, 0xaabb, 0xccdd, 1]);
  assert.notStrictEqual(id, 0, 'a periodic timer gets a nonzero id');

  e.w16_set_esp(STACK);
  e.w16_set_thunk_off(0x1234);
  ticks += 49;
  assert.strictEqual(e.w16_run_due(), 0, 'nothing is due before the period elapses');
  ticks += 1;
  assert.strictEqual(e.w16_run_due(), 1, 'the timer is due once its period elapses');
  const sp = e.w16_esp() >>> 0;
  assert.strictEqual(sp, STACK - 20, 'a FAR PASCAL frame of 16 argument bytes and a far return');
  const frame = Array.from({ length: 10 }, (_, i) => e.w16_get16(sp + i * 2));
  assert.deepStrictEqual(frame,
    [0x1234, e.w16_thunk_sel(), 0, 0, 0, 0, 0xccdd, 0xaabb, 0, id],
    'TimeProc(wTimerID, wMsg, dwUser, dw1, dw2) returns into the pump call it interrupted');
  assert.strictEqual(e.w16_cs(), proc.sel, 'CS is the TimeProc selector');
  assert.strictEqual(e.w16_eip() >>> 0, 0x00120000 + proc.off, 'EIP is the TimeProc offset');

  e.w16_setup();
  e.w16_set_esp(STACK);
  assert.strictEqual(e.w16_run_due(), 0, 'the period that fired is charged before the callback');
  ticks += 175;  // three periods late: the next one starts at 1200, not 1100
  assert.strictEqual(e.w16_run_due(), 1, 'a periodic timer fires again');
  e.w16_setup();
  e.w16_set_esp(STACK);
  ticks += 24;
  assert.strictEqual(e.w16_run_due(), 0,
    'a late pump skips the periods it missed instead of replaying them');

  assert.strictEqual(call(MMSYSTEM, 603, [id]), 0, 'timeKillEvent of a live id');
  assert.strictEqual(call(MMSYSTEM, 603, [id]), 11, 'a dead id is MMSYSERR_INVALPARAM');
  ticks += 500;
  e.w16_set_esp(STACK);
  assert.strictEqual(e.w16_run_due(), 0, 'a killed timer never fires');

  const once = call(MMSYSTEM, 602, [10, 1, proc.sel, proc.off, 0, 7, 0]);
  ticks += 10;
  e.w16_setup();
  e.w16_set_esp(STACK);
  assert.strictEqual(e.w16_run_due(), 1, 'a one-shot timer fires');
  e.w16_setup();
  e.w16_set_esp(STACK);
  ticks += 100;
  assert.strictEqual(e.w16_run_due(), 0, 'and is gone afterwards');
  assert.strictEqual(call(MMSYSTEM, 603, [once]), 11, 'its id is no longer live');
  console.log('PASS  timeSetEvent enters a due 16-bit TimeProc from the message pump');

  // --- USER.163-169, 183 caret; USER.21 GetDoubleClickTime ------------------
  e.w16_setup();
  call(USER, 163, [0, 0, 2, 14]);
  assert.deepStrictEqual([e.w16_caret(0), e.w16_caret(1), e.w16_caret(4)], [2, 14, 0],
    'CreateCaret sizes a hidden caret');
  call(USER, 165, [5, -3]);
  call(USER, 183, [ss, 0x300]);
  assert.deepStrictEqual([e.w16_get16(SS_BASE + 0x300), e.w16_get16(SS_BASE + 0x302)],
    [5, 0xfffd], 'GetCaretPos returns the signed position SetCaretPos set');
  call(USER, 167, [0]);
  assert.strictEqual(e.w16_caret(4), 1, 'ShowCaret');
  call(USER, 166, [0]);
  assert.strictEqual(e.w16_caret(4), 0, 'HideCaret');
  assert.strictEqual(call(USER, 169, []), 530, 'the default blink time');
  call(USER, 168, [250]);
  assert.strictEqual(call(USER, 169, []), 250, 'SetCaretBlinkTime is read back');
  call(USER, 164, []);
  assert.strictEqual(call(USER, 21, []), 500, 'GetDoubleClickTime');
  console.log('PASS  the Win16 caret family shares USER\'s one caret');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
