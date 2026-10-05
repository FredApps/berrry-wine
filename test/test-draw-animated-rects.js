#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { createCanvas } = require('../lib/canvas-compat');
const { Win98Renderer } = require('../lib/renderer');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (global $animated_test_delta (mut i32) (i32.const 0))

  (func (export "animated_call")
      (param $stack i32) (param $hwnd i32) (param $kind i32)
      (param $from i32) (param $to i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $handle_DrawAnimatedRects
      (local.get $hwnd) (local.get $kind) (local.get $from) (local.get $to)
      (i32.const 0) (i32.const 0))
    (global.set $animated_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $stack)))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "animated_delta") (result i32)
    (global.get $animated_test_delta))
  (func (export "animated_set_last_error") (param $value i32)
    (global.set $last_error (local.get $value)))
  (func (export "animated_last_error") (result i32)
    (global.get $last_error))

  (func (export "animated_make_window") (param $style i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $hwnd) (local.get $style)))
    (local.get $hwnd))

  (export "animated_sparse_map" (func $virtual_map_commit))
  (export "animated_g2w" (func $g2w))
`;

function writeRect(e, ptr, values) {
  values.forEach((value, index) => e.guest_write32(ptr + index * 4, value));
}

function pixel(canvas, x, y) {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
}

(async () => {
  const row = apiTable.find(entry => entry.name === 'DrawAnimatedRects');
  assert(row, 'DrawAnimatedRects is registered');
  assert.strictEqual(row.nargs, 4, 'DrawAnimatedRects retains its four-argument ABI');
  assert.strictEqual(row.convention, 'stdcall');
  assert.strictEqual(row.stub, undefined, 'DrawAnimatedRects is a real handler');

  const calls = [];
  let hostResult = 1;
  const harness = await bootRenderHarness({
    fonts: 'none',
    extraWat,
    extraHostOverrides: {
      draw_animated_rects(...args) {
        calls.push(args);
        return hostResult;
      },
    },
  });
  const e = harness.exports;
  const stack = 0x074ff000;
  const hwnd = e.animated_make_window(0x10000000) >>> 0;

  const sparsePage = 0x30000000;
  assert.strictEqual(e.animated_sparse_map(sparsePage, 0x1000) >>> 0, sparsePage);
  assert.strictEqual(e.animated_sparse_map(0x28000000, 0x3000) >>> 0, 0x28000000);
  assert.strictEqual(e.animated_sparse_map(sparsePage + 0x1000, 0x1000) >>> 0,
    sparsePage + 0x1000);
  assert.notStrictEqual(
    (e.animated_g2w(sparsePage + 0xfff) + 1) >>> 0,
    e.animated_g2w(sparsePage + 0x1000) >>> 0,
    'fixture puts adjacent guest pages in non-contiguous host backing');
  const from = sparsePage + 0xff8;
  const toPage = 0x31000000;
  assert.strictEqual(e.animated_sparse_map(toPage, 0x1000) >>> 0, toPage);
  const to = toPage + 0x80;
  writeRect(e, from, [-7, 11, 31, 47]);
  writeRect(e, to, [220, 0, 392, 234]);

  e.animated_set_last_error(0x12345678);
  assert.strictEqual(e.animated_call(stack, hwnd, 1, from, to), 1,
    'Win98 RegEdit legacy animation selector succeeds');
  assert.strictEqual(e.animated_delta(), 20, 'stdcall pops return address and four arguments');
  assert.strictEqual(e.animated_last_error() >>> 0, 0x12345678,
    'success leaves last error untouched');
  assert.deepStrictEqual(calls.pop(),
    [hwnd, 1, -7, 11, 31, 47, 220, 0, 392, 234],
    'non-affine sparse RECTs are copied field-by-field into scalar host arguments');

  for (const kind of [2, 3]) {
    assert.strictEqual(e.animated_call(stack, hwnd, kind, from, to), 1,
      `legacy animation selector ${kind} succeeds`);
    assert.strictEqual(calls.pop()[1], kind);
  }
  const beforeRejects = calls.length;
  for (const kind of [0, 4, -1]) {
    assert.strictEqual(e.animated_call(stack, hwnd, kind, from, to), 0,
      `animation selector ${kind} is rejected`);
    assert.strictEqual(e.animated_delta(), 20);
  }
  assert.strictEqual(e.animated_call(stack, 0x12345678, 1, from, to), 0,
    'invalid HWND is rejected');
  assert.strictEqual(e.animated_call(stack, hwnd, 1, 0, to), 0,
    'NULL source RECT is rejected');
  assert.strictEqual(e.animated_call(stack, hwnd, 1, 0x32000000, to), 0,
    'unmapped source RECT is rejected');
  assert.strictEqual(calls.length, beforeRejects,
    'invalid calls never reach the browser host');
  assert.strictEqual(e.animated_last_error() >>> 0, 0x12345678,
    'failure also leaves last error untouched');

  hostResult = 0;
  assert.strictEqual(e.animated_call(stack, hwnd, 1, from, to), 0,
    'host animation failure propagates');
  assert.strictEqual(e.animated_delta(), 20);
  hostResult = 1;
  writeRect(e, from, [4, 4, 4, 4]);
  assert.strictEqual(e.animated_call(stack, hwnd, 1, from, to), 1,
    'degenerate endpoints remain valid USER inputs');

  // Exercise the real host geometry path. RegEdit supplies main-client
  // coordinates, so its right-pane destination begins at 24+220,62+0.
  const geometry = await bootRenderHarness({ fonts: 'none', extraWat });
  const hostCalls = [];
  geometry.renderer.animateCaptionRect = (...args) => {
    hostCalls.push(args);
    return true;
  };
  geometry.renderer.windows[0x20000] = {
    hwnd: 0x20000, isChild: false, x: 20, y: 20, w: 400, h: 300,
    clientRect: { x: 24, y: 62, w: 392, h: 234 },
  };
  assert.strictEqual(geometry.host.draw_animated_rects(
    0x20000, 1, 0, 0, 100, 100, 220, 0, 392, 234), 1);
  assert.deepStrictEqual(hostCalls.pop(), [
    { left: 24, top: 62, right: 124, bottom: 162 },
    { left: 244, top: 62, right: 416, bottom: 296 },
    { x: 0, y: 0, w: 640, h: 480 },
    1,
  ], 'top-level coordinates use its client origin and clip to the desktop');

  geometry.renderer.windows[0x20001] = {
    hwnd: 0x20001, isChild: true, parentHwnd: 0x20000,
    x: 10, y: 20, w: 80, h: 60,
    clientRect: { x: 34, y: 82, w: 80, h: 60 },
  };
  assert.strictEqual(geometry.host.draw_animated_rects(
    0x20001, 3, -20, -20, 10, 10, 0, 0, 80, 60), 1);
  assert.deepStrictEqual(hostCalls.pop(), [
    { left: 14, top: 62, right: 44, bottom: 92 },
    { left: 34, top: 82, right: 114, bottom: 142 },
    { x: 24, y: 62, w: 392, h: 234 },
    3,
  ], 'child coordinates use its client origin and clip to its parent client');

  // Renderer animation is scheduled, interpolated and erased without keeping
  // a timer alive in headless mode or changing a guest backing surface.
  const canvas = createCanvas(80, 60);
  const renderer = new Win98Renderer(canvas);
  assert.strictEqual(renderer.animateCaptionRect(
    { left: 1, top: 1, right: 5, bottom: 5 },
    { left: 2, top: 2, right: 6, bottom: 6 },
    { x: 0, y: 0, w: 80, h: 60 }, 1), true);
  assert.strictEqual(renderer._animatedRect, null,
    'headless validation does not retain an unscheduled outline');

  renderer._isNode = false;
  const frames = [];
  const queue = [];
  renderer._animatedRectRaf = callback => queue.push(callback);
  renderer.repaint = function repaintAnimationTest() {
    this.surface.fill(0, 0, 80, 60, '#202020');
    this._paintAnimatedRect();
    frames.push(this._animatedRect ? { ...this._animatedRect.current } : null);
  };
  assert.strictEqual(renderer.animateCaptionRect(
    { left: 10, top: 10, right: 30, bottom: 30 },
    { left: 30, top: 20, right: 60, bottom: 50 },
    { x: 15, y: 5, w: 55, h: 50 }, 1), true);
  assert.strictEqual(queue.length, 1, 'browser path schedules its first frame');
  queue.shift()(0);
  assert.deepStrictEqual(frames.at(-1), { left: 10, top: 10, right: 30, bottom: 30 });
  assert.deepStrictEqual(pixel(canvas, 15, 10), [223, 223, 223, 255],
    'wire frame is inverted where it intersects the parent clip');
  assert.deepStrictEqual(pixel(canvas, 14, 10), [32, 32, 32, 255],
    'wire frame cannot escape the parent clip');
  assert.deepStrictEqual(pixel(canvas, 20, 20), [32, 32, 32, 255],
    'wire frame leaves its interior untouched');
  queue.shift()(90);
  assert.deepStrictEqual(frames.at(-1), { left: 20, top: 15, right: 45, bottom: 40 },
    'half-duration frame linearly interpolates every edge');
  queue.shift()(180);
  assert.deepStrictEqual(frames.at(-1), { left: 30, top: 20, right: 60, bottom: 50 },
    'destination remains visible for one complete frame');
  queue.shift()(196);
  assert.strictEqual(frames.at(-1), null, 'following frame clears the transient overlay');
  assert.deepStrictEqual(pixel(canvas, 30, 20), [32, 32, 32, 255],
    'clear frame restores compositor pixels beneath the outline');

  assert.strictEqual(renderer.animateCaptionRect(
    { left: 1, top: 1, right: 4, bottom: 4 },
    { left: 5, top: 5, right: 8, bottom: 8 },
    { x: 0, y: 0, w: 80, h: 60 }, 1), true);
  const stale = queue.shift();
  assert.strictEqual(renderer.animateCaptionRect(
    { left: 40, top: 10, right: 50, bottom: 20 },
    { left: 50, top: 20, right: 60, bottom: 30 },
    { x: 0, y: 0, w: 80, h: 60 }, 1), true);
  const replacement = renderer._animatedRect;
  stale(0);
  assert.strictEqual(renderer._animatedRect, replacement,
    'a stale callback cannot advance or clear a replacement animation');

  console.log('DrawAnimatedRects WAT validation, host geometry, and renderer animation: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
