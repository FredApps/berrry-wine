#!/usr/bin/env node
'use strict';

// An SS_OWNERDRAW static paints nothing itself: USER hands its client to the
// parent as WM_DRAWITEM with CtlType ODT_STATIC. War Wind's Multiplayer Wizard
// draws its page artwork that way; before this the static filled itself with
// the dialog face and drew its (empty) text, so the picture never appeared.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_od_make_parent") (param $wndproc i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (local.get $wndproc))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x90000000)))
    (local.get $hwnd))
  (func (export "test_od_make_static")
      (param $parent i32) (param $id i32) (param $style i32) (result i32)
    (call $ctrl_create_child (local.get $parent) (i32.const 3) (local.get $id)
      (i32.const 10) (i32.const 20) (i32.const 120) (i32.const 225)
      (local.get $style) (i32.const 0)))
  (func (export "test_od_paint") (param $hwnd i32) (result i32)
    (call $static_wndproc (local.get $hwnd) (i32.const 0x000F)
      (i32.const 0) (i32.const 0)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'calc.exe'));
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const le32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 0xFF);
  const cap = e.guest_alloc(20) >>> 0;
  const proc = e.guest_alloc(64) >>> 0;
  bytes.set([
    0x8B, 0x44, 0x24, 0x08, 0xA3, ...le32(cap),        // msg
    0x8B, 0x44, 0x24, 0x0C, 0xA3, ...le32(cap + 4),    // wParam
    0x8B, 0x4C, 0x24, 0x10,                            // ecx = lParam
    0x8B, 0x01, 0xA3, ...le32(cap + 8),                // CtlType
    0x8B, 0x41, 0x14, 0xA3, ...le32(cap + 12),         // hwndItem
    0x8B, 0x41, 0x24, 0xA3, ...le32(cap + 16),         // rcItem.right
    0xB8, 0x01, 0x00, 0x00, 0x00,                      // mov eax,1
    0xC2, 0x10, 0x00,                                  // ret 16
  ], e.guest_to_wasm(proc) >>> 0);
  const clear = () => { for (let i = 0; i < 20; i += 4) e.guest_write32(cap + i, 0); };

  const parent = e.test_od_make_parent(proc) >>> 0;

  const od = e.test_od_make_static(parent, 101, 0x5000000D) >>> 0;  // WS_CHILD|WS_VISIBLE|SS_OWNERDRAW
  assert(od, 'owner-draw static is created');
  clear();
  e.test_od_paint(od);
  assert.strictEqual(e.guest_read32(cap) >>> 0, 0x002B,
    'painting an SS_OWNERDRAW static sends WM_DRAWITEM to its parent');
  assert.strictEqual(e.guest_read32(cap + 4) >>> 0, 101, 'wParam is the control id');
  assert.strictEqual(e.guest_read32(cap + 8) >>> 0, 5, 'CtlType is ODT_STATIC');
  assert.strictEqual(e.guest_read32(cap + 12) >>> 0, od, 'hwndItem names the static');
  assert.strictEqual(e.guest_read32(cap + 16) >>> 0, 120, 'rcItem spans the client width');

  const label = e.test_od_make_static(parent, 102, 0x50000000) >>> 0;  // SS_LEFT
  clear();
  e.test_od_paint(label);
  assert.notStrictEqual(e.guest_read32(cap) >>> 0, 0x002B,
    'an ordinary label paints itself without asking its parent');

  console.log('PASS  SS_OWNERDRAW statics delegate painting through WM_DRAWITEM/ODT_STATIC');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
