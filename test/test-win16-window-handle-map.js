#!/usr/bin/env node
'use strict';

// A destroyed window must give back the Win16 handle-map slots that named it.
// HWNDs are never reissued on the 32-bit side, so a slot kept for a dead
// window is kept for good. Civilization II opens and closes city, advisor and
// dialog windows all campaign long -- each with a handful of children, and
// each child's internal DC narrowed for WM_CTLCOLOR/WM_ERASEBKGND -- and at
// AD 1240 the 4096-entry map was full and $win16_h16 trapped ("Win16 handle
// map full", 0xCA16A9F4) as the next CreatePen came back.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_init") (param $win16 i32)
    (global.set $is_win16 (local.get $win16))
    (call $win16_handle_reset))
  (func (export "test_h16") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
  (func (export "test_h32") (param $h i32) (result i32) (call $win16_h32 (local.get $h)))
  (func (export "test_create") (param $hwnd i32) (param $parent i32)
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x7777))
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent)))
  (func (export "test_set_own_dc") (param $hwnd i32) (param $hdc i32)
    (call $wnd_set_own_dc (local.get $hwnd) (local.get $hdc)))
  (func (export "test_remove") (param $hwnd i32) (call $wnd_table_remove (local.get $hwnd)))
  (func (export "test_next") (result i32) (call $win16_handle_next_get))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_init(1);
  const used = () => e.win16_handle_map_used();

  // Something that outlives every window below: a pen, say.
  const keep16 = e.test_h16(0x00410042);
  const base = used();

  const HWND = 0x00012345;
  e.test_create(HWND, 0);
  e.test_set_own_dc(HWND, 0x00310777);
  const w16 = e.test_h16(HWND);
  const client16 = e.test_h16(HWND + 0x40000);
  const whole16 = e.test_h16(HWND + 0xC0000);
  const own16 = e.test_h16(0x00310777);
  assert.strictEqual(used(), base + 4, 'the window, its two internal DCs and its own DC are mapped');
  assert.strictEqual(e.test_h32(w16), HWND);

  e.test_remove(HWND);
  assert.strictEqual(used(), base, 'destroying the window releases all four slots');
  for (const h16 of [w16, client16, whole16, own16]) {
    assert.strictEqual(e.test_h32(h16), 0, 'a stale 16-bit handle reads back as a dead (NULL) handle');
  }
  assert.strictEqual(e.test_h32(keep16), 0x00410042, 'an unrelated mapping survives');

  // The next window reuses a freed slot rather than growing the map.
  const top = e.test_next();
  e.test_create(HWND + 1, 0);
  const again16 = e.test_h16(HWND + 1);
  assert.ok([w16, client16, whole16, own16].includes(again16), 'a freed slot is reused');
  assert.strictEqual(e.test_next(), top, 'without advancing the map');
  e.test_remove(HWND + 1);

  // A campaign's worth of dialogs: far more windows than the map has slots.
  // Before the fix this trapped in $win16_h16 once the 4096 slots were gone.
  for (let i = 0; i < 3000; i++) {
    const parent = 0x00013000 + i * 2, child = parent + 1;
    e.test_create(parent, 0);
    e.test_create(child, parent);
    e.test_h16(parent);
    e.test_h16(child);
    e.test_h16(child + 0x40000);   // WM_CTLCOLOR / WM_ERASEBKGND hdc
    e.test_remove(child);
    e.test_remove(parent);
  }
  assert.strictEqual(used(), base, '6000 created and destroyed windows leave the map where it was');
  assert.ok(e.test_next() < 16, `the map's high-water mark stays small (${e.test_next()})`);

  // Outside a Win16 task the arena page is not ours to scan: a no-op.
  e.test_init(0);
  e.test_create(0x00019999, 0);
  e.test_remove(0x00019999);

  console.log('PASS  Win16 handle map releases a destroyed window\'s HWND and DC slots');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
