#!/usr/bin/env node
'use strict';

// Internal synchronous SendMessage must never treat USER's reserved built-in
// wndproc marker as guest x86. 7-Zip reaches this through SetWindowTextA on a
// common-control window during startup.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_builtin_plain") (param $hwnd i32) (result i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $ctrl_table_set (call $wnd_table_find (local.get $hwnd))
      (i32.const 0) (i32.const 0))
    (global.set $eip (i32.const 0x00401000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00120000))
    (call $wnd_send_message (local.get $hwnd) (i32.const 0x000C)
      (i32.const 0) (i32.const 0)))

  (func (export "test_builtin_static")
      (param $hwnd i32) (param $text i32) (result i32)
    (local $cs i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $ctrl_table_set (call $wnd_table_find (local.get $hwnd))
      (i32.const 3) (i32.const 77))
    (local.set $cs (call $heap_alloc (i32.const 48)))
    (call $zero_memory (call $g2w (local.get $cs)) (i32.const 48))
    (call $gs32 (i32.add (local.get $cs) (i32.const 32)) (i32.const 0x50000000))
    (call $gs32 (i32.add (local.get $cs) (i32.const 36)) (local.get $text))
    (drop (call $wnd_send_message (local.get $hwnd) (i32.const 0x0001)
      (i32.const 0) (local.get $cs)))
    (drop (call $wnd_send_message (local.get $hwnd) (i32.const 0x000C)
      (i32.const 0) (local.get $text)))
    (call $heap_free (local.get $cs))
    (call $wnd_get_state_ptr (local.get $hwnd)))
`;

function putString(e, text) {
  const ptr = e.guest_alloc(text.length + 1) >>> 0;
  for (let i = 0; i < text.length; i++) e.guest_write8(ptr + i, text.charCodeAt(i));
  e.guest_write8(ptr + text.length, 0);
  return ptr;
}

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  assert.strictEqual(e.test_builtin_plain(0x10001), 0,
    'an unclassified built-in window safely returns DefWindowProc-style zero');
  assert.strictEqual(e.get_eip() >>> 0, 0x00401000,
    'the built-in marker was not installed as a nested x86 EIP');
  assert.strictEqual(e.get_esp() >>> 0, 0x00120000,
    'safe built-in dispatch leaves the guest stack untouched');

  const text = putString(e, 'Seven Zip');
  assert(e.test_builtin_static(0x10002, text) >>> 0,
    'a classified built-in control routes through its native WAT wndproc');
  const out = e.guest_alloc(32) >>> 0;
  assert.strictEqual(e.static_get_text(0x10002, out, 32), 9);
  const actual = Array.from({ length: 9 }, (_, i) => e.guest_read8(out + i))
    .map(byte => String.fromCharCode(byte)).join('');
  assert.strictEqual(actual, 'Seven Zip', 'WM_SETTEXT reached the built-in static control');

  console.log('PASS  internal SendMessage keeps WNDPROC_BUILTIN out of the x86 decoder');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
