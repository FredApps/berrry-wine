#!/usr/bin/env node

'use strict';

// USER.82 InvertRect is a real entry point, not a fail-fast stub.
//
// The Win16 dispatch had FillRect (USER.81) and FrameRect (USER.83) and
// nothing in between, so a program that highlights by inverting hit
// $crash_unimplemented instead. MoraffWare's SphereJongg does exactly that for
// its tile highlight, about 42,000 batches into a run — long enough that the
// stop read as a crash rather than as a missing API.
//
// The shim is driven the way the dispatcher drives it: a real arena selector,
// a 16-bit RECT at a real far address, a Pascal frame on a real 16-bit stack,
// and the shim's own far-return epilogue. The pixels are then read out of the
// bitmap's canonical storage, because "InvertRect was reached" and "InvertRect
// inverted the right rectangle" are different claims.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const W = 8;
const H = 8;

const extraWat = String.raw`
  (func (export "twir_selector") (result i32)
    (call $win16_next_seg_set (i32.const 1))
    (call $win16_index_to_sel (call $win16_alloc_segment)))

  (func (export "twir_seg_base") (param $sel i32) (result i32)
    (call $win16_seg_base (call $win16_sel_to_index (local.get $sel))))

  ;; A 16-bit handle for a 32-bit one, which is what the guest would have been
  ;; given by the Win16 CreateCompatibleDC it never made here.
  (func (export "twir_h16") (param $h32 i32) (result i32)
    (call $win16_h16 (local.get $h32)))

  (func (export "twir_put_rect") (param $ga i32) (param $l i32) (param $t i32)
      (param $r i32) (param $b i32)
    (call $gs16 (local.get $ga) (local.get $l))
    (call $gs16 (i32.add (local.get $ga) (i32.const 2)) (local.get $t))
    (call $gs16 (i32.add (local.get $ga) (i32.const 4)) (local.get $r))
    (call $gs16 (i32.add (local.get $ga) (i32.const 6)) (local.get $b)))

  ;; InvertRect(hDC, lpRect): Pascal word 2 = hDC, 1:0 = lpRect.
  (func (export "twir_invert") (param $esp i32) (param $sel i32) (param $hdc16 i32)
      (param $rect_off i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))                        ;; return IP
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (local.get $sel)) ;; return CS
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (local.get $rect_off))
    (call $gs16 (i32.add (local.get $esp) (i32.const 6)) (local.get $sel))
    (call $gs16 (i32.add (local.get $esp) (i32.const 8)) (local.get $hdc16))
    (call $win16_InvertRect)
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat });
  const bytes = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const descriptor = RegionMap.BASE.GDI_LINE_DESC;

  const bitmap = wat.test_call_CreateCompatibleBitmap(0, W, H) >>> 0;
  assert(bitmap, 'the fixture bitmap was allocated');
  const hdc = wat.test_call_CreateCompatibleDC(0) >>> 0;
  assert(wat.test_call_SelectObject(hdc, bitmap), 'the bitmap selected into the DC');
  assert.strictEqual(wat.test_gdi_surface_descriptor(hdc, descriptor), 1);
  const storage = dv.getUint32(descriptor, true);
  assert(storage, 'the DDB has canonical storage to read back');

  const pixel = (x, y) => {
    const p = storage + (y * W + x) * 4;
    return bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
  };

  // A fresh compatible bitmap starts black, so an inversion is unambiguous.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) assert.strictEqual(pixel(x, y), 0, 'starts black');
  }

  const sel = wat.twir_selector() >>> 0;
  const segBase = wat.twir_seg_base(sel) >>> 0;
  assert(segBase, 'the fake task got a mapped selector');
  const rectOff = 0x100;
  wat.twir_put_rect(segBase + rectOff, 2, 3, 6, 5);

  const hdc16 = wat.twir_h16(hdc) >>> 0;
  assert(hdc16, 'the DC has a 16-bit handle');
  assert(wat.twir_invert(segBase + 0x8000, sel, hdc16, rectOff) >>> 0,
    'InvertRect reports success instead of stopping the task');

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= 2 && x < 6 && y >= 3 && y < 5;
      assert.strictEqual(pixel(x, y), inside ? 0xFFFFFF : 0,
        `pixel ${x},${y} should be ${inside ? 'inverted' : 'untouched'}`);
    }
  }

  // Twice over the same rectangle is the identity — that is what makes it an
  // inversion rather than a fill, and it is how a highlight gets taken down.
  assert(wat.twir_invert(segBase + 0x8000, sel, hdc16, rectOff) >>> 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) assert.strictEqual(pixel(x, y), 0, 'inverting twice restores');
  }

  wat.test_call_DeleteDC(hdc);
  wat.test_call_DeleteObject(bitmap);

  console.log('PASS  Win16 USER.82 InvertRect inverts the rectangle it is given');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
