#!/usr/bin/env node
'use strict';

// A menu bar is non-client area in its own right, and it can live on a
// borderless WS_POPUP *dialog*. Moraff's Jiggler is that shape: its whole
// game menu hangs off a 1305x42 dialog with no caption and no border, which
// the app reparents onto the game window. handleMouseDown's dialog branch
// drops every click outside such a dialog's client rect, so without an
// explicit menu-bar check there the painted bar was unclickable — and the
// generic menu check further down never ran, because it was gated on the
// JS-side `_menuId` mirror that a guest-installed SetMenu never sets.

const assert = require('assert');
const { installInputHandlers } = require('../lib/renderer-input');

class FakeRenderer {}
installInputHandlers(FakeRenderer);

// The strip: WS_POPUP | WS_VISIBLE, no caption, no border. Its client area
// starts 18px down, below the bar — the bar itself is outside it.
const STRIP = 0x10002;
const PARENT = 0x10001;

function makeRenderer({ barCount, takeClick }) {
  const calls = [];
  const wasm = {
    exports: {
      menu_bar_count: hwnd => (hwnd === STRIP ? barCount : 0),
      menu_bar_screen_x: () => 0,
      menu_bar_screen_y: () => 0,
      menu_handle_bar_click: (hwnd, x, y) => {
        calls.push({ hwnd, x, y });
        return takeClick ? 1 : 0;
      },
      menu_open_hwnd: () => 0,
      menu_open_top: () => -1,
      wnd_get_style_export: () => 0x90000000,
      hittest_sync: () => 0,
    },
  };
  const strip = {
    hwnd: STRIP,
    visible: true,
    isDialog: true,
    isChild: false,
    parentHwnd: PARENT,
    style: 0x90000000,
    x: 0, y: 0, w: 1305, h: 42,
    wasm,
  };
  const r = new FakeRenderer();
  r.wasm = wasm;
  r.windows = { [STRIP]: strip };
  r.inputQueue = [];
  r._mapExclusiveInputPoint = (x, y) => ({ x, y, outside: false });
  r._applyCursorClip = (x, y) => ({ x, y });
  r._mouseMaskForButton = () => 1;
  r._inputWindowAtPoint = () => strip;
  r._queueDirectInputMouseButton = () => {};
  r._signalDirectInputDevice = () => {};
  r._setMousePoint = () => {};
  r._modalDialogHwnd = () => 0;
  r._windowRectScreen = w => ({ x: w.x, y: w.y, w: w.w, h: w.h });
  r._computeClientRect = w => {
    w.clientRect = { x: w.x, y: w.y + 18, w: w.w, h: w.h - 18 };
  };
  r._isWindowClass = () => false;
  r._raiseWindowGroup = () => {};
  r._setKeyboardInputOwner = () => {};
  r._hasCaption = () => false;
  r._closeWatDialogFrame = () => {};
  r._beginWindowDrag = () => { throw new Error('a bar click must not start a drag'); };
  r.scheduleRepaint = () => {};
  r.repaint = () => {};
  r._hasMenuBar = w => (wasm.exports.menu_bar_count(w.hwnd) | 0) > 0;
  return { r, calls, strip };
}

// (40, 8) is inside the menu bar and outside the dialog's client rect.
{
  const { r, calls } = makeRenderer({ barCount: 6, takeClick: true });
  r.handleMouseDown(40, 8, 0, {});
  assert.strictEqual(calls.length, 1,
    'a click on the bar of a borderless dialog must reach menu_handle_bar_click');
  assert.deepStrictEqual(calls[0], { hwnd: STRIP, x: 40, y: 8 });
  assert.strictEqual(r._menuMouseCapture, true,
    'taking the bar click must start menu mouse capture');
}

// Negative control: the same window with no menu blob must not consult the
// menu at all, so an ordinary non-client click keeps its existing route.
{
  const { r, calls } = makeRenderer({ barCount: 0, takeClick: true });
  r.handleMouseDown(40, 8, 0, {});
  assert.strictEqual(calls.length, 0,
    'a dialog with no menu must not be asked to open one');
  assert.notStrictEqual(r._menuMouseCapture, true,
    'no menu means no menu capture');
}

// Second control: a menu that declines the point (a click in the empty space
// right of the last item) must fall through rather than swallow the click.
{
  const { r, calls } = makeRenderer({ barCount: 6, takeClick: false });
  r.handleMouseDown(900, 8, 0, {});
  assert.strictEqual(calls.length, 1, 'the menu is still consulted');
  assert.notStrictEqual(r._menuMouseCapture, true,
    'a declined bar click must not capture the mouse');
}

console.log('PASS  menu bar on a borderless WS_POPUP dialog takes its own clicks');
