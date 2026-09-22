#!/usr/bin/env node
'use strict';

// DialogBoxParamA creates the dialog hidden and shows it only once
// WM_INITDIALOG has returned -- USER strips WS_VISIBLE from a modal template
// and shows the window afterwards. We used to show it first, so any init that
// does real work sat on screen half-built: SimCity 2000's Select Power Plant
// box (template style 0x90c000c0, WS_VISIBLE set) showed as an empty grey
// frame at (0,0) for ~1,900 batches while its DLGPROC built eight plant
// pictures and then centred the window.
//
// The fixture is XP winmine's RT_DIALOG 600 with WS_VISIBLE added to its
// template style in the file bytes, so both halves are checked: the WAT
// style bit, and the renderer mirror, which takes its visibility from the
// template.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXE = path.join(__dirname, 'binaries', 'xp', 'winmine.exe');
if (!fs.existsSync(EXE)) {
  console.log('SKIP  xp/winmine.exe not found at', EXE);
  process.exit(0);
}
const WS_VISIBLE = 0x10000000;
const NAME_DIALOG_ID = 600;
const OWNER = { x: 200, y: 100, w: 164, h: 220, style: 0x00CF0000 | WS_VISIBLE };

const extraWat = String.raw`
  (func (export "test_make_owner") (param $style i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_BUILTIN))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (global.set $main_hwnd (local.get $hwnd))
    (local.get $hwnd))
  (func (export "test_nccalcsize") (param $hwnd i32)
    (call $defwndproc_do_nccalcsize (local.get $hwnd)))
  ;; A direct handler call has no stdcall frame under it: keep the harness ESP.
  (func (export "test_dialog_box_param") (param $id i32) (param $owner i32)
        (param $dlgproc i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DialogBoxParamA
      (i32.const 0) (local.get $id) (local.get $owner)
      (local.get $dlgproc) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (global.get $dlg_hwnd))
  (func (export "test_style") (param $hwnd i32) (result i32)
    (call $wnd_get_style (local.get $hwnd)))
  (func (export "test_show_pending") (result i32) (global.get $dlg_show_pending))
  ;; What CACA0004 does on the first return from WM_INITDIALOG.
  (func (export "test_init_returned")
    (if (i32.eq (global.get $dlg_show_pending) (global.get $dlg_pump_hwnd))
      (then (call $dlg_show_now (global.get $dlg_pump_hwnd)))))
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: e, renderer } = harness;

  // Add WS_VISIBLE to RT_DIALOG 600's template style (0x80400040, one hit).
  const fixture = Buffer.from(fs.readFileSync(EXE));
  const needle = Buffer.from([0x40, 0x00, 0x40, 0x80]);
  const at = fixture.indexOf(needle);
  assert(at >= 0 && fixture.indexOf(needle, at + 1) < 0, 'template style dword is unique');
  fixture.writeUInt32LE((0x80400040 | WS_VISIBLE) >>> 0, at);
  new Uint8Array(harness.memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'winmine.exe loads into the harness');

  const owner = e.test_make_owner(OWNER.style) >>> 0;
  renderer.windows[owner] = {
    hwnd: owner, style: OWNER.style, title: 'Minesweeper',
    x: OWNER.x, y: OWNER.y, w: OWNER.w, h: OWNER.h,
    visible: true, isChild: false, parentHwnd: 0, ownerHwnd: 0,
    zOrder: 1, wasm: harness.instance, wasmMemory: harness.memory,
  };
  renderer._computeClientRect(renderer.windows[owner]);
  e.test_nccalcsize(owner);

  // `xor eax,eax; ret 0x10`: a DLGPROC that declines every message.
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const dlgProc = e.guest_alloc(16) >>> 0;
  new Uint8Array(harness.memory.buffer).set(
    [0x31, 0xC0, 0xC2, 0x10, 0x00], dlgProc - imageBase + guestBase);

  const dlg = e.test_dialog_box_param(NAME_DIALOG_ID, owner, dlgProc) >>> 0;
  assert(dlg, 'DialogBoxParamA allocated an HWND');
  assert(renderer.windows[dlg], 'renderer mirrored the dialog');

  // While WM_INITDIALOG runs: hidden in WAT and on screen.
  assert.strictEqual(e.test_style(dlg) & WS_VISIBLE, 0, 'no WS_VISIBLE during WM_INITDIALOG');
  assert.strictEqual(renderer.windows[dlg].visible, false, 'mirror hidden during WM_INITDIALOG');
  assert.strictEqual(e.test_show_pending() >>> 0, dlg, 'show is pending for this dialog');

  // WM_INITDIALOG returns: now it is shown.
  e.test_init_returned();
  assert.notStrictEqual(e.test_style(dlg) & WS_VISIBLE, 0, 'WS_VISIBLE after WM_INITDIALOG');
  assert.strictEqual(renderer.windows[dlg].visible, true, 'mirror shown after WM_INITDIALOG');
  assert.strictEqual(e.test_show_pending(), 0, 'nothing left pending');

  console.log('PASS  DialogBoxParamA shows a WS_VISIBLE modal template only after WM_INITDIALOG');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
