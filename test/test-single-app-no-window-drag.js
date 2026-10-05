#!/usr/bin/env node
// Single-app (phone) mode must not let a titlebar drag move the app's own
// window. There is no desktop behind it to drag it around on: the phone
// presents the union of the visible top-level rects, so a drag walks the
// picture off its own crop and pulls teal in from the other side -- and the
// caption is a fat touch target across the top of the screen, exactly where a
// thumb starts a scroll, so it is easy to begin by accident with no window
// edge to drop it back against.
//
// A DIALOG is the deliberate exception: moving a message box to read what is
// underneath it is a real thing to want, and the crop is not anchored on it.
//
// This tests _beginWindowDrag directly rather than synthesising a titlebar
// hit, because the hit test lives in WAT -- the two call sites both ask
// hittest_sync for HTCAPTION and then call this, so the guard belongs here
// and one check covers both of them.

const { installInputHandlers } = require('../lib/renderer-input');

class FakeRenderer {}
installInputHandlers(FakeRenderer);

function makeWin(extra) {
  return Object.assign({ hwnd: 65537, x: 0, y: 147, w: 400, h: 376 }, extra);
}

function makeRenderer(singleAppMode) {
  const r = new FakeRenderer();
  r.singleAppMode = singleAppMode;
  return r;
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push(!!pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

// The app's own window, maximized the way single-app mode leaves it.
const phone = makeRenderer(true);
phone._beginWindowDrag(makeWin({ _maximized: true }), 200, 160);
check('phone: titlebar drag on the app window is refused', !phone._draggingWin,
  JSON.stringify(phone._draggingWin || null));

// Not every single-app window is maximized -- a keepAspect app like Pegged is
// letterboxed and sits smaller than the canvas. It must not be draggable
// either; the free space around it is the crop's teal, not desktop.
const phoneUnmaximized = makeRenderer(true);
phoneUnmaximized._beginWindowDrag(makeWin({ _maximized: false }), 200, 160);
check('phone: drag refused for an unmaximized top-level too',
  !phoneUnmaximized._draggingWin);

// A dialog still moves.
const phoneDialog = makeRenderer(true);
phoneDialog._beginWindowDrag(makeWin({ hwnd: 65539, isDialog: true, x: 40, y: 300 }), 100, 320);
check('phone: a dialog is still draggable', !!phoneDialog._draggingWin);
check('phone: the dialog drag keeps its grab offset',
  phoneDialog._draggingWin &&
  phoneDialog._draggingWin.offsetX === 60 && phoneDialog._draggingWin.offsetY === 20,
  phoneDialog._draggingWin
    ? `${phoneDialog._draggingWin.offsetX},${phoneDialog._draggingWin.offsetY}`
    : 'no drag');

// The ordinary desktop shell is untouched: dragging windows is the whole
// point of a desktop.
const desktop = makeRenderer(false);
desktop._beginWindowDrag(makeWin({ x: 20, y: 20 }), 120, 30);
check('desktop: titlebar drag still starts', !!desktop._draggingWin);
check('desktop: the drag keeps its grab offset',
  desktop._draggingWin &&
  desktop._draggingWin.offsetX === 100 && desktop._draggingWin.offsetY === 10,
  desktop._draggingWin
    ? `${desktop._draggingWin.offsetX},${desktop._draggingWin.offsetY}`
    : 'no drag');

const failed = checks.filter(ok => !ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
