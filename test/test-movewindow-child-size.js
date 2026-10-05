#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const sizes = new Map();
const positions = new Map();
const moveFlags = [];
const zOrders = [];
const painted = [];
const pack = (w, h) => ((w & 0xffff) | ((h & 0xffff) << 16)) >>> 0;

const extraWat = String.raw`
  (func (export "test_call_MoveWindow")
    (param $hwnd i32) (param $x i32) (param $y i32)
    (param $w i32) (param $h i32) (param $repaint i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (local.get $saved_esp) (i32.const 24)) (local.get $repaint))
    (call $handle_MoveWindow
      (local.get $hwnd) (local.get $x) (local.get $y)
      (local.get $w) (local.get $h) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_call_SetWindowPos")
    (param $hwnd i32) (param $x i32) (param $y i32)
    (param $w i32) (param $h i32) (param $flags i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (local.get $saved_esp) (i32.const 24)) (local.get $h))
    (call $gs32 (i32.add (local.get $saved_esp) (i32.const 28)) (local.get $flags))
    (call $handle_SetWindowPos
      (local.get $hwnd) (i32.const 0) (local.get $x) (local.get $y)
      (local.get $w) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_parent") (param $hwnd i32) (result i32)
    (call $wnd_get_parent (local.get $hwnd)))
  (func (export "test_clear_paints") (param $parent i32)
    (call $paint_clear_subtree (local.get $parent))
    (global.set $paint_pending (i32.const 0)))
  (func (export "test_paint_pending") (param $hwnd i32) (result i32)
    (call $paint_flag_test_hwnd (local.get $hwnd)))
  (func (export "test_reparent") (param $hwnd i32) (param $parent i32)
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent)))
  (func (export "test_take_nc_paint") (param $hwnd i32) (result i32)
    (local $flags i32)
    (local.set $flags (call $nc_flags_test (local.get $hwnd)))
    (call $nc_flags_clear (local.get $hwnd) (i32.const 1))
    (i32.and (local.get $flags) (i32.const 1)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      ctrl_paint_trace(hwnd, classAndReason) {
        if ((classAndReason >>> 8) === 0) painted.push(hwnd >>> 0);
      },
      get_window_client_size(hwnd) {
        return sizes.get(hwnd >>> 0) || 0;
      },
      move_window(hwnd, _x, _y, w, h, flags) {
        hwnd >>>= 0;
        const old = sizes.get(hwnd) || 0;
        const oldW = old & 0xffff;
        const oldH = old >>> 16;
        const nextW = (flags & 0x0001) ? oldW : w;
        const nextH = (flags & 0x0001) ? oldH : h;
        sizes.set(hwnd, pack(nextW, nextH));
        if (!(flags & 0x0002)) positions.set(hwnd, pack(_x, _y));
        moveFlags.push(flags >>> 0);
      },
      set_window_zorder(hwnd, insertAfter) {
        zOrders.push([hwnd >>> 0, insertAfter | 0]);
      },
      get_window_rect(hwnd, out) {
        const xy = positions.get(hwnd >>> 0) || 0;
        const wh = sizes.get(hwnd >>> 0) || 0;
        const view = new DataView(memory.buffer);
        view.setInt32(out, xy << 16 >> 16, true);
        view.setInt32(out + 4, xy >> 16, true);
        view.setInt32(out + 8, (xy << 16 >> 16) + (wh & 0xffff), true);
        view.setInt32(out + 12, (xy >> 16) + (wh >>> 16), true);
      },
    },
  });

  const first = e.test_create_edit(0, 0, 40, 20, 0x50000000, 0) >>> 0;
  const second = e.test_create_edit(0, 0, 50, 25, 0x50000000, 0) >>> 0;
  sizes.set(first, pack(40, 20));
  sizes.set(second, pack(50, 25));
  positions.set(first, pack(0, 0));
  positions.set(second, pack(0, 0));
  e.set_post_queue_count(0);

  assert.strictEqual(e.test_call_MoveWindow(first, 10, 12, 80, 30, 1), 1,
    'first child resize succeeds');
  assert.strictEqual(e.test_call_MoveWindow(second, 20, 24, 90, 35, 0), 1,
    'second child resize succeeds');
  assert.strictEqual(e.get_post_queue_count(), 0,
    'built-in default processing sends geometry messages synchronously');
  assert.strictEqual(positions.get(first), pack(10, 12));
  assert.strictEqual(sizes.get(first), pack(80, 30));
  assert.strictEqual(positions.get(second), pack(20, 24));
  assert.strictEqual(sizes.get(second), pack(90, 35));
  assert.strictEqual(moveFlags[0], 0x14,
    'bRepaint=TRUE keeps redraw enabled while preserving z-order and activation');
  assert.strictEqual(moveFlags[1], 0x1c,
    'bRepaint=FALSE maps to SWP_NOREDRAW');

  e.test_call_MoveWindow(second, 20, 24, 90, 35, 1);
  assert.strictEqual(e.get_post_queue_count(), 0,
    'same-geometry MoveWindow creates no deferred geometry-message loop');

  assert.strictEqual(e.test_call_SetWindowPos(first, 30, 32, 100, 40, 0x14), 1,
    'SetWindowPos move and resize succeeds');
  assert.strictEqual(e.get_post_queue_count(), 0,
    'SetWindowPos default geometry messages are not posted');
  assert.strictEqual(positions.get(first), pack(30, 32));
  assert.strictEqual(sizes.get(first), pack(100, 40));

  e.test_call_SetWindowPos(first, 99, 99, 150, 60, 0x17); // NOMOVE|NOSIZE
  assert.strictEqual(e.get_post_queue_count(), 0,
    'SWP_NOMOVE|SWP_NOSIZE suppress derived WM_MOVE/WM_SIZE');
  assert.deepStrictEqual(zOrders, [],
    'SWP_NOZORDER suppresses the host z-order update');

  const top = e.test_get_parent(first) >>> 0;
  sizes.set(top, pack(40, 20));
  e.test_call_SetWindowPos(top, 99, 99, 150, 60, 0x03); // NOMOVE|NOSIZE
  assert.deepStrictEqual(zOrders, [[top, 0]],
    'top-level SetWindowPos without SWP_NOZORDER moves the window to HWND_TOP');

  e.test_call_SetWindowPos(first, 0, 0, 20, 10, 0x03);
  assert.deepStrictEqual(zOrders, [[top, 0]],
    'child z-order stays in the retained sibling model, not the host global list');

  // Native control geometry cleanup must not enqueue parent/sibling paints
  // when the public API explicitly suppresses redraw.
  e.test_reparent(second, top);
  for (const move of [
    () => e.test_call_SetWindowPos(first, 40, 42, 90, 35, 0x1c),
    () => e.test_call_MoveWindow(first, 50, 52, 80, 30, 0),
    () => e.test_call_SetWindowPos(first, 0, 0, 70, 25, 0x1e), // shrink, NOMOVE
  ]) {
    e.test_clear_paints(top);
    assert.strictEqual(move(), 1);
    for (const hwnd of [top, first, second]) {
      assert.strictEqual(e.test_paint_pending(hwnd), 0,
        `NOREDRAW must not invalidate HWND ${hwnd.toString(16)} (parent=${top.toString(16)}, moved=${first.toString(16)}, sibling=${second.toString(16)})`);
    }
  }
  e.test_clear_paints(top);
  e.test_call_SetWindowPos(first, 60, 62, 60, 20, 0x14);
  assert.strictEqual(e.test_paint_pending(top), 1,
    'ordinary move still invalidates the exposed parent');
  assert.strictEqual(e.test_paint_pending(second), 1,
    'ordinary move still invalidates overlapping sibling coverage');

  e.wnd_set_style_export(top, e.wnd_get_style_export(top) | 0x10000000);
  e.test_take_nc_paint(first);
  e.test_call_SetWindowPos(first, 60, 62, 80, 30, 0x16); // resize, NOMOVE
  assert.strictEqual(e.test_take_nc_paint(first), 1,
    'resizing queues non-client repaint for borders and standard scrollbars');
  e.test_call_SetWindowPos(first, 60, 62, 80, 30, 0x14);
  assert.strictEqual(e.test_take_nc_paint(first), 0,
    'identical geometry does not queue redundant non-client repaint');
  e.test_call_SetWindowPos(first, 70, 72, 90, 40, 0x1c);
  assert.strictEqual(e.test_take_nc_paint(first), 0,
    'NOREDRAW suppresses non-client repaint on a real geometry change');
  e.wnd_set_style_export(top, e.wnd_get_style_export(top) & ~0x10000000);
  e.test_call_SetWindowPos(first, 80, 82, 100, 50, 0x14);
  assert.strictEqual(e.test_take_nc_paint(first), 0,
    'a hidden ancestor suppresses exposure repaint until the tree is shown');
  e.wnd_set_style_export(top, e.wnd_get_style_export(top) | 0x10000000);
  painted.length = 0;
  e.test_call_MoveWindow(first, 80, 82, 110, 60, 1);
  assert.deepStrictEqual(painted, [first],
    'MoveWindow(TRUE) completes the native target paint before returning');
  assert.strictEqual(e.test_take_nc_paint(first), 1,
    'MoveWindow(TRUE) also queues non-client repaint after resizing');
  e.test_call_MoveWindow(first, 80, 82, 110, 60, 1);
  assert.strictEqual(e.test_take_nc_paint(first), 0,
    'same-geometry MoveWindow does not queue non-client repaint');
  painted.length = 0;
  e.test_call_MoveWindow(first, 90, 92, 120, 70, 0);
  assert.deepStrictEqual(painted, [], 'MoveWindow(FALSE) must not paint');
  assert.strictEqual(e.test_take_nc_paint(first), 0,
    'MoveWindow(FALSE) suppresses non-client repaint');

  console.log('PASS MoveWindow/SetWindowPos preserve geometry, repaint, and z-order flags');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
