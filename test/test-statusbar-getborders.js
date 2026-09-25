#!/usr/bin/env node
'use strict';

// A registered msctls_statusbar32 with no guest comctl32 behind it answers
// its class messages through DefWindowProcA, the way MFC reaches it.
//
// MFC subclasses the bar through its CBT hook, finds no previous wndproc, and
// CWnd::DefWindowProc then calls ::DefWindowProcA for everything it does not
// handle itself -- including WM_GETFONT and SB_GETBORDERS, which
// CStatusBar::CalcFixedLayout sizes the bar from. Unanswered, both came back
// as garbage: SimCity 2000 Network Edition laid its bar out 267px tall and
// sized the city view to the 163px above it for the rest of the session.
//
//   WM_GETFONT     no font set -> DEFAULT_GUI_FONT (comctl32's status font,
//                  never NULL); after WM_SETFONT -> that font
//   SB_GETBORDERS  int[3] = {0, 2, 2}, returns TRUE; NULL array -> FALSE

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const HWND = 0x10005;
const WM_SETFONT = 0x30;
const WM_GETFONT = 0x31;
const SB_GETBORDERS = 0x407;
const DEFAULT_GUI_FONT = 0x30021;

const extraWat = String.raw`
  (func (export "tsgb_make") (param $hwnd i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (call $statusbar_native_mark_slot
      (call $wnd_table_find (local.get $hwnd)) (i32.const 1)))

  (func (export "tsgb_defproc") (param $hwnd i32) (param $msg i32) (param $wParam i32) (param $lParam i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DefWindowProcA (local.get $hwnd) (local.get $msg)
      (local.get $wParam) (local.get $lParam) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.tsgb_make(HWND);
  const call = (msg, wParam, lParam) => e.tsgb_defproc(HWND, msg, wParam, lParam) >>> 0;

  assert.strictEqual(call(WM_GETFONT, 0, 0), DEFAULT_GUI_FONT,
    'WM_GETFONT with no font set reports the status font, not NULL or garbage');
  call(WM_SETFONT, 0x30013, 0);
  assert.strictEqual(call(WM_GETFONT, 0, 0), 0x30013, 'WM_GETFONT returns the WM_SETFONT font');
  call(WM_SETFONT, 0, 0);
  assert.strictEqual(call(WM_GETFONT, 0, 0), DEFAULT_GUI_FONT, 'WM_SETFONT(NULL) restores the status font');
  console.log('PASS  WM_GETFONT/WM_SETFONT through DefWindowProcA');

  const buf = e.guest_alloc(12) >>> 0;
  for (let i = 0; i < 3; i++) e.guest_write32(buf + i * 4, 0x7d7d7d7d);
  assert.strictEqual(call(SB_GETBORDERS, 0, buf), 1, 'SB_GETBORDERS returns TRUE');
  const borders = [0, 1, 2].map(i => e.guest_read32(buf + i * 4) | 0);
  assert.deepStrictEqual(borders, [0, 2, 2], 'comctl32 default borders');
  assert.strictEqual(call(SB_GETBORDERS, 0, 0), 0, 'a NULL array is refused');
  console.log('PASS  SB_GETBORDERS reports {0, 2, 2} through DefWindowProcA');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
