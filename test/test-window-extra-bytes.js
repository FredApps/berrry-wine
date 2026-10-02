#!/usr/bin/env node

'use strict';

// Two window-geometry/state contracts InstallShield 3's file-copy progress
// dialog depends on (Need for Speed II SE retail setup, _ins0432._mp):
//
// 1. cbWndExtra is 40 bytes on Win9x. IS3's gauge class (ISBarCls) stores its
//    colours with SetWindowLong at offsets 4 (fill, navy) and 0x10 (empty
//    part, white) in WM_CREATE and reads them back in WM_PAINT for two
//    ETO_OPAQUE|ETO_CLIPPED ExtTextOuts. With 16 bytes of extra storage the
//    0x10 store was refused, GetWindowLong returned 0, and the empty part of
//    the bar and its percentage text were painted black.
//
// 2. A WS_CHILD dialog whose template asks for WS_CAPTION is created with a
//    caption and frame around its template-sized client, as CreateDialog's
//    AdjustWindowRectEx does. IS3's "Setup" progress dialog is
//    WS_CHILD|WS_CAPTION|DS_MODALFRAME; left at its template size, the
//    caption came out of the client area and clipped the Cancel button.
//
//   node test/test-window-extra-bytes.js

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_new_window") (param $hwnd i32)
    (call $wnd_table_set (local.get $hwnd) (i32.const 0)))

  (func (export "test_extra_set") (param $hwnd i32) (param $index i32) (param $value i32) (result i32)
    (call $wnd_extra_set (local.get $hwnd) (local.get $index) (local.get $value)))

  (func (export "test_extra_get") (param $hwnd i32) (param $index i32) (result i32)
    (call $wnd_extra_get (local.get $hwnd) (local.get $index)))

  (func (export "test_SetWindowWord") (param $hwnd i32) (param $index i32) (param $value i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowWord
      (local.get $hwnd) (local.get $index) (local.get $value)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dialog_wh") (param $hwnd i32) (param $template i32) (result i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_DIALOG))
    (global.set $dlg_indirect_template_ptr (local.get $template))
    (drop (call $dlg_load (local.get $hwnd) (i32.const 0)))
    (call $ctrl_get_wh_packed (local.get $hwnd)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });
  const view = new DataView(memory.buffer);
  const base = e.get_guest_base() >>> 0;

  // --- 1. window extra bytes ------------------------------------------------
  const hwnd = 0x20001;
  e.test_new_window(hwnd);
  // IS3 ISBarCls WM_CREATE: SetWindowLong(0,0) (4,0x800000) (0x10,0xffffff)
  // (8,0) (0xc,0).
  e.test_extra_set(hwnd, 0, 0);
  e.test_extra_set(hwnd, 4, 0x800000);
  e.test_extra_set(hwnd, 0x10, 0xffffff);
  e.test_extra_set(hwnd, 8, 0);
  e.test_extra_set(hwnd, 0xc, 0);
  assert.strictEqual(e.test_extra_get(hwnd, 4) >>> 0, 0x800000, 'fill colour at offset 4');
  assert.strictEqual(e.test_extra_get(hwnd, 0x10) >>> 0, 0xffffff,
    'empty-part colour at offset 0x10 must survive (ISBarCls)');

  // Every LONG offset up to cbWndExtra-4 = 36 is independent storage.
  for (let off = 0; off <= 36; off += 4) e.test_extra_set(hwnd, off, 0x1000 + off);
  for (let off = 0; off <= 36; off += 4) {
    assert.strictEqual(e.test_extra_get(hwnd, off) >>> 0, 0x1000 + off, `LONG at ${off}`);
  }
  // Past the 40-byte Win9x limit nothing is stored and 0 comes back.
  assert.strictEqual(e.test_extra_set(hwnd, 40, 0xdead) >>> 0, 0, 'offset 40 refused');
  assert.strictEqual(e.test_extra_get(hwnd, 40) >>> 0, 0, 'offset 40 reads 0');
  assert.strictEqual(e.test_extra_get(hwnd, 37) >>> 0, 0, 'LONG straddling the end reads 0');

  // SetWindowWord touches exactly two bytes, up to offset 38.
  assert.strictEqual(e.test_SetWindowWord(hwnd, 38, 0xbeef) >>> 0, 0, 'old word at 38 (high half of 0x1024)');
  assert.strictEqual(e.test_extra_get(hwnd, 36) >>> 0, 0xbeef1024, 'word at 38 is the high half of LONG 36');
  assert.strictEqual(e.test_SetWindowWord(hwnd, 39, 1) >>> 0, 0, 'word at 39 refused');

  // A new window in a reused slot starts with all 40 bytes zero.
  const other = 0x20002;
  e.test_new_window(other);
  for (let off = 0; off <= 36; off += 4) {
    assert.strictEqual(e.test_extra_get(other, off) >>> 0, 0, `fresh window LONG at ${off}`);
  }

  // --- 2. dialog window size from its template -------------------------------
  // DLGTEMPLATE: style, exStyle, cdit, x, y, cx, cy, menu=0, class=0, title="".
  const template = (style, cx, cy) => {
    const ptr = e.guest_alloc(32) >>> 0;
    const p = base + ptr;
    view.setUint32(p, style >>> 0, true);
    view.setUint32(p + 4, 0, true);
    view.setUint16(p + 8, 0, true);
    view.setInt16(p + 10, 0, true);
    view.setInt16(p + 12, 0, true);
    view.setInt16(p + 14, cx, true);
    view.setInt16(p + 16, cy, true);
    view.setUint16(p + 18, 0, true);
    view.setUint16(p + 20, 0, true);
    view.setUint16(p + 22, 0, true);
    return ptr;
  };
  const wh = (hwndDlg, style) => {
    const packed = e.test_dialog_wh(hwndDlg, template(style, 210, 67)) >>> 0;
    return [packed & 0xffff, packed >>> 16];
  };
  // 210x67 DLU at the 6x13 base is a 315x109 client.
  const WS_CHILD = 0x40000000, WS_POPUP = 0x80000000;
  const WS_CAPTION = 0x00C00000, WS_BORDER = 0x00800000, DS_MODALFRAME = 0x80;
  const top = wh(0x20010, WS_POPUP | WS_CAPTION | DS_MODALFRAME);
  const isSetup = wh(0x20011, WS_CHILD | WS_CAPTION | DS_MODALFRAME);
  assert.deepStrictEqual(isSetup, top,
    'a captioned child dialog gets the same frame and caption as a top-level one');
  assert.ok(isSetup[0] > 315 && isSetup[1] >= 109 + 19,
    `captioned child dialog window ${isSetup} must enclose a 315x109 client plus caption`);
  assert.deepStrictEqual(wh(0x20012, WS_CHILD), [315, 109],
    'a chrome-less child page keeps its template size');
  assert.deepStrictEqual(wh(0x20013, WS_CHILD | WS_BORDER), [317, 111],
    'a bordered child dialog gets the 1px simple child border');

  console.log('PASS test-window-extra-bytes');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
