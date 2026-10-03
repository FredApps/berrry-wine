#!/usr/bin/env node
'use strict';

// Registered x86 dialog children stay on GetMessage/DispatchMessage, but a
// WAT BUTTON stays on dialog_route_mouse. Its built-in procedure only updates
// local control state and queues BN_CLICKED for the parent, so no nested guest
// dialog procedure runs on the browser event stack.

const assert = require('assert');
const { installInputHandlers } = require('../lib/renderer-input');

class FakeRenderer {}
installInputHandlers(FakeRenderer);

let synchronousRoutes = 0;
const wasm = {
  exports: {
    ctrl_get_class: hwnd => hwnd === 0x40002 ? 1 : 0,
    wnd_get_proc_export: hwnd => hwnd === 0x40002 ? 0xFFFF0001 : 0,
    wnd_get_style_export: () => 0,
    dialog_route_mouse_screen: () => { synchronousRoutes++; return 1; },
  },
};
const dialog = {
  hwnd: 0x40001,
  visible: true,
  isDialog: true,
  x: 20,
  y: 20,
  w: 300,
  h: 180,
  wasm,
};
const renderer = new FakeRenderer();
renderer.wasm = wasm;
renderer.windows = { 0x40001: dialog };
renderer.inputQueue = [];
renderer._mouseX = 132;
renderer._mouseY = 79;
renderer._mouseButtonsMask = 1;
renderer._pointerInputWasm = wasm;
renderer._wakeMessageWait = () => {};
renderer._hitTestDeepChild = () => ({ hwnd: 0x40002, sx: 100, sy: 60 });
renderer._mapExclusiveInputPoint = (x, y) => ({ x, y, outside: false });
renderer._applyCursorClip = (x, y) => ({ x, y });
renderer._mouseMaskForButton = () => 1;
renderer._inputWasmAtPoint = () => wasm;
renderer._modalDialogHwnd = () => 0x40001;
renderer._handleNativeScrollbarUp = () => false;
renderer._signalDirectInputDevice = () => {};
renderer._setMousePoint = (x, y) => {
  renderer._mouseX = x;
  renderer._mouseY = y;
};
renderer._windowRectScreen = win => ({ x: win.x, y: win.y, w: win.w, h: win.h });
renderer._computeClientRect = win => {
  win.clientRect = { x: win.x, y: win.y, w: win.w, h: win.h };
};
renderer.scheduleRepaint = () => {};
renderer.repaint = () => {};

assert.strictEqual(renderer._queueNativeDialogChildMouseDown(
  dialog, 132, 79, 0x0201, 1), false,
'WAT dialog BUTTON down should stay on dialog_route_mouse');
assert.strictEqual(synchronousRoutes, 0,
  'classification alone must not synchronously enter the control');
assert.deepStrictEqual(renderer.inputQueue, [],
  'WAT BUTTON classification must not enqueue mouse messages');

console.log('PASS  WAT dialog BUTTONs stay on the built-in dialog router');
