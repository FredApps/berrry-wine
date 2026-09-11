#!/usr/bin/env node

// Dialog focus rules: WM_INITDIALOG receives the first visible, enabled tab
// stop and a TRUE DLGPROC return applies that focus after initialization.
// DefDlgProc also moves focus from the dialog itself to its first tab stop on
// WM_SETFOCUS. Diablo's Enter Name dialog depends on the latter fallback.

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const WS_CHILD_VISIBLE = 0x50000000;
const WS_TABSTOP = 0x00010000;
const WS_DISABLED = 0x08000000;
const WM_SETFOCUS = 0x0007;

const extraWat = String.raw`
  (func (export "test_setfocus_make_dialog") (result i32)
    (local $dlg i32)
    (local.set $dlg (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $dlg) (global.get $WNDPROC_CTRL_NATIVE))
    ;; WS_POPUP | WS_VISIBLE -- a top-level window whose children can be
    ;; effectively visible.
    (drop (call $wnd_set_style (local.get $dlg) (i32.const 0x90000000)))
    (local.get $dlg))

  (func (export "test_setfocus_add_child")
    (param $dlg i32) (param $id i32) (param $style i32) (result i32)
    (call $ctrl_create_child
      (local.get $dlg) (i32.const 2) (local.get $id)
      (i32.const 0) (i32.const 0) (i32.const 40) (i32.const 20)
      (local.get $style) (i32.const 0)))

  (func (export "test_focus_hwnd") (result i32) (global.get $focus_hwnd))

  (func (export "test_set_focus_hwnd") (param $hwnd i32)
    (global.set $focus_hwnd (local.get $hwnd)))

  (func (export "test_set_style") (param $hwnd i32) (param $style i32)
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style))))

  (func (export "test_first_tabstop") (param $dlg i32) (result i32)
    (call $dialog_first_init_tabstop (local.get $dlg)))

  ;; Model the stack left after a modeless DLGPROC returns from
  ;; WM_INITDIALOG. CACA0001 must consume the private marker/candidate, apply
  ;; the BOOL result, and still restore the ordinary saved return/HWND pair.
  (func (export "test_finish_modeless_init")
    (param $dlg i32) (param $candidate i32) (param $accepted i32)
    (param $stack i32) (result i32)
    (global.set $createwnd_implicit_show (i32.const 0))
    (global.set $esp (local.get $stack))
    (call $gs32 (local.get $stack) (i32.const 0x44494643)) ;; "DIFC"
    (call $gs32 (i32.add (local.get $stack) (i32.const 4))
      (local.get $candidate))
    (call $gs32 (i32.add (local.get $stack) (i32.const 8))
      (i32.const 0x00405678))
    (call $gs32 (i32.add (local.get $stack) (i32.const 12))
      (local.get $dlg))
    (global.set $eax (local.get $accepted))
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA0001))
    (call $win32_dispatch (i32.const 0))
    (global.get $eax))

  (func (export "test_eip") (result i32) (global.get $eip))

  (func (export "test_call_DefDlgProcA")
    (param $hwnd i32) (param $msg i32) (param $wParam i32) (param $lParam i32)
    (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (global.get $esp))
    (call $handle_DefDlgProcA
      (local.get $hwnd) (local.get $msg) (local.get $wParam) (local.get $lParam)
      (i32.const 0) (i32.const 0))
    (global.set $esp (local.get $saved_esp))
    (global.get $eax))

  (func (export "test_set_dialog_proc") (param $hwnd i32) (param $proc i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_DIALOG))
    (drop (call $dialog_proc_set (local.get $hwnd) (local.get $proc))))

  (func (export "test_call_dialog_default_proc")
    (param $hwnd i32) (param $msg i32) (result i32)
    (call $dialog_default_proc
      (local.get $hwnd) (local.get $msg) (i32.const 0) (i32.const 0)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat });

  // A dialog whose first child is not a tab stop: the focus skips it.
  const dlg = e.test_setfocus_make_dialog() >>> 0;
  const plain = e.test_setfocus_add_child(dlg, 100, WS_CHILD_VISIBLE) >>> 0;
  const field = e.test_setfocus_add_child(
    dlg, 101, WS_CHILD_VISIBLE | WS_TABSTOP) >>> 0;

  e.test_set_focus_hwnd(0);
  e.test_call_DefDlgProcA(dlg, WM_SETFOCUS, 0, 0);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, field,
    'DefDlgProc WM_SETFOCUS focuses the first WS_TABSTOP child');
  assert.notStrictEqual(e.test_focus_hwnd() >>> 0, plain,
    'a child without WS_TABSTOP is not a focus candidate');

  // Calling it again is idempotent -- it must not hand the focus onward to a
  // later tab stop the way WM_NEXTDLGCTL would.
  e.test_call_DefDlgProcA(dlg, WM_SETFOCUS, 0, 0);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, field,
    'a repeated WM_SETFOCUS leaves the focus where it is');

  // A disabled tab stop is skipped: USER will not focus a control the user
  // cannot reach with the Tab key either.
  const dlg2 = e.test_setfocus_make_dialog() >>> 0;
  e.test_setfocus_add_child(
    dlg2, 200, WS_CHILD_VISIBLE | WS_TABSTOP | WS_DISABLED);
  const enabled = e.test_setfocus_add_child(
    dlg2, 201, WS_CHILD_VISIBLE | WS_TABSTOP) >>> 0;

  e.test_set_focus_hwnd(0);
  e.test_call_DefDlgProcA(dlg2, WM_SETFOCUS, 0, 0);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, enabled,
    'DefDlgProc WM_SETFOCUS skips a disabled tab stop');

  // No tab stop at all: WM_SETFOCUS falls through to DefWindowProc rather
  // than inventing a focus window.
  const dlg3 = e.test_setfocus_make_dialog() >>> 0;
  e.test_setfocus_add_child(dlg3, 300, WS_CHILD_VISIBLE);

  e.test_set_focus_hwnd(0);
  e.test_call_DefDlgProcA(dlg3, WM_SETFOCUS, 0, 0);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, 0,
    'a dialog with no tab stop leaves the focus untouched');

  // WM_INITDIALOG's default-focus decision happens after the DLGPROC returns.
  // The first tab stop is passed before initialization and a TRUE return
  // accepts it.
  const candidate = e.test_first_tabstop(dlg) >>> 0;
  assert.strictEqual(candidate, field,
    'WM_INITDIALOG candidate is the first visible enabled tab stop');
  e.test_set_focus_hwnd(0);
  assert.strictEqual(
    e.test_finish_modeless_init(dlg, candidate, 1, 0x074ff000) >>> 0,
    dlg,
    'modeless continuation still returns the dialog HWND');
  assert.strictEqual(e.test_eip() >>> 0, 0x00405678,
    'modeless continuation restores the caller return address');
  assert.strictEqual(e.test_focus_hwnd() >>> 0, field,
    'TRUE from WM_INITDIALOG applies the default focus');

  // FALSE means the application chose focus itself; USER must not overwrite
  // that choice with wParam.
  e.test_set_focus_hwnd(plain);
  e.test_finish_modeless_init(dlg, candidate, 0, 0x074ff000);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, plain,
    'FALSE from WM_INITDIALOG preserves application-assigned focus');

  // USER revalidates the candidate after initialization. If the callback
  // disables it, focus advances to the next eligible control.
  const next = e.test_setfocus_add_child(
    dlg, 102, WS_CHILD_VISIBLE | WS_TABSTOP) >>> 0;
  e.test_set_style(field, WS_CHILD_VISIBLE | WS_TABSTOP | WS_DISABLED);
  e.test_set_focus_hwnd(0);
  e.test_finish_modeless_init(dlg, candidate, 1, 0x074ff000);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, next,
    'disabled WM_INITDIALOG candidate advances to the next tab stop');

  // SetFocus(dialog) enters USER's internal DefDlgProc dispatcher rather
  // than the exported DefDlgProcA thunk. A FALSE DLGPROC must still run the
  // same WM_SETFOCUS fallback. WinHelp uses exactly this path for its hidden
  // Contents page before showing it.
  const dlg4 = e.test_setfocus_make_dialog() >>> 0;
  e.test_setfocus_add_child(dlg4, 400, WS_CHILD_VISIBLE);
  const internalField = e.test_setfocus_add_child(
    dlg4, 401, WS_CHILD_VISIBLE | WS_TABSTOP) >>> 0;
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const falseProc = e.guest_alloc(16) >>> 0;
  const trueProc = e.guest_alloc(16) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  bytes.set([0x31, 0xC0, 0xC2, 0x10, 0x00],
    falseProc - imageBase + guestBase); // xor eax,eax; ret 16
  bytes.set([0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x10, 0x00],
    trueProc - imageBase + guestBase); // mov eax,1; ret 16

  e.test_set_dialog_proc(dlg4, falseProc);
  e.test_set_focus_hwnd(dlg4);
  e.test_call_dialog_default_proc(dlg4, WM_SETFOCUS);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, internalField,
    'internal DefDlgProc fallback focuses first tab stop after FALSE');

  const dlg5 = e.test_setfocus_make_dialog() >>> 0;
  const handledField = e.test_setfocus_add_child(
    dlg5, 500, WS_CHILD_VISIBLE | WS_TABSTOP) >>> 0;
  e.test_set_dialog_proc(dlg5, trueProc);
  e.test_set_focus_hwnd(dlg5);
  e.test_call_dialog_default_proc(dlg5, WM_SETFOCUS);
  assert.notStrictEqual(handledField, dlg5);
  assert.strictEqual(e.test_focus_hwnd() >>> 0, dlg5,
    'handled WM_SETFOCUS does not run DefDlgProc tab-stop fallback');

  console.log('PASS  dialog initialization and DefDlgProc assign Win98 tab-stop focus');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
