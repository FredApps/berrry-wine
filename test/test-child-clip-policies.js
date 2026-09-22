#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (func (export "test_parent") (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $hwnd) (i32.const 0)
      (i32.const 0) (i32.const 64) (i32.const 64) (i32.const 0))
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (local.get $hwnd))
  (func (export "test_child") (param $parent i32) (param $x i32) (param $y i32)
      (param $w i32) (param $h i32) (param $style i32) (result i32)
    (call $ctrl_create_child (local.get $parent) (i32.const 4) (i32.const 101)
      (local.get $x) (local.get $y) (local.get $w) (local.get $h)
      (local.get $style) (i32.const 0)))
  (func (export "test_clip") (param $dc i32) (param $parent i32)
      (param $erase i32) (param $style i32) (param $x i32) (param $y i32)
    (drop (call $wnd_set_style (local.get $parent) (local.get $style)))
    (drop (call $gdi_dc_system_clip_reset (local.get $dc)))
    (drop (call $gdi_dc_system_clip_rect (local.get $dc)
      (i32.const 0) (i32.const 0) (i32.const 64) (i32.const 64) (i32.const 1)))
    (if (local.get $erase)
      (then (call $dc_exclude_visible_children_for_erase (local.get $dc) (local.get $parent) (local.get $x) (local.get $y)))
      (else (call $dc_exclude_children_for_clip (local.get $dc) (local.get $parent) (local.get $x) (local.get $y)))))
  (func (export "test_visible") (param $dc i32) (param $x i32) (param $y i32) (result i32)
    (call $gdi_dc_clip_device_point_visible (local.get $dc) (local.get $x) (local.get $y)))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const parent = e.test_parent(), other = e.test_parent();
  const visible = [[2, 3, 8, 9], [7, 8, 10, 11], [-3, -2, 7, 6]];
  for (const r of visible) assert(e.test_child(parent, ...r, 0x50000000));
  assert(e.test_child(parent, 30, 30, 8, 8, 0x40000000), 'hidden child');
  assert(e.test_child(parent, 25, 25, 0, 8, 0x50000000), 'zero-width child');
  assert(e.test_child(other, 40, 40, 8, 8, 0x50000000), 'other parent child');
  const dc = e.test_call_CreateCompatibleDC(0);
  assert(dc);
  const bmi = e.guest_alloc(40), bits = e.guest_alloc(4);
  [40, 64, -64, 0x200001].forEach((v, i) => e.guest_write32(bmi + 4 * i, v));
  const bitmap = e.test_call_CreateDIBSection(0, bmi, 0, bits, 0, 0);
  assert(bitmap);
  e.test_call_SelectObject(dc, bitmap);
  let checked = 0;
  for (const erase of [0, 1]) for (const clipChildren of [false, true]) {
    for (const [ox, oy] of [[0, 0], [11, 13], [-4, -6]]) {
      e.test_clip(dc, parent, erase, 0x10000000 | (clipChildren ? 0x02000000 : 0), ox, oy);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const excluded = (erase || clipChildren) && visible.some(([cx, cy, w, h]) =>
          x >= ox + cx && x < ox + cx + w && y >= oy + cy && y < oy + cy + h);
        assert.strictEqual(e.test_visible(dc, x, y) !== 0, !excluded,
          `erase=${erase} clipChildren=${clipChildren} origin=${ox},${oy} point=${x},${y}`);
        checked++;
      }
    }
  }
  console.log(`PASS ${checked} child-clip points: policy, visibility, overlap, size, parent and origin`);
})().catch(error => { console.error(error); process.exit(1); });
