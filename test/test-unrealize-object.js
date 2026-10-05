#!/usr/bin/env node
'use strict';

// Winamp's palette-change path unrealizes logical palettes before realizing
// them again. The browser renderer resolves palettes immediately, so the
// operation has no deferred cache to clear, but only brushes and palettes are
// valid UnrealizeObject targets.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_unrealize_object") (param $object i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_UnrealizeObject
      (local.get $object) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;

  const logicalPalette = e.guest_alloc(8) >>> 0;
  e.guest_write16(logicalPalette, 0x0300);
  e.guest_write16(logicalPalette + 2, 1);
  e.guest_write32(logicalPalette + 4, 0x00112233);
  const palette = e.test_call_CreatePalette(logicalPalette) >>> 0;
  const brush = e.test_call_CreateSolidBrush(0x00010203) >>> 0;
  const bitmap = e.test_call_CreateCompatibleBitmap(0, 2, 2) >>> 0;
  assert(palette && brush && bitmap, 'test GDI objects allocate');

  assert.strictEqual(e.test_unrealize_object(palette), 1,
    'a live logical palette can be unrealized');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'UnrealizeObject pops its object handle and return address');
  assert.strictEqual(e.test_unrealize_object(brush), 1,
    'a live brush accepts the documented successful no-op');

  assert.strictEqual(e.test_unrealize_object(bitmap), 0,
    'a bitmap is not a documented UnrealizeObject target');
  assert.strictEqual(e.test_unrealize_object(0), 0,
    'a null object handle fails');
  assert.strictEqual(e.test_unrealize_object(0x7777), 0,
    'a fabricated object handle fails');

  assert.strictEqual(e.test_call_DeleteObject(palette), 1, 'palette releases');
  assert.strictEqual(e.test_call_DeleteObject(brush), 1, 'brush releases');
  assert.strictEqual(e.test_unrealize_object(palette), 0,
    'a deleted palette no longer succeeds');
  assert.strictEqual(e.test_unrealize_object(brush), 0,
    'a deleted brush no longer succeeds');
  assert.strictEqual(e.get_esp() >>> 0, stack + 8,
    'failed UnrealizeObject preserves stdcall cleanup');

  console.log('PASS  UnrealizeObject validates live palette and brush objects');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
