#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = `
  (global $test_return_offset (mut i32) (i32.const 77))
  (func (export "test_set_return") (param $offset i32) (global.set $test_return_offset (local.get $offset)))
  (func $test_stack (param $sp i32)
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (call $win16_sel_to_index (global.get $WIN16_THUNK_SEL))
      (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (global.set $code16 (i32.const 1))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $gs16 (local.get $sp) (global.get $test_return_offset))
    (call $gs16 (i32.add (local.get $sp) (i32.const 2)) (call $win16_index_to_sel (i32.const 1))))
  (func (export "test_begin") (param $count i32) (result i32)
    (call $test_stack (i32.const 0x110800))
    (call $gs16 (i32.const 0x110804) (local.get $count))
    (call $win16_BeginDeferWindowPos)
    (i32.load (global.get $reg_base)))
  (func (export "test_defer") (param $batch i32) (param $hwnd i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32) (result i32)
    (call $test_stack (i32.const 0x110800))
    (call $gs16 (i32.const 0x110804) (i32.const 0x14))
    (call $gs16 (i32.const 0x110806) (local.get $h))
    (call $gs16 (i32.const 0x110808) (local.get $w))
    (call $gs16 (i32.const 0x11080a) (local.get $y))
    (call $gs16 (i32.const 0x11080c) (local.get $x))
    (call $gs16 (i32.const 0x11080e) (i32.const 0))
    (call $gs16 (i32.const 0x110810) (call $win16_h16 (local.get $hwnd)))
    (call $gs16 (i32.const 0x110812) (local.get $batch))
    (call $win16_DeferWindowPos)
    (i32.load (global.get $reg_base)))
  (func (export "test_end") (param $batch i32)
    (call $test_stack (i32.const 0x110800))
    (call $gs16 (i32.const 0x110804) (local.get $batch))
    (call $win16_EndDeferWindowPos))
  (func (export "test_resume")
    (call $win16_dispatch (i32.sub (global.get $eip) (global.get $seg_base_cs)) (i32.const 0)))
  (func (export "test_result") (result i32) (i32.load (global.get $reg_base)))
  (func (export "test_narrow") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
  (func (export "test_widen") (param $h i32) (result i32) (call $win16_h32 (local.get $h)))
  (func (export "test_bind_callback") (param $hwnd i32) (param $offset i32)
    (call $wnd_table_set (local.get $hwnd) (i32.or (i32.shl
      (call $win16_index_to_sel (i32.const 1)) (i32.const 16)) (local.get $offset))))
  (func (export "test_end_thunk") (result i32)
    (call $win16_thunk_for (i32.const 2) (i32.const 261) (i32.const 0)))
  (func (export "test_defproc_thunk") (result i32)
    (call $win16_thunk_for (i32.const 2) (i32.const 107) (i32.const 0)))
  (func (export "test_parent") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x90000000)))
    (local.get $h))
  (func (export "test_child") (param $p i32) (result i32)
    (call $ctrl_create_child (local.get $p) (i32.const 2) (i32.const 101)
      (i32.const 1) (i32.const 2) (i32.const 20) (i32.const 30) (i32.const 0x50000000) (i32.const 0)))
`;
(async () => {
  const moves = [];
  const sizes = new Map();
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none', extraHostOverrides: {
    get_window_client_size: hwnd => sizes.get(hwnd) || 0,
    move_window: (hwnd, x, y, w, h, flags) => {
      moves.push({ hwnd, x, y, w, h, flags });
      if (!(flags & 1)) sizes.set(hwnd, (w & 0xffff) | (h << 16));
    },
  }});
  const parent = e.test_parent(), child = e.test_child(parent), other = e.test_child(parent);
  const finish = () => {
    for (let i = 0; e.get_eip() !== 0x10004d && i < 300; i++) e.test_resume();
    assert.strictEqual(e.get_eip(), 0x10004d, 'End returns through its original far address');
    assert.strictEqual(e.get_esp(), 0x110806, 'End consumes one Pascal argument');
    return e.test_result();
  };
  moves.length = 0;
  const a = e.test_begin(1), b = e.test_begin(0);
  assert(a && b && a !== b, 'independent live Win16 batches');
  assert.strictEqual(e.test_defer(a, child, -7, 9, 40, 50), a);
  assert.strictEqual(e.get_esp(), 0x110814, 'Defer consumes eight Pascal words');
  assert.strictEqual(e.test_defer(a, other, 8, -6, 60, 70), a, 'batch grows');
  assert.deepStrictEqual(moves, [], 'no geometry changes before End');
  e.test_end(b); assert.strictEqual(finish(), 1, 'empty independent batch commits');
  assert.deepStrictEqual(moves, []);
  e.test_end(a); assert.strictEqual(finish(), 1);
  assert.deepStrictEqual(moves.map(({ hwnd, x, y, w, h }) => [hwnd, x, y, w, h]),
    [[child, -7, 9, 40, 50], [other, 8, -6, 60, 70]]);
  e.test_end(a); assert.strictEqual(finish(), 0, 'consumed handle rejected');
  assert.strictEqual(e.test_begin(-1), 0, 'negative count rejected');
  const failed = e.test_begin(1);
  assert.strictEqual(e.test_defer(failed, 0, 0, 0, 1, 1), 0, 'invalid window aborts batch');
  e.test_end(failed); assert.strictEqual(finish(), 0);
  const wrongKind = e.test_narrow(child);
  e.test_end(wrongKind); assert.strictEqual(finish(), 0, 'HWND is not an HDWP');
  assert.strictEqual(e.test_widen(wrongKind), child, 'invalid End must not retire another object mapping');
  assert.strictEqual(e.test_defer(wrongKind, child, 0, 0, 1, 1), 0);
  assert.strictEqual(e.test_widen(wrongKind), child, 'invalid Defer must not retire another object mapping');
  const otherParent = e.test_parent(), outsider = e.test_child(otherParent);
  const mixed = e.test_begin(2);
  const beforeFailure = moves.length;
  assert.strictEqual(e.test_defer(mixed, child, 4, 5, 6, 7), mixed);
  assert.strictEqual(e.test_defer(mixed, outsider, 8, 9, 10, 11), 0, 'mixed parents abort the entire batch');
  e.test_end(mixed); assert.strictEqual(finish(), 0);
  assert.strictEqual(moves.length, beforeFailure, 'aborted batch never moves its first window');
  const changedParent = e.test_begin(1);
  e.test_defer(changedParent, other, 2, 3, 4, 5);
  e.test_wnd_set_parent(other, otherParent);
  e.test_end(changedParent); assert.strictEqual(finish(), 0, 'End revalidates queued windows');
  assert.strictEqual(moves.length, beforeFailure);
  e.test_wnd_set_parent(other, parent);
  for (let i = 0; i < 32; i++) {
    const h = e.test_begin(0); assert(h);
    e.test_end(h); assert.strictEqual(finish(), 1, 'batch table reclaimed');
  }
  // A real far wndproc chains CHANGED to DefWindowProc, and increments its
  // counter only on the resulting WM_SIZE, not on CHANGING/CHANGED.
  // Break at End's original return address so the run loop cannot execute
  // unrelated bytes after the continuation has restored the caller.
  const defproc = e.test_defproc_thunk();
  const chain = [0xff, 0x76, 0x0e, 0xff, 0x76, 0x0c, 0xff, 0x76, 0x0a,
    0xff, 0x76, 0x08, 0xff, 0x76, 0x06,
    0x9a, defproc & 255, defproc >>> 8, 0x1f, 0];
  const positionProc = onSize => [0x55, 0x89, 0xe5,
    0x83, 0x7e, 0x0c, 0x47, 0x75, chain.length, ...chain,
    0x83, 0x7e, 0x0c, 5, 0x75, onSize.length, ...onSize,
    0x5d, 0xca, 0x0a, 0x00];
  positionProc([0x36, 0x66, 0xff, 0x06, 0x00, 0x09])
    .forEach((byte, i) => e.guest_write8(0x100200 + i, byte));
  // The decoder may compile the caller block before observing a breakpoint;
  // provide a valid parked caller rather than a run of uninitialized bytes.
  for (const caller of [0x10004d, 0x100063]) {
    e.guest_write8(caller, 0xeb);
    e.guest_write8(caller + 1, 0xfe);
  }
  e.guest_write32(0x110900, 0);
  e.test_bind_callback(child, 0x200);
  const callbackBatch = e.test_begin(1);
  assert.strictEqual(e.test_defer(callbackBatch, child, 1, 2, 83, 91), callbackBatch);
  assert.strictEqual(e.guest_read32(0x110900), 0, 'no far callback during Defer');
  e.test_end(callbackBatch);
  assert.strictEqual(e.get_eip(), 0x100200, 'End enters the far changing procedure');
  e.set_bp(0x10004d);
  for (let i = 0; e.get_eip() !== 0x10004d && i < 20; i++) e.run(100);
  e.set_bp(0);
  assert.strictEqual(e.get_eip(), 0x10004d, 'actual x86 RETF resumes End and its caller');
  assert.strictEqual(e.get_esp(), 0x110806);
  assert.strictEqual(e.guest_read32(0x110900), 1, 'far callback finished before End returned');
  assert.strictEqual(e.test_result(), 1);
  const nested = e.test_begin(1), outer = e.test_begin(2);
  const third = e.test_child(parent);
  e.test_defer(nested, other, 3, 4, 101, 102);
  e.test_defer(outer, child, 5, 6, 103, 104);
  e.test_defer(outer, third, 7, 8, 105, 106);
  const thunk = e.test_end_thunk();
  const callEnd = handle => [0x68, handle & 255, handle >>> 8,
    0x9a, thunk & 255, thunk >>> 8, 0x1f, 0]; // CALL FAR thunk selector 3
  const nestedCode = positionProc([
    ...callEnd(outer), 0x36, 0xa3, 0x0c, 0x09, // busy outer End -> AX=0
    ...callEnd(nested), 0x36, 0xa3, 0x04, 0x09, // independent inner End -> AX=1
    0x36, 0x66, 0xff, 0x06, 0x08, 0x09,       // resumed after inner callback
  ]);
  nestedCode.forEach((byte, i) => e.guest_write8(0x100300 + i, byte));
  for (const offset of [0, 4, 8, 12]) e.guest_write32(0x110900 + offset, 0);
  e.test_bind_callback(child, 0x300);
  e.test_bind_callback(other, 0x200);
  moves.length = 0;
  // Use a distinct parked caller for this second callback run.
  e.test_set_return(99);
  e.test_end(outer);
  e.set_bp(0x100063);
  for (let i = 0; e.get_eip() !== 0x100063 && i < 20; i++) e.run(100);
  e.set_bp(0);
  assert.strictEqual(e.get_eip(), 0x100063, 'nested actual far calls restore outer End');
  assert.strictEqual(e.get_esp(), 0x110806, 'nested frames fully consumed');
  assert.strictEqual(e.guest_read32(0x11090c), 0, 'busy outer batch cannot be recursively committed');
  assert.strictEqual(e.guest_read32(0x110904), 1, 'nested independent batch commits');
  assert.strictEqual(e.guest_read32(0x110900), 1, 'inner far callback ran');
  assert.strictEqual(e.guest_read32(0x110908), 1, 'outer callback resumed after inner End');
  assert.deepStrictEqual(moves.map(move => move.hwnd), [child, other, third], 'outer next index survives nested commit');
  assert.strictEqual(e.test_result(), 1);
  console.log('PASS Win16 deferred transactions: delayed geometry, lifecycle, real far callbacks and nested/busy commits');
})().catch(error => { console.error(error); process.exit(1); });
