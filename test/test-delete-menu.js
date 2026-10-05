#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create_menu") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_CreateMenu
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_create_popup_menu") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_CreatePopupMenu
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_append_menu")
      (param $menu i32) (param $id i32) (param $text i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_AppendMenuA
      (local.get $menu) (i32.const 0) (local.get $id) (local.get $text)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_delete_menu")
      (param $menu i32) (param $item i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_DeleteMenu
      (local.get $menu) (local.get $item) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_submenu")
      (param $menu i32) (param $pos i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_GetSubMenu
      (local.get $menu) (local.get $pos) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_menu_item_count") (param $menu i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_GetMenuItemCount
      (local.get $menu) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_attached_menu_dword")
      (param $hwnd i32) (param $offset i32) (result i32)
    (i32.load (i32.add (call $menu_blob_w (local.get $hwnd)) (local.get $offset))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat });
  const text = e.guest_alloc(5) >>> 0;
  for (const [offset, value] of [...Buffer.from('Item\0')].entries()) {
    e.guest_write8(text + offset, value);
  }

  const bar = e.test_create_menu() >>> 0;
  assert(bar, 'CreateMenu returns a host-owned handle');
  assert.strictEqual(e.test_delete_menu(bar, 0, 0x400), 0,
    'deleting position zero from an empty menu returns FALSE');
  assert.strictEqual(e.test_append_menu(bar, 101, text), 1);
  assert.strictEqual(e.test_delete_menu(bar, 0, 0x400), 1);
  assert.strictEqual(e.test_delete_menu(bar, 0, 0x400), 0,
    'the removed host item is no longer present');

  const popup = e.test_create_popup_menu() >>> 0;
  assert(popup, 'CreatePopupMenu returns a WAT-owned handle');
  assert.strictEqual(e.test_append_menu(popup, 201, text), 1);
  assert.strictEqual(e.test_append_menu(popup, 202, text), 1);
  assert.strictEqual(e.test_delete_menu(popup, 201, 0), 1,
    'MF_BYCOMMAND removes the matching dynamic item');
  assert.strictEqual(e.test_delete_menu(popup, 0, 0x400), 1,
    'MF_BYPOSITION removes the shifted remaining item');
  assert.strictEqual(e.test_delete_menu(popup, 0, 0x400), 0,
    'an exhausted dynamic menu also returns FALSE');

  // Attached RT_MENU data lives in a mutable WAT copy. GetSubMenu returns an
  // encoded dropdown handle, not the host map's original submenu key; Unreal
  // clears this exact handle by repeatedly deleting position zero while
  // FindAvailableModes rebuilds its resolution menu.
  const hwnd = 0x10001;
  const source = 0x00410134;
  const childHeader = 4 + 16;
  const nestedHeader = childHeader + 4 + 3 * 28;
  const blobSize = nestedHeader + 4 + 28;
  const blob = e.guest_alloc(blobSize) >>> 0;
  for (let offset = 0; offset < blobSize; offset += 4) {
    e.guest_write32(blob + offset, 0);
  }
  e.guest_write32(blob, 1); // one top-level popup
  e.guest_write32(blob + 4 + 8, childHeader);
  e.guest_write32(blob + childHeader, 3);
  // First child owns an embedded popup subtree; the other two are commands.
  e.guest_write32(blob + childHeader + 4 + 16, 0x10);
  e.guest_write32(blob + childHeader + 4 + 24, nestedHeader);
  e.guest_write32(blob + childHeader + 4 + 28 + 20, 22);
  e.guest_write32(blob + childHeader + 4 + 56 + 20, 33);
  e.guest_write32(blob + nestedHeader, 1);
  e.guest_write32(blob + nestedHeader + 4 + 20, 44);
  e.test_wnd_table_set(hwnd, 0xffff0002);
  e.menu_set_source_guest(hwnd, blob, blobSize, source);

  const encoded = e.test_get_submenu(source, 0) >>> 0;
  assert.strictEqual(encoded, 0x00010134);
  assert.strictEqual(e.test_get_menu_item_count(encoded), 3);
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 1,
    'fixture starts with a live popup subtree');
  assert.strictEqual(e.test_delete_menu(encoded, 0, 0x400), 1);
  assert.strictEqual(e.test_get_menu_item_count(encoded), 2,
    'DeleteMenu decrements an encoded resource dropdown');
  assert.strictEqual(e.menu_child_id(hwnd, 0, 0), 22,
    'the fixed-size child records compact after removal');
  assert.strictEqual(e.menu_child_sub_count(hwnd, 0, 0), 0,
    'deleting a popup removes its subtree from the visible menu');
  assert.strictEqual(e.test_attached_menu_dword(hwnd, nestedHeader), 0,
    'DeleteMenu retires the removed popup subtree in the attached copy');
  assert.strictEqual(e.guest_read32(blob + nestedHeader), 1,
    'the caller fixture remains unchanged after menu_set copied it');
  assert.strictEqual(e.test_delete_menu(encoded, 33, 0), 1,
    'MF_BYCOMMAND resolves within the encoded dropdown');
  assert.strictEqual(e.test_get_menu_item_count(encoded), 1);
  assert.strictEqual(e.menu_child_id(hwnd, 0, 0), 22);
  assert.strictEqual(e.test_delete_menu(encoded, 0, 0x400), 1);
  assert.strictEqual(e.test_get_menu_item_count(encoded), 0);
  assert.strictEqual(e.test_delete_menu(encoded, 0, 0x400), 0,
    'the Unreal-style clear loop terminates on the exhausted dropdown');

  console.log('PASS  DeleteMenu removes host/dynamic items and terminates empty-menu loops');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
