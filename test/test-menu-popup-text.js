#!/usr/bin/env node

'use strict';

// A menu an app builds at runtime -- CreatePopupMenu + AppendMenu, then
// TrackPopupMenu -- has to show the labels it was given. Winamp's plug-in and
// playlist menus are built this way, so is WordPad's color popup.
//
// This used to test renderer._menuFormatText/_menuPaintDropdownJs, a JS menu
// painter deleted in cdb2426 when menu rendering moved into WAT; it had been
// asserting against a layer that no longer exists. The behaviour it guarded is
// real, so it is re-pointed at the WAT model the painter reads:
//
//   label / shortcut split on '\t'   (menu_child_label_*, menu_child_shortcut_*)
//   mnemonic from an un-doubled '&'  (menu_child_accel)
//
// The '&' itself stays in the label -- DrawText strips it and underlines the
// next character, the same way Win32 does.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
// $GUEST_BASE, from the map declared in src/00-regions.wat.
const RegionMap = require('../lib/region-map.generated.js');

const MF_STRING = 0x000;
const MF_SEPARATOR = 0x800;

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

(async () => {
  const harness = await bootRenderHarness({
    extraWat: `
    (func (export "test_get_menu_state")
        (param $h i32) (param $item i32) (param $flags i32) (result i32)
      (call $handle_GetMenuState (local.get $h) (local.get $item)
        (local.get $flags) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
    (func (export "test_check_menu")
        (param $h i32) (param $item i32) (param $flags i32) (result i32)
      (call $handle_CheckMenuItem (local.get $h) (local.get $item)
        (local.get $flags) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
    (func (export "test_detached_alias") (param $id i32) (param $h i32)
      (local $node i32) (local $w i32)
      (local.set $node (call $heap_alloc (i32.const 12)))
      (local.set $w (call $g2w (local.get $node)))
      (i32.store (local.get $w) (global.get $detached_menus))
      (i32.store offset=4 (local.get $w) (local.get $id))
      (i32.store offset=8 (local.get $w) (local.get $h))
      (global.set $detached_menus (local.get $node)))
    (func (export "test_dc_exists") (param $hdc i32) (result i32)
      (i32.ne (call $gdi_dc_state_entry (local.get $hdc) (i32.const 0))
        (i32.const 0)))
  ` });
  const wat = harness.exports;
  const bytes = () => new Uint8Array(harness.memory.buffer);

  const strA = text => {
    const p = wat.guest_alloc(text.length + 1) >>> 0;
    for (let i = 0; i < text.length; i++) wat.guest_write8(p + i, text.charCodeAt(i));
    wat.guest_write8(p + text.length, 0);
    return p;
  };

  // The blob keeps offsets into itself, so the accessors hand back WASM
  // addresses and a length -- there is no NUL to stop at.
  const readAt = (ptr, len) => {
    if (!ptr || !len) return '';
    return Buffer.from(bytes().slice(ptr, ptr + len)).toString('latin1');
  };

  const hmenu = wat.test_call_CreatePopupMenu() >>> 0;
  assert(hmenu, 'CreatePopupMenu should return a handle');
  const items = [
    { id: 101, text: '&Enabled' },
    { id: 102, text: 'Spectrum &Radar' },
    { id: 103, text: 'E&&xit\tCtrl+X' },
    { id: 104, text: 'Close Plug-in\t[Escape]' },
    { id: 105, text: 'Extract files to specified destination folder\tCtrl+Shift+E' },
  ];
  for (const it of items) {
    assert.strictEqual(wat.test_call_AppendMenuA(hmenu, MF_STRING, it.id, strA(it.text)), 1);
  }
  wat.test_call_AppendMenuA(hmenu, MF_SEPARATOR, 0, 0);

  // hwnd 0 is fine here: TrackPopupMenu parks the synthesized blob in a global
  // keyed by the owner hwnd, and every accessor below asks for that same one.
  assert.strictEqual(wat.menu_track_popup_open(hmenu, 0, 40, 40, 0), 1,
    'TrackPopupMenu should open a dynamic popup');

  const label = i => readAt(wat.menu_child_label_ptr(0, 0, i), wat.menu_child_label_len(0, 0, i));
  const shortcut = i =>
    readAt(wat.menu_child_shortcut_ptr(0, 0, i), wat.menu_child_shortcut_len(0, 0, i));

  check('every appended item is in the popup', () => {
    assert.strictEqual(wat.menu_child_count(0, 0), 6);
  });

  check('popup width grows to keep long labels and shortcuts in separate columns', () => {
    const syntheticWindowDc = 0x40000; // old hwnd 0 + client-DC tag shortcut
    assert.strictEqual(wat.test_dc_exists(syntheticWindowDc), 0,
      'test started with an invented window DC');
    const width = wat.menu_dropdown_width(0, 0) | 0;
    assert(width > 180, `long popup stayed at the legacy 180px width (${width})`);
    assert.strictEqual(wat.test_dc_exists(syntheticWindowDc), 0,
      'a width query created state for an invented application window DC');
    assert.strictEqual(wat.menu_hittest_dropdown(0, 0, 40, 40,
      40 + width - 3, 43), 0,
    'the widened painted area must also belong to the first menu item');
    assert.strictEqual(wat.test_dc_exists(syntheticWindowDc), 0,
      'hit testing created state for an invented application window DC');
  });

  check('an item shows the string it was appended with', () => {
    assert.strictEqual(label(0), '&Enabled');
    assert.strictEqual(label(1), 'Spectrum &Radar');
  });

  check('the label stops at the tab and the shortcut carries the rest', () => {
    assert.strictEqual(label(2), 'E&&xit');
    assert.strictEqual(shortcut(2), 'Ctrl+X');
    assert.strictEqual(label(3), 'Close Plug-in');
    assert.strictEqual(shortcut(3), '[Escape]');
  });

  check('an item without a tab has no shortcut column', () => {
    assert.strictEqual(wat.menu_child_shortcut_len(0, 0, 0), 0);
    assert.strictEqual(wat.menu_child_shortcut_ptr(0, 0, 0), 0);
  });

  check('command ids survive the popup blob', () => {
    for (let i = 0; i < items.length; i++) {
      assert.strictEqual(wat.menu_child_id(0, 0, i), items[i].id);
    }
  });

  check('the separator is marked as one', () => {
    assert.strictEqual(wat.menu_child_flags(0, 0, 5) & 1, 1);
  });

  check('the mnemonic is the character after an un-doubled &', () => {
    assert.strictEqual(wat.menu_child_accel(0, 0, 0), 'E'.charCodeAt(0));
    assert.strictEqual(wat.menu_child_accel(0, 0, 1), 'R'.charCodeAt(0));
  });

  check('a doubled && is a literal ampersand, not a mnemonic', () => {
    // Stepping one byte at a time made the second '&' look like a fresh
    // marker, so "E&&xit" claimed 'X'.
    assert.strictEqual(wat.menu_child_accel(0, 0, 2), 0);
  });

  check('an item with no & has no mnemonic', () => {
    assert.strictEqual(wat.menu_child_accel(0, 0, 3), 0);
  });

  // GetMenuString reads the same blob, so it used to hand back "#0065" too.
  check('GetMenuString returns the label, not the command id', () => {
    // menu_handle_copy_label writes to a WASM address, not a guest one.
    const g2w = g => RegionMap.g2w(g, wat.get_image_base());
    const buf = wat.guest_alloc(64) >>> 0;
    const n = wat.menu_handle_copy_label(hmenu, 1, 0x400, g2w(buf), 64);
    assert.strictEqual(readAt(g2w(buf), n), 'Spectrum &Radar');
  });

  check('tracked dynamic popups preserve submenus rather than id-zero separators', () => {
    const child = wat.test_call_CreatePopupMenu() >>> 0;
    const parent = wat.test_call_CreatePopupMenu() >>> 0;
    wat.test_call_AppendMenuA(child, 0x8, 201, strA('&Clear\tCtrl+C'));
    wat.test_call_AppendMenuA(child, MF_SEPARATOR, 0, 0);
    wat.test_call_AppendMenuA(child, 0, 202, strA('Fade'));
    wat.test_call_AppendMenuA(parent, 0x10, child, strA('Rendering Options'));
    wat.test_call_AppendMenuA(parent, MF_SEPARATOR, 0, 0);
    wat.test_call_AppendMenuA(parent, 0x100, 203, 0x12345678);
    assert.strictEqual(wat.menu_track_popup_open(parent, 0, 40, 40, 0), 1);
    assert.strictEqual(label(0), 'Rendering Options');
    assert.strictEqual(wat.menu_child_flags(0, 0, 0) & 1, 0);
    assert.strictEqual(wat.menu_hittest_dropdown(0, 0, 40, 40, 60, 52), 0);
    assert.strictEqual(wat.menu_child_sub_count(0, 0, 0), 3);
    assert.strictEqual(readAt(wat.menu_subchild_label_ptr(0, 0, 0, 0),
      wat.menu_subchild_label_len(0, 0, 0, 0)), '&Clear');
    assert.strictEqual(wat.menu_subchild_id(0, 0, 0, 0), 201);
    assert.strictEqual(wat.menu_subchild_flags(0, 0, 0, 0) & 4, 4);
    assert.strictEqual(wat.menu_subchild_flags(0, 0, 0, 1) & 1, 1);
    assert.strictEqual(wat.menu_subchild_id(0, 0, 0, 2), 202);
    assert.strictEqual(wat.menu_child_flags(0, 0, 1) & 1, 1);
    assert.strictEqual(wat.menu_child_flags(0, 0, 2) & 8, 8);
    assert.strictEqual(label(2), '', 'owner-draw data must never become text');
  });

  check('CheckMenuItem updates only the requested dynamic tree before tracking', () => {
    const root = wat.test_call_CreatePopupMenu() >>> 0;
    const child = wat.test_call_CreatePopupMenu() >>> 0;
    const other = wat.test_call_CreatePopupMenu() >>> 0;
    wat.test_call_AppendMenuA(child, 0, 301, strA('Clear'));
    wat.test_call_AppendMenuA(child, 0, 301, strA('Duplicate'));
    wat.test_call_AppendMenuA(root, 0x10, child, strA('Rendering Options'));
    wat.test_call_AppendMenuA(other, 0, 301, strA('Unrelated'));
    assert.strictEqual(wat.test_check_menu(root, 301, 8), 0);
    assert.strictEqual(wat.test_check_menu(root, 301, 8), 8);
    assert.strictEqual(wat.test_check_menu(child, 1, 0x400), 0,
      'by-command must not check every duplicate id');
    assert.strictEqual(wat.test_check_menu(other, 0, 0x400), 0,
      'same command id in an unrelated menu must remain unchecked');
    assert.strictEqual(wat.test_check_menu(root, 999, 8), -1);
    assert.strictEqual(wat.test_check_menu(child, 99, 0x408), -1);
    assert.strictEqual(wat.test_check_menu(root, 0, 0x408), 0,
      'a popup row can be checked by position');
    assert.strictEqual(wat.menu_track_popup_open(root, 0, 40, 40, 0), 1);
    assert.strictEqual(wat.menu_child_flags(0, 0, 0) & 4, 4);
    assert.strictEqual(wat.menu_subchild_flags(0, 0, 0, 0) & 4, 4);
    assert.strictEqual(wat.menu_subchild_flags(0, 0, 0, 1) & 4, 0);
    assert.strictEqual(wat.test_check_menu(root, 301, 0), 8);
    assert.strictEqual(wat.menu_track_popup_open(root, 0, 40, 40, 0), 1);
    assert.strictEqual(wat.menu_subchild_flags(0, 0, 0, 0) & 4, 0);
    // LoadMenu's detached tagged alias must reach the same canonical tree.
    // This seeds the resolver cache; resource parsing is tested separately.
    wat.test_detached_alias(101, root);
    assert.strictEqual(wat.test_check_menu(0xbe0065, 301, 8), 0);
    assert.strictEqual(wat.test_check_menu(root, 301, 0), 8);
  });

  check('GetMenuState queries canonical dynamic and detached trees without tracking', () => {
    const root = wat.test_call_CreatePopupMenu() >>> 0;
    const child = wat.test_call_CreatePopupMenu() >>> 0;
    const other = wat.test_call_CreatePopupMenu() >>> 0;
    wat.test_call_AppendMenuA(child, 8, 401, strA('Checked'));
    wat.test_call_AppendMenuA(child, 0, 401, strA('Duplicate'));
    wat.test_call_AppendMenuA(child, 0x100, 402, 0x12345678);
    wat.test_call_AppendMenuA(root, 0x18, child, strA('Submenu'));
    wat.test_call_AppendMenuA(root, MF_SEPARATOR, 0, 0);
    wat.test_call_AppendMenuA(other, 0, 401, strA('Unrelated'));
    const state = (h, item, flags = 0) => wat.test_get_menu_state(h, item, flags);
    assert.strictEqual(state(root, 401), 8, 'recursive first command match');
    assert.strictEqual(state(child, 1, 0x400), 0, 'exact position; no private text-ownership bit');
    assert.strictEqual(state(other, 401), 0, 'unrelated menus remain isolated');
    assert.strictEqual(state(root, 0, 0x400), 0x318, 'popup count in high byte, flags in low byte');
    assert.strictEqual(state(root, 1, 0x400), MF_SEPARATOR);
    assert.strictEqual(state(root, 402), 0x100, 'owner-draw flag survives');
    assert.strictEqual(state(root, 999), -1);
    assert.strictEqual(state(root, 99, 0x400), -1);
    assert.strictEqual(state(root, -1, 0x400), -1);
    assert.strictEqual(state(root, child), -1, 'a submenu handle is not a command id');
    wat.test_detached_alias(102, root);
    assert.strictEqual(state(0xbe0066, 401), 8);
    assert.strictEqual(state(0xbe0066, 0, 0x400), 0x318);
    assert.strictEqual(wat.test_check_menu(root, 401, 0), 8);
    assert.strictEqual(state(0xbe0066, 401), 0, 'queries observe later mutations');
  });

  console.log(`test-menu-popup-text: ${passed} checks ok`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
