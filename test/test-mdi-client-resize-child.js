#!/usr/bin/env node

'use strict';

// A maximized MDI child follows its MDICLIENT when the client is resized.
//
// USER does this from MDICLIENT's own WM_SIZE. Nothing in this emulator used
// to: $mdi_child_maximize ran only from the child's own SC_MAXIMIZE, so a
// child that was already zoomed when the frame grew kept the rect it had been
// given at the old frame size. Maximizing SimCity 2000's MDI frame to the full
// desktop left its city window at 392x254 in the corner of a 1024x768 frame,
// and the child's own maximize button then looked dead, because the child
// already believed it was maximized.
//
// The two callers that matter are geometry paths, not message paths: an MFC
// frame's RecalcLayout batches its control bars and the MDICLIENT into one
// DeferWindowPos, which EndDeferWindowPos replays through SetWindowPos, and
// neither that nor MoveWindow delivers a WM_SIZE to $mdiclient_wndproc.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');

const extraWat = String.raw`
  (func $tmcr_make_window (param $parent i32) (param $class i32) (result i32)
    (local $hwnd i32) (local $slot i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (call $ctrl_table_set (local.get $slot) (local.get $class) (i32.const 0))
    (local.get $hwnd))

  (func (export "tmcr_make_frame") (result i32)
    (call $tmcr_make_window (i32.const 0) (i32.const 0)))

  ;; The MDICLIENT's private state is allocated on WM_CREATE, and every MDI
  ;; helper gates on it -- a client without it is not an MDI client at all.
  (func (export "tmcr_make_client") (param $frame i32) (result i32)
    (local $client i32) (local $ccs i32) (local $cs i32) (local $result i32)
    (local.set $client
      (call $tmcr_make_window (local.get $frame) (i32.const 33)))
    (local.set $ccs (call $heap_alloc (i32.const 8)))
    (local.set $cs (call $heap_alloc (i32.const 48)))
    (call $gs32 (local.get $ccs) (i32.const 0))
    (call $gs32 (i32.add (local.get $ccs) (i32.const 4)) (i32.const 0xFF00))
    (call $gs32 (local.get $cs) (local.get $ccs))
    (local.set $result (call $mdiclient_wndproc
      (local.get $client) (i32.const 1) (i32.const 0) (local.get $cs)))
    (call $heap_free (local.get $cs))
    (call $heap_free (local.get $ccs))
    (if (i32.eq (local.get $result) (i32.const -1))
      (then (return (i32.const 0))))
    (local.get $client))

  (func (export "tmcr_make_child") (param $client i32) (param $w i32) (param $h i32)
      (result i32)
    (local $child i32)
    (local.set $child (call $tmcr_make_window (local.get $client) (i32.const 0)))
    (drop (call $mdi_child_message
      (local.get $child) (i32.const 1) (i32.const 0) (i32.const 0)))
    (call $host_move_window (local.get $child)
      (i32.const 0) (i32.const 0) (local.get $w) (local.get $h) (i32.const 0x14))
    (call $ctrl_geom_sync (local.get $child)
      (i32.const 0) (i32.const 0) (local.get $w) (local.get $h) (i32.const 0x14))
    (local.get $child))

  (func (export "tmcr_set_client_rect") (param $hwnd i32)
      (param $w i32) (param $h i32)
    (call $client_rect_set (local.get $hwnd)
      (i32.const 0) (i32.const 0) (local.get $w) (local.get $h)))

  (func (export "tmcr_maximize") (param $child i32)
    (call $wnd_apply_show_state (local.get $child) (i32.const 3)))

  (func (export "tmcr_is_maximized") (param $child i32) (result i32)
    (call $wnd_max_get (local.get $child)))

  (func (export "tmcr_size_children") (param $client i32)
    (call $mdi_client_size_children (local.get $client)))

  (func (export "tmcr_wh") (param $hwnd i32) (result i32)
    (call $ctrl_get_wh_packed (local.get $hwnd)))

  (func (export "tmcr_client_wh") (param $hwnd i32) (result i32)
    (i32.or
      (i32.and
        (i32.sub (call $client_rect_get_r (local.get $hwnd))
                 (call $client_rect_get_l (local.get $hwnd)))
        (i32.const 0xFFFF))
      (i32.shl
        (i32.sub (call $client_rect_get_b (local.get $hwnd))
                 (call $client_rect_get_t (local.get $hwnd)))
        (i32.const 16))))

  ;; The wiring, not just the helper: this is the call EndDeferWindowPos makes
  ;; for every entry an MFC RecalcLayout batched, the MDICLIENT among them.
  ;; SWP_NOZORDER | SWP_NOACTIVATE, as MFC passes.
  (func (export "tmcr_set_window_pos") (param $hwnd i32) (param $w i32) (param $h i32)
      (result i32)
    (call $set_window_pos_core (local.get $hwnd) (i32.const 0)
      (i32.const 0) (i32.const 0) (local.get $w) (local.get $h)
      (i32.const 0x14) (i32.const 0)))
`;

function wh(packed) {
  return { w: packed & 0xFFFF, h: (packed >>> 16) & 0xFFFF };
}

(async () => {
  const { exports: e, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      set_window_zorder() {},
      activate_window() { return 1; },
    },
  });

  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes USER state');

  const frame = e.tmcr_make_frame() >>> 0;
  const client = e.tmcr_make_client(frame) >>> 0;
  assert(client, 'MDICLIENT WM_CREATE allocated its state');

  // The client starts at the small frame's client area; both children are
  // created at the size an app would give them there.
  e.tmcr_set_client_rect(client, 392, 230);
  const zoomed = e.tmcr_make_child(client, 392, 230) >>> 0;
  const floating = e.tmcr_make_child(client, 120, 80) >>> 0;
  e.tmcr_maximize(zoomed);
  assert.strictEqual(e.tmcr_is_maximized(zoomed), 1, 'the first child is zoomed');
  assert.strictEqual(e.tmcr_is_maximized(floating), 0, 'the second child is not');

  // The frame grows; its layout gives the MDICLIENT the new client area.
  e.tmcr_set_client_rect(client, 1016, 698);
  e.tmcr_size_children(client);

  const after = wh(e.tmcr_wh(zoomed) >>> 0);
  assert.deepStrictEqual(after, { w: 1016, h: 698 },
    `a maximized MDI child fills the resized client (got ${after.w}x${after.h})`);

  // A restored child keeps its own rect: only the maximized one tracks the
  // client, exactly as USER's MDICLIENT does.
  const kept = wh(e.tmcr_wh(floating) >>> 0);
  assert.deepStrictEqual(kept, { w: 120, h: 80 },
    `a non-maximized MDI child is left alone (got ${kept.w}x${kept.h})`);

  // Shrinking is the same operation in the other direction -- a frame that is
  // restored from maximized must not leave the child hanging off the edge.
  e.tmcr_set_client_rect(client, 392, 230);
  e.tmcr_size_children(client);
  const shrunk = wh(e.tmcr_wh(zoomed) >>> 0);
  assert.deepStrictEqual(shrunk, { w: 392, h: 230 },
    `a maximized MDI child shrinks with the client (got ${shrunk.w}x${shrunk.h})`);

  // And through the path an application actually takes. SetWindowPos on the
  // client is what EndDeferWindowPos replays, and it delivers no WM_SIZE to
  // $mdiclient_wndproc at all, so the relayout has to be hung off the geometry
  // commit rather than off the message.
  assert.strictEqual(e.tmcr_set_window_pos(client, 600, 400) >>> 0, 1,
    'SetWindowPos resizes the MDI client');
  // Compare against the client's own CLIENT_RECT rather than the requested
  // size: SetWindowPos recomputes it through NCCALCSIZE, and the harness's
  // renderer has a screen of its own to fit the window into.
  const clientNow = wh(e.tmcr_client_wh(client) >>> 0);
  assert(clientNow.w > 392 && clientNow.h > 230,
    `the client really did grow (got ${clientNow.w}x${clientNow.h})`);
  const viaSwp = wh(e.tmcr_wh(zoomed) >>> 0);
  assert.deepStrictEqual(viaSwp, clientNow,
    `SetWindowPos on the client re-sizes its maximized child ` +
    `(child ${viaSwp.w}x${viaSwp.h}, client ${clientNow.w}x${clientNow.h})`);

  console.log('PASS  a maximized MDI child tracks its client through resize');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
