#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const IMAGE_BASE = 0x400000;
const RSRC_RVA = 0x16000;
const DATA_RVA = 0x17000;

const extraWat = String.raw`
  (global $test_statusbar_dispatch_eip (mut i32) (i32.const 0))

  (func (export "test_create_statusbar") (param $text_g i32) (result i32)
    (local $hwnd i32) (local $slot i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    ;; CreateWindowEx keeps a registered comctl32 status bar at class zero so
    ;; its guest wndproc can own layout; the per-slot marker routes only the
    ;; WAT text/paint mirror. Exercise that real browser path here.
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (call $statusbar_native_mark_slot (local.get $slot) (i32.const 1))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x10000000)))
    (call $ctrl_geom_set
      (local.get $slot) (i32.const 0) (i32.const 0)
      (i32.const 200) (i32.const 20))
    (call $title_table_set
      (local.get $hwnd) (call $g2w (local.get $text_g))
      (call $guest_strlen (local.get $text_g)))
    (local.get $hwnd))

  (func (export "test_statusbar_send")
      (param $hwnd i32) (param $msg i32) (param $wParam i32) (param $lParam i32)
      (result i32)
    (call $wnd_send_message
      (local.get $hwnd) (local.get $msg) (local.get $wParam) (local.get $lParam)))

  (func (export "test_destroy_statusbar") (param $hwnd i32)
    (local $slot i32)
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (if (i32.ge_s (local.get $slot) (i32.const 0))
      (then (call $ctrl_table_reset_slot (local.get $slot)))))

  (func (export "test_statusbar_title_ptr") (param $hwnd i32) (result i32)
    (call $title_table_get_ptr (local.get $hwnd)))
  (func (export "test_statusbar_title_len") (param $hwnd i32) (result i32)
    (call $title_table_get_len (local.get $hwnd)))
  (func (export "test_statusbar_state_ptr") (param $hwnd i32) (result i32)
    (call $wnd_get_state_ptr (local.get $hwnd)))
  (func (export "test_statusbar_class") (param $hwnd i32) (result i32)
    (call $ctrl_table_get_class (local.get $hwnd)))
  (func (export "test_statusbar_queue_and_drain") (param $hwnd i32) (result i32)
    (call $update_invalidate_full (local.get $hwnd))
    (call $paint_flag_set (local.get $hwnd))
    (call $paint_drain_native_control_paints))
  (func (export "test_statusbar_drain") (result i32)
    (call $paint_drain_native_control_paints))
  (func (export "test_statusbar_dispatch_erase")
      (param $hwnd i32) (param $msg_g i32) (result i32)
    (local $before i32)
    ;; Match the real registered COMCTL32 status: its layout wndproc is x86,
    ;; while USER's dispatch boundary owns the WAT shared-surface mirror.
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (call $gs32 (local.get $msg_g) (local.get $hwnd))
    (call $gs32 (i32.add (local.get $msg_g) (i32.const 4)) (i32.const 0x0014))
    (call $gs32 (i32.add (local.get $msg_g) (i32.const 8))
      (i32.add (local.get $hwnd) (i32.const 0x40000)))
    (call $gs32 (i32.add (local.get $msg_g) (i32.const 12)) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401234))
    (global.set $eip (i32.const 0x0040AAAA))
    (call $handle_DispatchMessageA
      (local.get $msg_g)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_statusbar_dispatch_eip (global.get $eip))
    (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
  (func (export "test_statusbar_dispatch_eip") (result i32)
    (global.get $test_statusbar_dispatch_eip))
  (func (export "test_string_load_w")
      (param $hinst i32) (param $id i32) (param $buf_g i32) (result i32)
    (local $len i32)
    (call $push_rsrc_ctx (local.get $hinst))
    (local.set $len
      (call $string_load_w (local.get $id) (call $g2w (local.get $buf_g)) (i32.const 256)))
    (call $pop_rsrc_ctx)
    (local.get $len))

  (func (export "test_menu_help_resource_id")
      (param $wParam i32) (param $lParam i32) (param $main i32) (param $ids_g i32)
      (result i32)
    (call $menu_help_resource_id
      (local.get $wParam) (local.get $lParam) (local.get $main)
      (call $g2w (local.get $ids_g))))

  (func (export "test_menu_help")
      (param $msg i32) (param $wParam i32) (param $lParam i32)
      (param $main i32) (param $hinst i32) (param $status i32) (param $ids i32)
      (result i32)
    (local $before i32)
    (i32.store offset=16 (global.get $reg_base) (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $status))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $ids))
    (call $handle_MenuHelp
      (local.get $msg) (local.get $wParam) (local.get $lParam)
      (local.get $main) (local.get $hinst) (i32.const 0))
    (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const dv = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const wasm = guest => e.guest_to_wasm(guest) >>> 0;
  e.init_thread(1, IMAGE_BASE, 0, 0, 0, 0, 0, RSRC_RVA);

  const strA = text => {
    const ptr = e.guest_alloc(text.length + 1) >>> 0;
    const out = wasm(ptr);
    for (let i = 0; i < text.length; i++) bytes[out + i] = text.charCodeAt(i);
    bytes[out + text.length] = 0;
    return ptr;
  };
  const strW = text => {
    const ptr = e.guest_alloc((text.length + 1) * 2) >>> 0;
    const out = wasm(ptr);
    for (let i = 0; i < text.length; i++) dv.setUint16(out + i * 2, text.charCodeAt(i), true);
    dv.setUint16(out + text.length * 2, 0, true);
    return ptr;
  };
  const title = hwnd => {
    const ptr = e.test_statusbar_title_ptr(hwnd) >>> 0;
    const len = e.test_statusbar_title_len(hwnd) >>> 0;
    return Buffer.from(bytes.subarray(ptr, ptr + len)).toString('latin1');
  };

  // Minimal PE RT_STRING tree: type 6 -> bundle 64 -> en-US -> DATA_RVA.
  // Bundle 64 slot 15 is string ID 1023 (command offset 1000 + item 23).
  const root = wasm(IMAGE_BASE + RSRC_RVA);
  const entry = (base, id, child) => {
    dv.setUint16(base + 14, 1, true);
    dv.setUint32(base + 16, id, true);
    dv.setUint32(base + 20, child, true);
  };
  entry(root, 6, 0x80000020);
  entry(root + 0x20, 64, 0x80000040);
  entry(root + 0x40, 0x0409, 0x00000060);
  dv.setUint32(root + 0x60, DATA_RVA, true);
  const help = 'Command help';
  dv.setUint32(root + 0x64, 32 + help.length * 2, true);
  const data = wasm(IMAGE_BASE + DATA_RVA);
  for (let i = 0; i < 15; i++) dv.setUint16(data + i * 2, 0, true);
  dv.setUint16(data + 30, help.length, true);
  for (let i = 0; i < help.length; i++) {
    dv.setUint16(data + 32 + i * 2, help.charCodeAt(i), true);
  }
  const resourceProbe = e.guest_alloc(512) >>> 0;
  assert.strictEqual(e.test_string_load_w(IMAGE_BASE, 1023, resourceProbe), help.length,
    'the test RT_STRING fixture is readable through the same module context');

  const status = e.test_create_statusbar(strA('Ready')) >>> 0;
  assert.strictEqual(title(status), 'Ready');
  assert.strictEqual(e.test_statusbar_class(status), 0,
    'registered status bar keeps class zero so COMCTL32 owns its wndproc');
  assert.strictEqual(e.test_statusbar_queue_and_drain(status), 1,
    'a visible class-zero native status bar drains its retained WM_PAINT');
  assert.strictEqual(e.test_statusbar_drain(), 0,
    'draining validates the native status bar exactly once');

  // Simple-part text is retained independently and appears only in simple mode.
  assert.strictEqual(e.test_statusbar_send(status, 0x040b, 0x01ff, strW('Transient')), 1);
  assert.strictEqual(title(status), 'Ready');
  assert.strictEqual(e.test_statusbar_send(status, 0x0409, 1, 0), 1);
  assert.strictEqual(title(status), 'Transient');
  assert.strictEqual(e.test_statusbar_send(status, 0x0409, 0, 0), 1);
  assert.strictEqual(title(status), 'Ready');

  const ids = e.guest_alloc(32) >>> 0;
  const idsW = wasm(ids);
  dv.setUint32(idsW, 1000, true);       // ordinary command string-id offset
  dv.setUint32(idsW + 4, 2000, true);   // direct popup index offset
  dv.setUint32(idsW + 8, 0, true);      // trailing-pair terminator
  dv.setUint32(idsW + 12, 0, true);

  const main = e.test_call_CreatePopupMenu() >>> 0;
  assert.strictEqual(e.test_menu_help_resource_id(23, main, main, ids), 1023);
  assert.strictEqual(e.test_menu_help_resource_id((0x10 << 16) | 2, main, main, ids), 2002);
  assert.strictEqual(e.test_menu_help_resource_id((0x800 << 16) | 23, main, main, ids), 0,
    'a separator has no help resource');

  const child = e.test_call_CreatePopupMenu() >>> 0;
  const parent = e.test_call_CreatePopupMenu() >>> 0;
  assert.strictEqual(e.test_call_AppendMenuA(parent, 0x10, child, 0), 1);
  dv.setUint32(idsW + 8, 3001, true);
  dv.setUint32(idsW + 12, child, true);
  dv.setUint32(idsW + 16, 0, true);
  dv.setUint32(idsW + 20, 0, true);
  assert.strictEqual(e.test_menu_help_resource_id(0x10 << 16, parent, main, ids), 3001,
    'nested popups resolve through the documented string-id/HMENU pairs');

  assert.strictEqual(e.test_menu_help(0x0111, 23, parent, main, IMAGE_BASE, status, ids), 32,
    'the Win98 WM_COMMAND no-op still pops return address plus seven arguments');
  assert.strictEqual(title(status), 'Ready');
  assert.strictEqual(e.test_menu_help(0x011f, 23, parent, main, IMAGE_BASE, status, ids), 32,
    'MenuHelp uses the seven-argument stdcall ABI');
  assert.strictEqual(title(status), help,
    'WM_MENUSELECT loads the command help resource into the status simple pane');
  assert.strictEqual(e.test_menu_help(0x011f, 0xffff0000, 0, main, IMAGE_BASE, status, ids), 32);
  assert.strictEqual(title(status), 'Ready',
    'the menu-close sentinel restores the ordinary status pane');

  const eraseMsg = e.guest_alloc(16) >>> 0;
  assert.strictEqual(e.test_statusbar_dispatch_erase(status, eraseMsg), 8,
    'native status erase completes as the one-argument DispatchMessage call');
  assert.strictEqual(e.test_statusbar_dispatch_eip() >>> 0, 0x0040aaaa,
    'native status erase is completed by USER without entering the guest wndproc');
  assert.strictEqual(e.get_eax() >>> 0, 1,
    'native status erase reports that its face was painted');

  assert(e.test_statusbar_state_ptr(status), 'status bar owns its two text panes');
  e.test_destroy_statusbar(status);
  assert.strictEqual(e.test_statusbar_state_ptr(status), 0,
    'WM_DESTROY retires status-bar pane storage');

  console.log('PASS  MenuHelp matches Win98 selection, status-pane, and stdcall behavior');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
