#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "clipboard_set_api") (param i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_OleSetClipboard (local.get 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
    (func (export "clipboard_current_api") (param i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_OleIsCurrentClipboard (local.get 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
    (func (export "clipboard_get_api") (param i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_OleGetClipboard (local.get 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  e.init_dx_com_thunks();
  assert.strictEqual(e.test_ole_set_clipboard, undefined, 'no separate test-only ownership setter');
  assert.strictEqual(e.test_ole_get_clipboard, undefined, 'no separate test-only ownership getter');
  const refcount = obj => e.guest_read32(obj + 4);
  const set = obj => {
    assert.strictEqual(e.clipboard_set_api(obj), 0);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  };
  const current = (obj, expected) => {
    assert.strictEqual(e.clipboard_current_api(obj), expected);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  };
  current(0, 1);
  const first = e.test_ole_create_data_object(0, 0) >>> 0;
  const second = e.test_ole_create_data_object(0, 0) >>> 0;
  const vtable = e.guest_read32(first);
  set(first);
  assert.strictEqual(refcount(first), 2);
  current(first, 0); current(second, 1);
  set(first);
  assert.strictEqual(refcount(first), 2, 'republishing with a caller reference stays balanced');
  assert.strictEqual(e.test_ole_release(first), 1, 'clipboard now holds the only reference');
  for (let i = 0; i < 4; i++) {
    set(first);
    assert.strictEqual(e.guest_read32(first), vtable, 'republishing must not destroy the object');
    assert.strictEqual(refcount(first), 1, 'clipboard-only republish preserves one reference');
    current(first, 0);
  }
  const out = e.guest_alloc(4) >>> 0;
  assert.strictEqual(e.clipboard_get_api(out), 0);
  assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  assert.strictEqual(e.guest_read32(out) >>> 0, first);
  assert.strictEqual(refcount(first), 2, 'consumer receives an owned reference');
  set(second);
  assert.strictEqual(refcount(first), 1, 'replacement leaves the consumer reference alive');
  assert.strictEqual(refcount(second), 2);
  current(first, 1); current(second, 0);
  assert.strictEqual(e.test_ole_release(first), 0);
  set(0);
  assert.strictEqual(refcount(second), 1, 'clearing retires only the clipboard reference');
  current(second, 1); current(0, 1);
  set(0);
  assert.strictEqual(refcount(second), 1, 'repeated clear does not release again');
  assert.strictEqual(e.test_ole_release(second), 0);
  console.log('PASS real OLE clipboard APIs: republish, owner identity, replacement, Get and clear lifetimes');
})().catch(error => { console.error(error); process.exitCode = 1; });
