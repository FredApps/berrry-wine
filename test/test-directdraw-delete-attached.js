#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_dd_surface") (result i32)
    (call $dx_create_com_obj (i32.const 2) (i32.const 0x54000000)))

  (func (export "test_dd_add") (param $parent i32) (param $child i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_AddAttachedSurface
      (local.get $parent) (local.get $child) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dd_delete")
      (param $parent i32) (param $flags i32) (param $child i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_DeleteAttachedSurface
      (local.get $parent) (local.get $flags) (local.get $child)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dd_ref") (param $surface i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $surface))))

  (func (export "test_dd_parent") (param $surface i32) (result i32)
    (i32.load offset=4
      (call $dx_surf_meta_ptr (call $dx_from_this (local.get $surface)))))

  (func (export "test_dd_implicit_link") (param $parent i32) (param $child i32)
    (store.field DxObject misc0 (call $dx_from_this (local.get $parent))
      (local.get $child)))

  (func (export "test_dd_implicit_child") (param $parent i32) (result i32)
    (load.field DxObject misc0 (call $dx_from_this (local.get $parent))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const DD_OK = 0;
  const DDERR_CANNOTDETACHSURFACE = 0x88760014;
  const DDERR_INVALIDPARAMS = 0x80070057;
  const DDERR_SURFACENOTATTACHED = 0x887601cc;

  const parent = e.test_dd_surface() >>> 0;
  const child = e.test_dd_surface() >>> 0;
  assert.strictEqual(e.test_dd_add(parent, child) >>> 0, DD_OK);
  assert.strictEqual(e.test_dd_ref(child), 2,
    'AddAttachedSurface did not retain its child');
  assert.notStrictEqual(e.test_dd_parent(child), 0);

  assert.strictEqual(e.test_dd_delete(parent, 0, child) >>> 0, DD_OK);
  assert.strictEqual(e.get_esp(), 0x00300010,
    'DeleteAttachedSurface did not pop this, flags, and child');
  assert.strictEqual(e.test_dd_parent(child), 0,
    'explicit parent relationship survived detachment');
  assert.strictEqual(e.test_dd_ref(child), 1,
    'detachment did not release AddAttachedSurface ownership');
  assert.strictEqual(e.test_dd_delete(parent, 0, child) >>> 0,
    DDERR_SURFACENOTATTACHED,
    'repeated detachment silently succeeded');

  const otherParent = e.test_dd_surface() >>> 0;
  const otherChild = e.test_dd_surface() >>> 0;
  e.test_dd_add(otherParent, otherChild);
  assert.strictEqual(e.test_dd_delete(parent, 0, otherChild) >>> 0,
    DDERR_SURFACENOTATTACHED,
    'a different parent detached a surface it does not own');
  assert.notStrictEqual(e.test_dd_parent(otherChild), 0);
  assert.strictEqual(e.test_dd_ref(otherChild), 2);

  assert.strictEqual(e.test_dd_delete(otherParent, 1, otherChild) >>> 0,
    DDERR_INVALIDPARAMS,
    'reserved flags were accepted');
  assert.notStrictEqual(e.test_dd_parent(otherChild), 0);
  assert.strictEqual(e.test_dd_ref(otherChild), 2);

  const allParent = e.test_dd_surface() >>> 0;
  const first = e.test_dd_surface() >>> 0;
  const second = e.test_dd_surface() >>> 0;
  e.test_dd_add(allParent, first);
  e.test_dd_add(allParent, second);
  assert.strictEqual(e.test_dd_delete(allParent, 0, 0) >>> 0, DD_OK,
    'NULL child did not detach all explicit children');
  assert.deepStrictEqual([
    e.test_dd_parent(first), e.test_dd_ref(first),
    e.test_dd_parent(second), e.test_dd_ref(second),
  ], [0, 1, 0, 1]);

  const flipParent = e.test_dd_surface() >>> 0;
  const implicitBack = e.test_dd_surface() >>> 0;
  e.test_dd_implicit_link(flipParent, implicitBack);
  assert.strictEqual(e.test_dd_delete(flipParent, 0, implicitBack) >>> 0,
    DDERR_CANNOTDETACHSURFACE,
    'implicit flip-chain attachment was detached');
  assert.strictEqual(e.test_dd_implicit_child(flipParent) >>> 0, implicitBack);
  assert.strictEqual(e.test_dd_ref(implicitBack), 1);

  console.log('PASS  DirectDraw detaches explicit surfaces with exact ownership and errors');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
