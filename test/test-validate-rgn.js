#!/usr/bin/env node
'use strict';

// ValidateRgn(hwnd, hrgn): the update region is one rectangle here, so a
// region validates its bounding box (the reduction InvalidateRgn makes too),
// NULL validates the whole client area, and the window stops owing a paint
// once nothing is left. Dark Earth's demo calls it after drawing its window.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_window") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $h) (i32.const 0)
      (i32.const 0) (i32.const 32) (i32.const 24) (i32.const 0))
    (call $wnd_table_set (local.get $h) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x90000000)))
    (call $client_rect_set (local.get $h) (i32.const 0) (i32.const 0) (i32.const 32) (i32.const 24))
    (local.get $h))
  (func (export "t_damage") (param $h i32)
    (call $update_invalidate_rect (local.get $h) (i32.const 3) (i32.const 4) (i32.const 12) (i32.const 15))
    (call $paint_flag_set (local.get $h)))
  (func (export "t_pending") (param $h i32) (result i32)
    (call $update_get_rect (local.get $h) (i32.const 0)))
  (func (export "t_rect_rgn") (param $l i32) (param $t i32) (param $r i32) (param $b i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateRectRgn (local.get $l) (local.get $t) (local.get $r) (local.get $b)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "t_validate_rgn") (param $h i32) (param $rgn i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_ValidateRgn (local.get $h) (local.get $rgn)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.add (local.get $sp) (i32.const 12)))
      (then (unreachable)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const h = e.t_window();

  e.t_damage(h);
  assert(e.t_pending(h), 'damage is pending');
  const small = e.t_rect_rgn(0, 0, 4, 4);
  assert.strictEqual(e.t_validate_rgn(h, small), 1, 'TRUE, stdcall pops two args');
  assert(e.t_pending(h), 'a region covering part of the damage leaves the rest owed');
  const cover = e.t_rect_rgn(0, 0, 20, 20);
  e.t_validate_rgn(h, cover);
  assert(!e.t_pending(h), 'a region covering the damage validates it');

  e.t_damage(h);
  e.t_validate_rgn(h, 0);
  assert(!e.t_pending(h), 'NULL validates the whole client area');

  assert.strictEqual(e.t_validate_rgn(0, 0), 1, 'NULL hwnd is TRUE');
  console.log('PASS  ValidateRgn validates its bounding box, NULL the whole client area');
})().catch(error => { console.error(error); process.exit(1); });
