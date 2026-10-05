#!/usr/bin/env node
'use strict';
const assert = require('assert');
// Real guest callbacks: erase timing, borrowed paint DC, result-driven fErase,
// reentrant BeginPaint and reinvalidation. See docs/review-win16-windowpos.md.
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');
const extraWat = `
  (func (export "test_window") (param $proc i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $h) (i32.const 0)
      (i32.const 0) (i32.const 32) (i32.const 24) (i32.const 0))
    (call $wnd_table_set (local.get $h) (local.get $proc))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x90000000)))
    (call $client_rect_set (local.get $h) (i32.const 0) (i32.const 0) (i32.const 32) (i32.const 24))
    (local.get $h))
  (func (export "test_damage") (param $h i32) (param $erase i32) (param $brush i32)
    (call $wnd_set_bg_brush (local.get $h) (local.get $brush))
    (call $update_invalidate_rect (local.get $h) (i32.const 3) (i32.const 4) (i32.const 12) (i32.const 15))
    (call $paint_flag_set (local.get $h))
    (if (local.get $erase) (then (call $nc_flags_set (local.get $h) (i32.const 2)))))
  (func (export "test_begin") (param $h i32) (param $ps i32) (result i32)
    (local $sp i32) (local $dc i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_BeginPaint (local.get $h) (local.get $ps) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (local.set $dc (i32.load (global.get $reg_base)))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.add (local.get $sp) (i32.const 12)))
      (then (unreachable)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (local.get $dc))
  (func (export "test_end") (param $h i32) (param $ps i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_EndPaint (local.get $h) (local.get $ps) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp)))
  (func (export "test_update") (param $h i32) (call $update_window_now (local.get $h)))
  (func (export "test_erase_pending") (param $h i32) (result i32)
    (i32.and (call $nc_flags_test (local.get $h)) (i32.const 2)))
  (func (export "test_damage_pending") (param $h i32) (result i32)
    (call $update_get_rect (local.get $h) (i32.const 0)))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
`;
const u32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 255);
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const record = e.guest_alloc(32), ps = e.guest_alloc(64);
  const brush = e.test_call_CreateSolidBrush(0xff);
  for (const handled of [0, 1, 7]) for (const background of [0, brush]) for (const erase of [0, 1]) {
    // Actual stdcall wndproc records the erase HDC and message before returning.
    const code = [0x8b, 0x44, 0x24, 12, 0xa3, ...u32(record),
      0x8b, 0x44, 0x24, 8, 0xa3, ...u32(record + 4),
      0xff, 0x05, ...u32(record + 8), 0xb8, ...u32(handled), 0xc2, 16, 0];
    const proc = e.guest_alloc(code.length);
    code.forEach((b, i) => e.guest_write8(proc + i, b));
    const h = e.test_window(proc);
    for (let i = 0; i < 12; i += 4) e.guest_write32(record + i, 0);
    e.test_damage(h, erase, background);
    const dc = e.test_begin(h, ps);
    assert(dc, 'BeginPaint returns a paint DC');
    assert.strictEqual(e.test_damage_pending(h), 0, 'BeginPaint validates before returning, not EndPaint');
    assert.strictEqual(e.guest_read32(record + 8), erase, 'only erase-marked damage sends WM_ERASEBKGND');
    if (erase) {
      assert.strictEqual(e.guest_read32(record + 4), 0x14);
      assert.strictEqual(e.guest_read32(record), dc, 'erase borrows the actual paint DC');
    }
    assert.strictEqual(e.guest_read32(ps + 4), erase && !handled ? 1 : 0,
      `fErase follows callback result, not class brush: erase=${erase}, handled=${handled}, brush=${background}`);
    assert.deepStrictEqual([0, 1, 2, 3].map(i => e.guest_read32(ps + 8 + i * 4)), [3, 4, 12, 15]);
    assert.strictEqual(e.get_sync_msg_depth(), 0);
    e.test_end(h, ps);
    e.guest_write32(record + 8, 0);
    e.test_damage(h, 0, background);
    e.test_begin(h, ps);
    assert.strictEqual(e.guest_read32(record + 8), erase && !handled ? 1 : 0,
      'declined erase remains pending across a later non-erasing invalidation');
    assert.strictEqual(e.guest_read32(ps + 4), erase && !handled ? 1 : 0);
    e.test_end(h, ps);
  }
  const begin = e.test_thunk(apiTable.find(a => a.name === 'BeginPaint').id);
  const paint = [0xc7, 0x05, ...u32(record + 12), ...u32(1),
    0x68, ...u32(ps), 0xff, 0x74, 0x24, 8,
    0xb8, ...u32(begin), 0xff, 0xd0, 0xa3, ...u32(record + 20), 0xc2, 16, 0];
  const eraseCode = [0xa1, ...u32(record + 12), 0xa3, ...u32(record + 16),
    0x8b, 0x44, 0x24, 12, 0xa3, ...u32(record),
    0xb8, ...u32(1), 0xc2, 16, 0];
  const body = [0x83, 0x7c, 0x24, 8, 0x0f, 0x75, paint.length, ...paint, ...eraseCode];
  const proc = e.guest_alloc(body.length);
  body.forEach((b, i) => e.guest_write8(proc + i, b));
  const h = e.test_window(proc);
  e.guest_write32(record + 12, 0); e.guest_write32(record + 16, 0);
  e.test_damage(h, 1, 0);
  const sp = e.get_esp();
  e.test_update(h);
  assert.strictEqual(e.get_esp(), sp);
  assert.strictEqual(e.guest_read32(record + 16), 1, 'erase happens inside WM_PAINT at BeginPaint, never ahead of it');
  assert.strictEqual(e.guest_read32(record), e.guest_read32(record + 20), 'nested erase receives the returned paint DC');
  assert.strictEqual(e.guest_read32(ps + 4), 0, 'handled custom erase with NULL brush reports fErase=FALSE');
  assert.strictEqual(e.get_sync_msg_depth(), 0);
  e.test_end(h, ps);

  // A same-window BeginPaint from the erase callback must not recursively
  // redispatch the request already being handled by its outer invocation.
  const innerPs = e.guest_alloc(64);
  const recursive = [0xff, 0x05, ...u32(record + 8),
    0x68, ...u32(innerPs), 0xff, 0x74, 0x24, 8,
    0xb8, ...u32(begin), 0xff, 0xd0, 0xa3, ...u32(record + 24),
    0xb8, ...u32(7), 0xc2, 16, 0];
  const recursiveProc = e.guest_alloc(recursive.length);
  recursive.forEach((b, i) => e.guest_write8(recursiveProc + i, b));
  const recursiveWindow = e.test_window(recursiveProc);
  e.guest_write32(record + 8, 0);
  e.test_damage(recursiveWindow, 1, 0);
  e.test_begin(recursiveWindow, ps);
  assert.strictEqual(e.guest_read32(record + 8), 1, 'nested BeginPaint does not resend the in-flight erase');
  assert(e.guest_read32(record + 24), 'nested BeginPaint returns its own paint DC');
  assert.strictEqual(e.guest_read32(innerPs + 4), 0);
  assert.strictEqual(e.guest_read32(ps + 4), 0);
  assert.strictEqual(e.get_sync_msg_depth(), 0);
  e.test_end(recursiveWindow, innerPs);
  e.test_end(recursiveWindow, ps);

  // A newly requested erase belongs to the next cycle even when the current
  // callback reports success. Clearing after the callback would lose it.
  const invalidate = e.test_thunk(apiTable.find(a => a.name === 'InvalidateRect').id);
  const renew = [0x6a, 2, 0x6a, 0, 0xff, 0x74, 0x24, 12, // any nonzero BOOL requests erase
    0xb8, ...u32(invalidate), 0xff, 0xd0, 0xb8, ...u32(7), 0xc2, 16, 0];
  const renewProc = e.guest_alloc(renew.length);
  renew.forEach((b, i) => e.guest_write8(renewProc + i, b));
  const renewWindow = e.test_window(renewProc);
  e.test_damage(renewWindow, 1, 0);
  e.test_begin(renewWindow, ps);
  assert.strictEqual(e.guest_read32(ps + 4), 0, 'current erase was handled');
  assert.strictEqual(e.test_erase_pending(renewWindow), 2, 'callback reinvalidation retains its new erase request');
  e.test_end(renewWindow, ps);
  assert.strictEqual(e.test_damage_pending(renewWindow), 1, 'EndPaint preserves callback reinvalidation');
  const repeatWindow = e.test_window(proc);
  e.test_damage(repeatWindow, 0, 0);
  e.test_begin(repeatWindow, ps);
  e.test_damage(repeatWindow, 0, 0); // same rectangle, invalidated during painting
  e.test_end(repeatWindow, ps);
  assert.strictEqual(e.test_damage_pending(repeatWindow), 1,
    'EndPaint must not validate newly invalidated pixels even when they equal old rcPaint');
  console.log('PASS BeginPaint synchronous erase callback, paint DC, result-driven fErase and no-erase cases');
})().catch(error => { console.error(error); process.exit(1); });
