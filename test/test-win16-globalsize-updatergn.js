#!/usr/bin/env node

'use strict';

// Two Win16 answers Visual Basic 3 programs depend on, both found by the
// Over1000Games Sokoban.
//
// KERNEL.20 GlobalSize reports the size Windows 3.1 actually gave the block,
// which is the request rounded up to 32 bytes. VB GlobalAllocs a file buffer,
// asks GlobalSize how big it is, and lays a sub-heap over the whole of it; its
// first-fit walk then steps through that sub-heap in even strides until it
// lands exactly on the end. Handed back the odd size it asked for (0x2c3), the
// walk stepped over the end and never stopped.
//
// USER.237 GetUpdateRgn(hWnd, hRgn, fErase) is a real entry point, not a
// fail-fast stub, and its Pascal frame is six bytes. VB's form paint path calls
// it on every WM_PAINT.
//
// Both are driven the way the dispatcher drives them: a Pascal frame on a real
// 16-bit stack, and the shim's own far-return epilogue, so the test also pins
// how many bytes each one pops.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "tgs_selector") (result i32)
    (call $win16_next_seg_set (i32.const 1))
    (call $win16_index_to_sel (call $win16_alloc_segment)))

  (func (export "tgs_seg_base") (param $sel i32) (result i32)
    (call $win16_seg_base (call $win16_sel_to_index (local.get $sel))))

  (func $tgs_frame (param $esp i32) (param $sel i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))                          ;; return IP
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (local.get $sel)))  ;; return CS

  (func (export "tgs_h16") (param $h32 i32) (result i32)
    (call $win16_h16 (local.get $h32)))

  (func (export "tgs_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))

  ;; GlobalAlloc(wFlags, dwBytes): Pascal words 1:0 = dwBytes, word 2 = wFlags.
  (func (export "tgs_global_alloc") (param $esp i32) (param $sel i32) (param $bytes i32) (result i32)
    (call $tgs_frame (local.get $esp) (local.get $sel))
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (i32.and (local.get $bytes) (i32.const 0xFFFF)))
    (call $gs16 (i32.add (local.get $esp) (i32.const 6)) (i32.shr_u (local.get $bytes) (i32.const 16)))
    (call $gs16 (i32.add (local.get $esp) (i32.const 8)) (i32.const 0x42))  ;; GHND
    (call $win16_GlobalAlloc)
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))

  ;; GlobalSize(h) -> DX:AX.
  (func (export "tgs_global_size") (param $esp i32) (param $sel i32) (param $h i32) (result i32)
    (call $tgs_frame (local.get $esp) (local.get $sel))
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (local.get $h))
    (call $win16_GlobalSize)
    (i32.or (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF))
            (i32.shl (i32.load offset=8 (global.get $reg_base)) (i32.const 16))))

  ;; GetUpdateRgn(hWnd, hRgn, fErase): word 2 = hWnd, 1 = hRgn, 0 = fErase.
  (func (export "tgs_get_update_rgn") (param $esp i32) (param $sel i32) (param $hwnd16 i32)
      (param $rgn16 i32) (result i32)
    (global.set $code16 (i32.const 1))
    (call $tgs_frame (local.get $esp) (local.get $sel))
    (call $gs16 (i32.add (local.get $esp) (i32.const 4)) (i32.const 1))
    (call $gs16 (i32.add (local.get $esp) (i32.const 6)) (local.get $rgn16))
    (call $gs16 (i32.add (local.get $esp) (i32.const 8)) (local.get $hwnd16))
    (call $win16_GetUpdateRgn)
    (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });

  const sel = wat.tgs_selector() >>> 0;
  const segBase = wat.tgs_seg_base(sel) >>> 0;
  assert(segBase, 'the fake task got a mapped selector');
  const esp = segBase + 0x8000;

  const sizeOf = (bytes) => {
    const h = wat.tgs_global_alloc(esp, sel, bytes) >>> 0;
    assert(h, `GlobalAlloc(${bytes}) answered with a handle`);
    assert.strictEqual(wat.tgs_esp() >>> 0, (esp + 4 + 6) >>> 0, 'GlobalAlloc pops its six bytes');
    const size = wat.tgs_global_size(esp, sel, h) >>> 0;
    assert.strictEqual(wat.tgs_esp() >>> 0, (esp + 4 + 2) >>> 0, 'GlobalSize pops its two bytes');
    return size;
  };

  // Sokoban's own request, then the edges of the 32-byte unit.
  assert.strictEqual(sizeOf(0x2c3), 0x2e0, 'GlobalSize(0x2c3) reports the rounded 0x2e0');
  assert.strictEqual(sizeOf(1), 0x20, 'one byte is one 32-byte unit');
  assert.strictEqual(sizeOf(0x20), 0x20, 'an exact unit is not rounded further');
  assert.strictEqual(sizeOf(0x21), 0x40, 'one past a unit takes the next one');
  assert.strictEqual(sizeOf(0x12345), 0x12360, 'a multi-segment block rounds the same way');
  for (const bytes of [0x2c3, 3, 0x777, 0x10001]) {
    assert.strictEqual(sizeOf(bytes) % 2, 0, `GlobalSize(${bytes}) is even, so an even-stride walk can land on it`);
  }

  // No window behind this handle: nothing to report, and the task continues.
  const rgn = wat.test_call_CreateRectRgn(0, 0, 1, 1) >>> 0;
  assert(rgn, 'the fixture region was created');
  const hwnd16 = wat.tgs_h16(0x7ff0) >>> 0;
  const rgn16 = wat.tgs_h16(rgn) >>> 0;
  assert.strictEqual(wat.tgs_get_update_rgn(esp, sel, hwnd16, rgn16) >>> 0, 0,
    'GetUpdateRgn on an unknown window reports no update');
  assert.strictEqual(wat.tgs_esp() >>> 0, (esp + 4 + 6) >>> 0, 'GetUpdateRgn pops its six bytes');

  console.log('PASS  Win16 GlobalSize reports 32-byte units; USER.237 GetUpdateRgn returns');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
