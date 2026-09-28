#!/usr/bin/env node

'use strict';

// PAINT_WORK_COUNTS invariant: the shared counts of dirty PAINT_FLAGS slots and
// of NC_FLAGS bit holders must equal what a full walk of those tables finds,
// after every operation that can write them. The message pump trusts a zero
// count to skip its 256-slot paint and non-client walks (the empty-PeekMessage
// path that cost Diablo 13.8% of gameplay CPU), so a count that drifts low
// loses a WM_PAINT and one that drifts high only costs the old scan.
//
// Drives a seeded random sequence of every writer (set/clear/take, NC
// set/clear/scan, selector, native drain, invalidate, subtree clear, hide/show,
// PeekMessage, window destroy + slot recycle) and checks $paint_work_audit
// after each step, plus the early-out cases directly.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const MAIN = 0x10001;
const FOREIGN = 0x10007;  // owned by another guest thread
const HWNDS = [MAIN, 0x10002, 0x10003, 0x10004, 0x10005, 0x10006, FOREIGN];

const extraWat = String.raw`
  (func $test_pw_add (param $hwnd i32) (param $parent i32) (param $tid i32)
    (local $slot i32)
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $hwnd)
      (select (i32.const 0x50000000) (i32.const 0x10000000) (local.get $parent))))
    (if (local.get $parent)
      (then (call $wnd_set_parent (local.get $hwnd) (local.get $parent))))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (i32.store (call $wnd_thread_addr (local.get $slot)) (local.get $tid)))
  (func (export "test_pw_setup")
    (global.set $next_hwnd (i32.const 0x10010))
    (global.set $main_hwnd (i32.const 0x10001))
    (call $test_pw_add (i32.const 0x10001) (i32.const 0) (i32.const 0))
    (call $test_pw_add (i32.const 0x10002) (i32.const 0x10001) (i32.const 0))
    (call $test_pw_add (i32.const 0x10003) (i32.const 0x10001) (i32.const 0))
    (call $test_pw_add (i32.const 0x10004) (i32.const 0x10003) (i32.const 0))
    (call $test_pw_add (i32.const 0x10005) (i32.const 0x10001) (i32.const 0))
    (call $test_pw_add (i32.const 0x10006) (i32.const 0x10005) (i32.const 0))
    (call $test_pw_add (i32.const 0x10007) (i32.const 0) (i32.const 99)))
  (func (export "test_pw_readd") (param $hwnd i32) (param $parent i32)
    (call $test_pw_add (local.get $hwnd) (local.get $parent) (i32.const 0)))
  (func (export "test_pw_set_nc_count") (param $n i32)
    (global.set $nc_flags_count (local.get $n)))
  (func (export "test_pw_nc_count") (result i32) (global.get $nc_flags_count))
  (func (export "test_pw_nc_test") (param $hwnd i32) (result i32)
    (call $nc_flags_test (local.get $hwnd)))
  (func (export "test_pw_paint_test") (param $hwnd i32) (result i32)
    (call $paint_flag_test_hwnd (local.get $hwnd)))
  (func (export "test_pw_op") (param $op i32) (param $hwnd i32) (param $arg i32) (result i32)
    (local $sp i32) (local $ip i32) (local $r i32)
    (if (i32.eq (local.get $op) (i32.const 0))
      (then (call $paint_flag_set (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 1))
      (then (call $paint_flag_clear_hwnd (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 2))
      (then (return (call $paint_flag_take))))
    (if (i32.eq (local.get $op) (i32.const 3))
      (then (call $nc_flags_set (local.get $hwnd) (local.get $arg)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 4))
      (then (call $nc_flags_clear (local.get $hwnd) (local.get $arg)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 5))
      (then (return (call $nc_flags_scan (local.get $arg)))))
    (if (i32.eq (local.get $op) (i32.const 6))
      (then (return (call $paint_select_next_dirty))))
    (if (i32.eq (local.get $op) (i32.const 7))
      (then (return (call $paint_drain_native_control_paints))))
    (if (i32.eq (local.get $op) (i32.const 8))
      (then (call $invalidate_hwnd (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 9))
      (then (call $paint_clear_subtree (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 10))
      (then
        (drop (call $wnd_set_style (local.get $hwnd)
          (i32.xor (call $wnd_get_style (local.get $hwnd)) (i32.const 0x10000000))))
        (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 11))
      (then
        (local.set $sp (i32.load offset=16 (global.get $reg_base)))
        (local.set $ip (global.get $eip))
        (call $handle_PeekMessageA (i32.const 0x3000) (i32.const 0)
          (i32.const 0) (i32.const 0) (local.get $arg) (i32.const 0))
        (local.set $r (i32.load (global.get $reg_base)))
        (i32.store offset=16 (global.get $reg_base) (local.get $sp))
        (global.set $eip (local.get $ip))
        (global.set $yield_flag (i32.const 0))
        (global.set $yield_reason (i32.const 0))
        (global.set $handler_set_eip (i32.const 0))
        (return (local.get $r))))
    (if (i32.eq (local.get $op) (i32.const 12))
      (then (call $wnd_table_remove (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 13))
      (then (global.set $paint_pending (local.get $arg)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 14))
      (then (call $paint_flag_set_inv (local.get $hwnd)) (return (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 15))
      (then (return (call $paint_flag_any))))
    (i32.const -1))
`;

// xorshift32, so a failure names a reproducible step.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const counts = () => [0, 1, 2, 3, 4].map(k => wat.paint_work_count(k));
  const audit = (what) => {
    const bad = wat.paint_work_audit();
    assert.strictEqual(bad, 0,
      `${what}: PAINT_WORK_COUNTS disagree with a table walk (mask 0x${bad.toString(16)}, counts ${counts()})`);
  };

  audit('boot');
  assert.deepStrictEqual(counts(), [0, 0, 0, 0, 0], 'a fresh module owes no paint work');
  wat.test_pw_setup();
  audit('setup');

  // --- the early-outs are exact ------------------------------------------
  // Nothing dirty: the pump's paint selection answers 0 without a walk.
  assert.strictEqual(wat.test_pw_op(6, 0, 0), 0);
  assert.strictEqual(wat.test_pw_op(7, 0, 0), 0);
  assert.strictEqual(wat.test_pw_op(15, 0, 0), 0);
  // A stale per-instance $nc_flags_count (set on one thread, cleared on
  // another) with no bit of the mask held anywhere must not find work.
  wat.test_pw_set_nc_count(3);
  wat.test_pw_op(3, 0x10002, 2);  // a retained erase bit only
  audit('erase bit');
  assert.strictEqual(wat.test_pw_op(5, 0, 5), 0, 'no NCPAINT/NCCALCSIZE holder -> scan finds none');
  assert.strictEqual(wat.test_pw_nc_test(0x10002), 2, 'the early-out must not touch the erase bit');
  // A bit that IS held must still be found through the stale count.
  wat.test_pw_op(3, 0x10003, 1);
  assert.strictEqual(wat.test_pw_op(5, 0, 1), 0x10003, 'a held NCPAINT is still selected');
  wat.test_pw_op(4, 0x10003, 1);
  wat.test_pw_op(4, 0x10002, 2);
  audit('nc cleanup');
  assert.deepStrictEqual(counts().slice(1), [0, 0, 0, 0]);

  // A dirty window owned by another thread keeps the count non-zero, and the
  // walk (not the count) still decides it is not this thread's to paint.
  wat.test_pw_op(0, FOREIGN, 0);
  audit('foreign dirty');
  assert.strictEqual(counts()[0], 1);
  assert.strictEqual(wat.test_pw_op(15, 0, 0), 0, 'foreign dirty slot is not ours');
  assert.strictEqual(wat.test_pw_op(6, 0, 0), 0);
  wat.test_pw_op(1, FOREIGN, 0);
  audit('foreign clear');

  // The main-window global is mirrored into PAINT_FLAGS by the selector,
  // and the count must see that mirror before it answers.
  wat.test_pw_op(13, 0, 1);
  wat.test_pw_op(6, 0, 0);
  audit('main mirror');
  wat.test_pw_op(13, 0, 0);
  wat.test_pw_op(1, MAIN, 0);
  audit('main clear');

  // Destroying a window with pending work releases it from the counts, and
  // the recycled slot starts clean.
  wat.test_pw_op(0, 0x10006, 0);
  wat.test_pw_op(3, 0x10006, 7);
  audit('before destroy');
  wat.test_pw_op(12, 0x10006, 0);
  audit('destroy');
  assert.deepStrictEqual(counts(), [0, 0, 0, 0, 0], 'a destroyed window owes nothing');
  wat.test_pw_readd(0x10006, 0x10005);
  audit('recycle');

  // --- random walk over every writer --------------------------------------
  const next = rng(0x5eed1234);
  const NC_BITS = [1, 2, 4, 8, 3, 7, 5];
  const SCAN_MASKS = [1, 4, 5];
  const opsSeen = new Set();
  for (let step = 0; step < 6000; step++) {
    const op = next() % 16;
    const hwnd = HWNDS[next() % HWNDS.length];
    let arg = 0;
    if (op === 3 || op === 4) arg = NC_BITS[next() % NC_BITS.length];
    else if (op === 5) arg = SCAN_MASKS[next() % SCAN_MASKS.length];
    else if (op === 11) arg = next() & 1;  // PM_NOREMOVE / PM_REMOVE
    else if (op === 13) arg = next() & 1;
    if (op === 12) {
      // Destroy, then bring the hwnd straight back so later steps have it.
      if (hwnd === MAIN || hwnd === FOREIGN) continue;
      wat.test_pw_op(12, hwnd, 0);
      audit(`step ${step} destroy ${hwnd.toString(16)}`);
      wat.test_pw_readd(hwnd, hwnd === 0x10004 ? 0x10003 : hwnd === 0x10006 ? 0x10005 : MAIN);
    } else {
      wat.test_pw_op(op, hwnd, arg);
    }
    opsSeen.add(op);
    audit(`step ${step} op ${op} hwnd 0x${hwnd.toString(16)} arg ${arg}`);
  }
  assert.strictEqual(opsSeen.size, 16, 'every writer was exercised');

  // Drain to idle through the real pump and confirm the counts return to 0
  // for paint work this thread can retire.
  wat.test_pw_op(13, 0, 0);
  for (const h of HWNDS) {
    wat.test_pw_op(1, h, 0);
    wat.test_pw_op(4, h, 0xF);
  }
  audit('drained');
  assert.deepStrictEqual(counts(), [0, 0, 0, 0, 0]);
  assert.strictEqual(wat.test_pw_op(11, 0, 1), 0, 'an idle PeekMessage returns nothing');

  console.log('PASS  PAINT_WORK_COUNTS stay equal to a table walk across every writer');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
