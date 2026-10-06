#!/usr/bin/env node
'use strict';

// A WAT dialog BUTTON in cooperative mode stays on dialog_route_mouse: the
// renderer's instance is the running guest, and the button procedure only
// changes control state and queues BN_CLICKED (4de7c7cc). In guest-main Worker
// mode the renderer's instance is an idle shadow, so a synchronous route would
// press the button against the shadow's USER globals and the guest would never
// hear of it (Unreal Tournament's setup-wizard Next did nothing with Threads
// on). There the click is queued into slot 0's own message pump, except for a
// common MessageBox/file dialog, whose call is parked in the CACA0006 pump.

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
'cooperative mode: a WAT dialog BUTTON stays on dialog_route_mouse');
assert.strictEqual(renderer.inputQueue.length, 0, 'and nothing is queued');

renderer._guestWorkerWasms = new WeakSet([wasm]);
wasm.exports.modal_dialog_hwnd = () => 0x40001;
assert.strictEqual(renderer._queueNativeDialogChildMouseDown(
  dialog, 132, 79, 0x0201, 1), false,
'Worker mode: a common modal dialog BUTTON stays on dialog_route_mouse');
delete wasm.exports.modal_dialog_hwnd;

assert.strictEqual(renderer._queueNativeDialogChildMouseDown(
  dialog, 132, 79, 0x0201, 1), true,
'Worker mode: a WAT dialog BUTTON down enters the guest queue');
assert.strictEqual(synchronousRoutes, 0,
  'dialog BUTTON down must not synchronously enter its parent wndproc');
assert.deepStrictEqual(renderer.inputQueue[0], {
  type: 'mouse',
  hwnd: 0x40002,
  msg: 0x0201,
  wParam: 1,
  lParam: (19 << 16) | 32,
  mouseX: 132,
  mouseY: 79,
  mouseButtons: 1,
});

renderer.handleMouseUp(132, 79, 0);
assert.strictEqual(synchronousRoutes, 0,
  'dialog BUTTON up must not synchronously send BN_CLICKED');
assert.deepStrictEqual(renderer.inputQueue[1], {
  type: 'mouse',
  hwnd: 0x40002,
  msg: 0x0202,
  wParam: 0,
  lParam: (19 << 16) | 32,
  mouseX: 132,
  mouseY: 79,
  mouseButtons: 0,
});

console.log('PASS  Worker-mode dialog BUTTON clicks go through the guest message pump');
