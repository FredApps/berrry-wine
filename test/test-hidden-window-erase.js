#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (func (export "test_window") (param $parent i32) (param $visible i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (i32.const 0x401000))
    (call $wnd_set_parent (local.get $h) (local.get $parent))
    (drop (call $wnd_set_style (local.get $h)
      (i32.or (select (i32.const 0x40000000) (i32.const 0) (local.get $parent))
        (select (i32.const 0x10000000) (i32.const 0) (local.get $visible)))))
    (call $nc_flags_set (local.get $h) (i32.const 7))
    (local.get $h))
  (func (export "test_show") (param $h i32)
    (drop (call $wnd_set_style (local.get $h) (i32.or (call $wnd_get_style (local.get $h)) (i32.const 0x10000000)))))
  (func (export "test_scan") (param $mask i32) (result i32) (call $nc_flags_scan (local.get $mask)))
  (func (export "test_clear") (param $h i32) (call $nc_flags_clear (local.get $h) (i32.const 7)))
  (func (export "test_retire") (param $h i32) (call $wnd_table_remove (local.get $h)))
`;
(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const parent = e.test_window(0, 0);
  const child = e.test_window(parent, 1);
  const visible = e.test_window(0, 1);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(e.test_scan(2), visible, 'hidden pending erases must not starve a later visible window');
    assert(e.nc_flags_test(parent) & 2, 'hidden parent keeps its initial erase');
    assert(e.nc_flags_test(child) & 2, 'visible child under a hidden parent keeps its initial erase');
  }
  e.test_clear(visible);
  assert.strictEqual(e.test_scan(2), 0, 'hidden pending erases are not deliverable');
  assert.strictEqual(e.test_scan(7), 0, 'combined nonclient scans must not expose hidden windows');
  assert(e.nc_flags_test(parent) & 2);
  assert(e.nc_flags_test(child) & 2, 'combined scan must also retain erase');
  e.test_show(parent);
  assert.strictEqual(e.test_scan(2), parent);
  e.test_clear(parent);
  assert.strictEqual(e.test_scan(2), child, 'parent exposure makes the preserved child erase available');
  e.test_retire(child);
  assert.strictEqual(e.test_scan(2), 0, 'retirement clears pending work');
  console.log('PASS hidden erase preservation, ancestor visibility, scan fairness and retirement');
})().catch(error => { console.error(error); process.exit(1); });
