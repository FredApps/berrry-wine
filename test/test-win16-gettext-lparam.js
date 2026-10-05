#!/usr/bin/env node
'use strict';

// A Win16 WM_GETTEXT carries a selector:offset buffer, and SendMessage /
// CallWindowProc must turn it into a guest pointer before a native control
// writes the text -- exactly as they already did for WM_SETTEXT.
//
// Civilization II names a new city by subclassing an edit and calling
// CallWindowProc(WM_GETTEXT) into a far buffer. The packed lParam went through
// untouched, the edit wrote the typed name to a linear address nobody reads,
// and every city kept the terrain name ("Hills", "Grassland") the buffer
// already held.
//
// Also checks that a listbox/combobox (whose class-specific list used to
// *replace* the decision rather than add to it) still converts WM_SETTEXT and
// WM_GETTEXT, and that a NULL WM_GETTEXT buffer stays NULL.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "tgl_sel") (result i32)
      (call $win16_next_seg_set (i32.const 1))
      (call $win16_index_to_sel (call $win16_alloc_segment)))
    (func (export "tgl_far") (param $sel i32) (param $off i32) (result i32)
      (call $win16_far_to_guest (local.get $sel) (local.get $off)))
    (func (export "tgl_conv") (param $class i32) (param $msg i32) (param $lp i32) (result i32)
      (call $win16_ctrl_lparam32 (local.get $class) (local.get $msg) (local.get $lp)))
  ` });

  const sel = e.tgl_sel() >>> 0;
  const far = ((sel << 16) | 0x40) >>> 0;
  const want = e.tgl_far(sel, 0x40) >>> 0;
  assert.notStrictEqual(want, far, 'precondition: the far pointer is not already linear');
  const conv = (cls, msg, lp) => e.tgl_conv(cls, msg, lp) >>> 0;

  const WM_SETTEXT = 0x0C, WM_GETTEXT = 0x0D, EDIT = 2, LISTBOX = 4, COMBOBOX = 5;
  assert.strictEqual(conv(EDIT, WM_GETTEXT, far), want, 'edit WM_GETTEXT buffer is converted');
  assert.strictEqual(conv(0, WM_GETTEXT, far), want, 'a plain window\'s WM_GETTEXT is converted');
  assert.strictEqual(conv(EDIT, WM_SETTEXT, far), want, 'WM_SETTEXT still converted');
  assert.strictEqual(conv(LISTBOX, WM_SETTEXT, far), want, 'listbox WM_SETTEXT is converted');
  assert.strictEqual(conv(COMBOBOX, WM_GETTEXT, far), want, 'combobox WM_GETTEXT is converted');
  assert.strictEqual(conv(LISTBOX, 0x0401, far), want, 'LB_ADDSTRING still converted');
  assert.strictEqual(conv(EDIT, WM_GETTEXT, 0), 0, 'a NULL buffer stays NULL');
  assert.strictEqual(conv(EDIT, 0x0E, 0x1234), 0x1234, 'WM_GETTEXTLENGTH lParam is untouched');

  console.log('PASS  Win16 WM_GETTEXT far buffers reach native controls as guest pointers');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
