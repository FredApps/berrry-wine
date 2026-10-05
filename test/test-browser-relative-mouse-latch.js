#!/usr/bin/env node
'use strict';

// Regression: hiding/clipping an absolute cursor must not arm a sticky
// capture latch. Only explicit relativeMouse configuration may request lock.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { APPS } = require('../lib/apps');

assert.strictEqual(APPS.diablo_demo.hideHostCursor, true);
assert.strictEqual(APPS.diablo_shareware.hideHostCursor, true);
assert.notStrictEqual(APPS.diablo_shareware.relativeMouse, true,
  'Diablo remains an absolute mouse application');
const shellSource = fs.readFileSync(path.join(__dirname, '../lib/browser-shell.js'), 'utf8');
assert(shellSource.includes('hideHostCursor: app.hideHostCursor === true'),
  'browser shell propagates the presentation-only cursor policy');

const listeners = new Map();
const addListener = (type, fn) => listeners.set(type, fn);
const lockRequests = [];
const cursorClasses = new Set();
const canvas = {
  width: 640,
  height: 480,
  style: {},
  classList: { toggle(name, on) { if (on) cursorClasses.add(name); else cursorClasses.delete(name); } },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  addEventListener: addListener,
  removeEventListener() {},
  setAttribute() {},
  focus() {},
  webkitRequestPointerLock() {
    lockRequests.push(1);
  },
};

global.window = {
  addEventListener: addListener,
  removeEventListener() {},
  MobileKeyboard: null,
};
global.document = {
  pointerLockElement: null,
  webkitPointerLockElement: null,
  body: {},
  documentElement: {},
  activeElement: canvas,
  visibilityState: 'visible',
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: addListener,
  elementFromPoint: () => null,
};

const intervalFns = [];
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
global.setInterval = fn => { intervalFns.push(fn); return intervalFns.length; };
global.clearInterval = () => {};

const calls = { absolute: [] };
let heuristic = false;
// Diablo's software cursor does not change its absolute input protocol.
const runningApps = [{
  name: 'diablo_shareware', hideHostCursor: true, wine: { running: true },
}];
const renderer = {
  windows: {},
  _exclusiveTransform: { hwnd: 1 },
  wantsRelativeMouse: (x, y, explicit) => explicit === true,
  wantsHiddenMouse: () => heuristic,
  handleMouseMove: (x, y) => calls.absolute.push([x, y]),
  handleRelativeMouseMove() {},
  handleMenuHover() {},
  handleMouseDown() {},
  handleMouseUp() {},
  handleWheel() {},
};

function click(x, y) {
  canvas.onmousedown({
    clientX: x, clientY: y, button: 0, buttons: 1,
    ctrlKey: false, shiftKey: false, preventDefault() {},
  });
  listeners.get('mouseup')({
    clientX: x, clientY: y, button: 0,
    preventDefault() {}, stopPropagation() {},
  });
}

try {
  const browserInput = require('../lib/browser-input');
  browserInput.wireCanvasInput(canvas, renderer, { runningApps, debugMode: false });

  click(320, 240);
  assert.strictEqual(lockRequests.length, 0,
    'a software-cursor profile must not capture');
  assert(cursorClasses.has('guest-cursor-hidden'),
    'Diablo profile hides the duplicate browser cursor');

  heuristic = true;
  canvas.onmousemove({ clientX: 300, clientY: 200, movementX: 1, movementY: 0 });
  assert.deepStrictEqual(calls.absolute, [[300, 200]],
    'hidden-cursor absolute games receive hover without capture');
  assert(cursorClasses.has('guest-cursor-hidden'),
    'absolute input still hides the duplicate browser cursor');

  heuristic = false;
  click(320, 240);
  assert.strictEqual(lockRequests.length, 0,
    'cursor visibility changes must not leave a sticky capture latch');

  renderer._exclusiveTransform = null;
  canvas.onmousemove({ clientX: 123, clientY: 234, movementX: 1, movementY: 0 });
  assert.deepStrictEqual(calls.absolute, [[300, 200], [123, 234]],
    'the latch must drop with the exclusive presentation');
  click(123, 234);
  assert.strictEqual(lockRequests.length, 0,
    'a windowed guest must not inherit a stale latch');

  renderer._exclusiveTransform = { hwnd: 1 };
  heuristic = true;
  for (const fn of intervalFns) fn();
  heuristic = false;
  click(320, 240);
  assert.strictEqual(lockRequests.length, 0,
    'stationary cursor visibility polling must not arm capture');
  runningApps[0].relativeMouse = true;
  click(320, 240);
  assert.strictEqual(lockRequests.length, 1, 'explicit relative app captures');
  runningApps[0] = {
    name: 'diablo_shareware', hideHostCursor: true, wine: { running: true },
  };
  canvas.onmousemove({ clientX: 210, clientY: 190 });
  assert.deepStrictEqual(calls.absolute.at(-1), [210, 190],
    'switching to an absolute app restores ordinary motion immediately');
  click(210, 190);
  assert.strictEqual(lockRequests.length, 1, 'absolute app does not inherit capture intent');
} finally {
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
}

console.log('PASS explicit relative input; no cursor-state capture latch');
