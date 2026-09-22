#!/usr/bin/env node
'use strict';

// SimCity 2000's map view is an MFC CView with two CScrollBar children. Two
// window-manager gaps broke it:
//
//   1. WH_CBT/HCBT_CREATEWND fired for a native child only when it was a
//      toolbar, combobox or edit. USER fires it for every window, and MFC
//      attaches a wrapper's m_hWnd inside that hook, so both CScrollBars kept
//      m_hWnd = 0: every MoveWindow/SetScrollRange went to hwnd 0 and the
//      view had no scrollbars.
//   2. AdjustWindowRectEx gave a captionless bordered child 4px of frame while
//      $defwndproc_do_nccalcsize gives it 1px. MFC places a view at
//      AdjustWindowRectEx(WS_BORDER) outside the frame's client, so the view
//      sat 3px too far up and left and its scrollbars painted into the MDI
//      child's frame.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');

const extraWat = String.raw`
  (func (export "test_set_cbt_hook") (param $proc i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookExA
      (i32.const 5) (local.get $proc) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_parent") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x10000000)))
    (local.get $h))

  (func (export "test_create_child")
      (param $class i32) (param $style i32) (param $parent i32) (param $stack i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00ABCDEF))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (i32.const 0))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (i32.const 16))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (i32.const 100))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36)) (local.get $parent))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 40)) (i32.const 0x502))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 44)) (global.get $image_base))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 48)) (i32.const 0))
    (call $handle_CreateWindowExA
      (i32.const 0) (local.get $class) (i32.const 0)
      (local.get $style) (i32.const 0) (i32.const 0)))

  (func (export "test_stack_arg") (param $i i32) (result i32)
    (call $gl32 (i32.add (i32.load offset=16 (global.get $reg_base))
      (i32.mul (local.get $i) (i32.const 4)))))

  (func (export "test_adjust") (param $rect i32) (param $style i32) (param $ex i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_AdjustWindowRectEx
      (local.get $rect) (local.get $style) (i32.const 0) (local.get $ex) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes continuation thunks');

  // --- HCBT_CREATEWND reaches the hook for a native SCROLLBAR child -------
  const hookProc = (e.get_image_base() >>> 0) + 0x1000;
  assert.ok(e.test_set_cbt_hook(hookProc), 'WH_CBT hook installed');
  const parent = e.test_parent();
  const cls = e.guest_alloc(16) >>> 0;
  Buffer.from('SCROLLBAR\0', 'latin1').forEach((b, i) => e.guest_write8(cls + i, b));
  const stack = (e.guest_alloc(0x400) >>> 0) + 0x300;
  e.test_create_child(cls, 0x50000001, parent, stack); // WS_CHILD|WS_VISIBLE|SBS_VERT
  const hwnd = e.get_eax() >>> 0;
  assert.ok(hwnd, 'CreateWindowExA allocated the scrollbar');
  assert.strictEqual(e.get_eip() >>> 0, hookProc,
    'CreateWindowExA enters the CBT hook for a native SCROLLBAR');
  assert.strictEqual(e.test_stack_arg(1), 3, 'nCode = HCBT_CREATEWND');
  assert.strictEqual(e.test_stack_arg(2) >>> 0, hwnd, 'wParam = the new scrollbar');
  console.log('PASS  WH_CBT sees HCBT_CREATEWND for a native SCROLLBAR child');

  // --- AdjustWindowRectEx agrees with nccalcsize for a bordered child -----
  const rect = e.guest_alloc(16) >>> 0;
  const adjust = (style, ex) => {
    e.guest_write32(rect, 10); e.guest_write32(rect + 4, 10);
    e.guest_write32(rect + 8, 110); e.guest_write32(rect + 12, 60);
    assert.strictEqual(e.test_adjust(rect, style, ex), 1);
    return [0, 4, 8, 12].map(o => e.guest_read32(rect + o) | 0);
  };
  assert.deepStrictEqual(adjust(0x50800000, 0), [9, 9, 111, 61],
    'child WS_BORDER: 1px frame');
  assert.deepStrictEqual(adjust(0x50800000, 0x200), [7, 7, 113, 63],
    'child WS_BORDER + WS_EX_CLIENTEDGE: 1 + 2px');
  assert.deepStrictEqual(adjust(0x50000000, 0), [10, 10, 110, 60],
    'borderless child: no frame');
  console.log('PASS  AdjustWindowRectEx gives a captionless bordered child a 1px frame');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
