#!/usr/bin/env node
'use strict';

// $wnd_child_from_point_deep -- the hit test the renderer routes every mouse
// click through -- must hand the point to the TOPMOST overlapping sibling,
// the way USER's WindowFromPoint does.
//
// It used to take the first child in slot order, which is creation order.
// Civilization II opens its city screen as a child covering the whole main
// window, on top of the map screen's World/Status panels, which were created
// first. Every click on the city screen's Rename/Buy/Change/Exit buttons went
// to the Status panel underneath, and the game answered "You must close the
// City Window before the game can proceed."

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat: `
    (func (export "test_make_window")
        (param $hwnd i32) (param $parent i32) (param $style i32)
        (param $x i32) (param $y i32) (param $w i32) (param $h i32)
      (local $slot i32)
      (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
      (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
      (call $wnd_set_parent (local.get $hwnd) (local.get $parent))
      (local.set $slot (call $wnd_table_find (local.get $hwnd)))
      (call $ctrl_geom_set (local.get $slot)
        (local.get $x) (local.get $y) (local.get $w) (local.get $h))
      (call $client_rect_set (local.get $hwnd)
        (i32.const 0) (i32.const 0) (local.get $w) (local.get $h)))
  ` });

  const V = WS_CHILD | WS_VISIBLE;
  const main = 0x10001, status = 0x10002, statusKid = 0x10003;
  const city = 0x10004, rename = 0x10005;
  e.test_make_window(main, 0, WS_VISIBLE, 0, 0, 640, 480);
  // The map screen's Status panel and something inside it, created first.
  e.test_make_window(status, main, V, 454, 135, 178, 299);
  e.test_make_window(statusKid, status, V, 0, 0, 178, 299);
  // The city window, created later over the whole client, and its button.
  e.test_make_window(city, main, V, 0, 0, 640, 454);
  e.test_make_window(rename, city, V, 583, 413, 57, 24);

  assert(e.wnd_z_get(city) > e.wnd_z_get(status),
    'precondition: the later sibling is above the earlier one');
  assert.strictEqual(e.wnd_child_from_point_deep(main, 600, 420) >>> 0, rename,
    'a click on the city window\'s button reaches the button, not the panel below');
  assert.strictEqual(e.wnd_child_from_point_deep(main, 500, 200) >>> 0, city,
    'a click on bare city window stays on the city window');
  assert.strictEqual(e.wnd_child_from_point_deep(main, 10, 470) >>> 0, 0,
    'a point under no child is no hit');

  console.log('PASS  deep child hit test takes the topmost overlapping sibling');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
