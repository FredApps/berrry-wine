#!/usr/bin/env node
'use strict';

// A captured WAT BUTTON release may execute its built-in control procedure
// directly: that procedure only clears/toggles local state and queues the
// parent's BN_CLICKED. The parent dialog still runs through GetMessage, while
// frameworks cannot pre-translate and discard WM_LBUTTONUP before the built-in
// BUTTON sees it.

const assert = require('assert');
const { installInputHandlers } = require('../lib/renderer-input');

class FakeRenderer {}
installInputHandlers(FakeRenderer);

let routedSynchronously = 0;
const wasm = {
  exports: {
    get_capture_hwnd: () => 0x10002,
    wnd_top_level: () => 0x10001,
    wnd_get_owner: () => 0x90001,
    wnd_mouse_msg_origin_x: () => 40,
    wnd_mouse_msg_origin_y: () => 50,
    ctrl_get_class: () => 1,
    send_message: () => { routedSynchronously++; return 0; },
    dialog_route_mouse: () => { routedSynchronously++; return 1; },
  },
};

const renderer = new FakeRenderer();
renderer.wasm = wasm;
renderer.windows = {
  0x10001: {
    hwnd: 0x10001,
    visible: true,
    isChild: false,
    x: 20,
    y: 20,
    w: 300,
    h: 220,
    wasm,
  },
};
renderer.inputQueue = [];
renderer._dialogBtnDrag = {
  parent: 0x10001,
  downLParam: 0,
  clientX: 20,
  clientY: 20,
  wasm,
};
renderer._mapExclusiveInputPoint = (x, y) => ({ x, y, outside: false });
renderer._applyCursorClip = (x, y) => ({ x, y });
renderer._mouseMaskForButton = () => 1;
renderer._inputWasmAtPoint = () => wasm;
renderer._modalDialogHwnd = () => 0;
renderer._handleNativeScrollbarUp = () => false;
renderer._signalDirectInputDevice = () => {};
renderer._setMousePoint = (x, y) => { renderer._mouseX = x; renderer._mouseY = y; };
renderer._wakeMessageWait = () => {};
renderer.scheduleRepaint = () => {};
renderer.repaint = () => {};

renderer.handleMouseUp(55, 70, 1);

assert.strictEqual(routedSynchronously, 1,
  'captured WAT dialog button must receive its built-in mouse-up directly');
assert.strictEqual(renderer.inputQueue.length, 0,
  'the built-in button queues BN_CLICKED, not the renderer mouse-up');

console.log('PASS  captured WAT button mouse-up directly reaches the built-in control');

let watRoutedSynchronously = 0;
const watModalWasm = {
  exports: {
    get_capture_hwnd: () => 0x20002,
    dialog_route_mouse: () => { watRoutedSynchronously++; return 1; },
  },
};
const watRenderer = new FakeRenderer();
watRenderer.wasm = watModalWasm;
watRenderer.windows = {
  0x20001: {
    hwnd: 0x20001,
    visible: true,
    isChild: false,
    x: 20,
    y: 20,
    w: 300,
    h: 220,
    wasm: watModalWasm,
  },
};
watRenderer.inputQueue = [];
watRenderer._dialogBtnDrag = {
  parent: 0x20001,
  downLParam: 0,
  clientX: 20,
  clientY: 20,
  wasm: watModalWasm,
};
watRenderer._mapExclusiveInputPoint = (x, y) => ({ x, y, outside: false });
watRenderer._applyCursorClip = (x, y) => ({ x, y });
watRenderer._mouseMaskForButton = () => 1;
watRenderer._inputWasmAtPoint = () => watModalWasm;
watRenderer._modalDialogHwnd = () => 0x20001;
watRenderer._handleNativeScrollbarUp = () => false;
watRenderer._signalDirectInputDevice = () => {};
watRenderer._setMousePoint = (x, y) => { watRenderer._mouseX = x; watRenderer._mouseY = y; };
watRenderer._wakeMessageWait = () => {};
watRenderer.scheduleRepaint = () => {};
watRenderer.repaint = () => {};

watRenderer.handleMouseUp(55, 70, 1);

assert.strictEqual(watRoutedSynchronously, 1,
  'WAT-owned modal dialog should retain synchronous mouse-up routing');
assert.strictEqual(watRenderer.inputQueue.length, 0,
  'WAT-owned modal dialog should not queue its mouse-up');

console.log('PASS  WAT-owned modal dialog mouse-up stays synchronous');

function capturedControlCase(ctrlClass, owner, workerOwned = false) {
  const sent = [];
  const captureWasm = {
    exports: {
      get_capture_hwnd: () => 0x30002,
      wnd_top_level: () => 0x30001,
      wnd_get_owner: () => owner,
      wnd_mouse_msg_origin_x: () => 40,
      wnd_mouse_msg_origin_y: () => 50,
      ctrl_get_class: () => ctrlClass,
      dialog_route_mouse: () => 0,
      send_message: (hwnd, msg, wParam, lParam) => {
        sent.push({ hwnd, msg, wParam, lParam: lParam >>> 0 });
        return 0;
      },
    },
  };
  const r = new FakeRenderer();
  r.wasm = captureWasm;
  if (workerOwned) r._guestWorkerWasms = new WeakSet([captureWasm]);
  r.windows = {
    0x30001: {
      hwnd: 0x30001, visible: true, isChild: false,
      x: 20, y: 20, w: 300, h: 220, wasm: captureWasm,
    },
  };
  r.inputQueue = [];
  r._dialogBtnDrag = {
    parent: 0x30001, downLParam: 0,
    clientX: 20, clientY: 20, wasm: captureWasm,
  };
  r._mapExclusiveInputPoint = (x, y) => ({ x, y, outside: false });
  r._applyCursorClip = (x, y) => ({ x, y });
  r._mouseMaskForButton = () => 1;
  r._inputWasmAtPoint = () => captureWasm;
  r._modalDialogHwnd = () => 0;
  r._handleNativeScrollbarMove = () => false;
  r._handleNativeScrollbarUp = () => false;
  r._signalDirectInputDevice = () => {};
  r._setMousePoint = (x, y) => { r._mouseX = x; r._mouseY = y; };
  r._wakeMessageWait = () => {};
  r.scheduleRepaint = () => {};
  r.repaint = () => {};
  r._mouseButtonsMask = 1;
  r.handleMouseMove(55, 70);
  r.handleMouseUp(55, 70, 1);
  return { sent, queued: r.inputQueue };
}

const trackbar = capturedControlCase(19, 0x90001);
assert.deepStrictEqual(trackbar.sent, [
  { hwnd: 0x30002, msg: 0x0200, wParam: 1, lParam: (20 << 16) | 15 },
  { hwnd: 0x30002, msg: 0x0202, wParam: 0, lParam: (20 << 16) | 15 },
], 'captured WAT trackbar move and release should dispatch synchronously');
assert.strictEqual(trackbar.queued.length, 0);

const ownerlessButton = capturedControlCase(1, 0);
assert.strictEqual(ownerlessButton.sent.length, 2,
  'ownerless main-dialog WAT button should dispatch synchronously');
assert.strictEqual(ownerlessButton.queued.length, 0);

const workerCapture = capturedControlCase(1, 0x90001, true);
assert.strictEqual(workerCapture.sent.length, 0, 'Worker capture never calls page native handlers');
assert.deepStrictEqual(workerCapture.queued.map(({hwnd, msg, wParam, lParam}) =>
  ({hwnd, msg, wParam, lParam})), [
  {hwnd: 0x30002, msg: 0x200, wParam: 1, lParam: (20 << 16) | 15},
  {hwnd: 0x30002, msg: 0x202, wParam: 0, lParam: (20 << 16) | 15},
], 'Worker captured move and release keep control-local coordinates');

console.log('PASS  WAT capture dispatches directly for controls and ownerless buttons');

const nativeDialogWasm = {
  exports: {
    ctrl_get_class: hwnd => hwnd === 0x40002 ? 0 : 1,
    wnd_get_proc_export: hwnd => hwnd === 0x40002 ? 0x00412345 : 0,
  },
};
const nativeDialog = {
  hwnd: 0x40001,
  wasm: nativeDialogWasm,
};
const nativeDialogRenderer = new FakeRenderer();
nativeDialogRenderer.wasm = nativeDialogWasm;
nativeDialogRenderer.inputQueue = [];
nativeDialogRenderer._mouseX = 132;
nativeDialogRenderer._mouseY = 79;
nativeDialogRenderer._mouseButtonsMask = 1;
nativeDialogRenderer._wakeMessageWait = () => {};
nativeDialogRenderer._hitTestDeepChild = () => ({
  hwnd: 0x40002,
  sx: 100,
  sy: 60,
});

assert.strictEqual(nativeDialogRenderer._queueNativeDialogChildMouseDown(
  nativeDialog, 132, 79, 0x0201, 1), true);
assert.deepStrictEqual(nativeDialogRenderer.inputQueue, [{
  type: 'mouse',
  hwnd: 0x40002,
  msg: 0x0201,
  wParam: 1,
  lParam: (19 << 16) | 32,
  mouseX: 132,
  mouseY: 79,
  mouseButtons: 1,
}], 'registered x86 dialog child should receive DOWN through the guest queue');
assert.deepStrictEqual(nativeDialogRenderer._directMouseDown, {
  win: nativeDialog,
  targetHwnd: 0x40002,
  screenX: 100,
  screenY: 60,
});

nativeDialogWasm.exports.wnd_get_proc_export = () => 0xFFFF0001;
nativeDialogRenderer.inputQueue.length = 0;
assert.strictEqual(nativeDialogRenderer._queueNativeDialogChildMouseDown(
  nativeDialog, 132, 79, 0x0201, 1), false,
  'WAT-owned dialog pages retain synchronous dialog routing');
assert.strictEqual(nativeDialogRenderer.inputQueue.length, 0);

console.log('PASS  native x86 dialog child mouse-down is queued through GetMessage');

// WAT controls can synchronously notify a guest parent while transferring
// focus. With a Worker owner, neither DOWN nor its paired UP may execute on
// the page instance (whose code16 can be false for a real Win16 task).
for (const controlClass of [1, 2]) {
  const workerWasm = { exports: {
    ctrl_get_class: () => controlClass,
    wnd_get_proc_export: () => 0xFFFF0001,
    is_win16: () => 0, // deliberately uninformative page-side CPU state
    dialog_route_mouse: () => { throw Error('page-side dialog callback'); },
    send_message: () => { throw Error('page-side guest notification'); },
  }};
  const workerDialog = { hwnd: 0x50001, wasm: workerWasm };
  const r = new FakeRenderer();
  Object.assign(r, {
    wasm: workerWasm, windows: {0x50001: workerDialog}, inputQueue: [],
    _guestWorkerWasms: new WeakSet([workerWasm]),
    _mouseX: 132, _mouseY: 79, _mouseButtonsMask: 1,
    _hitTestDeepChild: () => ({hwnd: 0x50002, sx: 100, sy: 60}),
    _wakeMessageWait: () => {}, _traceInput: () => {},
    _mapExclusiveInputPoint: (x, y) => ({x, y, outside: false}),
    _applyCursorClip: (x, y) => ({x, y}), _mouseMaskForButton: () => 1,
    _inputWasmAtPoint: () => workerWasm, _modalDialogHwnd: () => 0,
    _handleNativeScrollbarUp: () => false, _signalDirectInputDevice: () => {},
    _setMousePoint(x, y) { this._mouseX = x; this._mouseY = y; },
  });
  assert.strictEqual(r._queueNativeDialogChildMouseDown(workerDialog, 132, 79, 0x201, 1), true);
  assert.strictEqual(r._dialogBtnDrag, undefined, 'Worker control never enters direct dialog drag');
  r.wasm = {exports: {}}; // another app may become the renderer's current instance
  r.handleMouseUp(92, 85, 1); // release outside the original control still pairs
  assert.deepStrictEqual(r.inputQueue.map(({hwnd, msg, wParam, lParam}) =>
    ({hwnd, msg, wParam, lParam})), [
    {hwnd: 0x50002, msg: 0x201, wParam: 1, lParam: (19 << 16) | 32},
    {hwnd: 0x50002, msg: 0x202, wParam: 0, lParam: (25 << 16) | 0xfff8},
  ], 'Worker gets exact control-relative paired mouse messages');
  assert.strictEqual(r._directMouseDown, null, 'paired release retires pointer ownership');
}
console.log('PASS  Worker WAT BUTTON/EDIT input stays on owning guest queue; cooperative PE route retained');

const groupRows = [
  {hwnd: 8, cls: 1, style: 0x50000007, x: 48, y: 160, w: 290, h: 100},
  {hwnd: 9, cls: 1, style: 0x50010009, x: 58, y: 188, w: 262, h: 24},
  {hwnd: 11, cls: 1, style: 0x40010009, x: 58, y: 218, w: 262, h: 24}, // hidden
  {hwnd: 12, cls: 1, style: 0x58010009, x: 58, y: 218, w: 262, h: 24}, // disabled
  {hwnd: 13, cls: 3, style: 0x50000000, x: 58, y: 218, w: 262, h: 24}, // static
  {hwnd: 10, cls: 1, style: 0x50010009, x: 58, y: 218, w: 262, h: 24},
];
const row = h => groupRows.find(r => r.hwnd === h);
const groupWasm = {exports: {
  ctrl_get_class: h => row(h).cls,
  wnd_get_style_export: h => row(h).style,
  wnd_get_proc_export: () => 0xFFFF0001,
  wnd_get_parent: () => 4,
  wnd_next_child_slot: (parent, slot) => { assert.strictEqual(parent, 4); return slot < groupRows.length ? slot : -1; },
  wnd_slot_hwnd: slot => groupRows[slot].hwnd,
  wnd_window_screen_x: h => row(h).x, wnd_window_screen_y: h => row(h).y,
  wnd_screen_w: h => row(h).w, wnd_screen_h: h => row(h).h,
  dialog_route_mouse: () => { throw Error('group fallback executed page dialog callback'); },
}};
const groupRenderer = new FakeRenderer();
Object.assign(groupRenderer, {
  wasm: {exports: {}}, _guestWorkerWasms: new WeakSet([groupWasm]), inputQueue: [],
  _hitTestDeepChild: () => ({hwnd: 8, sx: 48, sy: 160}), _wakeMessageWait: () => {},
});
assert.strictEqual(groupRenderer._queueNativeDialogChildMouseDown(
  {hwnd: 4, wasm: groupWasm}, 64, 227, 0x201, 1), true);
assert.strictEqual(groupRenderer.inputQueue.length, 1);
assert.strictEqual(groupRenderer.inputQueue[0].hwnd, 10, 'overlapping groupbox must not steal dealer radio input');
assert.strictEqual(groupRenderer.inputQueue[0].lParam, (9 << 16) | 6, 'radio gets its own local coordinates');
assert.strictEqual(groupRenderer._queueNativeDialogChildMouseDown(
  {hwnd: 4, wasm: groupWasm}, 50, 165, 0x201, 1), true);
assert.strictEqual(groupRenderer.inputQueue.length, 1, 'empty group frame is noninteractive');
console.log('PASS  Worker groupbox transparency selects visible enabled underlying radio');
