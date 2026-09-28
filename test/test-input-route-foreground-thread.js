#!/usr/bin/env node
'use strict';

// A hardware key belongs to the foreground thread, whichever guest thread's
// message call happens to poll the shared host input FIFO first.
//
// Moorhuhn 1 runs a WinSock helper thread whose only window is a hidden
// "WinSock Window" and whose GetMessage loop (0x418b12) wakes whenever host
// input is queued. With the present cap on, the main thread sleeps ~15 of
// every 16ms, so that helper usually won the race for a key. It has no focus,
// so the key resolved to hwnd 0, and $input_route_to_owner then fell back to
// the helper's OWN $main_hwnd -- per instance, i.e. the socket window -- and
// kept the key. The main thread's WH_KEYBOARD hook never saw Space and the
// title never started. This drives $input_route_to_owner directly with that
// two-thread window table.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');
const MAIN_TID = 1;
const HELPER_TID = 2;
const GAME_HWND = 0x10002;     // main thread's window, the foreground one
const SOCKET_HWND = 0x18001;   // helper thread's hidden window
const WM_KEYDOWN = 0x0100;
const WM_LBUTTONDOWN = 0x0201;
const VK_SPACE = 0x20;
const KEY_LPARAM = 0x00390001;

const extraWat = String.raw`
  (func (export "test_set_tid") (param $tid i32)
    (global.set $current_thread_id (local.get $tid)))
  (func (export "test_add_window") (param $hwnd i32)
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000)))
  (func (export "test_set_input_state")
      (param $main i32) (param $focus i32) (param $pending_hwnd i32) (param $lparam i32)
    (global.set $main_hwnd (local.get $main))
    (global.set $focus_hwnd (local.get $focus))
    (global.set $pending_input_hwnd (local.get $pending_hwnd))
    (global.set $pending_input_lparam (local.get $lparam))
    (global.set $pending_input_packed (i32.const 0)))
  (func (export "test_route") (param $packed i32) (result i32)
    (call $input_route_to_owner (local.get $packed)))
  (func (export "test_pending_packed") (result i32)
    (global.get $pending_input_packed))
  (func (export "test_take_queued") (param $tid i32) (param $msg_ptr i32) (result i32)
    (call $shared_post_queue_peek_tid (local.get $tid) (local.get $msg_ptr)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 1)))
  (func (export "test_queued_input_flags") (result i32)
    (global.get $user_queue_input_flags))
`;

(async () => {
  let foreground = GAME_HWND;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: { foreground_window: () => foreground },
  });
  const { exports: e, memory } = harness;

  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes the guest heap');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const view = new DataView(memory.buffer);
  const msg = e.guest_alloc(28) >>> 0;
  const field = off => view.getUint32((msg + off - imageBase + guestBase) >>> 0, true);
  const keyDown = ((VK_SPACE << 16) | WM_KEYDOWN) >>> 0;

  e.test_set_tid(MAIN_TID);
  e.test_add_window(GAME_HWND);
  e.test_set_tid(HELPER_TID);
  e.test_add_window(SOCKET_HWND);

  const drain = tid => { while (e.test_take_queued(tid, msg)) { /* discard */ } };
  const reset = () => { drain(MAIN_TID); drain(HELPER_TID); };

  // 1. The Moorhuhn case: the focusless helper polls a key while the game's
  //    window is foreground. It must hand the key to the main thread's queue,
  //    flagged as hardware input so that thread's WH_KEYBOARD hook runs.
  reset();
  e.test_set_tid(HELPER_TID);
  e.test_set_input_state(SOCKET_HWND, 0, 0, KEY_LPARAM);
  assert.strictEqual(e.test_route(keyDown) >>> 0, 0,
    'a focusless helper thread does not keep a key the foreground thread owns');
  assert.strictEqual(e.test_pending_packed() >>> 0, 0, 'the routed key is not retained for a retry');
  assert.strictEqual(e.test_take_queued(HELPER_TID, msg), 0, 'nothing lands in the helper queue');
  assert.strictEqual(e.test_take_queued(MAIN_TID, msg), 1, 'the key lands in the main thread queue');
  assert.strictEqual(e.test_queued_input_flags(), 1, 'it is marked as hardware input');
  assert.strictEqual(field(0), GAME_HWND, 'addressed to the foreground window');
  assert.strictEqual(field(4), WM_KEYDOWN);
  assert.strictEqual(field(8), VK_SPACE);
  assert.strictEqual(field(12), KEY_LPARAM, 'lParam (the hook reads its transition bit) survives');

  // 2. The foreground window's own thread keeps a key it polled itself,
  //    exactly as before (its GetMessage delivers it to its focus/main).
  reset();
  e.test_set_tid(MAIN_TID);
  e.test_set_input_state(GAME_HWND, 0, 0, KEY_LPARAM);
  assert.strictEqual(e.test_route(keyDown) >>> 0, keyDown, 'the foreground thread keeps its key');
  assert.strictEqual(e.test_take_queued(MAIN_TID, msg), 0, 'and does not queue it to itself');

  // 3. A thread that has the focus keeps the key: focus names the target.
  reset();
  e.test_set_tid(HELPER_TID);
  e.test_set_input_state(SOCKET_HWND, SOCKET_HWND, SOCKET_HWND, KEY_LPARAM);
  assert.strictEqual(e.test_route(keyDown) >>> 0, keyDown, 'a key resolved to the poller\'s focus stays');
  assert.strictEqual(e.test_take_queued(MAIN_TID, msg), 0);

  // 4. The foreground rule is for keyboard input only; mouse routing is by
  //    the hit-tested window and is untouched.
  reset();
  e.test_set_tid(HELPER_TID);
  e.test_set_input_state(SOCKET_HWND, 0, 0, 0);
  const click = WM_LBUTTONDOWN >>> 0;
  assert.strictEqual(e.test_route(click) >>> 0, click, 'mouse input is not rerouted by focus rules');
  assert.strictEqual(e.test_take_queued(MAIN_TID, msg), 0);

  // 5. With no foreground window (or one that is not a live guest window)
  //    the old per-thread fallback still applies.
  for (const fg of [0, 0x2abcd]) {
    reset();
    foreground = fg;
    e.test_set_tid(HELPER_TID);
    e.test_set_input_state(SOCKET_HWND, 0, 0, KEY_LPARAM);
    assert.strictEqual(e.test_route(keyDown) >>> 0, keyDown,
      `foreground 0x${fg.toString(16)}: falls back to the poller's main window`);
    assert.strictEqual(e.test_take_queued(MAIN_TID, msg), 0);
  }

  console.log('PASS input routing: focusless helper thread hands keys to the foreground thread');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
