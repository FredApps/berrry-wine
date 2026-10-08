'use strict';
const assert = require('node:assert/strict');
const { pointerSnapshot, installPointerTrace } = require('../tools/input-receipt');
let forbiddenReads = 0;
const wine = { get memory() { forbiddenReads++; throw Error('memory'); },
  get instance() { forbiddenReads++; throw Error('exports'); }, renderer: {
    canvas: { width: 640, height: 480, getBoundingClientRect: () =>
      ({ left: 0, top: 180, right: 640, bottom: 660, width: 640, height: 480 }) },
    _mouseX: 305, _mouseY: 275, _mouseButtonsMask: 1,
    _directMouseDown: { targetHwnd: 0x10004, screenX: 220, screenY: 260, win: { hwnd: 0x10002 } },
    inputQueue: Array.from({ length: 12 }, (_, i) => ({ type: 'mouse', hwnd: 0x10004,
      msg: 0x201, lParam: (15 << 16) | 85, mouseY: i })),
    windows: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i,
      { hwnd: i, style: 0x5000000b, clientRect: { x: 3, y: 23, w: 634, h: 453 } }])),
  } };
const before = JSON.stringify(wine.renderer), snapshot = pointerSnapshot(wine, null);
assert.equal(snapshot.queue.length, 8);
assert.equal(snapshot.windows.length, 16);
assert.equal(snapshot.down.screenY, 260);
assert.equal(snapshot.queue[0].lParam, (15 << 16) | 85);
assert.equal(JSON.stringify(wine.renderer), before);
assert.equal(pointerSnapshot(null, null).canvas, null);
const r = wine.renderer;
let calls = 0;
r.onInputTrace = function(what) { assert.equal(this, r); calls++;
  if (what === 'throw') throw Error('original'); return 17; };
const previous = r.onInputTrace, trace = installPointerTrace(wine, null);
for (let i = 0; i < 40; i++) assert.equal(r.onInputTrace('down'), 17);
assert.equal(calls, 40);
assert.equal(trace.rows().length, 32);
assert.throws(() => r.onInputTrace('throw'), /original/);
assert.equal(calls, 41);
trace.stop();
assert.equal(r.onInputTrace, previous);
delete r.onInputTrace;
const clock = Date.now;
let time = 100;
Date.now = () => time;
try {
  const timed = installPointerTrace(wine, null);
  r.onInputTrace('first');
  time += 15000;
  r.onInputTrace('expired');
  assert.equal(timed.rows().length, 1);
  timed.stop();
  assert.equal(Object.hasOwn(r, 'onInputTrace'), false);
  const replaced = installPointerTrace(wine, null), replacement = () => 91;
  r.onInputTrace = replacement;
  replaced.stop();
  assert.equal(r.onInputTrace, replacement, 'stop preserves a later owner');
} finally { Date.now = clock; }
assert.equal(forbiddenReads, 0);
console.log('PASS bounded page receipt: no guest reads; original receiver/result/error once; time/count caps and ownership restoration');
