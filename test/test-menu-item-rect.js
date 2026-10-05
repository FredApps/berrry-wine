#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_call_GetMenuItemRect")
      (param $hwnd i32) (param $hmenu i32) (param $item i32) (param $rect i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_GetMenuItemRect
      (local.get $hwnd) (local.get $hmenu) (local.get $item) (local.get $rect)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_menu_item_rect_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

const SENTINEL = [0x11111111, 0x22222222, 0x33333333, 0x44444444];

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const view = new DataView(memory.buffer);
  const windowRects = new Map([[0x10001, [100, 50, 500, 350]]]);
  const harness = await bootRenderHarness({
    memory,
    extraWat,
    extraHostOverrides: {
      get_window_rect: (hwnd, out) => {
        const rect = windowRects.get(hwnd >>> 0) || [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) view.setInt32((out >>> 0) + i * 4, rect[i], true);
      },
    },
  });
  const wat = harness.exports;
  const hwnd = 0x10001;
  const hmenu = 0x410134;
  const submenu = 0x010134;

  const allocRect = () => {
    const rect = wat.guest_alloc(16) >>> 0;
    SENTINEL.forEach((value, i) => wat.guest_write32(rect + i * 4, value));
    return rect;
  };
  const readRect = rect => Array.from({ length: 4 }, (_, i) =>
    wat.guest_read32(rect + i * 4) | 0);
  const unchanged = rect => assert.deepStrictEqual(
    readRect(rect).map(value => value >>> 0), SENTINEL,
    'failed query leaves the caller RECT untouched');

  // Two bar items and a two-row File popup. Offsets are relative to the blob.
  const barCount = 2;
  const childOffset = 4 + barCount * 16;
  const stringsOffset = childOffset + 4 + 2 * 28;
  const labels = ['File', 'Edit', 'Open', 'Exit'];
  const blobSize = stringsOffset + labels.reduce((sum, text) => sum + text.length, 0);
  const blob = wat.guest_alloc(blobSize) >>> 0;
  for (let offset = 0; offset < blobSize; offset++) wat.guest_write8(blob + offset, 0);
  wat.guest_write32(blob, barCount);
  let textOffset = stringsOffset;
  const putLabel = (text, record, child) => {
    wat.guest_write32(record, textOffset);
    wat.guest_write32(record + 4, text.length);
    for (let i = 0; i < text.length; i++) wat.guest_write8(blob + textOffset + i, text.charCodeAt(i));
    textOffset += text.length;
    if (child) wat.guest_write32(record + 8, childOffset);
  };
  putLabel(labels[0], blob + 4, true);
  putLabel(labels[1], blob + 20, false);
  wat.guest_write32(blob + 32, 202);
  wat.guest_write32(blob + childOffset, 2);
  const child0 = blob + childOffset + 4;
  const child1 = child0 + 28;
  putLabel(labels[2], child0, false);
  wat.guest_write32(child0 + 20, 101);
  putLabel(labels[3], child1, false);
  wat.guest_write32(child1 + 20, 102);

  wat.test_wnd_table_set(hwnd, 0xffff0002);
  wat.wnd_set_style_export(hwnd, 0x00cf0000);
  wat.menu_set_source_guest(hwnd, blob, blobSize, hmenu);

  const rect = allocRect();
  assert.strictEqual(wat.test_call_GetMenuItemRect(hwnd, hmenu, 0, rect), 1,
    'an attached menu bar has positioned items');
  const barLeft = (wat.menu_bar_screen_x(hwnd) + wat.menu_bar_item_x(hwnd, 0)) | 0;
  const barTop = wat.menu_bar_screen_y(hwnd) | 0;
  const barWidth = (wat.menu_bar_item_x(hwnd, 1) - wat.menu_bar_item_x(hwnd, 0)) | 0;
  assert.deepStrictEqual(readRect(rect), [barLeft, barTop, barLeft + barWidth, barTop + 18],
    'bar RECT matches the painter and hit-test geometry in screen coordinates');
  assert.strictEqual(wat.test_menu_item_rect_esp() >>> 0, 0x30014,
    'four-argument stdcall restores ESP');

  SENTINEL.forEach((value, i) => wat.guest_write32(rect + i * 4, value));
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, hmenu, 0, rect), 0,
    'a menu bar query requires its attached HWND');
  unchanged(rect);
  assert.strictEqual(wat.test_call_GetMenuItemRect(hwnd, hmenu, 2, rect), 0,
    'an out-of-range bar position fails');
  unchanged(rect);
  assert.strictEqual(wat.test_call_GetMenuItemRect(hwnd, hmenu, 0, 0), 0,
    'a NULL output pointer fails');

  assert.strictEqual(wat.test_call_GetMenuItemRect(0, submenu, 1, rect), 0,
    'a resource popup has no rectangle before it is displayed');
  unchanged(rect);
  wat.menu_open(hwnd, 0);
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, submenu, 1, rect), 1,
    'a displayed resource popup can find its menu window from NULL HWND');
  const popupX = (wat.menu_bar_screen_x(hwnd) + wat.menu_bar_item_x(hwnd, 0)) | 0;
  const popupY = (wat.menu_bar_screen_y(hwnd) + 18) | 0;
  const popupWidth = wat.menu_dropdown_width(hwnd, 0) | 0;
  assert.deepStrictEqual(readRect(rect),
    [popupX + 2, popupY + 22, popupX + popupWidth - 2, popupY + 42],
    'resource popup RECT matches its painted border and 20px row geometry');
  wat.menu_close();

  const strA = text => {
    const out = wat.guest_alloc(text.length + 1) >>> 0;
    for (let i = 0; i < text.length; i++) wat.guest_write8(out + i, text.charCodeAt(i));
    wat.guest_write8(out + text.length, 0);
    return out;
  };
  const dynamic = wat.test_call_CreatePopupMenu() >>> 0;
  const otherDynamic = wat.test_call_CreatePopupMenu() >>> 0;
  wat.test_call_AppendMenuA(dynamic, 0, 301, strA('First'));
  wat.test_call_AppendMenuA(dynamic, 0, 302, strA('Second'));
  wat.test_call_AppendMenuA(otherDynamic, 0, 401, strA('Other'));

  SENTINEL.forEach((value, i) => wat.guest_write32(rect + i * 4, value));
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, dynamic, 0, rect), 0,
    'a dynamic popup has no rectangle before TrackPopupMenu displays it');
  unchanged(rect);
  assert.strictEqual(wat.menu_track_popup_open(dynamic, 0, 40, 60, hwnd), 1);
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, dynamic, 1, rect), 1);
  const dynamicWidth = wat.menu_dropdown_width(hwnd, 0) | 0;
  assert.deepStrictEqual(readRect(rect), [42, 82, 40 + dynamicWidth - 2, 102],
    'dynamic popup RECT follows the explicit TrackPopupMenu screen anchor');

  SENTINEL.forEach((value, i) => wat.guest_write32(rect + i * 4, value));
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, otherDynamic, 0, rect), 0,
    'another live HMENU cannot borrow the displayed popup geometry');
  unchanged(rect);
  assert.strictEqual(wat.test_call_GetMenuItemRect(0x10002, dynamic, 0, rect), 0,
    'an explicit wrong owner HWND fails');
  unchanged(rect);
  wat.menu_close();
  assert.strictEqual(wat.test_call_GetMenuItemRect(0, dynamic, 0, rect), 0,
    'closing the popup retires its positioned rectangles');
  unchanged(rect);

  console.log('PASS  GetMenuItemRect follows attached/displayed Win98 menu geometry');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
