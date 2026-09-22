#!/usr/bin/env node
'use strict';

// CreateDialogParam(..., NULL DlgProc, ...) — MFC's CDialogBar, which is what
// SimCity 2000's status bar is — gets the template's class procedure, and a
// template naming no class gets the dialog class: DefDlgProc. DefDlgProc then
// does its default processing with no DLGPROC to call, and WM_ERASEBKGND is
// the one that matters: it fills COLOR_BTNFACE through the DC in wParam.
//
// Three things were wrong, and each left SimCity drawing every status message
// over the previous one:
//   1. the NULL-DlgProc window got the app's own main wndproc, so MFC's CBT
//      subclass saw AfxWndProc as the old proc, kept no super proc, and sent
//      WM_ERASEBKGND to DefWindowProc against a NULL-brush class;
//   2. $dialog_default_proc returned 0 at once when there was no DLGPROC;
//   3. its erase ignored wParam and filled the whole client through a fresh
//      DC, wiping the panel frames that BeginPaint's clipped DC then could
//      not redraw.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXE = path.join(__dirname, 'binaries', 'xp', 'winmine.exe');

const extraWat = String.raw`
  (func (export "test_dialog_window") (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_DIALOG))
    (drop (call $dialog_proc_set (local.get $h) (i32.const 0)))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x50000000)))
    (call $client_rect_set (local.get $h) (i32.const 0) (i32.const 0) (i32.const 32) (i32.const 24))
    (local.get $h))
  (func (export "test_defdlg") (param $h i32) (param $msg i32) (param $wp i32) (result i32)
    (call $dialog_default_proc (local.get $h) (local.get $msg) (local.get $wp) (i32.const 0)))
  (func (export "test_clip") (param $dc i32)
    (drop (call $host_gdi_intersect_clip_rect (local.get $dc)
      (i32.const 5) (i32.const 6) (i32.const 12) (i32.const 14))))

  ;; Direct handler call: keep the harness stack around its stdcall cleanup.
  (func (export "test_create_dialog") (param $id i32) (param $dlgproc i32) (result i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateDialogParamA
      (i32.const 0) (local.get $id) (i32.const 0)
      (local.get $dlgproc) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (global.get $dlg_hwnd))
  (func (export "test_set_app_wndproc") (param $p i32)
    (global.set $wndproc_addr (local.get $p))
    (global.set $wndproc_addr2 (i32.const 0)))
  (func (export "test_wndproc") (param $h i32) (result i32)
    (call $wnd_table_get (local.get $h)))
  (func (export "test_dlgproc") (param $h i32) (result i32)
    (call $dialog_proc_get (local.get $h)))
  (func (export "test_wndproc_dialog") (result i32) (global.get $WNDPROC_DIALOG))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: e } = harness;

  // --- DefDlgProc erases with no DLGPROC, through wParam's clipped DC ------
  const hwnd = e.test_dialog_window();
  const bmi = e.guest_alloc(40), out = e.guest_alloc(4);
  e.guest_write32(bmi, 40); e.guest_write32(bmi + 4, 32); e.guest_write32(bmi + 8, -24);
  e.guest_write16(bmi + 12, 1); e.guest_write16(bmi + 14, 32);
  const bitmap = e.test_call_CreateDIBSection(0, bmi, out);
  const dc = e.test_call_CreateCompatibleDC(0);
  e.test_call_SelectObject(dc, bitmap);
  e.test_clip(dc);
  const bits = e.guest_read32(out);
  for (let i = 0; i < 32 * 24; i++) e.guest_write32(bits + i * 4, 0);
  assert.strictEqual(e.test_defdlg(hwnd, 0x14, dc), 1,
    'DefDlgProc with no DLGPROC still erases WM_ERASEBKGND');
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    const inside = x >= 5 && x < 12 && y >= 6 && y < 14;
    assert.strictEqual(e.guest_read32(bits + 4 * (y * 32 + x)) & 0xffffff,
      inside ? 0xc0c0c0 : 0, `erase pixel ${x},${y} honours the supplied DC's clip`);
  }
  console.log('PASS  NULL-DLGPROC DefDlgProc erases COLOR_BTNFACE inside wParam DC clip only');

  // --- CreateDialogParamA(NULL DlgProc) installs DefDlgProc ---------------
  if (!fs.existsSync(EXE)) {
    console.log('SKIP  xp/winmine.exe not found; CreateDialogParamA half not run');
    return;
  }
  const fixture = fs.readFileSync(EXE);
  new Uint8Array(harness.memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'winmine.exe loads into the harness');
  // A registered app wndproc that must NOT become the dialog's procedure.
  // Executable (`xor eax,eax; ret 16`) because messages may reach it.
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const appProc = e.guest_alloc(16) >>> 0;
  new Uint8Array(harness.memory.buffer).set(
    [0x31, 0xC0, 0xC2, 0x10, 0x00], appProc - imageBase + guestBase);
  e.test_set_app_wndproc(appProc);
  const dlg = e.test_create_dialog(600, 0) >>> 0;
  assert(dlg, 'CreateDialogParamA allocated an HWND for RT_DIALOG 600');
  assert.strictEqual(e.test_wndproc(dlg) >>> 0, e.test_wndproc_dialog() >>> 0,
    'classless template + NULL DlgProc gets DefDlgProc, not the app wndproc');
  assert.strictEqual(e.test_dlgproc(dlg), 0, 'and no DLGPROC');
  console.log('PASS  CreateDialogParamA(NULL DlgProc) on a classless template installs DefDlgProc');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
