#!/usr/bin/env node
'use strict';

// Ending a dialog tears its window tree down through $wnd_destroy_tree, and
// every window it removes has to leave the renderer too. A wizard page is a
// grandchild: dialog -> frame control (a WAT-native child the renderer never
// registered) -> page created with CreateDialog (a renderer window). The
// caller's single host_destroy_window on the dialog cannot reach the page
// through the renderer's parent links, so the page used to survive the
// wizard. Unreal Tournament's last setup-wizard page then sat over the game
// window and won every hit test, and no click ever reached the game.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_tg_make") (param $parent i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (if (local.get $parent)
      (then (call $wnd_set_parent (local.get $hwnd) (local.get $parent))))
    (local.get $hwnd))
  (func (export "test_tg_alive") (param $hwnd i32) (result i32)
    (i32.ne (call $wnd_table_get (local.get $hwnd)) (i32.const 0)))
  (func (export "test_tg_teardown") (param $dlg i32)
    (call $wnd_destroy_tree (local.get $dlg))
    (call $host_destroy_window (local.get $dlg)))
`;

(async () => {
  const { exports: e, renderer, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const dialog = e.test_tg_make(0) >>> 0;
  const frame = e.test_tg_make(dialog) >>> 0;
  const page = e.test_tg_make(frame) >>> 0;
  // The renderer knows the dialog and the page, not the frame control.
  renderer.createWindow(dialog, 0x90c80000, 0, 0, 400, 300, 'Wizard', 0);
  renderer.createWindow(page, 0x40000000, 10, 10, 300, 200, '', 0);
  renderer.windows[page].parentHwnd = frame;
  renderer.windows[page].isChild = true;
  assert(renderer.windows[dialog] && renderer.windows[page], 'fixture windows registered');
  assert(!renderer.windows[frame], 'frame control is WAT-only');

  e.test_tg_teardown(dialog);

  assert.strictEqual(e.test_tg_alive(dialog), 0, 'dialog left the window table');
  assert.strictEqual(e.test_tg_alive(frame), 0, 'frame left the window table');
  assert.strictEqual(e.test_tg_alive(page), 0, 'page left the window table');
  assert(!renderer.windows[dialog], 'dialog left the renderer');
  assert(!renderer.windows[page],
    'grandchild page left the renderer (it used to stay and swallow input)');

  console.log('PASS  dialog teardown removes renderer grandchildren');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
