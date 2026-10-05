#!/usr/bin/env node
'use strict';

// A maximized MDI child's own caption and borders are not on screen. USER
// sizes the child so its CLIENT area is the MDICLIENT's client area -- the
// frame sits outside the MDICLIENT, clipped away -- and the frame's menu bar
// takes over the child's minimize / restore / close buttons at its right end.
//
// Before this, SimCity 2000's maximized city window kept its whole caption
// inside the MDICLIENT: a second title bar under the frame's, eating 24 rows
// of map on a phone that has none to spare, with nothing in the menu bar.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');

const extraWat = String.raw`
  (func $tmmc_make_window (param $parent i32) (param $class i32) (param $style i32) (result i32)
    (local $hwnd i32) (local $slot i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (if (local.get $parent)
      (then (call $wnd_set_parent (local.get $hwnd) (local.get $parent))))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (call $ctrl_table_set (local.get $slot) (local.get $class) (i32.const 0))
    (local.get $hwnd))

  (func (export "tmmc_make_frame") (result i32)
    (call $tmmc_make_window (i32.const 0) (i32.const 0) (i32.const 0x10CF0000)))

  (func (export "tmmc_make_client") (param $frame i32) (result i32)
    (local $client i32) (local $ccs i32) (local $cs i32)
    (local.set $client
      (call $tmmc_make_window (local.get $frame) (i32.const 33) (i32.const 0x56000000)))
    (local.set $ccs (call $heap_alloc (i32.const 8)))
    (local.set $cs (call $heap_alloc (i32.const 48)))
    (call $gs32 (local.get $ccs) (i32.const 0))
    (call $gs32 (i32.add (local.get $ccs) (i32.const 4)) (i32.const 0xFF00))
    (call $gs32 (local.get $cs) (local.get $ccs))
    (drop (call $mdiclient_wndproc
      (local.get $client) (i32.const 1) (i32.const 0) (local.get $cs)))
    (call $client_rect_set (local.get $client) (i32.const 0) (i32.const 0) (i32.const 300) (i32.const 200))
    (local.get $client))

  ;; WS_CHILD | WS_VISIBLE | WS_OVERLAPPEDWINDOW, as MFC creates a document frame.
  (func (export "tmmc_make_child") (param $client i32) (result i32)
    (local $child i32)
    (local.set $child
      (call $tmmc_make_window (local.get $client) (i32.const 0) (i32.const 0x56CF0000)))
    (drop (call $mdi_child_message (local.get $child) (i32.const 1) (i32.const 0) (i32.const 0)))
    (call $host_move_window (local.get $child)
      (i32.const 10) (i32.const 10) (i32.const 160) (i32.const 120) (i32.const 0x14))
    (call $ctrl_geom_sync (local.get $child)
      (i32.const 10) (i32.const 10) (i32.const 160) (i32.const 120) (i32.const 0x14))
    (call $defwndproc_do_nccalcsize (local.get $child))
    (local.get $child))

  (func (export "tmmc_maximize") (param $child i32) (result i32)
    (call $wnd_apply_show_state (local.get $child) (i32.const 3))
    (call $mdi_child_maximize (local.get $child)))
  (func (export "tmmc_restore") (param $child i32)
    (call $wnd_apply_show_state (local.get $child) (i32.const 9)))
  (func (export "tmmc_max_child") (param $frame i32) (result i32)
    (call $mdi_frame_maximized_child (local.get $frame)))
  (func (export "tmmc_xy") (param $hwnd i32) (result i32) (call $ctrl_get_xy_packed (local.get $hwnd)))
  (func (export "tmmc_wh") (param $hwnd i32) (result i32) (call $ctrl_get_wh_packed (local.get $hwnd)))
  (func (export "tmmc_client") (param $hwnd i32) (param $i i32) (result i32)
    (if (result i32) (i32.eqz (local.get $i))
      (then (call $client_rect_get_l (local.get $hwnd)))
      (else (if (result i32) (i32.eq (local.get $i) (i32.const 1))
        (then (call $client_rect_get_t (local.get $hwnd)))
        (else (if (result i32) (i32.eq (local.get $i) (i32.const 2))
          (then (call $client_rect_get_r (local.get $hwnd)))
          (else (call $client_rect_get_b (local.get $hwnd)))))))))
  (func (export "tmmc_bar_y") (param $frame i32) (result i32)
    (call $menu_bar_screen_y (local.get $frame)))
  (func (export "tmmc_frame_right") (param $frame i32) (result i32)
    (call $host_get_window_rect (local.get $frame) (global.get $WINDOW_RECT_SCRATCH))
    (i32.load offset=8 (global.get $WINDOW_RECT_SCRATCH)))
  (func (export "tmmc_hit") (param $frame i32) (param $x i32) (param $y i32) (result i32)
    (call $menu_hittest_mdi_buttons (local.get $frame) (local.get $x) (local.get $y)))
`;

const s16 = v => (v << 16) >> 16;
const xy = v => [s16(v & 0xFFFF), s16(v >>> 16)];
const wh = v => [v & 0xFFFF, v >>> 16];

(async () => {
  const { exports: e, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: { set_window_zorder() {}, activate_window() { return 1; } },
  });
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes USER state');

  const frame = e.tmmc_make_frame() >>> 0;
  const client = e.tmmc_make_client(frame) >>> 0;
  const child = e.tmmc_make_child(client) >>> 0;
  const inset = [0, 1].map(i => e.tmmc_client(child, i));
  assert(inset[0] > 0 && inset[1] > inset[0], `the restored child has a frame and caption (${inset})`);
  assert.strictEqual(e.tmmc_max_child(frame), 0, 'no maximized child yet');

  assert.strictEqual(e.tmmc_maximize(child), 1);
  const [x, y] = xy(e.tmmc_xy(child) >>> 0);
  assert.deepStrictEqual([x, y], [-inset[0], -inset[1]],
    'the maximized child sits with its caption and border outside the MDICLIENT');
  const clientW = e.tmmc_client(child, 2) - e.tmmc_client(child, 0);
  const clientH = e.tmmc_client(child, 3) - e.tmmc_client(child, 1);
  assert.deepStrictEqual([clientW, clientH], [300, 200],
    'its client area is exactly the MDICLIENT client area');
  console.log('PASS  a maximized MDI child\'s caption and borders are outside the MDICLIENT');

  assert.strictEqual(e.tmmc_max_child(frame) >>> 0, child, 'the frame knows its maximized child');
  const r = e.tmmc_frame_right(frame) - 3;
  const by = e.tmmc_bar_y(frame) + 2 + 7;
  assert.strictEqual(e.tmmc_hit(frame, r - 10, by), 0xF060, 'close button');
  assert.strictEqual(e.tmmc_hit(frame, r - 28, by), 0xF120, 'restore button');
  assert.strictEqual(e.tmmc_hit(frame, r - 44, by), 0xF020, 'minimize button');
  assert.strictEqual(e.tmmc_hit(frame, r - 80, by), 0, 'left of the buttons is the menu');
  assert.strictEqual(e.tmmc_hit(frame, r - 10, by + 20), 0, 'below the bar is not a button');
  e.tmmc_restore(child);
  assert.strictEqual(e.tmmc_max_child(frame), 0, 'a restored child leaves the menu bar');
  assert.strictEqual(e.tmmc_hit(frame, r - 10, by), 0, 'and takes its buttons with it');
  console.log('PASS  the frame menu bar carries the maximized child\'s buttons');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
