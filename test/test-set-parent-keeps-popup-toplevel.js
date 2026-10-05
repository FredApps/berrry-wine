#!/usr/bin/env node
'use strict';

// SetParent gives a window a parent; it does not make it a child window.
// WS_CHILD does, and every renderer facility gated on `isChild` -- the menu
// bar first -- has to keep following that bit. Moraff's Jiggler is the case:
// it hangs its whole game menu on a borderless WS_POPUP dialog and then
// SetParents that strip onto the game window, and marking the strip a child
// there left the six-item bar WAT had already loaded unpainted and
// unhittestable.

const assert = require('assert');
const { createWindowHost } = require('../lib/host-window');

const POPUP = 0x10002;
const CHILD = 0x10004;
const PARENT = 0x10001;

function host(windows) {
  const recomputed = [];
  const renderer = {
    windows,
    _toolbarWidthLimit: () => 0,
    _clampToolbarWidth: () => {},
    _computeClientRect: win => { recomputed.push(win.hwnd); },
  };
  const shared = {
    readStr: () => '', readStrW: () => '',
    cursorCssForHandle: () => '', cursorCssFromPixels: () => '',
    builtCursorCssFor: () => '',
  };
  const { imports } = createWindowHost({ renderer }, shared);
  return { imports, recomputed };
}

// WS_POPUP | WS_VISIBLE: reparenting must leave it top-level.
{
  const popup = { hwnd: POPUP, style: 0x90000000, isChild: false, parentHwnd: 0 };
  const windows = { [PARENT]: { hwnd: PARENT, style: 0x92000000 }, [POPUP]: popup };
  const { imports, recomputed } = host(windows);
  imports.set_parent(POPUP, PARENT);
  assert.strictEqual(popup.parentHwnd, PARENT, 'the parent is still recorded');
  assert.strictEqual(popup.isChild, false,
    'SetParent must not turn a WS_POPUP window into a child window');
  assert.deepStrictEqual(recomputed, [],
    'a window whose role did not change needs no client-rect recompute');
}

// WS_CHILD: the bit is what decides, so this one is a child and its
// non-client layout has to be recomputed against the new parent.
{
  const child = { hwnd: CHILD, style: 0x50000000, isChild: false, parentHwnd: 0 };
  const windows = { [PARENT]: { hwnd: PARENT, style: 0x92000000 }, [CHILD]: child };
  const { imports, recomputed } = host(windows);
  imports.set_parent(CHILD, PARENT);
  assert.strictEqual(child.isChild, true, 'WS_CHILD reparents as a child');
  assert.deepStrictEqual(recomputed, [CHILD],
    'gaining child status must recompute the client rect');
}

// SetParent(hwnd, NULL) returns a child to the desktop.
{
  const child = { hwnd: CHILD, style: 0x50000000, isChild: true, parentHwnd: PARENT };
  const windows = { [PARENT]: { hwnd: PARENT, style: 0x92000000 }, [CHILD]: child };
  const { imports, recomputed } = host(windows);
  imports.set_parent(CHILD, 0);
  assert.strictEqual(child.parentHwnd, 0);
  assert.strictEqual(child.isChild, false, 'a parentless window is top-level');
  assert.deepStrictEqual(recomputed, [CHILD],
    'losing child status must recompute the client rect');
}

console.log('PASS  SetParent follows WS_CHILD, not the mere presence of a parent');
