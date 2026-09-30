#!/usr/bin/env node
'use strict';

// EnableMenuItem(hMenu, pos, MF_BYPOSITION) on a CreatePopupMenu handle.
//
// A dynamic menu handle is a guest heap pointer (Civilization II's are
// 0x7EF0xxxx). EnableMenuItem sent it down the resource-blob path, which reads
// the high word as a GetSubMenu-style bar index: 0x7EEF, so
// $menu_enable_position_global fetched a "child offset" half a megabyte past
// the menu bar blob and wrote a flags word wherever that pointed. In a fresh
// session that word is zero and nothing happens; once a long campaign had
// filled the far memory it was garbage, and Build Railroad ('r') trapped with
// "memory access out of bounds" (8121 <- 8214 <- 9207, vm-h12b.log b156934).
//
// Two things are checked: EnableMenuItem acts on the dynamic menu itself, and
// the by-position blob walk never addresses a dropdown its bar does not have.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "t_popup") (result i32)
    (call $handle_CreatePopupMenu (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "t_append") (param $h i32) (param $flags i32) (param $id i32) (param $text i32) (result i32)
    (call $handle_AppendMenuA (local.get $h) (local.get $flags) (local.get $id) (local.get $text)
      (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "t_enable") (param $h i32) (param $item i32) (param $flags i32) (result i32)
    (call $handle_EnableMenuItem (local.get $h) (local.get $item) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "t_dyn_flags") (param $h i32) (param $i i32) (result i32)
    (i32.load (call $dmb_item_w (call $dynamic_menu_state_w (local.get $h)) (local.get $i))))
  (func (export "t_blob_w") (param $hwnd i32) (result i32) (call $menu_blob_w (local.get $hwnd)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const dv = () => new DataView(memory.buffer);

  // A window with a resource menu bar, so the blob path has somewhere to look.
  // The bar declares 4 dropdowns but its table has room for 8; entry 5, past
  // the declared count, points at a decoy child list. Nothing may write there.
  const hwnd = 0x10001;
  const barCount = 4, tableSlots = 8, childCount = 3;
  const childHeader = 4 + tableSlots * 16;
  const decoyHeader = childHeader + 4 + childCount * 28;
  const size = decoyHeader + 4 + childCount * 28;
  const blob = e.guest_alloc(size) >>> 0;
  for (let o = 0; o < size; o += 4) e.guest_write32(blob + o, 0);
  e.guest_write32(blob, barCount);
  e.guest_write32(blob + 4 + 2 * 16 + 8, childHeader);
  e.guest_write32(blob + childHeader, childCount);
  e.guest_write32(blob + 4 + 5 * 16 + 8, decoyHeader);
  e.guest_write32(blob + decoyHeader, childCount);
  for (let p = 0; p < childCount; p++) {
    e.guest_write32(blob + childHeader + 4 + p * 28 + 20, 300 + p);
    e.guest_write32(blob + decoyHeader + 4 + p * 28 + 20, 400 + p);
  }
  e.test_wnd_table_set(hwnd, 0xffff0002);
  e.menu_set_source_guest(hwnd, blob, size, 0x410134);
  const blobW = e.t_blob_w(hwnd) >>> 0;
  assert.notStrictEqual(blobW, 0, 'fixture bar is attached');
  const decoyFlags = (p) => dv().getUint32(blobW + decoyHeader + 4 + p * 28 + 16, true);

  // In range: dropdown 2 (handle (2+1)<<16), position 1 is greyed.
  assert.strictEqual(e.menu_enable_position_global(0x30134, 1, 1), 0);
  assert.strictEqual(e.menu_child_flags(hwnd, 2, 1) & 2, 2, 'an in-range position still greys');
  assert.strictEqual(e.menu_enable_position_global(0x30134, 1, 0), 1);

  // Out of range: dropdown 5 of a 4-dropdown bar.
  assert.strictEqual(e.menu_enable_position_global(0x60134, 1, 1), -1,
    'a dropdown index past the bar count names nothing');
  assert.strictEqual(decoyFlags(1), 0, 'the walk wrote through a bar-table slot past the bar count');
  // In range, but past the dropdown's item count.
  assert.strictEqual(e.menu_enable_position_global(0x30134, 7, 1), -1,
    'a position past the dropdown item count names nothing');

  // A CreatePopupMenu menu, greyed by position as Civ2's 0x503aa0 does.
  const text = e.guest_alloc(4) >>> 0;
  e.guest_write32(text, 0x41);
  const popup = e.t_popup() >>> 0;
  assert.notStrictEqual(popup, 0);
  for (let i = 0; i < 3; i++) assert.notStrictEqual(e.t_append(popup, 0, 500 + i, text), 0);
  // Put the decoy exactly where the old path read this handle's "bar entry".
  const tidx = (popup >>> 16) - 1;
  const wildWord = blobW + 4 + tidx * 16 + 8;
  const saved = wildWord + 4 <= memory.buffer.byteLength ? dv().getUint32(wildWord, true) : null;
  if (saved !== null) dv().setUint32(wildWord, decoyHeader, true);
  try {
    assert.strictEqual(e.t_enable(popup, 1, 0x403), 0, 'EnableMenuItem answers the previous state');
    assert.strictEqual(e.t_dyn_flags(popup, 1) & 3, 3, 'position 1 of the popup is greyed');
    assert.strictEqual(e.t_dyn_flags(popup, 0) & 3, 0, 'its neighbours are not');
    assert.strictEqual(e.t_dyn_flags(popup, 2) & 3, 0);
    assert.strictEqual(decoyFlags(1), 0, 'EnableMenuItem on a dynamic menu wrote into a resource bar');
    assert.strictEqual(e.t_enable(popup, 1, 0x400), 3);
    assert.strictEqual(e.t_dyn_flags(popup, 1) & 3, 0, 're-enabled by position');
    assert.strictEqual(e.t_enable(popup, 502, 1), 0, 'by command id');
    assert.strictEqual(e.t_dyn_flags(popup, 2) & 3, 1);
    assert.strictEqual(e.t_enable(popup, 9, 0x401), -1, 'a missing position answers -1');
  } finally {
    if (saved !== null) dv().setUint32(wildWord, saved, true);
  }

  console.log('PASS EnableMenuItem acts on dynamic menus and never walks past a bar');
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
