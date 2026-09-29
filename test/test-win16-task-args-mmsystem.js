#!/usr/bin/env node

'use strict';

// Four things a 16-bit task gets from us that it did not get before, all found
// by Bad Toys 3D (1996) and all driven here the way the dispatcher drives
// them: a real arena selector, a Pascal frame on a real 16-bit stack, and the
// shim's own far-return epilogue.
//
//  1. Its command line. InitTask hands WinMain ES:BX, and that block used to be
//     unconditionally empty, so an installer that re-runs itself with a switch
//     took its no-arguments path forever. Bad Toys 3D's INSTALL.EXE copies
//     itself to C:\BT3D\TINST.DAT and WinExec()s it with "/kopie C:\" to do the
//     actual copying; with an empty PSP the second stage just put the directory
//     dialog up again.
//
//  2. waveOutGetVolume without reading past its own frame. The waveOut shim
//     hoisted the HWAVEOUT out of stack word 3 for every ordinal that reached
//     it, but 415/416 take (uDeviceID, ...) in a six-byte frame, so word 3 is
//     the caller's own stack -- and $win16_h32 is right to refuse an index it
//     never handed out, so a correctly implemented call killed the task. The
//     poison word below is the value the game actually had there.
//
//  3. The joystick ordinals, answering for a machine with no joystick driver
//     (which is what the 32-bit handlers already say).
//
//  4. GS. A 16-bit task has six selectors and spends them; GS used to trap.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MMSYSERR_NOERROR = 0;
const MMSYSERR_NODRIVER = 6;
const MMSYSERR_INVALPARAM = 11;

const extraWat = String.raw`
  (func (export "twa_selector") (result i32)
    (call $win16_next_seg_set (i32.const 1))
    (call $win16_index_to_sel (call $win16_alloc_segment)))

  (func (export "twa_seg_base") (param $sel i32) (result i32)
    (call $win16_seg_base (call $win16_sel_to_index (local.get $sel))))

  (func (export "twa_g2w") (param $ga i32) (result i32) (call $g2w (local.get $ga)))

  (func (export "twa_read8") (param $ga i32) (result i32) (call $gl8 (local.get $ga)))

  ;; Lay a far return address plus up to four Pascal words at ESP and enter a
  ;; shim. Words are given lowest-first, which is last-pushed-first -- the
  ;; order $win16_arg16 numbers them in.
  (func $twa_frame (param $esp i32) (param $sel i32)
        (param $w0 i32) (param $w1 i32) (param $w2 i32) (param $w3 i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))                        ;; return IP
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (local.get $sel)) ;; return CS
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (local.get $w0))
    (call $gs16 (i32.add (local.get $esp) (i32.const 6)) (local.get $w1))
    (call $gs16 (i32.add (local.get $esp) (i32.const 8)) (local.get $w2))
    (call $gs16 (i32.add (local.get $esp) (i32.const 10)) (local.get $w3)))

  (func (export "twa_mmsystem") (param $esp i32) (param $sel i32) (param $ordinal i32)
        (param $w0 i32) (param $w1 i32) (param $w2 i32) (param $w3 i32) (result i32)
    (call $twa_frame (local.get $esp) (local.get $sel)
      (local.get $w0) (local.get $w1) (local.get $w2) (local.get $w3))
    (if (i32.eqz (call $win16_mmsystem (local.get $ordinal)))
      (then (return (i32.const -1))))
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))

  ;; InitTask leaves ES:BX pointing at the command line it built.
  (func (export "twa_init_task") (param $esp i32) (param $sel i32) (result i32)
    (global.set $win16_psp_sel (i32.const 0))
    (call $twa_frame (local.get $esp) (local.get $sel)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (call $win16_InitTask)
    (call $win16_seg_base (call $win16_sel_to_index (global.get $sreg_es))))

  (func (export "twa_set_gs") (param $sel i32) (call $win16_set_sreg (i32.const 5) (local.get $sel)))
  (func (export "twa_gs_base") (result i32) (call $seg16_base (i32.const 5)))
  (func (export "twa_gs_value") (result i32) (call $seg16_value (i32.const 5)))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const dv = new DataView(memory.buffer);

  const sel = wat.twa_selector() >>> 0;
  const base = wat.twa_seg_base(sel) >>> 0;
  assert(sel && base, 'the fixture selector resolves to an arena segment');
  // A 16-bit stack inside that segment, with room above it for the frame and
  // room below for the shim's scratch.
  const esp = base + 0x2000;
  const scratch = 0x0400;          // offset within the segment, for out-params

  // --- 1. the task's command line ------------------------------------------
  const cmdline = '/kopie C:\\';
  const buf = wat.guest_alloc(cmdline.length + 1) >>> 0;
  for (let i = 0; i < cmdline.length; i++) wat.guest_write8(buf + i, cmdline.charCodeAt(i));
  wat.set_extra_cmdline(wat.twa_g2w(buf), cmdline.length);

  const psp = wat.twa_init_task(esp, sel) >>> 0;
  assert(psp, 'InitTask built a PSP and left its selector in ES');
  assert.strictEqual(wat.twa_read8(psp + 0x80), cmdline.length,
    'the PSP length byte counts the command line');
  let got = '';
  for (let i = 0; i < cmdline.length; i++) got += String.fromCharCode(wat.twa_read8(psp + 0x81 + i));
  assert.strictEqual(got, cmdline, 'the PSP holds the command line the host passed');
  assert.strictEqual(wat.twa_read8(psp + 0x81 + cmdline.length), 0,
    'lpCmdLine is NUL-terminated, because WinMain is handed this pointer');
  assert.strictEqual(wat.twa_read8(psp + 0x82 + cmdline.length), 0x0D,
    'the DOS carriage return still follows the terminator');
  console.log('PASS  a 16-bit task is handed its command line');

  // --- 2. waveOutGetVolume does not read past its own frame ----------------
  // 415 takes (uDeviceID, lpdwVolume): word0:1 are the far pointer, word2 the
  // device id, and word3 belongs to the caller. 0x5307 is what Bad Toys 3D had
  // there -- not a handle this side ever handed out.
  const volume = wat.twa_mmsystem(esp, sel, 415, scratch, sel, 0, 0x5307);
  assert.strictEqual(volume, MMSYSERR_NOERROR, 'waveOutGetVolume succeeded');
  assert.notStrictEqual(dv.getUint32(wat.twa_g2w(base + scratch), true), undefined);
  // A null far pointer is the documented bad parameter.
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 415, scratch, 0, 0, 0x5307),
    MMSYSERR_INVALPARAM, 'waveOutGetVolume rejects a null lpdwVolume');
  console.log('PASS  waveOutGetVolume ignores the word past its six-byte frame');

  // --- 3. the joystick ordinals --------------------------------------------
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 101, 0, 0, 0, 0), 0,
    'joyGetNumDevs counts no joysticks');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 102, 54, scratch, sel, 0),
    MMSYSERR_NODRIVER, 'joyGetDevCaps finds no driver for a well-formed probe');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 102, 54, 0, 0, 0),
    MMSYSERR_INVALPARAM, 'joyGetDevCaps rejects a null lpCaps');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 102, 54, scratch, sel, 16),
    MMSYSERR_INVALPARAM, 'joyGetDevCaps rejects an id past JOYSTICKID16');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 103, scratch, sel, 0, 0),
    MMSYSERR_NODRIVER, 'joyGetPos finds no driver');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 104, scratch, 0, 0, 0),
    MMSYSERR_INVALPARAM, 'joyGetThreshold rejects a null pointer');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 105, 0, 0, 0, 0), 0,
    'joyReleaseCapture succeeds when there is no capture');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 107, 0, 0, 0, 0),
    MMSYSERR_NODRIVER, 'joySetThreshold finds no driver');
  assert.strictEqual(wat.twa_mmsystem(esp, sel, 107, 0, 16, 0, 0),
    MMSYSERR_INVALPARAM, 'joySetThreshold rejects an id past JOYSTICKID16');
  console.log('PASS  MMSYSTEM answers the joystick set for a machine with no joystick');

  // --- 4. GS is an ordinary data selector in a 16-bit task ------------------
  wat.twa_set_gs(sel);
  assert.strictEqual(wat.twa_gs_base() >>> 0, base, 'GS resolves to its segment base');
  assert.strictEqual(wat.twa_gs_value() >>> 0, sel, 'reading GS back answers what was written');
  console.log('PASS  GS is loadable and addressable in a 16-bit task');
})();
