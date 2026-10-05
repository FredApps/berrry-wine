#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (func (export "test_result") (result i32) (i32.load (global.get $reg_base)))
  (func (export "test_retire") (param $h i32) (call $wnd_table_remove (local.get $h)))
  (func (export "test_window") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x10000000)))
    (local.get $h))
  (func (export "test_narrow") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
  (func (export "test_child") (param $parent i32) (result i32)
    (call $ctrl_create_child (local.get $parent) (i32.const 2) (i32.const 100)
      (i32.const 0) (i32.const 0) (i32.const 30) (i32.const 20)
      (i32.const 0x50000000) (i32.const 0)))
  (func $test_pos_stack
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (global.set $code16 (i32.const 1))
    (global.set $sreg_cs (call $win16_index_to_sel (i32.const 1)))
    (global.set $seg_base_cs (i32.const 0x100000))
    (global.set $sreg_ss (call $win16_index_to_sel (i32.const 2)))
    (global.set $seg_base_ss (i32.const 0x110000))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x110100))
    (call $gs16 (i32.const 0x110100) (i32.const 77))
    (call $gs16 (i32.const 0x110102) (call $win16_index_to_sel (i32.const 1))))
  (func (export "test_batch") (param $end i32) (param $arg i32) (result i32)
    (call $test_pos_stack)
    (call $gs16 (i32.const 0x110104) (local.get $arg))
    (if (local.get $end) (then (call $win16_EndDeferWindowPos)) (else (call $win16_BeginDeferWindowPos)))
    (i32.load (global.get $reg_base)))
  (func (export "test_resume")
    (call $win16_dispatch (i32.sub (global.get $eip) (global.get $seg_base_cs)) (i32.const 0)))
  (func (export "test_pos16") (param $defer i32) (param $h i32) (param $after i32) (param $flags i32) (param $batch i32)
    (call $test_pos_stack)
    (call $gs16 (i32.const 0x110104) (local.get $flags))
    (call $gs16 (i32.const 0x110106) (i32.const 20))
    (call $gs16 (i32.const 0x110108) (i32.const 30))
    (call $gs16 (i32.const 0x11010a) (i32.const 0))
    (call $gs16 (i32.const 0x11010c) (i32.const 0))
    (call $gs16 (i32.const 0x11010e) (local.get $after))
    (call $gs16 (i32.const 0x110110) (call $win16_h16 (local.get $h)))
    (call $gs16 (i32.const 0x110112) (local.get $batch))
    (if (local.get $defer) (then (call $win16_DeferWindowPos)) (else (call $win16_SetWindowPos)))
    (global.set $code16 (i32.const 0)))
`;
(async () => {
  const order = [];
  const moves = [];
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none', extraHostOverrides: {
    set_window_zorder: (hwnd, after) => order.push([hwnd >>> 0, after | 0]),
    move_window: (...args) => moves.push(args),
  }});
  const parent = e.test_window();
  const position = (defer, target, after, flags) => {
    const batch = defer ? e.test_batch(0, 1) : 0;
    e.test_pos16(defer, target, after, flags, batch);
    assert.strictEqual(e.get_esp(), 0x110100 + (defer ? 20 : 18));
    if (defer) {
      assert.deepStrictEqual(order, [], 'deferred z-order does not change until End');
      e.test_batch(1, batch);
      for (let i = 0; e.get_eip() !== 0x10004d && i < 10; i++) e.test_resume();
      assert.strictEqual(e.get_esp(), 0x110106);
    }
    assert.strictEqual(e.get_eip(), 0x10004d);
  };
  for (const [target, sibling] of [[parent, e.test_window()], [e.test_child(parent), e.test_child(parent)]]) {
  const mapped = e.test_narrow(sibling);
  assert.notStrictEqual(mapped, sibling);
  for (const defer of [0, 1]) for (const [after, expected] of [[mapped, sibling], [0, 0], [1, 1], [0xffff, -1], [0xfffe, -2]]) {
    order.length = 0;
    position(defer, target, after, 0x13);
    assert.deepStrictEqual(order, [[target, expected]], `defer=${defer} after=${after}: one correctly widened host update`);
  }
  for (const defer of [0, 1]) {
    order.length = 0;
    position(defer, target, 0xeeee, 0x17);
    assert.deepStrictEqual(order, [], 'NOZORDER ignores even an unmapped insert-after value');
  }
  }
  const retired = e.test_window();
  e.test_narrow(retired);
  e.test_retire(retired);
  for (const invalid of [0, 0x76543210, retired]) {
    order.length = 0;
    moves.length = 0;
    position(0, invalid, 0, 0x18);
    assert.strictEqual(e.test_result(), 0, 'Pascal SetWindowPos preserves invalid-target failure');
    assert.deepStrictEqual(order, [], 'failed Win16 positioning does not reorder');
    assert.deepStrictEqual(moves, [], 'failed Win16 positioning does not move');
  }
  console.log('PASS Win16 positioning widens insert-after before host dispatch, preserves sentinels and NOZORDER');
})().catch(error => { console.error(error); process.exit(1); });
