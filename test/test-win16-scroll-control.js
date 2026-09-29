#!/usr/bin/env node
'use strict';

// Two things a scroll-bar *control* needs for Civilization II's Tax Rate
// sliders to work:
//
// 1. SetScrollPos/SetScrollRange(hwnd, SB_CTL, ...) must use the record the
//    control paints from. That record is chosen by the SBS_VERT style bit, not
//    by "nBar is nonzero", so a horizontal control's thumb stayed at 0.
// 2. WM_HSCROLL/WM_VSCROLL are packed differently in Win16: wParam = code,
//    lParam = MAKELONG(pos, hwndCtl). With the Win32 lParam the task could not
//    tell which bar moved and ignored every arrow click.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_make") (param $hwnd i32) (param $style i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style))))
  (func (export "t_set_range") (param $hwnd i32) (param $bar i32) (param $min i32) (param $max i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_SetScrollRange (local.get $hwnd) (local.get $bar)
      (local.get $min) (local.get $max) (i32.const 0) (i32.const 0)))
  (func (export "t_set_pos") (param $hwnd i32) (param $bar i32) (param $pos i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_SetScrollPos (local.get $hwnd) (local.get $bar)
      (local.get $pos) (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "t_get_pos") (param $hwnd i32) (param $bar i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_GetScrollPos (local.get $hwnd) (local.get $bar)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_record") (param $hwnd i32) (param $vert i32) (param $field i32) (result i32)
    (i32.load (i32.add
      (call $scroll_bar_addr (call $wnd_table_find (local.get $hwnd)) (local.get $vert))
      (i32.shl (local.get $field) (i32.const 2)))))
  (func (export "t_lparam16") (param $msg i32) (param $wparam i32) (param $lparam i32) (result i32)
    (call $win16_msg_lparam16_cmd (local.get $msg) (local.get $wparam) (local.get $lparam)))
  (func (export "t_h16") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, width: 64, height: 48 });
  const SB_CTL = 2;
  const HORZ = 0x50000000, VERT = 0x50000001;

  e.t_make(0x10041, HORZ);
  e.t_set_range(0x10041, SB_CTL, 0, 10);
  e.t_set_pos(0x10041, SB_CTL, 4);
  assert.strictEqual(e.t_record(0x10041, 0, 0), 4, 'a horizontal control moves its horizontal record');
  assert.strictEqual(e.t_record(0x10041, 0, 2), 10, 'and takes the range there too');
  assert.strictEqual(e.t_get_pos(0x10041, SB_CTL), 4, 'GetScrollPos reads the same record back');

  e.t_make(0x10042, VERT);
  e.t_set_range(0x10042, SB_CTL, 0, 20);
  e.t_set_pos(0x10042, SB_CTL, 7);
  assert.strictEqual(e.t_record(0x10042, 1, 0), 7, 'a vertical control moves its vertical record');
  assert.strictEqual(e.t_record(0x10042, 1, 2), 20, 'and takes the range there too');

  // Win32 wParam = MAKEWPARAM(SB_THUMBTRACK, 37), lParam = hwndCtl.
  const h16 = e.t_h16(0x10041) & 0xffff;
  assert.strictEqual(e.t_lparam16(0x0114, (37 << 16) | 5, 0x10041) >>> 0, ((h16 << 16) | 37) >>> 0,
    'WM_HSCROLL lParam is MAKELONG(pos, hwndCtl)');
  assert.strictEqual(e.t_lparam16(0x0115, 1, 0) >>> 0, 0,
    'a window\'s own scroll bar has no control in the high word');
  assert.strictEqual(e.t_lparam16(0x0111, 0x0001000b, 0) >>> 0, 0, 'WM_COMMAND from a menu is unchanged');

  console.log('PASS Win16 scroll-bar controls keep their thumb and report which bar moved');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
