#!/usr/bin/env node
'use strict';

// Exclusive DirectDraw owns the top-level presentation, but native child
// controls paint into a separate shared GDI surface.  The latter must not
// replace the primary (that regresses the DX SDK samples), and it must not be
// discarded either (that hides AoE I/II's subclassed player-name EDIT).

const assert = require('assert');
const { createCanvas } = require('../lib/canvas-compat');
const { Win98Renderer } = require('../lib/renderer');

const hwnd = 0x10010;
const childHwnd = 0x10013;
const screen = createCanvas(8, 8);
const renderer = new Win98Renderer(screen);
const wasm = { exports: {
  get_dx_exclusive_hwnd: () => hwnd,
  wnd_window_screen_x: target => target === childHwnd ? 2 : target === 0x10020 ? 4 : 0,
  wnd_window_screen_y: target => target === childHwnd ? 3 : target === 0x10020 ? 5 : 0,
} };
const top = renderer.windows[hwnd] = {
  hwnd, x: 0, y: 0, w: 8, h: 8, visible: true, isChild: false, wasm,
};

const dx = createCanvas(8, 8);
dx.getContext('2d').fillStyle = '#ff0000';
dx.getContext('2d').fillRect(0, 0, 8, 8);
const gdi = createCanvas(8, 8);
gdi.getContext('2d').fillStyle = '#0000ff';
gdi.getContext('2d').fillRect(0, 0, 8, 8);
gdi.getContext('2d').fillStyle = '#00ff00';
gdi.getContext('2d').fillRect(2, 3, 3, 2);

assert.strictEqual(renderer.attachWindowSurface(hwnd, dx, true), true);
assert.strictEqual(renderer.attachWindowSurface(hwnd, gdi, false), true);
assert.strictEqual(top._backCanvas, dx,
  'ordinary GDI must not displace an exclusive DirectDraw primary');
assert.strictEqual(top._exclusiveGdiChildCanvas, gdi,
  'the shared GDI surface must survive before a native child exists');

// Real guest workers can attach the process GDI surface before their later
// CreateWindow(EDIT) host call reaches the renderer. The child deliberately
// appears after both surfaces so that ordering cannot hide its pixels.
const child = renderer.windows[childHwnd] = {
  hwnd: childHwnd, x: 2, y: 3, w: 3, h: 2, visible: true,
  isChild: true, parentHwnd: hwnd, wasm,
};

renderer._drawPresentedCanvas(dx, 0, 0, 8, 8);
renderer._compositeExclusiveSharedChildren(top, null);
const pixel = (x, y) => Array.from(screen.getContext('2d').getImageData(x, y, 1, 1).data);
assert.deepStrictEqual(pixel(0, 0), [255, 0, 0, 255],
  'top-level GDI background outside the child must not cover DirectDraw');
assert.deepStrictEqual(pixel(3, 3), [0, 255, 0, 255],
  'native child pixels must composite over DirectDraw inside its window rect');

child.visible = false;
renderer._drawPresentedCanvas(dx, 0, 0, 8, 8);
renderer._compositeExclusiveSharedChildren(top, null);
assert.deepStrictEqual(pixel(3, 3), [255, 0, 0, 255],
  'hiding the child must stop compositing its stale shared pixels');

assert.strictEqual(renderer.detachWindowSurface(hwnd, gdi), true);
assert.strictEqual(top._exclusiveGdiChildCanvas, null,
  'deleting the GDI surface must release the saved child overlay');

// A post-processing source must retain the whole exclusive screen when a
// smaller popup sits at a nonzero origin (Diablo's Replay Intro notice).
const popupCanvas = createCanvas(3, 2);
popupCanvas.getContext('2d').fillStyle = '#00ff00';
popupCanvas.getContext('2d').fillRect(0, 0, 3, 2);
const popup = renderer.windows[0x10020] = {
  hwnd: 0x10020, x: 4, y: 5, w: 3, h: 2, visible: true,
  isChild: false, wasm, _backCanvas: popupCanvas, _gdiWriteSeq: 2,
};
top._gdiWriteSeq = 2;
const composed = renderer._buildExclusivePresentationSource(popup, [top, popup], 1);
assert.strictEqual(composed.width, 8, 'popup must not shrink the full-screen source');
assert.strictEqual(composed.height, 8, 'popup must not crop the full-screen source');
const composedPixel = (x, y) => Array.from(composed.getContext('2d').getImageData(x, y, 1, 1).data);
assert.deepStrictEqual(composedPixel(0, 0), [255, 0, 0, 255],
  'the game must remain visible above the offset popup');
assert.deepStrictEqual(composedPixel(5, 6), [0, 255, 0, 255],
  'popup art must stay at its guest screen coordinates');
assert.deepStrictEqual(composedPixel(5, 7), [255, 0, 0, 255],
  'the popup must not stretch into the rest of the display');

console.log('PASS  native child GDI pixels overlay exclusive DirectDraw by child rect');
