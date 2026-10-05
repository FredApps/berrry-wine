#!/usr/bin/env node

'use strict';

// InsertMenuItemA/W against a CreateMenu handle.
//
// tetravex.exe builds its entire menu bar this way: CreateMenu for the bar and
// for each popup, then repeated InsertMenuItemA(uItem = -1). The handler used
// to answer TRUE and drop the item on the floor, so SetMenu had nothing to
// serialize and the window came up with no menu bar at all. CreateMenu now
// makes the same WAT dynamic (MNUD) menu CreatePopupMenu does, and SetMenu
// serializes the finished bar.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MIIM_ID = 0x02;
const MIIM_SUBMENU = 0x04;
const MIIM_STRING = 0x40;

const extraWat = `
  (func (export "test_call_CreateMenu") (result i32)
    (call $handle_CreateMenu
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_InsertMenuItemW")
      (param $hmenu i32) (param $item i32) (param $bypos i32) (param $mii i32) (result i32)
    (call $handle_InsertMenuItemW
      (local.get $hmenu) (local.get $item) (local.get $bypos) (local.get $mii)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_GetSubMenu") (param $hmenu i32) (param $pos i32) (result i32)
    (call $handle_GetSubMenu (local.get $hmenu) (local.get $pos)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_register_menu_window") (param $hwnd i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE)))
  (func (export "test_call_SetMenu_bridge")
      (param $hwnd i32) (param $hmenu i32) (result i32)
    (call $handle_SetMenu
      (local.get $hwnd) (local.get $hmenu) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log(`  ok  ${label}`); };

(async () => {
  const harness = await bootRenderHarness({ extraWat });
  const wat = harness.exports;

  const alloc = size => wat.guest_alloc(size) >>> 0;
  const strA = text => {
    const p = alloc(text.length + 1);
    for (let i = 0; i < text.length; i++) wat.guest_write8(p + i, text.charCodeAt(i));
    wat.guest_write8(p + text.length, 0);
    return p;
  };
  const strW = text => {
    const p = alloc(text.length * 2 + 2);
    for (let i = 0; i < text.length; i++) {
      wat.guest_write8(p + i * 2, text.charCodeAt(i) & 0xff);
      wat.guest_write8(p + i * 2 + 1, text.charCodeAt(i) >>> 8);
    }
    wat.guest_write8(p + text.length * 2, 0);
    wat.guest_write8(p + text.length * 2 + 1, 0);
    return p;
  };
  // MENUITEMINFOA: cbSize, fMask, fType, fState, wID, hSubMenu, hbmpChecked,
  // hbmpUnchecked, dwItemData, dwTypeData, cch.
  const menuItemInfo = ({ mask = 0, id = 0, subMenu = 0, typeData = 0 }) => {
    const p = alloc(44);
    for (let i = 0; i < 44; i += 4) wat.guest_write32(p + i, 0);
    wat.guest_write32(p + 0, 44);
    wat.guest_write32(p + 4, mask);
    wat.guest_write32(p + 16, id);
    wat.guest_write32(p + 20, subMenu);
    wat.guest_write32(p + 36, typeData);
    return p;
  };
  const readA = p => {
    let out = '';
    for (let c; p && (c = wat.guest_read8(p)); p++) out += String.fromCharCode(c);
    return out;
  };
  const count = h => wat.test_menu_item_count(h);
  const id = (h, i) => wat.test_menu_item_field(h, i, 1);
  const label = (h, i) => readA(wat.test_menu_item_field(h, i, 2) >>> 0);
  const submenu = (h, i) => wat.test_menu_item_field(h, i, 3) >>> 0;
  const MF_POPUP = 0x10;

  const bar = wat.test_call_CreateMenu() >>> 0;
  const game = wat.test_call_CreateMenu() >>> 0;
  assert(bar && game && bar !== game, 'CreateMenu returns distinct handles');
  assert.strictEqual(count(bar), 0, 'CreateMenu makes an empty dynamic menu');

  check('a tail InsertMenuItemA lands in the submenu', () => {
    assert.strictEqual(wat.test_call_InsertMenuItemA(game, -1, 1,
      menuItemInfo({ mask: MIIM_ID | MIIM_STRING, id: 42, typeData: strA('&New Game') })), 1);
    assert.strictEqual(count(game), 1);
    assert.strictEqual(id(game, 0), 42);
    assert.strictEqual(label(game, 0), '&New Game');
  });

  check('MIIM_SUBMENU attaches the popup to the bar', () => {
    assert.strictEqual(wat.test_call_InsertMenuItemA(bar, -1, 1,
      menuItemInfo({ mask: MIIM_SUBMENU | MIIM_STRING, subMenu: game,
                     typeData: strA('&Game') })), 1);
    assert.strictEqual(count(bar), 1);
    assert.strictEqual(label(bar, 0), '&Game');
    assert(wat.test_menu_item_field(bar, 0, 0) & MF_POPUP, 'the entry must be a popup');
    assert.strictEqual(submenu(bar, 0), game);
    assert.strictEqual(wat.test_call_GetSubMenu(bar, 0) >>> 0, game,
      'GetSubMenu answers before SetMenu');
  });

  check('the W twin reads its label as UTF-16', () => {
    assert.strictEqual(wat.test_call_InsertMenuItemW(game, -1, 1,
      menuItemInfo({ mask: MIIM_ID | MIIM_STRING, id: 43, typeData: strW('E&xit') })), 1);
    assert.strictEqual(count(game), 2);
    assert.strictEqual(id(game, 1), 43);
  });

  check('a non-tail insert lands at its position', () => {
    assert.strictEqual(wat.test_call_InsertMenuItemA(bar, 0, 1,
      menuItemInfo({ mask: MIIM_ID | MIIM_STRING, id: 44, typeData: strA('&Help') })), 1);
    assert.strictEqual(count(bar), 2);
    assert.strictEqual(id(bar, 0), 44);
    assert.strictEqual(label(bar, 1), '&Game');
  });

  check('SetMenu serializes the bar into the window', () => {
    const hwnd = 0x10002;
    wat.test_register_menu_window(hwnd);
    assert.strictEqual(wat.test_call_SetMenu_bridge(hwnd, bar), 1);
    assert.strictEqual(wat.menu_bar_count(hwnd), 2);
    assert.strictEqual(wat.menu_child_count(hwnd, 1), 2);
    assert.strictEqual(wat.menu_child_id(hwnd, 1, 0), 42);
    assert.strictEqual(wat.menu_child_id(hwnd, 1, 1), 43);
    wat.menu_clear(hwnd);
  });

  console.log(`\ntest-insert-menu-item-host-bar: ${passed}/${passed} passed`);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
