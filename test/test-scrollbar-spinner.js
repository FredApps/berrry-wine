#!/usr/bin/env node
'use strict';

// A SCROLLBAR control shorter than two 16px arrows is a spinner: USER splits
// its length between the arrows, (len - 4) / 2 each, and draws no thumb once
// under 6px of track is left. SimCity 2000's Budget window is six 15x24
// SBS_VERT bars built exactly that way. With arrows dropped below 36px, the
// control had nothing to paint and every click hit-tested as "nothing", so
// the tax and funding rates could not be changed at all.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_sb_arrow_size") (param $len i32) (result i32)
    (call $scrollbar_arrow_size (local.get $len)))
  (func (export "test_sb_thumb_size") (param $len i32) (param $range i32) (result i32)
    (call $scrollbar_thumb_size (local.get $len) (local.get $range)))
  (func (export "test_sb_page_thumb") (param $len i32) (result i32)
    (call $sb_page_thumb (call $sb_track_len (local.get $len)) (i32.const 1) (i32.const 101)))

  ;; A dialog-like parent holding one 15x24 vertical scrollbar control.
  (func (export "test_sb_spinner_setup") (result i32)
    (local $top i32)
    (local.set $top (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $top) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $top) (i32.const 0x10000000)))
    (call $ctrl_create_child
      (local.get $top) (i32.const 7) (i32.const 440)
      (i32.const 135) (i32.const 65) (i32.const 15) (i32.const 24)
      (i32.const 0x50000001) (i32.const 0)))
  (func (export "test_sb_press") (param $hwnd i32) (param $y i32) (result i32)
    (local $part i32)
    (drop (call $scrollbar_ctrl_wndproc (local.get $hwnd) (i32.const 0x0201) (i32.const 1)
      (i32.or (i32.const 7) (i32.shl (local.get $y) (i32.const 16)))))
    (local.set $part (global.get $sb_pressed_part))
    (drop (call $scrollbar_ctrl_wndproc (local.get $hwnd) (i32.const 0x0202) (i32.const 0)
      (i32.or (i32.const 7) (i32.shl (local.get $y) (i32.const 16)))))
    (local.get $part))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  // Arrow length: full-size arrows above 36px, shared below, none at <=4px.
  assert.strictEqual(e.test_sb_arrow_size(100), 16);
  assert.strictEqual(e.test_sb_arrow_size(37), 16);
  assert.strictEqual(e.test_sb_arrow_size(36), 16);
  assert.strictEqual(e.test_sb_arrow_size(24), 10, '24px spinner: two 10px arrows');
  assert.strictEqual(e.test_sb_arrow_size(20), 8);
  assert.strictEqual(e.test_sb_arrow_size(4), 0);

  // No thumb in a 4px track (both geometry models), a normal thumb in a long bar.
  assert.strictEqual(e.test_sb_thumb_size(24, 100), 0, 'spinner has no thumb');
  assert.strictEqual(e.test_sb_page_thumb(24), 0, 'SCROLLINFO spinner has no thumb');
  assert.strictEqual(e.test_sb_thumb_size(100, 100), 16);

  // Hit test along the 24px axis: up arrow [0,10), gap, down arrow [14,24).
  assert.strictEqual(e.scrollbar_hit_part(24, 3, 7, 0, 20), 1, 'upper half hits the up arrow');
  assert.strictEqual(e.scrollbar_hit_part(24, 20, 7, 0, 20), 2, 'lower half hits the down arrow');
  assert.strictEqual(e.scrollbar_hit_part(24, 12, 7, 0, 20), 0, 'the 4px gap is no part');

  // A real press on the control is taken as an arrow press.
  const hwnd = e.test_sb_spinner_setup();
  assert.ok(hwnd > 0, 'scrollbar control created');
  assert.strictEqual(e.test_sb_press(hwnd, 4), 1, 'press on the upper arrow');
  assert.strictEqual(e.test_sb_press(hwnd, 20), 2, 'press on the lower arrow');

  console.log('PASS  scrollbar spinner: 24px SBS_VERT bar has two 10px arrows, no thumb, clickable');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
