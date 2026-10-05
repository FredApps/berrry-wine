#!/usr/bin/env node
'use strict';

// A BUTTON custom command can open a nested dialog from its parent DLGPROC.
// Delivering that command through the recursive synchronous sender strands the
// browser inside the outer click, so the nested dialog can never receive its
// own input. Custom dialog commands stay on the ordinary message pump, while
// IDOK/IDCANCEL can be wizard navigation and stay on that pump too. A true
// DialogBox gets its unhandled IDOK fallback when the queued command runs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { createCanvas } = require('../lib/canvas-compat');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_focus_api") (param $hwnd i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetFocus (local.get $hwnd) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp)))
  (func (export "test_create_sibling_button") (param $hwnd i32) (param $id i32) (result i32)
    (call $ctrl_create_child
      (call $wnd_get_parent (local.get $hwnd)) (i32.const 1) (local.get $id)
      (i32.const 120) (i32.const 0) (i32.const 100) (i32.const 24)
      (i32.const 0x50010000) (i32.const 0)))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
  (func (export "test_button_state_ptr") (param $hwnd i32) (result i32)
    (call $wnd_get_state_ptr (local.get $hwnd)))
  (func (export "test_legacy_check") (param $hwnd i32) (param $value i32) (result i32)
    (call $ctrl_set_check_state (local.get $hwnd) (local.get $value))
    (call $ctrl_get_check_state (local.get $hwnd)))
  (func (export "test_check_pixel") (param $hwnd i32) (param $x i32) (param $y i32) (result i32)
    (call $gdi_hdc_get_pixel (i32.add (local.get $hwnd) (i32.const 0x40000))
      (local.get $x) (local.get $y)))
  (func (export "test_capture_api") (param $next i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $next)
      (then (call $handle_SetCapture (local.get $next) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_ReleaseCapture (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load (global.get $reg_base)))
  (func (export "test_dialog_capture") (result i32)
    (global.get $dialog_button_capture_hwnd))
  (func (export "test_create_dialog_button")
    (param $dlgproc i32) (param $id i32) (param $kind i32) (result i32)
    (local $dlg i32)
    (local.set $dlg (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $dlg) (global.get $WNDPROC_DIALOG))
    (drop (call $wnd_set_style (local.get $dlg) (i32.const 0x90000000)))
    (drop (call $dialog_proc_set (local.get $dlg) (local.get $dlgproc)))
    (call $ctrl_create_child
      (local.get $dlg) (i32.const 1) (local.get $id)
      (i32.const 0) (i32.const 0) (i32.const 100) (i32.const 24)
      (i32.or (i32.const 0x50010000) (local.get $kind)) (i32.const 0)))

  (func (export "test_button_click") (param $hwnd i32)
    (drop (call $button_wndproc
      (local.get $hwnd) (i32.const 0x0201) (i32.const 1) (i32.const 0)))
    (drop (call $button_wndproc
      (local.get $hwnd) (i32.const 0x0202) (i32.const 0) (i32.const 0))))

  (func (export "test_button_release") (param $hwnd i32)
    (drop (call $button_wndproc
      (local.get $hwnd) (i32.const 0x0202) (i32.const 0) (i32.const 0))))

  (func (export "test_subclass_parent") (param $hwnd i32) (param $proc i32)
    (call $wnd_table_set (call $wnd_get_parent (local.get $hwnd)) (local.get $proc)))

  (func (export "test_make_owned_guest_parent")
    (param $hwnd i32) (param $proc i32)
    (local $parent i32) (local $owner i32)
    (local.set $parent (call $wnd_get_parent (local.get $hwnd)))
    (local.set $owner (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $owner) (global.get $WNDPROC_BUILTIN))
    (call $wnd_set_owner (local.get $parent) (local.get $owner))
    (drop (call $dialog_proc_set (local.get $parent) (i32.const 0)))
    (call $wnd_table_set (local.get $parent) (local.get $proc)))

  (func (export "test_make_unowned_guest_parent")
    (param $hwnd i32) (param $proc i32)
    (local $parent i32)
    (local.set $parent (call $wnd_get_parent (local.get $hwnd)))
    (drop (call $dialog_proc_set (local.get $parent) (i32.const 0)))
    (call $wnd_table_set (local.get $parent) (local.get $proc)))

  (func (export "test_set_button_id")
    (param $hwnd i32) (param $id i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowLongA
      (local.get $hwnd) (i32.const -12) (local.get $id)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

function u32(value) {
  return [value, value >>> 8, value >>> 16, value >>> 24].map(v => v & 0xff);
}

(async () => {
  const { exports: e, memory, renderer, instance } = await bootRenderHarness({ extraWat });
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes x86 callback support');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const result = e.guest_alloc(12) >>> 0;
  const proc = e.guest_alloc(64) >>> 0;

  // DLGPROC: capture WM_COMMAND's msg/wParam/lParam and return TRUE.
  bytes.set(Uint8Array.from([
    0x81, 0x7c, 0x24, 0x08, 0x11, 0x01, 0x00, 0x00,
    0x75, 0x1b,
    0x8b, 0x44, 0x24, 0x08, 0xa3, ...u32(result),
    0x8b, 0x44, 0x24, 0x0c, 0xa3, ...u32(result + 4),
    0x8b, 0x44, 0x24, 0x10, 0xa3, ...u32(result + 8),
    0xb8, 0x01, 0x00, 0x00, 0x00,
    0xc2, 0x10, 0x00,
  ]), toWasm(proc));

  const captured = () => [
    view.getUint32(toWasm(result), true),
    view.getUint32(toWasm(result + 4), true),
    view.getUint32(toWasm(result + 8), true),
  ];

  // USER's native router retains capture across an outside release. The
  // button must clear pressed/capture state without posting BN_CLICKED or
  // toggling an automatic checkbox, including negative and exclusive edges.
  for (const kind of [0, 1, 3, 6, 9, 11]) {
    const button = e.test_create_dialog_button(proc, 1100 + kind, kind) >>> 0;
    const parent = e.wnd_get_parent(button) >>> 0;
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0,
      'BM_GETSTATE must not expose the internal default-button border as BST_PUSHED');
    for (const [x, y] of [[-1, 5], [5, -1], [100, 5], [5, 24]]) {
      assert.strictEqual(e.dialog_route_mouse(parent, 0x201, 1, (5 << 16) | 5), 1);
      assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0x6c,
        'BM_GETSTATE matches Win98 mouse tracking, pushed and focus bits');
      assert.strictEqual(e.get_capture_hwnd(), button);
      assert.strictEqual(e.dialog_route_mouse(parent, 0x202, 0,
        (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0), 1);
      assert.strictEqual(e.get_capture_hwnd(), 0, 'outside release retires capture');
      assert.strictEqual(e.get_post_queue_count(), 0, 'outside release sends no BN_CLICKED');
      assert.strictEqual(e.send_message(button, 0xf0, 0, 0), 0, 'outside release does not auto-check');
      assert.strictEqual(e.button_get_flags(button) & 1, 0, 'outside release clears native pressed state');
      assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 8,
        'cancelled release retains focus but not pushed/check state');
    }
    e.test_button_click(button);
    assert.strictEqual(e.button_get_flags(button) & 1, 0, 'inside release also retires pressed state');
    assert.strictEqual(e.get_post_queue_count(), 1, 'inside release still posts BN_CLICKED');
    assert.strictEqual(e.send_message(button, 0xf0, 0, 0), [3, 6, 9].includes(kind) ? 1 : 0,
      'inside release preserves automatic check behavior');
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), [3, 6, 9].includes(kind) ? 9 : 8,
      'BM_GETSTATE combines check and focus after release');
    e.set_post_queue_count(0);
  }
  const custom = e.test_create_dialog_button(proc, 1016) >>> 0;
  // Native Win98 reference: docs/reference-button-input-win98.txt.
  for (const [kind, code] of [[0, 0x2020], [1, 0x2010], [2, 0x2000], [3, 0x2000],
      [4, 0x2040], [5, 0x2000], [6, 0x2000], [7, 0x100], [9, 0x2040], [10, 0x2020], [11, 0x2000]]) {
    const button = e.test_create_dialog_button(proc, 1600 + kind, kind) >>> 0;
    for (const key of [0, 9, 13, 32, 65]) {
      assert.strictEqual(e.send_message(button, 0x87, key, 0), code, `DLGC flags for button style ${kind}`);
    }
    assert.strictEqual(e.get_post_queue_count(), 0, 'dialog-code queries do not notify');
    e.set_focus(button);
    e.set_post_queue_count(0);
    assert.strictEqual(e.send_message(button, 0x87, 0, 0), code, 'focus paint does not rewrite dialog capabilities');
  }
  e.wnd_set_style_export(custom, 0x50010001);
  assert.strictEqual(e.send_message(custom, 0x87, 0, 0), 0x2010, 'dialog code follows current style');
  e.wnd_set_style_export(custom, 0x50010000);
  // Space activates on release, with the same auto-check/notify transition
  // as mouse release. Key repeats cannot enqueue repeated clicks.
  for (const kind of [0, 1, 2, 3, 4, 5, 6, 9, 11]) {
    const button = e.test_create_dialog_button(proc, 1500 + kind, kind) >>> 0;
    e.set_focus(button);
    e.set_post_queue_count(0);
    e.send_message(button, 0x100, 0x0d, 1);
    assert.strictEqual(e.get_post_queue_count(), 0, 'Enter activation belongs to dialog processing');
    for (const lp of [1, 0x40000001, 0x40000001]) {
      e.send_message(button, 0x100, 0x20, lp);
      assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0x2c, 'Space reports tracking without mouse-origin bit');
      assert.strictEqual(e.get_capture_hwnd(), button);
      assert.strictEqual(e.get_post_queue_count(), 0, 'Space key-down/repeat does not click');
    }
    e.send_message(button, 0x101, 9, 0xc00f0001);
    assert.strictEqual(e.get_capture_hwnd(), button, 'TAB release leaves cancellation to focus handling');
    e.send_message(button, 0x101, 0x20, 0xc0390001);
    assert.strictEqual(e.get_capture_hwnd(), 0);
    assert.strictEqual(e.get_post_queue_count(), 1, 'Space release clicks once');
    assert.strictEqual(e.send_message(button, 0xf0, 0, 0), [3, 6, 9].includes(kind) ? 1 : 0);
    e.set_post_queue_count(0);
    e.send_message(button, 0x101, 0x20, 0xc0390001);
    assert.strictEqual(e.get_post_queue_count(), 0, 'a repeated release is inert');
    for (const cancel of ['focus', 'other-key', 'sys-key', 'capture']) {
      e.set_focus(button);
      e.send_message(button, 0x100, 0x20, 1);
      if (cancel === 'focus') e.set_focus(custom);
      if (cancel === 'other-key') e.send_message(button, 0x101, 0x41, 0xc01e0001);
      if (cancel === 'sys-key') e.send_message(button, 0x105, 0x12, 0xe0380001);
      if (cancel === 'capture') e.test_capture_api(custom);
      e.send_message(button, 0x101, 0x20, 0xc0390001);
      assert.strictEqual(e.get_post_queue_count(), cancel === 'focus' ? 1 : 0,
        'Win98 activates highlighted Space on focus loss, but capture/other-key cancellation does not');
      e.set_post_queue_count(0);
      assert.strictEqual(e.button_get_flags(button) & 0x601, 0);
      if (cancel === 'capture') e.test_capture_api(0);
    }
  }
  // Native focus-loss matrix, including direct synthetic groupbox delivery.
  for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const button = e.test_create_dialog_button(proc, 1700 + kind, kind) >>> 0;
    for (const mode of ['space', 'mouse', 'outside', 'space-clear', 'highlight']) {
      e.set_focus(button);
      e.send_message(button, 0xf1, 0, 0);
      e.set_post_queue_count(0);
      if (mode === 'mouse' || mode === 'outside') {
        e.send_message(button, 0x201, 1, (5 << 16) | 5);
        if (mode === 'outside') e.send_message(button, 0x200, 1, (5 << 16) | 0xffff);
      } else if (mode === 'highlight') {
        e.send_message(button, 0xf3, 1, 0);
      } else {
        e.send_message(button, 0x100, 32, 1);
        if (mode === 'space-clear') e.send_message(button, 0xf3, 0, 0);
      }
      e.set_focus(custom);
      const clicked = mode === 'space' || mode === 'highlight';
      assert.strictEqual(e.get_post_queue_count(), clicked ? 1 : 0, `Win98 focus-loss kind=${kind} mode=${mode}`);
      assert.strictEqual(e.get_capture_hwnd(), 0);
      assert.strictEqual(e.send_message(button, 0xf2, 0, 0),
        clicked && [3, 6, 9].includes(kind) ? 1 : 0, 'focus loss retires tracking/focus and applies automatic checking');
      e.set_post_queue_count(0);
      e.send_message(button, 0x101, 32, 0xc0390001);
      assert.strictEqual(e.get_post_queue_count(), 0, 'late release cannot activate a second time');
    }
  }
  // A synchronous guest parent observes automatic checking and retired
  // tracking before WM_KILLFOCUS removes the focus flag, matching the oracle.
  const observed = e.guest_alloc(4) >>> 0;
  const observerProc = e.guest_alloc(32) >>> 0;
  const observedButton = e.test_create_dialog_button(proc, 1800, 3) >>> 0;
  const observedState = e.test_button_state_ptr(observedButton) >>> 0;
  bytes.set(Uint8Array.from([
    0x81, 0x7c, 0x24, 0x08, 0x11, 0x01, 0x00, 0x00,
    0x75, 0x0a,
    0xa1, ...u32(observedState + 8),
    0xa3, ...u32(observed),
    0x31, 0xc0, 0xc2, 0x10, 0x00,
  ]), toWasm(observerProc));
  e.test_make_unowned_guest_parent(observedButton, observerProc);
  e.set_focus(observedButton);
  e.send_message(observedButton, 0xf3, 1, 0);
  view.setUint32(toWasm(observed), 0xffffffff, true);
  e.set_focus(custom);
  assert.strictEqual(view.getUint32(toWasm(observed), true) & ~4, 10,
    'synchronous BN_CLICKED observes checked + focused, without press tracking');
  assert.strictEqual(e.button_get_flags(observedButton), 2, 'focus clears only after notification');
  assert.strictEqual(e.get_post_queue_count(), 0, 'ordinary parent notification is synchronous');

  const apiTable = require('../src/api_table.json');
  const focusThunk = e.test_thunk(apiTable.find(api => api.name === 'SetFocus').id);
  for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    for (const self of [true, false]) {
      const button = e.test_create_dialog_button(proc, 1850, kind) >>> 0;
      const alternate = e.test_create_sibling_button(button, 1851) >>> 0;
      const chosen = self ? button : alternate;
      const armed = e.guest_alloc(4) >>> 0;
      const refocusProc = e.guest_alloc(96) >>> 0;
      const action = [
        0xc7, 0x05, ...u32(armed), ...u32(0),
        0x68, ...u32(chosen), 0xb8, ...u32(focusThunk), 0xff, 0xd0,
      ];
      const gate = [0x83, 0x3d, ...u32(armed), 0, 0x74, action.length, ...action];
      bytes.set(Uint8Array.from([
        0x81, 0x7c, 0x24, 0x08, ...u32(0x111), 0x75, gate.length, ...gate,
        0x31, 0xc0, 0xc2, 0x10, 0x00,
      ]), toWasm(refocusProc));
      view.setUint32(toWasm(armed), 0, true);
      e.test_make_unowned_guest_parent(button, refocusProc);
      e.test_focus_api(button);
      e.send_message(button, 0xf3, 1, 0);
      view.setUint32(toWasm(armed), 1, true);
      e.test_focus_api(e.wnd_get_parent(button));
      assert.strictEqual(view.getUint32(toWasm(armed), true), 0, 'nested SetFocus callback ran');
      assert.strictEqual(e.get_focus_hwnd(), chosen, `native callback-selected focus survives kind=${kind} self=${self}`);
      assert.strictEqual(e.send_message(button, 0xf2, 0, 0), [3, 6, 9].includes(kind) ? 1 : 0,
        'Win98 outer handler still clears its focus-state bit after self-refocus');
      assert.strictEqual(e.send_message(alternate, 0xf2, 0, 0), self ? 0 : 8);
      assert.strictEqual(e.get_post_queue_count(), 0);
    }
  }
  const destroyThunk = e.test_thunk(apiTable.find(api => api.name === 'DestroyWindow').id);
  for (const stage of ['paint', 'command']) {
    const victim = e.test_create_dialog_button(proc, 1900, stage === 'paint' ? 11 : 3) >>> 0;
    const armed = e.guest_alloc(4) >>> 0;
    const retireProc = e.guest_alloc(96) >>> 0;
    const action = [
      0xc7, 0x05, ...u32(armed), ...u32(0),
      0x68, ...u32(victim), 0xb8, ...u32(destroyThunk), 0xff, 0xd0,
    ];
    const gate = [0x83, 0x3d, ...u32(armed), 0, 0x74, action.length, ...action];
    bytes.set(Uint8Array.from([
      0x81, 0x7c, 0x24, 0x08, ...u32(stage === 'paint' ? 0x2b : 0x111),
      0x75, gate.length, ...gate,
      0x31, 0xc0, 0xc2, 0x10, 0x00,
    ]), toWasm(retireProc));
    view.setUint32(toWasm(armed), 0, true);
    e.test_make_unowned_guest_parent(victim, retireProc);
    e.set_focus(victim);
    e.send_message(victim, 0xf3, 1, 0);
    view.setUint32(toWasm(armed), 1, true);
    e.set_focus(custom);
    assert.strictEqual(view.getUint32(toWasm(armed), true), 0, `${stage} callback actually ran`);
    assert.strictEqual(e.test_button_state_ptr(victim), 0, `${stage} callback destroyed the target safely`);
    assert.strictEqual(e.get_post_queue_count(), 0);
  }

  // Highlighting is not tracking: synthetic UP after BM_SETSTATE is inert.
  for (const kind of [0, 1, 3, 6, 9, 11]) {
    const button = e.test_create_dialog_button(proc, 1400 + kind, kind) >>> 0;
    assert.strictEqual(e.send_message(button, 0xf3, 2, 0), 0);
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 4);
    assert.strictEqual(e.get_capture_hwnd(), 0, 'highlight does not acquire capture');
    e.send_message(button, 0x202, 0, (5 << 16) | 5);
    assert.strictEqual(e.get_post_queue_count(), 0, 'highlight alone cannot generate BN_CLICKED');
    e.send_message(button, 0xf3, 0, 0);
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0);
    e.send_message(button, 0x201, 1, (5 << 16) | 5);
    e.send_message(button, 0x200, 1, (5 << 16) | 0xffff);
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0x68, 'dragging out removes only highlight, retaining Win98 tracking bits');
    assert.strictEqual(e.get_capture_hwnd(), button, 'dragging out keeps capture');
    e.send_message(button, 0x200, 1, (5 << 16) | 5);
    assert.strictEqual(e.send_message(button, 0xf2, 0, 0), 0x6c, 'dragging back restores highlight');
    e.send_message(button, 0x202, 0, (5 << 16) | 5);
    assert.strictEqual(e.get_post_queue_count(), 1, 'drag out/in still clicks once');
    assert.strictEqual(e.button_get_flags(button) & 0x601, 0, 'release retires tracking, origin and highlight');
    e.set_post_queue_count(0);
    const checked = e.send_message(button, 0xf0, 0, 0);
    e.send_message(button, 0xf3, 1, 0);
    assert.strictEqual(e.send_message(button, 0xf0, 0, 0), checked, 'highlight preserves check state');
    e.send_message(button, 0x201, 1, (5 << 16) | 5);
    e.send_message(button, 0x200, 1, (5 << 16) | 0xffff);
    e.send_message(button, 0x1f, 0, 0);
    assert.strictEqual(e.button_get_flags(button) & 0x601, 0, 'cancel clears tracking even while unhighlighted');
    assert.strictEqual(e.get_capture_hwnd(), 0);
    e.send_message(button, 0x202, 0, (5 << 16) | 5);
    assert.strictEqual(e.get_post_queue_count(), 0, 'cancelled drag cannot click later');
  }
  e.send_message(custom, 0xf1, 1, 0);
  assert.strictEqual(e.send_message(custom, 0xf0, 0, 0), 0, 'BM_SETCHECK has no effect on push buttons');
  for (const kind of [5, 6]) {
    const strip = createCanvas(39, 13);
    const stripCtx = strip.getContext('2d');
    const stripPixels = stripCtx.createImageData(39, 13);
    const tri = e.test_create_dialog_button(proc, 1300 + kind, kind) >>> 0;
    const parent = e.wnd_get_parent(tri) >>> 0;
    renderer.windows[parent] = { hwnd: parent, x: 0, y: 0, w: 100, h: 24,
      visible: true, isChild: false, hasCaption: false, style: 0, zOrder: 1,
      wasm: instance, wasmMemory: memory };
    for (const check of [0, 1, 2]) {
      e.send_message(tri, 0xf1, check, 0);
      assert.strictEqual(e.send_message(tri, 0xf0, 0, 0), check, 'BM_GETCHECK retains all three states');
      assert.strictEqual(e.send_message(tri, 0xf2, 0, 0) & 3, check, 'BM_GETSTATE agrees with BM_GETCHECK');
      assert.strictEqual(e.test_check_pixel(parent, 3, 9) >>> 0,
        [0xffffff, 0, 0x808080][check], 'checkbox tick paints clear, black or grayed state');
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
        const color = e.test_check_pixel(parent, x, y + 5) >>> 0;
        const at = (y * 39 + check * 13 + x) * 4;
        stripPixels.data.set([color & 255, (color >>> 8) & 255, (color >>> 16) & 255, 255], at);
      }
    }
    stripCtx.putImageData(stripPixels, 0, 0);
    fs.mkdirSync(path.join(ROOT, 'test/output'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, `test/output/button-three-state-${kind}.png`), strip.toBuffer('image/png'));
    assert.strictEqual(e.get_post_queue_count(), 0, 'programmatic checking does not notify');
    assert.strictEqual(e.test_legacy_check(tri, 2), 2, 'legacy check setter retains indeterminate');
    assert.strictEqual(e.send_message(tri, 0xf0, 0, 0), 2, 'native getter reads legacy setter state');
    if (kind === 6) {
      e.test_legacy_check(tri, 0);
      for (const expected of [1, 2, 0, 1, 2, 0]) {
        e.test_button_click(tri);
        assert.strictEqual(e.send_message(tri, 0xf0, 0, 0), expected, 'AUTO3STATE cycles through three states');
        assert.strictEqual(e.send_message(tri, 0xf2, 0, 0), 8 | expected);
        e.set_post_queue_count(0);
      }
    } else {
      e.test_button_click(tri);
      assert.strictEqual(e.send_message(tri, 0xf0, 0, 0), 2, 'manual 3STATE does not auto-cycle');
      e.set_post_queue_count(0);
    }
    e.test_legacy_check(tri, 2);
    e.dialog_route_mouse(parent, 0x201, 1, (5 << 16) | 5);
    e.dialog_route_mouse(parent, 0x202, 0, (5 << 16) | 0xffff);
    assert.strictEqual(e.send_message(tri, 0xf2, 0, 0), 10, 'outside cancellation preserves indeterminate and focus');
    assert.strictEqual(e.get_post_queue_count(), 0);
  }
  const customParent = e.wnd_get_parent(custom) >>> 0;
  const replacement = e.test_create_dialog_button(proc, 1200) >>> 0;
  for (const cancel of ['transfer', 'release', 'cancel-mode', 'focus-loss']) {
    assert.strictEqual(e.dialog_route_mouse(customParent, 0x201, 1, (5 << 16) | 5), 1);
    assert.strictEqual(e.test_dialog_capture(), custom);
    assert(e.button_get_flags(custom) & 1, 'press starts highlighted');
    if (cancel === 'transfer') assert.strictEqual(e.test_capture_api(replacement), custom);
    else if (cancel === 'release') assert.strictEqual(e.test_capture_api(0), 1);
    else if (cancel === 'focus-loss') e.set_focus(replacement);
    else e.send_message(custom, 0x1f, 0, 0);
    assert.strictEqual(e.get_capture_hwnd(), cancel === 'transfer' ? replacement : 0,
      `${cancel} does not erase a replacement capture owner`);
    assert.strictEqual(e.test_dialog_capture(), 0, `${cancel} retires the dialog router's target`);
    assert.strictEqual(e.button_get_flags(custom) & 1, 0, `${cancel} clears native pressed state`);
    assert.strictEqual(e.send_message(custom, 0xf2, 0, 0), cancel === 'focus-loss' ? 0 : 8,
      `${cancel} is observable through BM_GETSTATE without losing unrelated focus`);
    e.test_button_release(custom);
    assert.strictEqual(e.get_post_queue_count(), 0, `${cancel} prevents a later stray UP from clicking`);
    if (cancel === 'transfer') e.test_capture_api(0);
  }
  e.test_subclass_parent(custom, proc);
  e.test_button_release(custom);
  assert.strictEqual(e.get_post_queue_count(), 0,
    'a subclass-consumed DOWN cannot turn a stray UP into another command');
  assert.deepStrictEqual(captured(), [0, 0, 0],
    'a stray release does not send a synchronous command either');
  e.test_button_click(custom);
  assert.deepStrictEqual(captured(), [0, 0, 0],
    'subclassed dialog custom command does not enter a recursive x86 frame');
  assert.strictEqual(e.get_post_queue_count(), 1,
    'custom dialog command is queued for DispatchMessage');
  assert.deepStrictEqual([
    e.post_queue_peek(0, 0),
    e.post_queue_peek(0, 1),
    e.post_queue_peek(0, 2),
    e.post_queue_peek(0, 3),
  ], [customParent, 0x0111, 1016, custom],
  'queued message retains the parent, command id, and BUTTON hwnd');

  // Clear the synthetic queue before checking the standard command path.
  e.set_post_queue_count(0);
  const ok = e.test_create_dialog_button(proc, 1) >>> 0;
  const okParent = e.wnd_get_parent(ok) >>> 0;
  e.test_button_click(ok);
  assert.strictEqual(e.get_post_queue_count(), 1,
    'modeless IDOK stays on the main pump for wizard navigation');
  assert.deepStrictEqual([
    e.post_queue_peek(0, 0),
    e.post_queue_peek(0, 1),
    e.post_queue_peek(0, 2),
    e.post_queue_peek(0, 3),
  ], [okParent, 0x0111, 1, ok],
  'queued modeless IDOK retains the parent and button HWND');

  e.set_post_queue_count(0);
  const nativeOk = e.test_create_dialog_button(proc, 1) >>> 0;
  const nativeOkParent = e.wnd_get_parent(nativeOk) >>> 0;
  e.test_make_unowned_guest_parent(nativeOk, proc);
  e.test_button_click(nativeOk);
  assert.strictEqual(e.get_post_queue_count(), 1,
    'native installer IDOK stays on the main pump for nested license pages');
  assert.deepStrictEqual([
    e.post_queue_peek(0, 0),
    e.post_queue_peek(0, 1),
    e.post_queue_peek(0, 2),
    e.post_queue_peek(0, 3),
  ], [nativeOkParent, 0x0111, 1, nativeOk],
  'queued native installer IDOK retains the parent and button HWND');

  e.set_post_queue_count(0);
  const owned = e.test_create_dialog_button(proc, 0) >>> 0;
  const ownedParent = e.wnd_get_parent(owned) >>> 0;
  assert.strictEqual(e.test_set_button_id(owned, 0x1009), 0,
    'VCL-style GWL_ID assignment returns the creation-time zero ID');
  e.test_make_owned_guest_parent(owned, proc);
  e.test_button_click(owned);
  assert.strictEqual(e.get_post_queue_count(), 1,
    'an owned guest form queues its custom BUTTON command');
  assert.deepStrictEqual([
    e.post_queue_peek(0, 0),
    e.post_queue_peek(0, 1),
    e.post_queue_peek(0, 2),
    e.post_queue_peek(0, 3),
  ], [owned, 0xBD11, 0x1009, owned],
  'owned guest form receives reflected CN_COMMAND on the main message pump');

  e.set_post_queue_count(0);
  const nested = e.test_create_dialog_button(proc, 0) >>> 0;
  const nestedId = nested & 0xffff;
  assert.strictEqual(e.test_set_button_id(nested, nestedId), 0,
    'VCL-style child uses its HWND as its runtime control ID');
  e.test_make_unowned_guest_parent(nested, proc);
  e.test_button_click(nested);
  assert.strictEqual(e.get_post_queue_count(), 1,
    'self-ID button under an unowned guest panel queues its reflection');
  assert.deepStrictEqual([
    e.post_queue_peek(0, 0),
    e.post_queue_peek(0, 1),
    e.post_queue_peek(0, 2),
    e.post_queue_peek(0, 3),
  ], [nested, 0xBD11, nestedId, nested],
  'nested VCL panel receives reflected CN_COMMAND on the main message pump');

  console.log('PASS  custom modal-form BUTTON commands stay on the main message pump');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
