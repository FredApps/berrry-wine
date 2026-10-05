#!/usr/bin/env node
'use strict';

// EDIT keeps an ANSI internal buffer for painting, but a control created by
// CreateWindowExW must consume and produce UTF-16 for the window-text messages.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_seed_empty_text") (param $src i32)
    (global.set $clipboard_open (i32.const 1))
    (global.set $clipboard_owner_hwnd (i32.const 0x10001))
    (global.set $clipboard_emptied_by_opener (i32.const 1))
    (call $handle_SetClipboardData (i32.const 1) (local.get $src)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "test_create_unicode_edit") (param $class i32) (param $title i32) (result i32)
    (local $saved_esp i32) (local $hwnd i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (i32.const 0))   ;; y
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (i32.const 200)) ;; cx
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (i32.const 24))  ;; cy
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36)) (i32.const 0))   ;; parent
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 40)) (i32.const 100)) ;; menu/id
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 44)) (i32.const 0))   ;; instance
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 48)) (i32.const 0))   ;; param
    (call $handle_CreateWindowExW
      (i32.const 0) (local.get $class) (local.get $title)
      (i32.const 0x50010000) (i32.const 0) (i32.const 0))
    (local.set $hwnd (i32.load offset=0 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (local.get $hwnd))

  (func (export "test_edit_message")
    (param $hwnd i32) (param $msg i32) (param $wp i32) (param $lp i32)
    (result i32)
    (call $edit_wndproc
      (local.get $hwnd) (local.get $msg) (local.get $wp) (local.get $lp)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const src = 0x2800;
  const dst = 0x2a00;
  const value = 'C:\\GOG Games\\Lure of the Temptress';
  const className = e.guest_alloc(10) >>> 0;
  const title = e.guest_alloc((value.length + 1) * 2) >>> 0;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    e.guest_write8(src + i * 2, code & 0xff);
    e.guest_write8(src + i * 2 + 1, code >>> 8);
  }
  e.guest_write8(src + value.length * 2, 0);
  e.guest_write8(src + value.length * 2 + 1, 0);
  for (let i = 0; i < value.length; i++) {
    e.guest_write8(title + i * 2, value.charCodeAt(i));
    e.guest_write8(title + i * 2 + 1, 0);
  }
  e.guest_write8(title + value.length * 2, 0);
  e.guest_write8(title + value.length * 2 + 1, 0);
  for (let i = 0; i < 4; i++) {
    e.guest_write8(className + i * 2, 'EDIT'.charCodeAt(i));
    e.guest_write8(className + i * 2 + 1, 0);
  }
  e.guest_write8(className + 8, 0);
  e.guest_write8(className + 9, 0);

  const hwnd = e.test_create_unicode_edit(className, title) >>> 0;
  const heapAfterFirst = e.get_heap_ptr() >>> 0;
  assert.ok(hwnd, 'CreateWindowExW creates a Unicode EDIT');
  assert.strictEqual(e.guest_read32((e.get_image_base() >>> 0) + 0x124) >>> 0, title,
    'CREATESTRUCTW retains the caller UTF-16 title pointer');
  assert.strictEqual(e.guest_read32((e.get_image_base() >>> 0) + 0x128) >>> 0, className,
    'CREATESTRUCTW retains the caller UTF-16 class pointer');
  assert.ok(e.test_create_unicode_edit(className, title) >>> 0, 'a second CreateWindowExW succeeds');
  const heapGrowth = (e.get_heap_ptr() >>> 0) - heapAfterFirst;
  assert.ok(heapGrowth < 256,
    `CreateWindowExW frees its 768-byte conversion buffers (per-window growth was ${heapGrowth})`);

  assert.strictEqual(e.test_edit_message(hwnd, 0x000c, 0, src) | 0, 1,
    'Unicode WM_SETTEXT succeeds');
  assert.strictEqual(e.test_edit_message(hwnd, 0x000e, 0, 0) | 0, value.length,
    'WM_GETTEXTLENGTH counts UTF-16 code units, not bytes');
  assert.strictEqual(e.test_edit_message(hwnd, 0x000d, 260, dst) | 0, value.length,
    'Unicode WM_GETTEXT returns the character count');

  let roundTrip = '';
  for (let i = 0; i < 260; i++) {
    const code = e.guest_read8(dst + i * 2) |
      (e.guest_read8(dst + i * 2 + 1) << 8);
    if (!code) break;
    roundTrip += String.fromCharCode(code);
  }
  assert.strictEqual(roundTrip, value);

  e.clipboard_clear_all_data();
  e.test_edit_message(hwnd, 0x00b1, 0, -1); // EM_SETSEL, whole text
  e.test_edit_message(hwnd, 0x0302, 0, 0); // WM_PASTE: absent format is a no-op
  assert.strictEqual(e.test_edit_message(hwnd, 0x000e, 0, 0), value.length);
  const empty = e.guest_alloc(1) >>> 0;
  e.guest_write8(empty, 0);
  e.test_seed_empty_text(empty);
  e.test_edit_message(hwnd, 0x0302, 0, 0);
  assert.strictEqual(e.test_edit_message(hwnd, 0x000e, 0, 0), value.length,
    'existing empty-text paste policy stays unchanged pending native evidence');
  e.test_edit_message(hwnd, 0x000c, 0, src);
  e.test_edit_message(hwnd, 0x00b1, 0, 3);
  e.test_edit_message(hwnd, 0x0301, 0, 0); // WM_COPY publishes nonempty native text
  assert.strictEqual(e.clipboard_text_len(), 3);
  assert.strictEqual(e.clipboard_is_format_available(1), 1);

  console.log('PASS  Unicode EDIT window text round-trips through UTF-16 messages');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
