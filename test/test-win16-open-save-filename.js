#!/usr/bin/env node
'use strict';

// COMMDLG.1/.2 GetOpenFileName/GetSaveFileName for a Win16 task. The 16-bit
// OPENFILENAME (far string pointers, word handles, 72 bytes) is turned into
// the 32-bit one the shared Open/Save dialog reads; the chosen name lands in
// the task's own buffer, and the by-value results (nFileOffset,
// nFileExtension, nFilterIndex, Flags) come back when the Win16 modal pump
// resumes the call. Civilization II's Game > Save Game trapped here.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func $t_setup
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 1)))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (global.set $sreg_ds (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ds (i32.const 0x00110000)))

  (func $t_far (param $off i32) (result i32)
    (i32.or (i32.shl (call $win16_index_to_sel (i32.const 2)) (i32.const 16)) (local.get $off)))

  ;; Build the 16-bit OPENFILENAME at DS:0300 and call ordinal $ord with a
  ;; far pointer to it. Returns what the ordinal dispatcher said.
  (func (export "t_call") (param $ord i32) (param $size i32) (result i32)
    (local $o i32) (local $i i32)
    (call $t_setup)
    (local.set $o (i32.const 0x00110300))
    (block $z (loop $l
      (br_if $z (i32.ge_u (local.get $i) (i32.const 0x300)))
      (call $gs8 (i32.add (local.get $o) (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l)))
    (call $gs32 (local.get $o) (local.get $size))
    (call $gs32 (i32.add (local.get $o) (i32.const 8)) (call $t_far (i32.const 0x0400)))  ;; lpstrFilter
    (call $gs32 (i32.add (local.get $o) (i32.const 20)) (i32.const 1))                   ;; nFilterIndex
    (call $gs32 (i32.add (local.get $o) (i32.const 24)) (call $t_far (i32.const 0x0500))) ;; lpstrFile
    (call $gs32 (i32.add (local.get $o) (i32.const 28)) (i32.const 128))                 ;; nMaxFile
    (call $gs32 (i32.add (local.get $o) (i32.const 48)) (i32.const 0x22))  ;; ENABLEHOOK|OVERWRITEPROMPT
    (call $gs32 (i32.add (local.get $o) (i32.const 64)) (call $t_far (i32.const 0x0700))) ;; lpfnHook
    ;; "*.SAV\0*.SAV\0\0" (the rest of the block is already zero)
    (i64.store (call $g2w (i32.const 0x00110400)) (i64.const 0x5641532E2A))
    (i64.store (call $g2w (i32.const 0x00110406)) (i64.const 0x5641532E2A))
    ;; Pascal: far return, then the far pointer argument (offset, selector).
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00110100))
    (call $gs16 (i32.const 0x00110100) (i32.const 0x0010))
    (call $gs16 (i32.const 0x00110102) (call $win16_index_to_sel (i32.const 1)))
    (call $gs16 (i32.const 0x00110104) (i32.const 0x0300))
    (call $gs16 (i32.const 0x00110106) (call $win16_index_to_sel (i32.const 2)))
    (call $win16_commdlg (local.get $ord)))

  (func (export "t_ofn32") (param $off i32) (result i32)
    (if (i32.eqz (global.get $win16_ofn32)) (then (return (i32.const -1))))
    (call $gl32 (i32.add (global.get $win16_ofn32) (local.get $off))))
  (func (export "t_ofn16") (param $off i32) (result i32)
    (call $gl32 (i32.add (i32.const 0x00110300) (local.get $off))))
  (func (export "t_modal_hwnd") (result i32) (global.get $modal_dlg_hwnd))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "t_ax") (result i32) (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_dx") (result i32) (i32.load offset=8 (global.get $reg_base)))
  (func (export "t_eip") (result i32) (global.get $eip))

  ;; What the dialog's OK button leaves in the 32-bit struct, then the modal
  ;; pump turn that splices the far call back together.
  (func (export "t_finish") (param $result i32)
    (call $gs16 (i32.add (global.get $win16_ofn32) (i32.const 56)) (i32.const 3))
    (call $gs16 (i32.add (global.get $win16_ofn32) (i32.const 58)) (i32.const 9))
    (call $gs32 (i32.add (global.get $win16_ofn32) (i32.const 52))
      (i32.or (call $gl32 (i32.add (global.get $win16_ofn32) (i32.const 52))) (i32.const 1)))
    (call $modal_done (local.get $result))
    (call $win16_dispatch (global.get $WIN16_MODAL_PUMP) (i32.const 0)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, width: 64, height: 48 });
  const SEG2 = 0x00110000;

  assert.strictEqual(e.t_call(2, 72), 1, 'COMMDLG.2 is implemented');
  assert.notStrictEqual(e.t_modal_hwnd(), 0, 'the Save As dialog is up');
  assert.strictEqual(e.t_esp() >>> 0, 0x00110108, 'the far return and the far pointer are popped');
  assert.strictEqual(e.t_ofn32(0), 76, 'the dialog sees a 32-bit OPENFILENAME');
  assert.strictEqual(e.t_ofn32(12) >>> 0, SEG2 + 0x400, 'lpstrFilter is widened to a guest address');
  assert.strictEqual(e.t_ofn32(28) >>> 0, SEG2 + 0x500, 'lpstrFile names the task\'s own buffer');
  assert.strictEqual(e.t_ofn32(32), 128, 'nMaxFile carries across');
  assert.strictEqual(e.t_ofn32(24), 1, 'nFilterIndex carries across');
  assert.strictEqual(e.t_ofn32(52) & 0xE0, 0, 'the 16-bit hook flag is not shown to the 32-bit dialog');
  assert.strictEqual(e.t_ofn32(68), 0, 'the 16-bit hook is not handed to the 32-bit dialog');

  e.t_finish(1);
  assert.strictEqual(e.t_modal_hwnd(), 0, 'the dialog is gone');
  assert.strictEqual(e.t_ax() & 0xffff, 1, 'GetSaveFileName returns TRUE in AX');
  assert.strictEqual(e.t_eip() >>> 0, 0x00100010, 'the call resumes at its far return address');
  assert.strictEqual(e.t_ofn16(52) & 0xffff, 3, 'nFileOffset comes back at its 16-bit offset');
  assert.strictEqual(e.t_ofn16(52) >>> 16, 9, 'nFileExtension comes back at its 16-bit offset');
  assert.strictEqual(e.t_ofn16(48), 0x23, 'Flags gets the dialog\'s bits and keeps the hook bit');
  assert.strictEqual(e.t_ofn32(0), -1, 'the 32-bit copy is released');

  assert.strictEqual(e.t_call(1, 0), 1, 'COMMDLG.1 answers a bad lStructSize');
  assert.strictEqual(e.t_ax() & 0xffff, 0, 'and returns FALSE');
  assert.strictEqual(e.t_modal_hwnd(), 0, 'without a dialog');
  assert.strictEqual(e.t_call(26, 72) && e.t_ax() & 0xffff, 1,
    'CommDlgExtendedError reports CDERR_STRUCTSIZE');

  console.log('PASS Win16 GetOpenFileName/GetSaveFileName bridge the 16-bit OPENFILENAME');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
