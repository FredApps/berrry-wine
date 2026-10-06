#!/usr/bin/env node
'use strict';

// A keystroke on the dialog that owns the running modal pump (Esc, Enter,
// Space) becomes a POSTED WM_COMMAND, which the pump (CACA0004) delivers by
// entering the DLGPROC on its own continuation stack -- as IsDialogMessage
// does inside the real modal loop. The synchronous send it used to be is a
// nested $run that $wnd_send_message abandons after 64 rounds, so a long OK
// handler was cut off mid-way: the Alien vs Predator demo's RAR
// self-extractor unpacks its whole archive inside IDOK and stopped a third
// of the way in. A dialog that is not the modal pump's keeps the send.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_set_pump") (param $hwnd i32) (global.set $dlg_pump_hwnd (local.get $hwnd)))
  ;; A live dialog window, as DialogBoxParamA registers it.
  (func (export "t_make_dialog") (param $hwnd i32) (result i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_DIALOG))
    (call $wnd_get_thread (local.get $hwnd)))
  ;; The modal pump's own read of the shared USER queue (09b-dispatch.wat).
  (func (export "t_take") (result i32)
    (call $shared_post_queue_read (i32.const 0) (i32.const 1)))
  (func (export "t_probe") (param $i i32) (result i32)
    (if (result i32) (i32.eqz (local.get $i)) (then (global.get $user_queue_probe_hwnd))
      (else (if (result i32) (i32.eq (local.get $i) (i32.const 1)) (then (global.get $user_queue_probe_msg))
        (else (if (result i32) (i32.eq (local.get $i) (i32.const 2)) (then (global.get $user_queue_probe_wparam))
          (else (global.get $user_queue_probe_lparam))))))))
  (func (export "t_drain")
    (block $done (loop $l (br_if $done (i32.eqz (call $shared_post_queue_read (i32.const 0) (i32.const 1)))) (br $l))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const DLG = 0x00012345, OTHER = 0x00012346;

  assert.notStrictEqual(e.t_make_dialog(DLG), 0, 'the dialog has an owning thread');
  e.t_drain();
  e.t_set_pump(DLG);
  assert.strictEqual(e.dialog_handle_key(DLG, 27, 0), 1, 'Esc is handled');
  assert.strictEqual(e.t_take(), 1, 'the modal dialog gets a posted message, not a nested send');
  assert.deepStrictEqual([0, 1, 2, 3].map(i => e.t_probe(i) >>> 0), [DLG, 0x0111, 2, 0],
    'WM_COMMAND IDCANCEL to the dialog');
  assert.strictEqual(e.t_take(), 0, 'exactly one');

  // Not the modal pump's dialog: the synchronous send stays (no window proc
  // is registered for it here, so the send itself does nothing).
  assert.strictEqual(e.dialog_handle_key(OTHER, 27, 0), 1, 'Esc is still handled');
  assert.strictEqual(e.t_take(), 0, 'a modeless dialog is not posted to');

  e.t_set_pump(0);
  console.log('PASS dialog keys post WM_COMMAND to the modal pump dialog; other dialogs keep the send');
})().catch(error => { console.error(error); process.exitCode = 1; });
