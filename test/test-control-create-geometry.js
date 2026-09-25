#!/usr/bin/env node
'use strict';

// Two USER geometry rules a control's own window procedure enforces, both
// found in SimCity 2000 Network Edition's chat window, whose transcript never
// painted:
//
//   1. SCROLLBAR with SBS_VERT|SBS_RIGHTALIGN (or LEFTALIGN, or the SBS_HORZ
//      TOP/BOTTOMALIGN pair on the same bits) takes the standard thickness
//      along that edge of the rect it was created with. The chat log bar is
//      created 0x0 and never moved again; it stayed 0 wide.
//   2. A drop-down COMBOBOX's window is the closed field no matter what cy a
//      later MoveWindow/SetWindowPos passes -- that cy is the dropped list's
//      extent. The chat recipient combo grew to its dropped height after the
//      app laid it out and covered the transcript underneath it.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_parent") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x10000000)))
    (local.get $h))

  (func (export "test_create_child")
      (param $class i32) (param $style i32) (param $parent i32) (param $stack i32)
      (param $x i32) (param $y i32) (param $cx i32) (param $cy i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00ABCDEF))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $y))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $cx))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (local.get $cy))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36)) (local.get $parent))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 40)) (i32.const 0x65))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 44)) (global.get $image_base))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 48)) (i32.const 0))
    (call $handle_CreateWindowExA
      (i32.const 0) (local.get $class) (i32.const 0)
      (local.get $style) (local.get $x) (i32.const 0)))

  (func (export "test_move") (param $hwnd i32) (param $x i32) (param $y i32) (param $cx i32) (param $cy i32) (result i32)
    (call $move_window_core (local.get $hwnd) (i32.const 0)
      (local.get $x) (local.get $y) (local.get $cx) (local.get $cy)
      (i32.const 0x1c) (i32.const 0)))

  (func (export "test_xy") (param $hwnd i32) (result i32) (call $ctrl_get_xy_packed (local.get $hwnd)))
  (func (export "test_wh") (param $hwnd i32) (result i32) (call $ctrl_get_wh_packed (local.get $hwnd)))
  (func (export "test_combo_lb") (param $hwnd i32) (result i32)
    (call $cb_lb_hwnd (call $g2w (call $wnd_get_state_ptr (local.get $hwnd)))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const parent = e.test_parent();
  const cls = name => {
    const p = e.guest_alloc(16) >>> 0;
    Buffer.from(name + '\0', 'latin1').forEach((b, i) => e.guest_write8(p + i, b));
    return p;
  };
  const stack = () => (e.guest_alloc(0x400) >>> 0) + 0x300;
  const xy = h => { const v = e.test_xy(h) >>> 0; return [v & 0xffff, v >>> 16]; };
  const wh = h => { const v = e.test_wh(h) >>> 0; return [v & 0xffff, v >>> 16]; };
  const create = (name, style, x, y, cx, cy) => {
    e.test_create_child(cls(name), style, parent, stack(), x, y, cx, cy);
    const h = e.get_eax() >>> 0;
    assert.ok(h, `CreateWindowExA(${name}) returned a window`);
    return h;
  };

  // --- SCROLLBAR alignment styles ------------------------------------------
  let h = create('SCROLLBAR', 0x50000005, 40, 10, 100, 80);   // SBS_VERT|SBS_RIGHTALIGN
  assert.deepStrictEqual([xy(h), wh(h)], [[123, 10], [17, 80]], 'right-aligned vertical bar');
  h = create('SCROLLBAR', 0x50000003, 40, 10, 100, 80);       // SBS_VERT|SBS_LEFTALIGN
  assert.deepStrictEqual([xy(h), wh(h)], [[40, 10], [17, 80]], 'left-aligned vertical bar');
  h = create('SCROLLBAR', 0x50000004, 40, 10, 100, 80);       // SBS_HORZ|SBS_BOTTOMALIGN
  assert.deepStrictEqual([xy(h), wh(h)], [[40, 73], [100, 17]], 'bottom-aligned horizontal bar');
  h = create('SCROLLBAR', 0x50000005, 0, 0, 0, 0);            // SimCity's 0x0 chat-log bar
  assert.deepStrictEqual(wh(h), [17, 0], 'a 0x0 right-aligned bar still gets its width');
  h = create('SCROLLBAR', 0x50000001, 40, 10, 15, 24);        // plain SBS_VERT keeps its rect
  assert.deepStrictEqual([xy(h), wh(h)], [[40, 10], [15, 24]], 'unaligned bar is left alone');
  console.log('PASS  SBS_*ALIGN scroll bars take the standard thickness at creation');

  // --- Drop-down combo keeps its field height when moved -------------------
  h = create('COMBOBOX', 0x50200003, 10, 10, 120, 100);       // CBS_DROPDOWNLIST
  assert.deepStrictEqual(wh(h), [120, 21], 'created at field height');
  assert.strictEqual(e.test_move(h, 10, 30, 150, 200), 1);
  assert.deepStrictEqual([xy(h), wh(h)], [[10, 30], [150, 21]], 'MoveWindow keeps the field height');
  const lb = e.test_combo_lb(h) >>> 0;
  assert.deepStrictEqual(wh(lb), [150, 179], 'the list takes the requested dropped extent');
  const simple = create('COMBOBOX', 0x50200001, 10, 10, 120, 100); // CBS_SIMPLE
  e.test_move(simple, 10, 10, 120, 140);
  assert.deepStrictEqual(wh(simple), [120, 140], 'CBS_SIMPLE is as tall as asked');
  console.log('PASS  drop-down combobox stays at field height through MoveWindow');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
