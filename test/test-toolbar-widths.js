#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_toolbar_width") (param $hwnd i32) (param $idx i32) (param $raw i32) (result i32)
    (local $sw ptr<ToolbarState>)
    (local.set $sw (cast ptr<ToolbarState> (call $g2w (call $wnd_get_state_ptr (local.get $hwnd)))))
    (if (result i32) (local.get $raw)
      (then (call $toolbar_button_raw_width (local.get $sw) (local.get $idx)))
      (else (call $toolbar_button_width (local.get $sw) (local.get $idx)))))
  (func (export "test_toolbar_default_width") (param $hwnd i32) (param $width i32)
    (local $sw ptr<ToolbarState>)
    (local.set $sw (cast ptr<ToolbarState> (call $g2w (call $wnd_get_state_ptr (local.get $hwnd)))))
    (store.field.memarg ToolbarState button_w (local.get $sw) (local.get $width)))
  (func (export "test_toolbar_combo") (param $hwnd i32) (param $cmd i32) (param $width i32) (result i32)
    (call $ctrl_create_child (local.get $hwnd) (i32.const 5) (local.get $cmd)
      (i32.const 0) (i32.const 0) (local.get $width) (i32.const 24)
      (i32.const 0x50000003) (i32.const 0)))
  (func (export "test_toolbar_combo_resize") (param $hwnd i32) (param $width i32)
    (call $ctrl_geom_set (call $wnd_table_find (local.get $hwnd))
      (i32.const 0) (i32.const 0) (local.get $width) (i32.const 24)))
`;

(async () => {
  let parentWidth = 400;
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none',
    extraHostOverrides: { get_window_client_size: () => parentWidth | (80 << 16) },
  });
  const makeToolbar = () => e.test_create_toolbar(0, 0, 800, 28, 0);
  const add = (hwnd, records) => {
    const p = e.guest_alloc(records.length * 20);
    records.forEach(([image, command, style], i) => {
      [image, command, 4 | (style << 8), 0, -1].forEach((v, n) =>
        e.guest_write32(p + i * 20 + n * 4, v));
    });
    assert.strictEqual(e.send_message(hwnd, 0x414, records.length, p), 1);
  };
  const tb = makeToolbar();
  for (const width of [-1, 0, 26]) {
    e.test_toolbar_default_width(tb, width);
    for (const raw of [0, 1]) assert.strictEqual(e.test_toolbar_width(tb, 0, raw), width > 0 ? width : 23);
  }
  add(tb, [[99, 100, 0], ...[-1, 0, 3, 4, 8, 512, 513].map((v, i) => [v, 101 + i, 1])]);
  for (const raw of [0, 1]) {
    assert.deepStrictEqual(Array.from({ length: 8 }, (_, i) => e.test_toolbar_width(tb, i, raw)),
      [26, 8, 8, 8, 4, 8, 512, 8]);
    for (const index of [-1, 8, 2147483647]) assert.strictEqual(e.test_toolbar_width(tb, index, raw), 26);
  }

  const combos = makeToolbar();
  e.test_toolbar_default_width(combos, 23);
  add(combos, [[8, 201, 1], [8, 202, 1], [0, 203, 0]]);
  const first = e.test_toolbar_combo(combos, 201, 250);
  e.test_toolbar_combo(combos, 202, 300);
  const widths = raw => [0, 1, 2].map(i => e.test_toolbar_width(combos, i, raw));
  assert.deepStrictEqual(widths(1), [250, 300, 23]);
  // Each large combo must sum RAW siblings, not recursively negotiate them.
  assert.deepStrictEqual(widths(0), [80, 125, 23]);
  parentWidth = 800;
  assert.deepStrictEqual(widths(0), [250, 300, 23]);
  parentWidth = 100;
  e.test_toolbar_combo_resize(first, 160);
  assert.deepStrictEqual(widths(0), [160, 80, 23]);
  assert.deepStrictEqual(widths(1), [160, 300, 23]);
  console.log('PASS toolbar raw/constrained widths: defaults, separators, bounds, sibling negotiation');
})().catch(error => { console.error(error); process.exit(1); });
