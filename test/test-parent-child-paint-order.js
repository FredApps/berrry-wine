#!/usr/bin/env node
'use strict';

// USER must dispatch a dirty parent before a native child whose pixels the
// parent can overwrite. The child remains queued, then repaints after the
// parent's WM_PAINT has propagated its update region down the window tree.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (global $test_order_parent (mut i32) (i32.const 0))
  (global $test_order_child (mut i32) (i32.const 0))

  (func (export "test_order_create") (result i32)
    (local $parent i32) (local $child i32)
    (local.set $parent (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $host_register_dialog_frame
      (local.get $parent) (i32.const 0)
      (i32.const 0) (i32.const 200) (i32.const 80) (i32.const 0))
    ;; An application-owned parent: present in USER's window table, but not
    ;; registered as one of the WAT-native built-in control classes.
    (call $wnd_table_set (local.get $parent) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $parent) (i32.const 0x90000000)))
    (local.set $child (call $ctrl_create_child
      (local.get $parent) (i32.const 4) (i32.const 101)
      (i32.const 0) (i32.const 0) (i32.const 180) (i32.const 24)
      (i32.const 0x50000000) (i32.const 0)))
    (global.set $test_order_parent (local.get $parent))
    (global.set $test_order_child (local.get $child))
    (local.get $parent))

  (func (export "test_order_child") (result i32)
    (global.get $test_order_child))
  (func (export "test_order_builtin_proc") (result i32)
    (global.get $WNDPROC_BUILTIN))

  (func (export "test_order_clear")
    (call $paint_flag_clear_hwnd (global.get $test_order_parent))
    (call $update_clear_hwnd (global.get $test_order_parent))
    (call $paint_flag_clear_hwnd (global.get $test_order_child))
    (call $update_clear_hwnd (global.get $test_order_child)))

  (func (export "test_order_queue_both")
    (call $paint_flag_set_inv (global.get $test_order_parent))
    (call $paint_flag_set_inv (global.get $test_order_child)))

  (func (export "test_order_drain_native") (result i32)
    (call $paint_drain_native_control_paints))

  (func (export "test_order_select") (result i32)
    (call $paint_select_next_dirty))

  (func (export "test_order_clear_parent")
    (call $paint_flag_clear_hwnd (global.get $test_order_parent))
    (drop (call $paint_seed_child_paints (global.get $test_order_parent)))
    (call $update_clear_hwnd (global.get $test_order_parent)))

  (func (export "test_order_first_pending") (result i32)
    (call $paint_flag_first))

  (func (export "test_order_update") (param $hwnd i32)
    (local $esp i32)
    (local.set $esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_UpdateWindow (local.get $hwnd)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp)))
  (func (export "test_order_partial_child")
    (call $update_invalidate_rect (global.get $test_order_child)
      (i32.const 3) (i32.const 4) (i32.const 12) (i32.const 15)))
  (func (export "test_order_move_parent") (param $w i32) (param $repaint i32)
    (local $esp i32)
    (local.set $esp (i32.load offset=16 (global.get $reg_base)))
    (call $gs32 (i32.add (local.get $esp) (i32.const 24)) (local.get $repaint))
    (call $handle_MoveWindow (global.get $test_order_parent)
      (i32.const 0) (i32.const 0) (local.get $w) (i32.const 80) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp)))
  (func (export "test_order_update_rect") (param $dst i32) (result i32)
    (call $update_get_rect (global.get $test_order_child) (call $g2w (local.get $dst))))
  (func (export "test_order_api_thunk") (param $id i32) (result i32)
    (local $addr i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $addr (i32.add (global.get $THUNK_BASE)
      (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $addr) (i32.const 0))
    (i32.store offset=4 (local.get $addr) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $addr)))

  (func (export "test_cycle_parent") (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (local.set $b (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $a) (i32.const 0x00401000))
    (call $wnd_table_set (local.get $b) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $a) (i32.const 0x10000000)))
    (drop (call $wnd_set_style (local.get $b) (i32.const 0x10000000)))
    (call $wnd_set_parent (local.get $a) (local.get $b))
    ;; This second edge would close a -> b -> a. It must be rejected.
    (call $wnd_set_parent (local.get $b) (local.get $a))
    (call $wnd_get_parent (local.get $b)))
`;

(async () => {
  const painted = [];
  const { exports: e } = await bootRenderHarness({ extraWat,
    extraHostOverrides: {
      ctrl_paint_trace(hwnd, classAndReason) {
        if ((classAndReason >>> 8) === 0) painted.push(hwnd >>> 0);
      },
    },
  });
  const parent = e.test_order_create() >>> 0;
  const child = e.test_order_child() >>> 0;
  assert(parent && child, 'parent/child window tree should exist');

  e.test_order_clear();
  e.test_order_queue_both();
  assert.strictEqual(e.test_order_drain_native(), 0,
    'native child must wait while an application-owned ancestor is dirty');
  assert.strictEqual(e.test_order_select() >>> 0, parent,
    'the application-owned ancestor is the next WM_PAINT target');

  e.test_order_clear_parent();
  assert.strictEqual(e.test_order_drain_native(), 1,
    'native child paints after the ancestor update is consumed');
  assert.strictEqual(e.test_order_first_pending() >>> 0, 0,
    'parent and child paint state should be fully consumed');

  e.test_order_clear();
  e.test_order_update(child);
  assert.strictEqual(e.test_order_first_pending(), 0,
    'UpdateWindow on a clean window must not invent pending paint');
  const rect = e.guest_alloc(16);
  assert.strictEqual(e.test_order_update_rect(rect), 0,
    'UpdateWindow on a clean window must leave its update region empty');
  e.test_order_partial_child();
  e.wnd_set_style_export(child, e.wnd_get_style_export(child) & ~0x10000000);
  e.test_order_update(child);
  assert.strictEqual(e.test_order_update_rect(rect), 1);
  assert.deepStrictEqual([0, 4, 8, 12].map(o => e.guest_read32(rect + o)),
    [3, 4, 12, 15], 'hidden UpdateWindow must not expand a partial update');
  e.wnd_set_style_export(child, e.wnd_get_style_export(child) | 0x10000000);
  painted.length = 0;
  e.test_order_update(child);
  assert.deepStrictEqual(painted, [child],
    'UpdateWindow must run exactly the target native painter before returning');
  assert.strictEqual(e.test_order_update_rect(rect), 0,
    'visible native UpdateWindow must consume its update before returning');
  assert.strictEqual(e.test_order_first_pending(), 0,
    'native paint must not remain queued after UpdateWindow returns');
  e.test_order_clear();
  e.test_order_partial_child();
  e.send_message(child, 0x000f, child + 0x40000, 0);
  assert.strictEqual(e.test_order_update_rect(rect), 1,
    'painting into a supplied DC must not consume the window update region');
  e.test_order_clear();

  // A real guest callback proves the clean-window case sends no message,
  // while an existing update still follows the synchronous guest path.
  const calls = e.guest_alloc(4);
  const proc = e.guest_alloc(16);
  e.guest_write32(calls, 0);
  // cmp dword [esp+8],WM_PAINT; jne ret; inc dword [calls]; ret 16
  const code = [0x83, 0x7c, 0x24, 0x08, 0x0f, 0x75, 0x06,
    0xff, 0x05, calls & 255, (calls >>> 8) & 255,
    (calls >>> 16) & 255, calls >>> 24, 0xc2, 0x10, 0x00];
  for (let i = 0; i < code.length; i += 4) {
    e.guest_write32(proc + i, code[i] | code[i + 1] << 8 |
      code[i + 2] << 16 | code[i + 3] << 24);
  }
  e.wnd_table_set(parent, proc);
  e.test_order_update(parent);
  assert.strictEqual(e.guest_read32(calls), 0,
    'clean UpdateWindow must not enter the guest window procedure');
  e.test_order_queue_both();
  e.test_order_update(parent);
  assert.strictEqual(e.guest_read32(calls), 1,
    'dirty UpdateWindow must enter the guest procedure before returning');
  e.test_order_clear();
  e.guest_write32(calls, 0);
  e.test_order_move_parent(220, 0);
  assert.strictEqual(e.guest_read32(calls), 0,
    'MoveWindow(FALSE) must not send guest WM_PAINT');
  e.test_order_move_parent(240, 1);
  assert.strictEqual(e.guest_read32(calls), 1,
    'MoveWindow(TRUE) must send guest WM_PAINT before returning');
  e.test_order_clear();

  assert.strictEqual(e.test_cycle_parent(), 0,
    'window parenting rejects an edge that would create a cycle');

  // Enter an actual outer guest wndproc, which calls UpdateWindow through
  // its Win32 thunk and observes the inner paint count before it returns.
  const update = e.test_order_api_thunk(apiTable.find(a => a.name === 'UpdateWindow').id);
  const observed = e.guest_alloc(4);
  const u32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 255);
  const outerCode = [0x68, ...u32(parent), 0xb8, ...u32(update), 0xff, 0xd0,
    0xa1, ...u32(calls), 0xa3, ...u32(observed), 0xc2, 0x10, 0x00];
  while (outerCode.length % 4) outerCode.push(0x90);
  const outerProc = e.guest_alloc(outerCode.length);
  for (let i = 0; i < outerCode.length; i += 4) {
    e.guest_write32(outerProc + i, outerCode[i] | outerCode[i + 1] << 8 |
      outerCode[i + 2] << 16 | outerCode[i + 3] << 24);
  }
  const outer = 0x10050;
  e.wnd_table_set(outer, outerProc);
  e.guest_write32(calls, 0);
  e.guest_write32(observed, 0);
  e.test_order_queue_both();
  const beforeNestedEsp = e.get_esp();
  e.send_message(outer, 0x400, 0, 0);
  assert.strictEqual(e.guest_read32(observed), 1,
    'nested UpdateWindow must finish inner WM_PAINT before the outer wndproc resumes');
  assert.strictEqual(e.get_sync_msg_depth(), 0, 'nested callback depth must unwind');
  assert.strictEqual(e.get_esp(), beforeNestedEsp, 'nested callback must restore the outer stack');

  // A subclass owns WM_PAINT, even when the underlying class is native.
  e.test_order_clear();
  const nativeProc = e.wnd_get_proc_export(child);
  e.wnd_table_set(child, proc);
  e.guest_write32(calls, 0);
  painted.length = 0;
  e.send_message(child, 0x000f, 0, 0);
  assert.strictEqual(e.guest_read32(calls), 1,
    'internal synchronous WM_PAINT must enter the subclass');
  assert.deepStrictEqual(painted, [], 'a subclass may replace native painting entirely');
  e.test_order_update(child);
  assert.strictEqual(e.guest_read32(calls), 1, 'clean subclass UpdateWindow sends no paint');
  e.test_order_partial_child();
  e.test_order_update(child);
  assert.strictEqual(e.guest_read32(calls), 2,
    'dirty subclass UpdateWindow must finish before returning');
  assert.deepStrictEqual(painted, [], 'UpdateWindow must not bypass the subclass');
  assert.strictEqual(e.test_order_update_rect(rect), 1,
    'a subclass that never validates must retain its update region');

  // Forward all four incoming arguments to the original native procedure.
  // Each push shifts the next original argument to [esp+16].
  const callWindowProc = e.test_order_api_thunk(apiTable.find(a => a.name === 'CallWindowProcA').id);
  for (const originalProc of new Set([nativeProc, e.test_order_builtin_proc()])) {
    e.test_order_partial_child();
    painted.length = 0;
    const chainCode = [0xff, 0x05, ...u32(calls),
      ...Array.from({ length: 4 }, () => [0xff, 0x74, 0x24, 0x10]).flat(),
      0x68, ...u32(originalProc), 0xb8, ...u32(callWindowProc), 0xff, 0xd0,
      0xc2, 0x10, 0x00];
    while (chainCode.length % 4) chainCode.push(0x90);
    const chainProc = e.guest_alloc(chainCode.length);
    for (let i = 0; i < chainCode.length; i += 4) {
      e.guest_write32(chainProc + i, chainCode[i] | chainCode[i + 1] << 8 |
        chainCode[i + 2] << 16 | chainCode[i + 3] << 24);
    }
    e.wnd_table_set(child, chainProc);
    e.guest_write32(calls, 0);
    const beforeChainEsp = e.get_esp();
    e.test_order_update(child);
    assert.strictEqual(e.guest_read32(calls), 1, 'forwarding subclass runs once');
    assert.deepStrictEqual(painted, [child], 'CallWindowProc reaches the native painter exactly once');
    assert.strictEqual(e.test_order_update_rect(rect), 0,
      'forwarding to native WM_PAINT must validate the update region');
    const completedCalls = e.guest_read32(calls);
    e.test_order_update(child);
    assert.strictEqual(e.guest_read32(calls), completedCalls,
      'a second UpdateWindow must not repaint already-validated native damage');
    assert.strictEqual(e.get_esp(), beforeChainEsp, 'native chaining restores the guest stack');
    assert.strictEqual(e.get_sync_msg_depth(), 0, 'native chaining unwinds synchronous depth');
  }

  console.log('PASS  parent-first paint order and bounded ancestor traversal');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
