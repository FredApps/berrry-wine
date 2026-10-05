#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_marker_max") (result i32) (global.get $MAX_WINDOWS))
  (func (export "test_marker_register") (param $hwnd i32) (result i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $wnd_table_find (local.get $hwnd)))
  (func (export "test_marker_set") (param $tab i32) (param $slot i32) (param $value i32)
    (if (local.get $tab)
      (then (call $tab_native_mark_slot (local.get $slot) (local.get $value)))
      (else (call $statusbar_native_mark_slot (local.get $slot) (local.get $value)))))
  (func (export "test_marker_is") (param $tab i32) (param $hwnd i32) (result i32)
    (if (result i32) (local.get $tab)
      (then (call $tab_native_is (local.get $hwnd)))
      (else (call $statusbar_native_is (local.get $hwnd)))))
  (func (export "test_marker_byte") (param $tab i32) (param $index i32) (result i32)
    (i32.load8_u (i32.add (local.get $index)
      (select (global.get $NATIVE_TAB_BITS) (global.get $NATIVE_STATUS_BITS)
        (local.get $tab)))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const max = e.test_marker_max();
  const size = Math.ceil(max / 8);
  const snapshot = kind => Array.from({ length: size + 2 }, (_, i) => e.test_marker_byte(kind, i - 1));
  for (const kind of [0, 1]) {
    for (let slot = 0; slot < max; slot++) e.test_marker_set(kind, slot, 0);
  }
  const expected = [new Uint8Array(size), new Uint8Array(size)];
  const windows = Array.from({ length: max }, (_, i) => 0x20000 + i);
  const slots = windows.map(hwnd => e.test_marker_register(hwnd));
  assert(slots.every(slot => slot >= 0 && slot < max));
  assert.strictEqual(new Set(slots).size, max, 'fixture covers every window slot');
  for (const kind of [0, 1]) {
    for (let i = 0; i < max; i++) {
      const slot = slots[i];
      const marked = (i + kind) % 3 !== 0;
      // Non-boolean nonzero values must also set a bit.
      e.test_marker_set(kind, slot, marked ? 2 : 0);
      if (marked) expected[kind][slot >>> 3] |= 1 << (slot & 7);
    }
    for (const other of [0, 1]) {
      assert.deepStrictEqual(snapshot(other).slice(1, -1), [...expected[other]],
        'marking one family preserves every other bit and the other family');
    }
    windows.forEach((hwnd, i) => assert.strictEqual(e.test_marker_is(kind, hwnd),
      ((i + kind) % 3 !== 0) ? 1 : 0));
    const before = [snapshot(0), snapshot(1)];
    for (const slot of [-1, -2147483648, max, max + 7, 2147483647]) {
      e.test_marker_set(kind, slot, 1);
      e.test_marker_set(kind, slot, 0);
    }
    assert.deepStrictEqual([snapshot(0), snapshot(1)], before,
      'invalid slots must not change bitmap or neighboring bytes');
    assert.strictEqual(e.test_marker_is(kind, 0x7fffffff), 0, 'unknown HWND is not marked');
  }
  for (const kind of [0, 1]) {
    for (const slot of slots) e.test_marker_set(kind, slot, 0);
    assert(snapshot(kind).slice(1, -1).every(byte => byte === 0), 'every bit can be cleared');
    windows.forEach(hwnd => assert.strictEqual(e.test_marker_is(kind, hwnd), 0));
  }
  console.log('PASS native tab/status markers: every slot, isolation, clear, invalid bounds');
})().catch(error => { console.error(error); process.exit(1); });
