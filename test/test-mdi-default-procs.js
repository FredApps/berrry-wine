#!/usr/bin/env node

'use strict';

// USER's MDI contract is split across the preregistered MDICLIENT class and
// the default frame/child procedures. Keep the pieces together: an exported
// DefFrameProcA alone lets an MFC frame start, but CreateWindow("MDICLIENT")
// then routes the built-in sentinel into the x86 decoder.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');

const extraWat = String.raw`
  (global $test_mdi_delta (mut i32) (i32.const 0))

  (func $test_make_window (param $parent i32) (param $class i32)
      (param $id i32) (result i32)
    (local $hwnd i32) (local $slot i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (call $ctrl_table_set (local.get $slot) (local.get $class) (local.get $id))
    (local.get $hwnd))

  (func (export "test_class_id") (param $name i32) (result i32)
    (call $class_name_to_ctrl_id (local.get $name)))

  (func (export "test_make_frame") (result i32)
    (call $test_make_window (i32.const 0) (i32.const 0) (i32.const 0)))

  (func (export "test_make_client")
      (param $frame i32) (param $window_menu i32) (param $first_id i32)
      (result i32)
    (local $client i32) (local $ccs i32) (local $cs i32) (local $result i32)
    (local.set $client
      (call $test_make_window (local.get $frame) (i32.const 33) (i32.const 0)))
    (local.set $ccs (call $heap_alloc (i32.const 8)))
    (local.set $cs (call $heap_alloc (i32.const 48)))
    (call $gs32 (local.get $ccs) (local.get $window_menu))
    (call $gs32 (i32.add (local.get $ccs) (i32.const 4)) (local.get $first_id))
    (call $gs32 (local.get $cs) (local.get $ccs))
    (local.set $result (call $mdiclient_wndproc
      (local.get $client) (i32.const 1) (i32.const 0) (local.get $cs)))
    (call $heap_free (local.get $cs))
    (call $heap_free (local.get $ccs))
    (if (i32.eq (local.get $result) (i32.const -1))
      (then (return (i32.const 0))))
    (local.get $client))

  (func (export "test_make_child") (param $client i32) (param $id i32) (result i32)
    (local $child i32)
    (local.set $child
      (call $test_make_window (local.get $client) (i32.const 0) (local.get $id)))
    (drop (call $mdi_child_message
      (local.get $child) (i32.const 1) (i32.const 0) (i32.const 0)))
    (local.get $child))

  (func (export "test_active") (param $client i32) (result i32)
    (call $mdi_client_active (local.get $client)))
  (func (export "test_focus") (result i32)
    (global.get $focus_hwnd))
  (func (export "test_child_id") (param $child i32) (result i32)
    (call $ctrl_table_get_id (local.get $child)))
  (func (export "test_parent") (param $hwnd i32) (result i32)
    (call $wnd_get_parent (local.get $hwnd)))
  (func (export "test_style") (param $hwnd i32) (result i32)
    (call $wnd_get_style (local.get $hwnd)))
  (func (export "test_set_proc") (param $hwnd i32) (param $proc i32)
    (call $wnd_table_set (local.get $hwnd) (local.get $proc)))
  (func (export "test_client_message")
      (param $client i32) (param $msg i32) (param $wp i32) (param $lp i32)
      (result i32)
    (call $mdiclient_wndproc
      (local.get $client) (local.get $msg) (local.get $wp) (local.get $lp)))
  (func (export "test_frame_message")
      (param $frame i32) (param $client i32) (param $msg i32)
      (param $wp i32) (param $lp i32) (result i32)
    (call $mdi_frame_message
      (local.get $frame) (local.get $client) (local.get $msg)
      (local.get $wp) (local.get $lp)))

  (func (export "test_def_frame") (param $wide i32) (result i32)
    (local $saved i32) (local $before i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then (call $handle_DefFrameProcW
        (i32.const 0) (i32.const 0) (i32.const 0x0081)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_DefFrameProcA
        (i32.const 0) (i32.const 0) (i32.const 0x0081)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (global.set $test_mdi_delta (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_def_child") (param $wide i32) (result i32)
    (local $saved i32) (local $before i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then (call $handle_DefMDIChildProcW
        (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_DefMDIChildProcA
        (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (global.set $test_mdi_delta (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_translate") (param $client i32) (param $msg i32) (result i32)
    (local $saved i32) (local $before i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $handle_TranslateMDISysAccel
      (local.get $client) (local.get $msg) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_mdi_delta (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  ;; Exercise the public synchronous SendMessage contract with a WAT-native
  ;; child class, so WM_MDICREATE can finish entirely inside this export. The
  ;; authentic Dependency Walker acceptance below covers the guest-wndproc +
  ;; MFC CBT continuation path.
  (func (export "test_mdi_create")
      (param $client i32) (param $class i32) (param $title i32)
      (param $wide i32) (result i32)
    (local $saved i32) (local $before i32) (local $mdi i32) (local $child i32)
    (local.set $mdi (call $heap_alloc (i32.const 36)))
    (call $gs32 (local.get $mdi) (local.get $class))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 4)) (local.get $title))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 8)) (global.get $image_base))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 12)) (i32.const 3))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 16)) (i32.const 4))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 20)) (i32.const 120))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 24)) (i32.const 80))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 28)) (i32.const 0x10000000))
    (call $gs32 (i32.add (local.get $mdi) (i32.const 32)) (i32.const 0x12345678))
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 20)))
    (local.set $before (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x76543210))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4)) (local.get $client))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8)) (i32.const 0x0220))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)) (i32.const 0))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 16)) (local.get $mdi))
    (if (local.get $wide)
      (then (call $handle_SendMessageW
        (local.get $client) (i32.const 0x0220) (i32.const 0) (local.get $mdi)
        (i32.const 0) (i32.const 0)))
      (else (call $handle_SendMessageA
        (local.get $client) (i32.const 0x0220) (i32.const 0) (local.get $mdi)
        (i32.const 0) (i32.const 0))))
    (local.set $child (i32.load offset=0 (global.get $reg_base)))
    (global.set $test_mdi_delta (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $before)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (call $heap_free (local.get $mdi))
    (local.get $child))

  (func (export "test_mdi_delta") (result i32)
    (global.get $test_mdi_delta))
`;

(async () => {
  const keys = new Set();
  const { exports: e, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      set_window_zorder() {},
      activate_window() { return 1; },
      get_key_down_state(vk) { return keys.has(vk >>> 0) ? 0x8000 : 0; },
    },
  });

  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes USER state');
  e.init_dx_com_thunks();

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const className = e.guest_alloc(16) >>> 0;
  new Uint8Array(memory.buffer).set(
    Buffer.from('MDICLIENT\0', 'ascii'), toWasm(className));
  assert.strictEqual(e.test_class_id(className), 33,
    'MDICLIENT is recognized as a preregistered USER class');

  assert.strictEqual(e.test_def_frame(0), 1,
    'DefFrameProcA with NULL client falls through to DefWindowProcA');
  assert.strictEqual(e.test_mdi_delta(), 24,
    'DefFrameProcA pops return address plus five arguments');
  assert.strictEqual(e.test_def_frame(1), 1,
    'DefFrameProcW with NULL client falls through to DefWindowProcW');
  assert.strictEqual(e.test_mdi_delta(), 24,
    'DefFrameProcW pops return address plus five arguments');
  assert.strictEqual(e.test_def_child(0), 0);
  assert.strictEqual(e.test_mdi_delta(), 20,
    'DefMDIChildProcA pops return address plus four arguments');
  assert.strictEqual(e.test_def_child(1), 0);
  assert.strictEqual(e.test_mdi_delta(), 20,
    'DefMDIChildProcW pops return address plus four arguments');

  const frame = e.test_make_frame() >>> 0;
  const client = e.test_make_client(frame, 0x1234, 0xe900) >>> 0;
  assert(client, 'MDICLIENT WM_CREATE accepts CLIENTCREATESTRUCT');
  const first = e.test_make_child(client, 0) >>> 0;
  const second = e.test_make_child(client, 0) >>> 0;
  assert.strictEqual(e.test_child_id(first), 0xe900,
    'first MDI child receives CLIENTCREATESTRUCT.idFirstChild');
  assert.strictEqual(e.test_child_id(second), 0xe901,
    'subsequent MDI child receives the next Window-menu command ID');
  assert.strictEqual(e.test_active(client) >>> 0, second,
    'newly created MDI child becomes active');
  assert.strictEqual(e.test_focus() >>> 0, second,
    'newly active application MDI child receives keyboard focus');

  assert.strictEqual(e.test_frame_message(frame, client, 0x0111, 0xe900, 0), 1,
    'DefFrameProc consumes Window-menu child commands');
  assert.strictEqual(e.test_active(client) >>> 0, first,
    'Window-menu command activates the matching child');
  assert.strictEqual(e.test_focus() >>> 0, first,
    'Window-menu activation also transfers keyboard focus');
  e.test_client_message(client, 0x0224, first, 0);
  assert.strictEqual(e.test_active(client) >>> 0, second,
    'WM_MDINEXT advances to the following child');
  e.test_client_message(client, 0x0224, second, 0);
  assert.strictEqual(e.test_active(client) >>> 0, first,
    'WM_MDINEXT wraps at the last child');
  assert.strictEqual(e.test_client_message(client, 0x0229, 0, 0) >>> 0, first,
    'WM_MDIGETACTIVE returns the selected child');

  const observed = e.guest_alloc(4) >>> 0;
  const proc = e.guest_alloc(32) >>> 0;
  const u32 = value => [value, value >>> 8, value >>> 16, value >>> 24]
    .map(byte => byte & 0xff);
  new Uint8Array(memory.buffer).set(Uint8Array.from([
    0x8b, 0x44, 0x24, 0x08,       // mov eax,[esp+8] (message)
    0xa3, ...u32(observed),        // mov [observed],eax
    0x31, 0xc0,                    // xor eax,eax
    0xc2, 0x10, 0x00,              // ret 16
  ]), toWasm(proc));
  e.test_set_proc(first, proc);
  new DataView(memory.buffer).setUint32(toWasm(observed), 0, true);
  assert.strictEqual(e.test_frame_message(frame, client, 0x0086, 1, 0), 0,
    'WM_NCACTIVATE still falls through to the frame default procedure');
  assert.strictEqual(new DataView(memory.buffer).getUint32(toWasm(observed), true), 0x0086,
    'frame activation is mirrored to the last active MDI child');

  const msg = e.guest_alloc(28) >>> 0;
  const view = new DataView(memory.buffer);
  view.setUint32(toWasm(msg) + 4, 0x0100, true); // WM_KEYDOWN
  view.setUint32(toWasm(msg) + 8, 0x73, true);   // VK_F4
  assert.strictEqual(e.test_translate(client, msg), 0,
    'F4 without Ctrl is not an MDI system accelerator');
  keys.add(0x11); // VK_CONTROL
  assert.strictEqual(e.test_translate(client, msg), 1,
    'Ctrl+F4 is translated for the active MDI child');
  assert.strictEqual(e.test_mdi_delta(), 12,
    'TranslateMDISysAccel pops return address plus two arguments');
  view.setUint32(toWasm(msg) + 8, 0x75, true); // VK_F6
  assert.strictEqual(e.test_translate(client, msg), 1,
    'Ctrl+F6 is translated for the active MDI child');
  keys.add(0x10); // VK_SHIFT
  assert.strictEqual(e.test_translate(client, msg), 1,
    'Ctrl+Shift+F6 is translated in the reverse direction');

  const createFrame = e.test_make_frame() >>> 0;
  const createClient = e.test_make_client(createFrame, 0x5678, 0xea00) >>> 0;
  const ansiClass = e.guest_alloc(16) >>> 0;
  const ansiTitle = e.guest_alloc(16) >>> 0;
  new Uint8Array(memory.buffer).set(Buffer.from('STATIC\0', 'ascii'), toWasm(ansiClass));
  new Uint8Array(memory.buffer).set(Buffer.from('ansi child\0', 'ascii'), toWasm(ansiTitle));
  const ansiChild = e.test_mdi_create(createClient, ansiClass, ansiTitle, 0) >>> 0;
  assert(ansiChild, 'WM_MDICREATE returns the created ANSI child HWND');
  assert.strictEqual(e.test_mdi_delta(), 20,
    'WM_MDICREATE preserves SendMessageA stdcall cleanup');
  assert.strictEqual(e.test_parent(ansiChild) >>> 0, createClient,
    'WM_MDICREATE parents the new window to the MDI client');
  assert.strictEqual(e.test_child_id(ansiChild), 0xea00,
    'WM_MDICREATE assigns CLIENTCREATESTRUCT.idFirstChild as the child ID');
  assert.strictEqual(
    e.test_style(ansiChild) >>> 0,
    (0x10000000 | 0x46cf0000) >>> 0,
    'WM_MDICREATE adds the documented standard MDI-child styles');

  const wideClass = e.guest_alloc(32) >>> 0;
  const wideTitle = e.guest_alloc(32) >>> 0;
  new Uint8Array(memory.buffer).set(Buffer.from('STATIC\0', 'utf16le'), toWasm(wideClass));
  new Uint8Array(memory.buffer).set(Buffer.from('wide child\0', 'utf16le'), toWasm(wideTitle));
  const wideChild = e.test_mdi_create(createClient, wideClass, wideTitle, 1) >>> 0;
  assert(wideChild, 'WM_MDICREATE returns the created Unicode child HWND');
  assert.strictEqual(e.test_mdi_delta(), 20,
    'WM_MDICREATE preserves SendMessageW stdcall cleanup');
  assert.strictEqual(e.test_child_id(wideChild), 0xea01,
    'ANSI and Unicode creation share the next Window-menu command ID');
  assert.strictEqual(e.test_active(createClient) >>> 0, wideChild,
    'a successfully created MDI child becomes active');

  const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'api_table.json')));
  for (const [name, nargs] of [
    ['DefFrameProcA', 5], ['DefFrameProcW', 5],
    ['DefMDIChildProcA', 4], ['DefMDIChildProcW', 4],
    ['TranslateMDISysAccel', 2],
  ]) {
    const row = api.find(entry => entry.name === name);
    assert(row, `${name} is exported`);
    assert.strictEqual(row.nargs, nargs, `${name} stdcall arity`);
  }

  console.log('PASS  ANSI/Wide MDI defaults preserve ABI, activation, and Window-menu routing');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
