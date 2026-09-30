#!/usr/bin/env node
'use strict';

// USER.53 DestroyWindow must *send* WM_DESTROY and WM_NCDESTROY to every
// 16-bit window procedure in the tree before the windows go away. The 32-bit
// teardown can only post to a far procedure, and the post is purged with the
// window, so the procedures never saw either message. Civ2's MSControlClass
// buttons free three bitmaps on WM_DESTROY; every dialog leaked them until the
// 512-entry GDI table was full and dialogs came up without buttons.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_init")
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
    (global.set $code16 (i32.const 1))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2))))
  (func (export "test_window") (param $proc i32) (param $parent i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (i32.or (i32.const 0x000f0000) (local.get $proc)))
    (if (local.get $parent)
      (then
        (drop (call $wnd_set_style (local.get $h) (i32.const 0x50000000)))
        (call $wnd_set_parent (local.get $h) (local.get $parent)))
      (else (drop (call $wnd_set_style (local.get $h) (i32.const 0x10000000)))))
    (local.get $h))
  (func (export "test_native_child") (param $parent i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x50000000)))
    (call $wnd_set_parent (local.get $h) (local.get $parent))
    (local.get $h))
  (func (export "test_narrow") (param $h i32) (result i32) (call $win16_h16 (local.get $h)))
  (func (export "test_destroy_thunk") (result i32)
    (call $win16_thunk_for (i32.const 2) (i32.const 53) (i32.const 0)))
  (func (export "test_destroy") (param $h i32) (param $caller i32)
    (call $post_queue_reset)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x110800))
    (call $gs16 (i32.const 0x110800) (local.get $caller))
    (call $gs16 (i32.const 0x110802) (i32.const 0x000f))
    (call $gs16 (i32.const 0x110804) (call $win16_h16 (local.get $h)))
    (call $win16_DestroyWindow))
  (func (export "test_result") (result i32) (i32.load (global.get $reg_base)))
  (func (export "test_alive") (param $h i32) (result i32)
    (i32.ge_s (call $wnd_table_find (local.get $h)) (i32.const 0)))
  (func (export "test_post_count") (result i32) (call $post_queue_total_count))
  (func (export "test_walks_idle") (result i32)
    (i32.and
      (i32.and (i32.eqz (global.get $win16_destroy_cur0)) (i32.eqz (global.get $win16_destroy_cur1)))
      (i32.and (i32.eqz (global.get $win16_destroy_cur2)) (i32.eqz (global.get $win16_destroy_notified)))))
`;

// Pascal far wndproc recording {message, hWnd} pairs into SS:0904, one dword
// each, count at SS:0900. `extra` runs before the epilogue with BP intact.
function recorder(extra = []) {
  return [0x55, 0x89, 0xe5, 0x53,
    0x36, 0x8b, 0x1e, 0x00, 0x09, 0xc1, 0xe3, 0x02,     // bx = count * 4
    0x8b, 0x46, 0x0c, 0x36, 0x89, 0x87, 0x04, 0x09,     // [ss:bx+0904] = message
    0x8b, 0x46, 0x0e, 0x36, 0x89, 0x87, 0x06, 0x09,     // [ss:bx+0906] = hWnd
    0x36, 0xff, 0x06, 0x00, 0x09,                       // count++
    ...extra, 0x5b, 0x5d, 0x31, 0xc0, 0x31, 0xd2, 0xca, 0x0a, 0x00];
}
const word = n => [n & 255, (n >>> 8) & 255];

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_init();
  const writeCode = (offset, code) => code.forEach((b, i) => e.guest_write8(0x100000 + offset + i, b));
  writeCode(0x200, recorder());

  const run = (target, caller) => {
    e.guest_write32(0x110900, 0);
    writeCode(caller, [0xeb, 0xfe]);
    e.test_destroy(target, caller);
    e.set_bp(0x100000 + caller);
    for (let i = 0; e.get_eip() !== 0x100000 + caller && i < 30; i++) e.run(100);
    e.set_bp(0);
    assert.strictEqual(e.get_eip(), 0x100000 + caller, 'DestroyWindow returns to its far caller');
    assert.strictEqual(e.get_esp(), 0x110806, 'the Pascal argument and the walk frame are consumed');
    assert.strictEqual(e.test_result() & 0xffff, 1, 'DestroyWindow returns TRUE');
    assert.strictEqual(e.test_walks_idle(), 1, 'no walk is left in flight');
    return Array.from({ length: e.guest_read32(0x110900) }, (_, i) => {
      const v = e.guest_read32(0x110904 + i * 4) >>> 0;
      return [v & 0xffff, v >>> 16];
    });
  };

  // parent -> { first -> { grandchild }, native control, second }
  const parent = e.test_window(0x200, 0);
  const first = e.test_window(0x200, parent);
  const grandchild = e.test_window(0x200, first);
  const native = e.test_native_child(parent);
  const second = e.test_window(0x200, parent);
  const n = h => e.test_narrow(h);
  const both = h => [[0x0002, n(h)], [0x0082, n(h)]];
  assert.deepStrictEqual(run(parent, 0x40), [
    ...both(grandchild), ...both(first), ...both(second), ...both(parent),
  ], 'every 16-bit procedure gets WM_DESTROY then WM_NCDESTROY, children first');
  for (const h of [parent, first, grandchild, native, second])
    assert.strictEqual(e.test_alive(h), 0, `window 0x${h.toString(16)} is gone`);
  assert.strictEqual(e.test_post_count(), 0, 'nothing was left posted for the dead windows');

  // A procedure that destroys its own window from WM_DESTROY must not start
  // the same messages over, and the outer call still returns normally.
  const destroyThunk = e.test_destroy_thunk();
  writeCode(0x300, recorder([
    0x83, 0x7e, 0x0c, 0x02, 0x75, 0x08,             // cmp word [bp+0c],WM_DESTROY / jne +8
    0xff, 0x76, 0x0e, 0x9a, ...word(destroyThunk), 0x1f, 0,  // DestroyWindow(hWnd)
  ]));
  const selfish = e.test_window(0x300, 0);
  const inner = e.test_window(0x200, selfish);
  assert.deepStrictEqual(run(selfish, 0x60), [
    ...both(inner), [0x0002, n(selfish)],
  ], 'a nested DestroyWindow of the window being notified tears it down without re-notifying');
  assert.strictEqual(e.test_alive(selfish), 0);
  assert.strictEqual(e.test_alive(inner), 0);

  // A window with no children, destroyed after the nesting: the guard slots
  // must all have been released.
  const lone = e.test_window(0x200, 0);
  assert.deepStrictEqual(run(lone, 0x70), both(lone));

  console.log('PASS  Win16 DestroyWindow sends WM_DESTROY/WM_NCDESTROY to 16-bit procedures before teardown');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
