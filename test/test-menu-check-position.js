#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat: `
    (func (export "check_menu") (param $h i32) (param $id i32) (param $flags i32) (result i32)
      (call $handle_CheckMenuItem (local.get $h) (local.get $id) (local.get $flags)
        (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  const hwnd = 0x10001;
  const barCount = 4;
  const childCount = 15;
  const childHeader = 4 + barCount * 16;
  const size = childHeader + 4 + childCount * 28;
  const blob = wat.guest_alloc(size) >>> 0;

  for (let offset = 0; offset < size; offset += 4) wat.guest_write32(blob + offset, 0);
  wat.guest_write32(blob, barCount);
  wat.guest_write32(blob + 4 + 2 * 16 + 8, childHeader);
  wat.guest_write32(blob + childHeader, childCount);
  for (let position = 0; position < childCount; position++) {
    const item = blob + childHeader + 4 + position * 28;
    wat.guest_write32(item + 16, position === 4 ? 4 : 0);
    wat.guest_write32(item + 20, position === 5 ? 203 : 200 + position);
  }

  wat.test_wnd_table_set(hwnd, 0xffff0002);
  wat.menu_set_source_guest(hwnd, blob, size, 0x410134);
  const other = 0x10002;
  wat.test_wnd_table_set(other, 0xffff0002);
  wat.menu_set_source_guest(other, blob, size, 0x410135);
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 4) & 4, 4,
    'fixture starts with position 4 checked');
  assert.strictEqual(wat.menu_check_position_global(0x30134, 4, 0), 8,
    'unchecking by position returns the old checked state');
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 4) & 4, 0,
    'old position is unchecked immediately');
  assert.strictEqual(wat.menu_check_position_global(0x30134, 3, 8), 0,
    'checking by position returns the old unchecked state');
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 4) & 4, 0,
    'old position is unchecked');
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 3) & 4, 4,
    'new position is checked');
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 5) & 4, 0,
    'duplicate command ID at another position remains unchecked');
  assert.strictEqual(wat.menu_child_flags(other, 2, 3) & 4, 0,
    'unrelated menu remains unchecked');
  assert.strictEqual(wat.check_menu(0x30135, 5, 0x408), 0);
  assert.strictEqual(wat.menu_child_flags(other, 2, 5) & 4, 4,
    'position lookup resolves the requested window, not the first window');
  assert.strictEqual(wat.menu_child_flags(other, 2, 3) & 4, 0);
  assert.strictEqual(wat.check_menu(0x30135, 203, 8), 0,
    'command lookup returns state of first duplicate, not last');
  assert.strictEqual(wat.check_menu(0x30135, 203, 0), 8);
  assert.strictEqual(wat.menu_child_flags(other, 2, 3) & 4, 0);
  assert.strictEqual(wat.menu_child_flags(other, 2, 5) & 4, 4,
    'command lookup changes first duplicate only');
  assert.strictEqual(wat.menu_child_flags(hwnd, 2, 3) & 4, 4,
    'command lookup never mutates another window');
  assert.strictEqual(wat.check_menu(0x10135, 203, 8), -1,
    'empty sibling submenu must not search the entire bar');
  assert.strictEqual(wat.check_menu(0x410135, 203, 8), 0,
    'bar command lookup searches its children');
  assert.strictEqual(wat.check_menu(0x30135, 99, 0x408), -1);
  assert.strictEqual(wat.check_menu(0x30135, 999, 8), -1);
  assert.strictEqual(wat.check_menu(0, 203, 8), -1);

  console.log('PASS CheckMenuItem MF_BYPOSITION updates a resource-menu blob');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
