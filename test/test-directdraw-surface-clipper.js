#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_init_dx") (call $init_dx_com_thunks))
  (func (export "test_create_surface") (result i32)
    (call $dx_create_com_obj (i32.const 2) (global.get $DX_VTBL_DDSURF)))
  (func (export "test_create_clipper") (result i32)
    (call $dx_create_com_obj (i32.const 10) (global.get $DX_VTBL_DDCLIP)))
  (func (export "test_create_other") (result i32)
    (call $dx_create_com_obj (i32.const 3) (global.get $DX_VTBL_DDCLIP)))
  (func (export "test_alloc") (param $bytes i32) (result i32)
    (call $heap_alloc (local.get $bytes)))
  (func (export "test_peek32") (param $ptr i32) (result i32)
    (call $gl32 (local.get $ptr)))
  (func (export "test_poke32") (param $ptr i32) (param $value i32)
    (call $gs32 (local.get $ptr) (local.get $value)))
  (func (export "test_refcount") (param $object i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $object))))
  (func (export "test_release_basic") (param $object i32) (result i32)
    (call $dx_com_release_basic (local.get $object)))
  (func (export "test_release_surface") (param $surface i32) (result i32)
    (call $dx_surface_release (local.get $surface)))
  (func (export "test_surface_target") (param $surface i32) (result i32)
    (call $dx_surface_target_hwnd (call $dx_from_this (local.get $surface))))
  (func (export "test_set_clipper")
      (param $surface i32) (param $clipper i32) (result i32)
    (global.set $esp (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_SetClipper
      (local.get $surface) (local.get $clipper) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $eax))
  (func (export "test_get_clipper")
      (param $surface i32) (param $out i32) (result i32)
    (global.set $esp (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_GetClipper
      (local.get $surface) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $eax))
  (func (export "test_set_clipper_hwnd")
      (param $clipper i32) (param $hwnd i32) (result i32)
    (global.set $esp (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_SetHWnd
      (local.get $clipper) (i32.const 0) (local.get $hwnd)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $eax))
`;

(async () => {
  const DD_OK = 0;
  const DDERR_INVALIDPARAMS = 0x80070057 | 0;
  const DDERR_INVALIDOBJECT = 0x88760082 | 0;
  const DDERR_NOCLIPPERATTACHED = 0x887600ff | 0;
  const DESKTOP_HWND = 0x10000;
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_init_dx();

  const surface = e.test_create_surface() >>> 0;
  const first = e.test_create_clipper() >>> 0;
  const second = e.test_create_clipper() >>> 0;
  const other = e.test_create_other() >>> 0;
  const out = e.test_alloc(4) >>> 0;
  assert(surface && first && second && other && out,
    'surface, clippers, control object and output storage were allocated');

  e.test_poke32(out, 0x55aa55aa);
  assert.strictEqual(e.test_get_clipper(surface, out), DDERR_NOCLIPPERATTACHED,
    'a fresh surface reports that it has no clipper');
  assert.strictEqual(e.test_peek32(out), 0,
    'the failed getter clears its COM output instead of returning stale data');
  assert.strictEqual(e.test_set_clipper(surface, 0), DDERR_NOCLIPPERATTACHED,
    'detaching from a fresh surface reports no attachment');
  assert.strictEqual(e.test_get_clipper(surface, 0), DDERR_INVALIDPARAMS,
    'GetClipper rejects a null output pointer');

  assert.strictEqual(e.test_refcount(first), 1);
  assert.strictEqual(e.test_set_clipper(surface, first), DD_OK,
    'SetClipper attaches a valid DirectDrawClipper');
  assert.strictEqual(e.test_refcount(first), 2,
    'the surface owns one reference to its clipper');
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
    'SetClipper pops this and its one argument');

  assert.strictEqual(e.test_set_clipper(surface, first), DD_OK,
    'reattaching the same underlying clipper succeeds');
  assert.strictEqual(e.test_refcount(first), 2,
    'reattaching the same clipper is reference-count neutral');
  assert.strictEqual(e.test_get_clipper(surface, out), DD_OK);
  assert.strictEqual(e.test_peek32(out) >>> 0, first,
    'GetClipper returns the exact attached interface');
  assert.strictEqual(e.test_refcount(first), 3,
    'GetClipper gives the caller an independent reference');
  assert.strictEqual(e.test_release_basic(e.test_peek32(out)), 2,
    'the caller can release the getter reference independently');
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
    'GetClipper pops this and its output argument');

  assert.strictEqual(e.test_set_clipper(surface, other), DDERR_INVALIDOBJECT,
    'a different DirectDraw object type cannot be attached as a clipper');
  assert.strictEqual(e.test_refcount(first), 2,
    'a rejected replacement preserves the original owned reference');

  assert.strictEqual(e.test_set_clipper(surface, second), DD_OK,
    'a surface can replace its attached clipper');
  assert.strictEqual(e.test_refcount(first), 1,
    'replacement releases the old surface-owned reference');
  assert.strictEqual(e.test_refcount(second), 2,
    'replacement retains one reference to the new clipper');
  assert.strictEqual(e.test_set_clipper(surface, 0), DD_OK,
    'NULL detaches an existing clipper');
  assert.strictEqual(e.test_refcount(second), 1,
    'detachment releases the surface-owned reference');

  assert.strictEqual(e.test_set_clipper(other, first), DDERR_INVALIDOBJECT,
    'SetClipper validates the receiving surface object');
  assert.strictEqual(e.test_get_clipper(other, out), DDERR_INVALIDOBJECT,
    'GetClipper validates the receiving surface object');

  assert.strictEqual(e.test_set_clipper_hwnd(first, DESKTOP_HWND), DD_OK);
  assert.strictEqual(e.test_set_clipper(surface, first), DD_OK);
  assert.strictEqual(e.test_surface_target(surface), DESKTOP_HWND,
    'windowed presentation follows the attached clipper SetHWnd association');
  assert.strictEqual(e.test_release_surface(surface), 0,
    'the surface reaches final release');
  assert.strictEqual(e.test_refcount(first), 1,
    'final surface release detaches and releases its clipper reference');

  console.log('PASS DirectDraw surfaces own, return, replace, detach and use clippers');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
