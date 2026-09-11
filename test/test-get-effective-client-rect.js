#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_gecr_parent (mut i32) (i32.const 0))
  (global $test_gecr_left (mut i32) (i32.const 0))
  (global $test_gecr_cleanup (mut i32) (i32.const 0))

  (func (export "test_gecr_setup") (result i32)
    (local $top i32) (local $parent i32)
    (local.set $top (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $top) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $top) (i32.const 0x10000000)))
    (local.set $parent
      (call $ctrl_create_child
        (local.get $top) (i32.const 3) (i32.const 10)
        (i32.const 0) (i32.const 0) (i32.const 300) (i32.const 200)
        (i32.const 0x50000000) (i32.const 0)))
    (global.set $test_gecr_parent (local.get $parent))
    ;; Top and bottom strips, then a left strip in the remaining height.
    (drop (call $ctrl_create_child
      (local.get $parent) (i32.const 3) (i32.const 100)
      (i32.const 0) (i32.const 0) (i32.const 300) (i32.const 20)
      (i32.const 0x50000000) (i32.const 0)))
    (drop (call $ctrl_create_child
      (local.get $parent) (i32.const 3) (i32.const 101)
      (i32.const 0) (i32.const 180) (i32.const 300) (i32.const 20)
      (i32.const 0x50000000) (i32.const 0)))
    (global.set $test_gecr_left
      (call $ctrl_create_child
        (local.get $parent) (i32.const 3) (i32.const 102)
        (i32.const 0) (i32.const 20) (i32.const 30) (i32.const 160)
        (i32.const 0x50000000) (i32.const 0)))
    ;; A hidden right strip is listed too and must not affect the result.
    (drop (call $ctrl_create_child
      (local.get $parent) (i32.const 3) (i32.const 103)
      (i32.const 280) (i32.const 20) (i32.const 20) (i32.const 160)
      (i32.const 0x40000000) (i32.const 0)))
    (local.get $parent))

  (func (export "test_gecr_set_parent_visible") (param $visible i32)
    (drop (call $wnd_set_style
      (global.get $test_gecr_parent)
      (select (i32.const 0x50000000) (i32.const 0x40000000)
        (local.get $visible)))))
  (func (export "test_gecr_set_left_visible") (param $visible i32)
    (drop (call $wnd_set_style
      (global.get $test_gecr_left)
      (select (i32.const 0x50000000) (i32.const 0x40000000)
        (local.get $visible)))))

  (func (export "test_get_effective_client_rect")
      (param $hwnd i32) (param $rect i32) (param $info i32)
    (local $before i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (global.get $esp))
    (call $handle_GetEffectiveClientRect
      (local.get $hwnd) (local.get $rect) (local.get $info)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_gecr_cleanup
      (i32.sub (global.get $esp) (local.get $before))))
  (func (export "test_gecr_cleanup") (result i32)
    (global.get $test_gecr_cleanup))
  (func (export "test_gecr_find") (param $id i32) (result i32)
    (call $ctrl_find_by_id (global.get $test_gecr_parent) (local.get $id)))
  (func (export "test_gecr_style") (param $hwnd i32) (result i32)
    (call $wnd_get_style (local.get $hwnd)))
  (func (export "test_gecr_xy") (param $hwnd i32) (result i32)
    (call $ctrl_get_xy_packed (local.get $hwnd)))
  (func (export "test_gecr_wh") (param $hwnd i32) (result i32)
    (call $ctrl_get_wh_packed (local.get $hwnd)))
  (func (export "test_gecr_info_word") (param $info i32) (param $offset i32) (result i32)
    (i32.load (i32.add (call $g2w (local.get $info)) (local.get $offset))))

  (func (export "test_subtract_rect")
      (param $dst i32) (param $src1 i32) (param $src2 i32) (result i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (call $handle_SubtractRect
      (local.get $dst) (local.get $src1) (local.get $src2)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.get $eax))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const parent = e.test_gecr_setup() >>> 0;
  const rect = e.guest_alloc(16) >>> 0;
  const info = e.guest_alloc(48) >>> 0;
  const readRect = ptr => [0, 4, 8, 12].map(offset => e.guest_read32(ptr + offset) | 0);
  const writeRect = (ptr, values) => values.forEach((value, i) => e.guest_write32(ptr + i * 4, value));

  const probe1 = e.guest_alloc(16) >>> 0;
  const probe2 = e.guest_alloc(16) >>> 0;
  writeRect(probe1, [0, 20, 300, 200]);
  writeRect(probe2, [0, 180, 300, 200]);
  assert.strictEqual(e.test_subtract_rect(probe1, probe1, probe2), 1);
  assert.deepStrictEqual(readRect(probe1), [0, 20, 300, 180],
    'shared subtraction trims a bottom-docked strip');

  // Pair zero describes the menu and is ignored. The remaining nonzero
  // selectors pair with child IDs, followed by the required zero selector.
  [999, 100, 1, 100, 1, 101, 1, 102, 1, 103, 0, 0]
    .forEach((value, i) => e.guest_write32(info + i * 4, value));
  for (const id of [100, 101, 102, 103]) {
    const child = e.test_gecr_find(id) >>> 0;
    assert.notStrictEqual(child, 0, `fixture child ${id} is addressable through GetDlgItem state`);
    assert.strictEqual((e.test_gecr_style(child) & 0x10000000) !== 0, id !== 103,
      `fixture child ${id} has the intended WS_VISIBLE state`);
  }
  assert.deepStrictEqual([8, 16, 24, 32, 40].map(offset => e.test_gecr_info_word(info, offset)),
    [1, 1, 1, 1, 0], 'fixture mapping selectors are contiguous in translated memory');
  assert.deepStrictEqual([100, 101, 102, 103].map(id => e.test_gecr_xy(e.test_gecr_find(id)) >>> 0),
    [0, 180 << 16, (20 << 16), (20 << 16) | 280]);
  assert.deepStrictEqual([100, 101, 102, 103].map(id => e.test_gecr_wh(e.test_gecr_find(id)) >>> 0),
    [(20 << 16) | 300, (20 << 16) | 300, (160 << 16) | 30, (160 << 16) | 20]);

  e.test_get_effective_client_rect(parent, rect, 0);
  assert.deepStrictEqual(readRect(rect), [0, 0, 300, 200],
    'a null mapping table still starts from the real parent client size');
  assert.strictEqual(e.test_gecr_cleanup(), 16,
    'GetEffectiveClientRect pops return address plus three arguments');

  e.test_get_effective_client_rect(parent, rect, info);
  assert.deepStrictEqual([12, 20, 28, 36].map(offset => e.test_gecr_info_word(info, offset)),
    [100, 101, 102, 103], 'rectangle writes do not alter mapping ids');
  assert.notStrictEqual(e.test_gecr_style(e.test_gecr_find(101)) & 0x10000000, 0,
    'bottom control remains visible after the calculation');
  assert.deepStrictEqual(readRect(rect), [30, 20, 300, 180],
    'visible top, bottom, and left controls are subtracted; hidden controls are ignored');

  e.test_gecr_set_parent_visible(0);
  e.test_get_effective_client_rect(parent, rect, info);
  assert.deepStrictEqual(readRect(rect), [30, 20, 300, 180],
    'WS_VISIBLE children still count while their parent is hidden');

  e.test_gecr_set_left_visible(0);
  e.test_get_effective_client_rect(parent, rect, info);
  assert.deepStrictEqual(readRect(rect), [0, 20, 300, 180],
    'clearing the child WS_VISIBLE bit removes it from the calculation');

  // Pin the shared rectangle primitive to Microsoft's documented examples.
  const src1 = e.guest_alloc(16) >>> 0;
  const src2 = e.guest_alloc(16) >>> 0;
  writeRect(src1, [10, 10, 100, 100]);
  writeRect(src2, [50, 50, 150, 150]);
  assert.strictEqual(e.test_subtract_rect(src1, src1, src2), 1);
  assert.deepStrictEqual(readRect(src1), [10, 10, 100, 100],
    'a corner overlap cannot be represented by one RECT and leaves src1 unchanged');

  writeRect(src1, [10, 10, 100, 100]);
  writeRect(src2, [50, 10, 150, 150]);
  assert.strictEqual(e.test_subtract_rect(src1, src1, src2), 1);
  assert.deepStrictEqual(readRect(src1), [10, 10, 50, 100],
    'a full-height overlap trims the intersecting edge');

  console.log('PASS  GetEffectiveClientRect subtracts Win98-visible mapped controls');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
