#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_rect16") (param $op i32) (param $hdc i32)
    (param $left i32) (param $top i32) (param $right i32) (param $bottom i32) (result i32)
    (call $win16_seg_set (i32.const 1) (i32.const 0x00100000)
      (i32.const 0x10000) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x00110000)
      (i32.const 0x10000) (i32.const 1) (i32.const 2))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x00100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x00110000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00110100))
    (call $gs16 (i32.const 0x00110100) (i32.const 0x004d))
    (call $gs16 (i32.const 0x00110102) (call $win16_index_to_sel (i32.const 1)))
    (call $gs16 (i32.const 0x00110104) (local.get $bottom))
    (call $gs16 (i32.const 0x00110106) (local.get $right))
    (call $gs16 (i32.const 0x00110108) (local.get $top))
    (call $gs16 (i32.const 0x0011010a) (local.get $left))
    (call $gs16 (i32.const 0x0011010c) (call $win16_h16 (local.get $hdc)))
    (drop (call $win16_gdi (local.get $op)))
    (global.set $code16 (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_rect_bridge_active") (result i32) (global.get $win16_in_call32))
  (func (export "test_rect32_clip") (param $exclude i32) (param $hdc i32)
    (param $left i32) (param $top i32) (param $right i32) (param $bottom i32) (result i32)
    (call $win16_call32_begin (i32.const 5))
    (call $win16_call32_arg (i32.const 3) (local.get $right))
    (call $win16_call32_arg (i32.const 4) (local.get $bottom))
    (if (local.get $exclude)
      (then (call $handle_ExcludeClipRect (local.get $hdc) (local.get $left) (local.get $top)
        (local.get $right) (local.get $bottom) (i32.const 0)))
      (else (call $handle_IntersectClipRect (local.get $hdc) (local.get $left) (local.get $top)
        (local.get $right) (local.get $bottom) (i32.const 0))))
    (call $win16_call32_end)
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const size = 32;
  function surface() {
    const bmi = e.guest_alloc(40), out = e.guest_alloc(4);
    [40, size, -size, 0x200001].forEach((v, i) => e.guest_write32(bmi + i * 4, v));
    const bitmap = e.test_call_CreateDIBSection(0, bmi, 0, out, 0, 0);
    const dc = e.test_call_CreateCompatibleDC(0);
    assert(bitmap && dc);
    e.test_call_SelectObject(dc, bitmap);
    return { dc, bits: e.guest_read32(out) };
  }
  const a = surface(), b = surface();
  const pixels = s => Array.from({ length: size * size }, (_, i) => e.guest_read32(s.bits + 4 * i));
  const reset = s => {
    e.test_gdi_dc_clip_select(s.dc, 0);
    assert.strictEqual(e.test_call_PatBlt(s.dc, 0, 0, size, size, 0x00ff0062), 1); // WHITENESS
  };
  const cases = [[2, 3, 19, 23], [-5, -7, 13, 17], [4, 4, 4, 4], [20, 18, 3, 2]];
  for (const op of [21, 22, 24, 27]) {
    for (const rect of cases) {
      reset(a); reset(b);
      const before = pixels(a);
      const result = e.test_rect16(op, a.dc, ...rect);
      assert.strictEqual(e.get_esp(), 0x0011010e, 'Pascal bridge pops ten argument bytes and far return');
      assert.strictEqual(e.get_eip(), 0x0010004d, 'far return restores CS:IP');
      assert.strictEqual(e.test_rect_bridge_active(), 0, '32-bit bridge closes');
      const expected = op === 24 ? e.test_call_Ellipse(b.dc, ...rect)
        : op === 27 ? e.test_call_Rectangle(b.dc, ...rect)
        : e.test_rect32_clip(op === 21 ? 1 : 0, b.dc, ...rect);
      assert.strictEqual(result, expected & 0xffff, `ordinal ${op} preserves return value`);
      assert.deepStrictEqual(pixels(a), pixels(b), `ordinal ${op} preserves rendered pixels: ${rect}`);
      if (rect === cases[0]) {
        if (op === 24 || op === 27) assert.notDeepStrictEqual(pixels(a), before,
          'drawing comparison must include actual changed pixels');
        else {
          assert.strictEqual(e.test_gdi_dc_clip_point_visible(a.dc, 5, 5), op === 21 ? 0 : 1);
          assert.strictEqual(e.test_gdi_dc_clip_point_visible(a.dc, 25, 25), op === 21 ? 1 : 0);
        }
      }
      for (let y = -8; y < 34; y += 3) for (let x = -8; x < 34; x += 3) {
        assert.strictEqual(e.test_gdi_dc_clip_point_visible(a.dc, x, y),
          e.test_gdi_dc_clip_point_visible(b.dc, x, y), `ordinal ${op} preserves clip at ${x},${y}`);
      }
    }
  }
  console.log('PASS Win16 rectangle bridges: four ordinals, signed coordinates, pixels, clip, stack and far return');
})().catch(error => { console.error(error); process.exit(1); });
