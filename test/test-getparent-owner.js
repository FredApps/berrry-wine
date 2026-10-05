#!/usr/bin/env node

'use strict';

// GetParent reports the parent of a WS_CHILD window and the owner of a
// WS_POPUP one, and NULL for a top-level window that is neither -- even when
// that window has an owner.
//
// Visual Basic 3 creates every form as an owned *overlapped* window, owned by
// its hidden 0x0 main window at the centre of the screen, and computes a
// form's Left/Top as ScreenToClient(GetParent(form), GetWindowRect(form)).
// Answering with the owner made every Move shift the form by the owner's
// position, until Sokoban's form was entirely off the screen.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "tgp_make") (param $hwnd i32) (param $style i32)
      (param $parent i32) (param $owner i32)
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (call $wnd_set_parent (local.get $hwnd) (local.get $parent))
    (call $wnd_set_owner (local.get $hwnd) (local.get $owner)))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });

  const WS_POPUP = 0x80000000 | 0;
  const WS_CHILD = 0x40000000;
  const WS_OVERLAPPEDWINDOW = 0x00cf0000;

  const owner = 0x7a01;
  const popup = 0x7a02;
  const overlapped = 0x7a03;
  const child = 0x7a04;
  const lone = 0x7a05;

  wat.tgp_make(owner, WS_OVERLAPPEDWINDOW, 0, 0);
  wat.tgp_make(popup, WS_POPUP, 0, owner);
  wat.tgp_make(overlapped, 0x02cf0000, 0, owner);  // Sokoban's form style
  wat.tgp_make(child, WS_CHILD, owner, 0);
  wat.tgp_make(lone, WS_OVERLAPPEDWINDOW, 0, 0);

  const gp = (h) => wat.wnd_get_parent_api(h) >>> 0;
  assert.strictEqual(gp(popup), owner, 'an owned popup reports its owner');
  assert.strictEqual(gp(overlapped), 0, 'an owned overlapped window reports no parent');
  assert.strictEqual(gp(child), owner, 'a child reports its parent');
  assert.strictEqual(gp(lone), 0, 'an unowned top-level window reports no parent');

  console.log('PASS  GetParent: owner only for WS_POPUP, parent for WS_CHILD, else NULL');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
