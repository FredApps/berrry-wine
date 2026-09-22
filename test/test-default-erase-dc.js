#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_window") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (i32.const 0x401000))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x10000000)))
    (call $client_rect_set (local.get $h) (i32.const 0) (i32.const 0) (i32.const 32) (i32.const 24))
    (local.get $h))
  (func (export "test_erase") (param $h i32) (param $dc i32) (param $brush i32) (param $wide i32) (result i32)
    (local $sp i32) (local $result i32)
    (call $wnd_set_bg_brush (local.get $h) (local.get $brush))
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then (call $handle_DefWindowProcW (local.get $h) (i32.const 0x14) (local.get $dc)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_DefWindowProcA (local.get $h) (i32.const 0x14) (local.get $dc)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (local.set $result (i32.load (global.get $reg_base)))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.add (local.get $sp) (i32.const 20)))
      (then (unreachable)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (local.get $result))
  (func (export "test_clip") (param $dc i32)
    (drop (call $host_gdi_intersect_clip_rect (local.get $dc)
      (i32.const 5) (i32.const 6) (i32.const 12) (i32.const 14))))
  (func (export "test_erase16") (param $h i32) (param $dc i32) (param $brush i32) (result i32)
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (global.set $code16 (i32.const 1))
    (call $wnd_set_bg_brush (local.get $h) (local.get $brush))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x110800))
    (call $gs16 (i32.const 0x110800) (i32.const 0x80))
    (call $gs16 (i32.const 0x110802) (i32.const 0xf))
    (call $gs32 (i32.const 0x110804) (i32.const 0))
    (call $gs16 (i32.const 0x110808) (call $win16_h16 (local.get $dc)))
    (call $gs16 (i32.const 0x11080a) (i32.const 0x14))
    (call $gs16 (i32.const 0x11080c) (call $win16_h16 (local.get $h)))
    (call $win16_DefWindowProc)
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x11080e))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const hwnd = e.test_window();
  const bmi = e.guest_alloc(40), out = e.guest_alloc(4);
  e.guest_write32(bmi, 40); e.guest_write32(bmi + 4, 32); e.guest_write32(bmi + 8, -24);
  e.guest_write16(bmi + 12, 1); e.guest_write16(bmi + 14, 32);
  const bitmap = e.test_call_CreateDIBSection(0, bmi, 0, out, 0, 0);
  const dc = e.test_call_CreateCompatibleDC(0);
  e.test_call_SelectObject(dc, bitmap);
  const brush = e.test_call_CreateSolidBrush(0x000000ff); // red COLORREF
  e.test_clip(dc);
  const bits = e.guest_read32(out);
  for (const abi of ['A', 'W', '16']) {
    const erase = (handle, background) => abi === '16'
      ? e.test_erase16(hwnd, handle, background)
      : e.test_erase(hwnd, handle, background, +(abi === 'W'));
    for (let i = 0; i < 32 * 24; i++) e.guest_write32(bits + i * 4, 0xffffff);
    assert.strictEqual(erase(dc, brush), 1);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      const inside = x >= 5 && x < 12 && y >= 6 && y < 14;
      assert.strictEqual(e.guest_read32(bits + 4 * (y * 32 + x)) & 0xffffff,
        inside ? 0xff0000 : 0xffffff, `${abi} supplied DC pixel ${x},${y}`);
    }
    const before = Array.from({ length: 32 * 24 }, (_, i) => e.guest_read32(bits + i * 4));
    assert.strictEqual(erase(dc, 0), 0, 'NULL class brush declines erasing');
    assert.strictEqual(erase(0, brush), 0, 'missing DC cannot report a successful erase');
    assert.deepStrictEqual(Array.from({ length: 32 * 24 }, (_, i) => e.guest_read32(bits + i * 4)), before);
    assert.strictEqual(erase(dc, brush), 1, 'default erase must not release the caller-owned DC');
  }
  console.log('PASS default erase honors supplied HDC/clip, NULL brush, failure and DC ownership');
})().catch(error => { console.error(error); process.exit(1); });
