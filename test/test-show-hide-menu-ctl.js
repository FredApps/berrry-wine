#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_shmc_child (mut i32) (i32.const 0))
  (global $test_shmc_cleanup (mut i32) (i32.const 0))

  (func (export "test_shmc_setup") (result i32)
    (local $parent i32)
    (local.set $parent (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $parent) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $parent) (i32.const 0x10000000)))
    (global.set $test_shmc_child
      (call $ctrl_create_child
        (local.get $parent) (i32.const 1) (i32.const 200)
        (i32.const 0) (i32.const 0) (i32.const 80) (i32.const 20)
        (i32.const 0x40000000) (i32.const 0)))
    (local.get $parent))

  (func (export "test_shmc_child") (result i32)
    (global.get $test_shmc_child))
  (func (export "test_shmc_cleanup") (result i32)
    (global.get $test_shmc_cleanup))
  (func (export "test_shmc_menu_source") (param $hwnd i32) (result i32)
    (call $menu_source_get (local.get $hwnd)))
  (func (export "test_shmc_menu_state")
      (param $hmenu i32) (param $id i32) (result i32)
    (call $menu_handle_state_by_id (local.get $hmenu) (local.get $id)))

  (func (export "test_show_hide_menu_ctl")
      (param $hwnd i32) (param $selector i32) (param $info i32) (result i32)
    (local $before i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (global.get $esp))
    (call $handle_ShowHideMenuCtl
      (local.get $hwnd) (local.get $selector) (local.get $info)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_shmc_cleanup (i32.sub (global.get $esp) (local.get $before)))
    (global.get $eax))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const parent = e.test_shmc_setup() >>> 0;
  const child = e.test_shmc_child() >>> 0;
  const hmenu = 0x410134;

  // One top-level popup with one command child (id 100), initially unchecked.
  const barCount = 1;
  const childHeader = 4 + barCount * 16;
  const blobSize = childHeader + 4 + 28;
  const blob = e.guest_alloc(blobSize) >>> 0;
  for (let offset = 0; offset < blobSize; offset += 4) e.guest_write32(blob + offset, 0);
  e.guest_write32(blob, barCount);
  e.guest_write32(blob + 4 + 8, childHeader);
  e.guest_write32(blob + childHeader, 1);
  const item = blob + childHeader + 4;
  e.guest_write32(item + 16, 0);
  e.guest_write32(item + 20, 100);
  e.menu_set_source_guest(parent, blob, blobSize, hmenu);

  // First pair is the whole-menu selector/HMENU; later pairs map menu ids to
  // child control ids, followed by a zero selector terminator.
  const info = e.guest_alloc(24) >>> 0;
  e.guest_write32(info, 999);
  e.guest_write32(info + 4, hmenu);
  e.guest_write32(info + 8, 100);
  e.guest_write32(info + 12, 200);
  e.guest_write32(info + 16, 0);
  e.guest_write32(info + 20, 0);

  assert.strictEqual(e.wnd_get_style_export(child) & 0x10000000, 0,
    'mapped control starts hidden');
  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 100, info), 1);
  assert.strictEqual(e.test_shmc_cleanup(), 16,
    'ShowHideMenuCtl pops return address plus three arguments');
  assert.notStrictEqual(e.wnd_get_style_export(child) & 0x10000000, 0,
    'an unchecked menu item becomes checked and shows its control');
  assert.strictEqual(e.test_shmc_menu_state(hmenu, 100) & 8, 8);

  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 100, info), 1);
  assert.strictEqual(e.wnd_get_style_export(child) & 0x10000000, 0,
    'a checked menu item becomes unchecked and hides its control');
  assert.strictEqual(e.test_shmc_menu_state(hmenu, 100) & 8, 0);

  e.guest_write32(info + 12, 201); // no such child control
  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 100, info), 0,
    'a mapped but missing child reports failure');
  assert.strictEqual(e.test_shmc_menu_state(hmenu, 100) & 8, 0,
    'failure leaves the menu item unchecked, matching Win98');
  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 777, info), 0,
    'an absent selector does not claim success');
  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 100, 0), 0,
    'a null mapping table does not claim success');

  // Restore the valid child mapping, then exercise the first pair's special
  // whole-menu removal. A synthetic blob cannot be resource-reloaded, so the
  // attach half is covered structurally by the same menu_load path as SetMenu.
  e.guest_write32(info + 12, 200);
  assert.strictEqual(e.test_shmc_menu_source(parent), hmenu);
  assert.strictEqual(e.test_show_hide_menu_ctl(parent, 999, info), 1);
  assert.strictEqual(e.test_shmc_menu_source(parent), 0,
    'the first lpInfo pair toggles the whole attached menu');

  console.log('PASS  ShowHideMenuCtl toggles Win98 menu checks and child visibility');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
