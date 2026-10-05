#!/usr/bin/env node
'use strict';

// Exclusive DirectDraw primary pixels are valid backing for Storm-style
// borderless menus. They must never be copied over a captioned dialog after
// that dialog has painted its own client.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dx_overlay_window")
      (param $hwnd i32) (param $style i32) (param $target i32) (result i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (call $dx_overlay_needs_primary_seed (local.get $hwnd) (local.get $target)))

  (func (export "test_dx_overlay_child")
      (param $parent i32) (param $child i32) (param $target i32) (result i32)
    (call $wnd_table_set (local.get $parent) (global.get $WNDPROC_BUILTIN))
    (call $wnd_table_set (local.get $child) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $parent) (i32.const 0x90000000)))
    (drop (call $wnd_set_style (local.get $child) (i32.const 0x50000000)))
    (call $wnd_set_parent (local.get $child) (local.get $parent))
    (call $dx_overlay_needs_primary_seed (local.get $child) (local.get $target)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const target = 0x10001;
  const popup = 0x10002;
  const dialog = 0x10003;

  assert.strictEqual(wat.test_dx_overlay_window(popup, 0x90000000, target), 1,
    'visible borderless WS_POPUP must retain primary-backed Storm menu behavior');
  assert.strictEqual(wat.test_dx_overlay_window(dialog, 0x90C80000, target), 0,
    'WS_CAPTION dialog must keep its painted client instead of each new primary frame');
  assert.strictEqual(wat.test_dx_overlay_window(target, 0x90000000, target), 0,
    'the DirectDraw target itself is not an overlay');
  assert.strictEqual(wat.test_dx_overlay_child(popup, 0x10004, target), 0,
    'child controls must not be independently seeded from the primary');
  assert.strictEqual(wat.test_dx_overlay_window(0, 0x90000000, target), 0,
    'NULL is never an overlay window');

  console.log('PASS  DirectDraw reseeds borderless overlays but preserves captioned dialogs');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
