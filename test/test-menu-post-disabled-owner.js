#!/usr/bin/env node
'use strict';

// Menu tracking here runs on host input, not synchronously inside the owner's
// DefWindowProc as in real USER, so the WM_COMMAND a menu pick posts can sit
// in the queue while the guest is busy. Civilization II (Win16) ends a turn
// with an AI news box: it disables the main window, then pumps its own modal
// loop -- and that pump retrieved a Save Game command picked moments earlier.
// Save then ran nested inside the news box's modal before the box had
// painted, and the "Game saved!" modal it opened clobbered the game's single
// current-dialog state, so the news box could never be dismissed.
//
// Windows discards input aimed at a disabled window. Menu output now carries
// its own queue tag, and retrieval discards a tagged message whose target (or
// the WS_CHILD chain above it) is disabled. An ordinary PostMessage to the
// same disabled window is unaffected, and the discarded command does not come
// back when the window is re-enabled.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_make_top") (result i32)
    (local $top i32)
    (local.set $top (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $top) (global.get $WNDPROC_CTRL_NATIVE))
    (local.get $top))
  (func (export "test_make_child") (param $parent i32) (result i32)
    (local $child i32)
    (local.set $child (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $child) (global.get $WNDPROC_CTRL_NATIVE))
    (call $wnd_set_parent (local.get $child) (local.get $parent))
    (drop (call $wnd_set_style (local.get $child) (i32.const 0x50000000)))
    (local.get $child))
  (func (export "test_set_disabled") (param $hwnd i32) (param $on i32)
    (local $style i32)
    (local.set $style (i32.and (call $wnd_get_style (local.get $hwnd)) (i32.const 0xF7FFFFFF)))
    (if (local.get $on)
      ;; WS_DISABLED (bit 27), spelled as a shift: the hex literal equals a region base.
      (then (local.set $style (i32.or (local.get $style) (i32.shl (i32.const 1) (i32.const 27))))))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style))))
  (func (export "test_menu_post") (param $hwnd i32) (param $msg i32) (param $wp i32)
    (call $menu_post (local.get $hwnd) (local.get $msg) (local.get $wp) (i32.const 0)))
  (func (export "test_plain_post") (param $hwnd i32) (param $msg i32) (param $wp i32)
    (drop (call $shared_post_queue_enqueue (local.get $hwnd) (local.get $msg) (local.get $wp) (i32.const 0))))
  (func (export "test_get") (param $buf i32) (param $remove i32) (result i32)
    (call $shared_post_queue_read (local.get $buf) (local.get $remove)))
  (func (export "test_input_flags") (result i32) (global.get $user_queue_input_flags))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const buf = e.guest_alloc(28) >>> 0;
  const drain = () => { while (e.test_get(buf, 1)) { /* discard */ } };
  const next = remove => (e.test_get(buf, remove)
    ? { hwnd: e.guest_read32(buf) >>> 0, msg: e.guest_read32(buf + 4), wp: e.guest_read32(buf + 8) }
    : null);

  const top = e.test_make_top() >>> 0;
  drain();

  // Control: an enabled owner receives its menu command, and the menu tag
  // does not masquerade as hardware input to $user_queue_input_flags readers.
  e.test_menu_post(top, 0x0111, 0x132);
  let m = next(1);
  assert.deepStrictEqual(m, { hwnd: top, msg: 0x0111, wp: 0x132 }, 'enabled owner gets its menu command');
  assert.strictEqual(e.test_input_flags(), 0, 'menu tag is not the input flag');

  // The Civ2 order: pick from the menu, then the owner is disabled by a modal
  // before anything pumps. The modal's pump must not see the command.
  e.test_menu_post(top, 0x0116, 0x80001);      // WM_INITMENU
  e.test_menu_post(top, 0x0111, 0x132);        // WM_COMMAND Save Game
  e.test_plain_post(top, 0x0111, 0x777);       // the app's own PostMessage
  e.test_set_disabled(top, 1);
  m = next(0);
  assert.deepStrictEqual(m, { hwnd: top, msg: 0x0111, wp: 0x777 },
    'PM_NOREMOVE skips stale menu output to a disabled owner');
  m = next(1);
  assert.deepStrictEqual(m, { hwnd: top, msg: 0x0111, wp: 0x777 },
    'PM_REMOVE returns the ordinary post, not the menu command');
  assert.strictEqual(next(1), null, 'nothing else is queued');

  // Discarded, not deferred: re-enabling the owner does not replay it.
  e.test_set_disabled(top, 0);
  assert.strictEqual(next(1), null, 're-enabled owner does not get the stale command');

  // An MDI child's system-menu command is judged by its disabled frame.
  const child = e.test_make_child(top) >>> 0;
  e.test_set_disabled(top, 1);
  e.test_menu_post(child, 0x0112, 0xF060);     // WM_SYSCOMMAND SC_CLOSE
  assert.strictEqual(next(1), null, 'menu output to a child of a disabled frame is discarded');
  e.test_set_disabled(top, 0);
  e.test_menu_post(child, 0x0112, 0xF060);
  assert.deepStrictEqual(next(1), { hwnd: child, msg: 0x0112, wp: 0xF060 },
    'child of an enabled frame gets it');

  console.log('PASS  menu output queued for a window that became disabled is discarded at retrieval');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
