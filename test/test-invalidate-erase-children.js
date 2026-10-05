#!/usr/bin/env node
'use strict';

// InvalidateRect(parent, rc, TRUE) on a parent without WS_CLIPCHILDREN also
// marks every visible child the rectangle covers for erase, so the child's own
// paint cycle sends it WM_ERASEBKGND. SimCity 2000 invalidates its MFC frame
// (no WS_CLIPCHILDREN) and draws the title artwork from the subclassed MDI
// client's erase; without the propagation its launcher sat on bare grey.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $t_a (mut i32) (i32.const 0))
  (global $t_b (mut i32) (i32.const 0))

  (func (export "t_create") (param $style i32) (result i32)
    (local $parent i32)
    (local.set $parent (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $host_register_dialog_frame
      (local.get $parent) (i32.const 0)
      (i32.const 0) (i32.const 200) (i32.const 100) (i32.const 0))
    (call $wnd_table_set (local.get $parent) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $parent) (local.get $style)))
    (global.set $t_a (call $ctrl_create_child
      (local.get $parent) (i32.const 4) (i32.const 101)
      (i32.const 0) (i32.const 0) (i32.const 180) (i32.const 24)
      (i32.const 0x50000000) (i32.const 0)))
    (global.set $t_b (call $ctrl_create_child
      (local.get $parent) (i32.const 4) (i32.const 102)
      (i32.const 0) (i32.const 50) (i32.const 180) (i32.const 24)
      (i32.const 0x50000000) (i32.const 0)))
    (call $nc_flags_clear (global.get $t_a) (i32.const 2))
    (call $nc_flags_clear (global.get $t_b) (i32.const 2))
    (local.get $parent))

  (func (export "t_invalidate") (param $h i32) (param $rc i32) (param $erase i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_InvalidateRect (local.get $h) (local.get $rc) (local.get $erase)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp)))

  (func (export "t_erase") (result i32)
    (i32.or
      (i32.ne (i32.and (call $nc_flags_test (global.get $t_a)) (i32.const 2)) (i32.const 0))
      (i32.shl
        (i32.ne (i32.and (call $nc_flags_test (global.get $t_b)) (i32.const 2)) (i32.const 0))
        (i32.const 1))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const rc = e.guest_alloc(16);
  // Covers child A (0,0)-(180,24) only; child B sits at y=50.
  [0, 0, 100, 20].forEach((v, i) => e.guest_write32(rc + i * 4, v));

  const cases = [
    { style: 0x90000000, erase: 1, want: 1, why: 'covered child inherits the erase' },
    { style: 0x90000000, erase: 0, want: 0, why: 'bErase=FALSE marks no child' },
    { style: 0x92000000, erase: 1, want: 0, why: 'WS_CLIPCHILDREN keeps children out' },
  ];
  for (const c of cases) {
    const parent = e.t_create(c.style);
    e.t_invalidate(parent, rc, c.erase);
    assert.strictEqual(e.t_erase(), c.want, `${c.why} (style=0x${c.style.toString(16)})`);
  }
  console.log('PASS InvalidateRect erase reaches covered children of a non-CLIPCHILDREN parent');
})().catch(err => { console.error(err); process.exit(1); });
