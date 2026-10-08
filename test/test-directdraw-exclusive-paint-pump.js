#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

// A child paints through DirectDraw, validates itself, then Unlock presents
// the primary. Presentation must not manufacture the child's next WM_PAINT.
const extraWat = `
  (global $test_present_parent (mut i32) (i32.const 0))
  (global $test_present_child (mut i32) (i32.const 0))
  (global $test_present_native (mut i32) (i32.const 0))
  (func (export "test_present_setup") (result i32)
    (local $p i32) (local $c i32) (local $entry i32) (local $wrapper i32)
    (local.set $p (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $p) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $p) (i32.const 0)
      (i32.const 0) (i32.const 8) (i32.const 8) (i32.const 0))
    (call $wnd_table_set (local.get $p) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $p) (i32.const 0x90000000)))
    (call $client_rect_set (local.get $p) (i32.const 0) (i32.const 0) (i32.const 8) (i32.const 8))
    (global.set $test_present_parent (local.get $p))
    (global.set $main_hwnd (local.get $p))
    (call $dx_coop_hwnd_set (local.get $p))
    (call $dx_exclusive_set (i32.const 1))
    (local.set $c (call $ctrl_create_child (local.get $p) (i32.const 4) (i32.const 101)
      (i32.const 0) (i32.const 0) (i32.const 4) (i32.const 4)
      (i32.const 0x50000000) (i32.const 0)))
    (global.set $test_present_child (local.get $c))
    (global.set $test_present_native (call $ctrl_create_child (local.get $p) (i32.const 4) (i32.const 102)
      (i32.const 4) (i32.const 0) (i32.const 4) (i32.const 4)
      (i32.const 0x50000000) (i32.const 0)))
    (drop (call $gdi_window_surface_record (local.get $p) (i32.const 1)))
    (local.set $entry (call $dx_alloc (i32.const 2)))
    (store.field DxObject flags (local.get $entry) (i32.const 1))
    (store.field DxObject width (local.get $entry) (i32.const 8))
    (store.field DxObject height (local.get $entry) (i32.const 8))
    (store.field DxObject bpp (local.get $entry) (i32.const 32))
    (store.field DxObject pitch (local.get $entry) (i32.const 32))
    (store.field DxObject misc1 (local.get $entry) (call $g2w (call $dib_alloc (i32.const 256))))
    (global.set $dx_primary_wa (local.get $entry))
    (local.set $wrapper (call $heap_alloc (i32.const 8)))
    (call $gs32 (local.get $wrapper) (i32.const 0))
    (call $gs32 (i32.add (local.get $wrapper) (i32.const 4)) (call $dx_slot_of (local.get $entry)))
    (call $update_clear_hwnd (local.get $p))
    (call $paint_flag_clear_hwnd (local.get $p))
    (call $update_clear_hwnd (local.get $c))
    (call $paint_flag_clear_hwnd (local.get $c))
    (call $update_clear_hwnd (global.get $test_present_native))
    (call $paint_flag_clear_hwnd (global.get $test_present_native))
    (local.get $wrapper))
  (func (export "test_present_child") (result i32) (global.get $test_present_child))
  (func (export "test_present_native") (result i32) (global.get $test_present_native))
  (func (export "test_present_proc") (param $proc i32)
    (call $wnd_table_set (global.get $test_present_child) (local.get $proc)))
  (func (export "test_present_mode") (param $exclusive i32) (call $dx_exclusive_set (local.get $exclusive)))
  (func (export "test_present_damage") (param $h i32) (result i32)
    (call $update_get_rect (local.get $h) (i32.const 0)))
  (func (export "test_present_invalidate") (param $h i32) (call $invalidate_hwnd (local.get $h)))
  (func (export "test_present_update") (call $update_window_now (global.get $test_present_child)))
  (func (export "test_present_next") (result i32) (call $paint_select_next_dirty))
  (func (export "test_present_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
`;
const u32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 255);
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none', width: 8, height: 8 });
  const wrapper = e.test_present_setup(), child = e.test_present_child(), native = e.test_present_native();
  const calls = e.guest_alloc(4);
  const validate = e.test_present_thunk(apiTable.find(a => a.name === 'ValidateRect').id);
  const unlock = e.test_present_thunk(apiTable.find(a => a.name === 'IDirectDrawSurface_Unlock').id);
  // Real stdcall guest callback: record invocation, validate, present, return.
  const code = [0xff, 0x05, ...u32(calls),
    0x6a, 0, 0x68, ...u32(child), 0xb8, ...u32(validate), 0xff, 0xd0,
    0x6a, 0, 0x68, ...u32(wrapper), 0xb8, ...u32(unlock), 0xff, 0xd0,
    0x33, 0xc0, 0xc2, 16, 0];
  const proc = e.guest_alloc(code.length);
  code.forEach((b, i) => e.guest_write8(proc + i, b));
  e.test_present_proc(proc);
  e.test_present_invalidate(child);
  const sp = e.get_esp();
  e.test_present_update();
  assert.equal(e.get_esp(), sp, 'nested guest validation/Unlock restores the caller stack');
  assert.equal(e.guest_read32(calls), 1, 'one real WM_PAINT callback runs');
  assert.equal(e.test_present_damage(child), 0, 'exclusive primary Unlock must not renew validated child damage');
  assert.equal(e.paint_flag_test(child), 0, 'exclusive presentation must not manufacture child paint');
  assert.equal(e.test_present_damage(native), 0, 'an unrelated native sibling stays clean');
  assert.equal(e.test_present_next(), 0, 'the message pump can drain after presentation');
  e.test_present_update();
  assert.equal(e.guest_read32(calls), 1, 'a clean UpdateWindow does not call the guest again');
  e.test_present_invalidate(child);
  assert.equal(e.test_present_damage(child), 1, 'ordinary later invalidation remains deliverable');
  e.test_present_update();
  assert.equal(e.guest_read32(calls), 2);
  // Windowed DirectDraw still overwrites a shared GDI surface. Those controls
  // must retain their existing repaint behavior when returning from exclusive.
  e.test_present_mode(0);
  e.test_present_invalidate(child);
  e.test_present_update();
  assert.equal(e.test_present_damage(child), 1, 'windowed shared presentation still exposes its child');
  assert.equal(e.test_present_damage(native), 1, 'windowed presentation still repaints native siblings');
  assert.equal(e.paint_flag_test(native), 1);
  console.log('PASS exclusive primary Unlock drains validated child paint; later damage and windowed child exposure survive');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
