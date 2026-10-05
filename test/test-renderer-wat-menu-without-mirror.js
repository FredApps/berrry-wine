#!/usr/bin/env node
'use strict';

// A menu WAT installed before the renderer had a record for the window must
// still lay out as a menu bar.
//
// SetMenu's host callback (lib/host-window.js set_menu) forwards to
// renderer.setMenu, which returns immediately when `this.windows[hwnd]` is
// empty -- so `win._menuId`, the renderer's mirror of "this window has a
// menu", is never written for any window whose menu is loaded ahead of its
// renderer record. A dialog whose DLGTEMPLATE names a menu does exactly that:
// src/10-helpers.wat $dlg_load loads the menu while parsing the template,
// which is before the dialog reaches the renderer. Moraff's Jiggler puts its
// entire game menu on such a dialog, and the strip painted grey and empty.
//
// _hasMenuBar used to bail on the missing mirror before ever asking WAT. The
// blob is the source of truth, so the mirror may only be a fast path.

const { Win98Renderer } = require('../lib/renderer.js');

function makeWin(extra) {
  return Object.assign({
    hwnd: 0x10002,
    style: 0x90000000, // WS_POPUP | WS_VISIBLE -- not WS_CHILD
    isChild: false,
    visible: true,
  }, extra || {});
}

function rendererWithBarCount(counts) {
  const r = Object.create(Win98Renderer.prototype);
  r.windows = {};
  r.wasm = { exports: { menu_bar_count: hwnd => counts[hwnd >>> 0] | 0 } };
  r._ensureWatMenu = () => { throw new Error('_ensureWatMenu must not run without a mirrored menu id'); };
  return r;
}

let failures = 0;
function check(ok, what) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
}

const r = rendererWithBarCount({ 0x10002: 6, 0x10004: 0 });

// The case this exists for: bars in WAT, no mirror.
check(r._hasMenuBar(makeWin({})) === true,
  'a WAT menu with no renderer mirror still counts as a menu bar');

// And the negative, so the new path cannot answer "yes" for every window.
check(r._hasMenuBar(makeWin({ hwnd: 0x10004 })) === false,
  'a window WAT has no bars for still has no menu bar');

// WS_CHILD keeps its old meaning: hMenu is a control id there, not a menu.
check(r._hasMenuBar(makeWin({ isChild: true })) === false,
  'a child window is never given a menu bar');

check(r._hasMenuBar(null) === false, 'no window, no menu bar');

// With the mirror set, the lazy JS-side push still has to run -- that is what
// keeps a resource menu from measuring 0 bars on the very first repaint.
let ensured = 0;
const r2 = rendererWithBarCount({ 0x10002: 6 });
r2._ensureWatMenu = () => { ensured++; };
check(r2._hasMenuBar(makeWin({ _menuId: 0x12345 })) === true && ensured === 1,
  'a mirrored menu id still goes through _ensureWatMenu');

if (failures) process.exit(1);
