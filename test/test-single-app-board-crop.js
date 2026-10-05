#!/usr/bin/env node
// Where a `contain`-cropped board lands on a phone, per orientation.
//
// Three reports from a real iPhone, all Rattler Race (app id `snake`,
// lib/apps.js), all about the same function -- the `contain` branch of
// Win98Renderer._computeSingleAppZoom:
//
//   1. Fill cut the tops off the snake-head life icons and kept the 3px window
//      border down each side. That is the registry crop's business, and it is
//      pinned here against the app entry so a future edit to those fractions
//      has to answer for the score panel.
//   2. Fit in PORTRAIT stood the picture off both side edges -- 27 CSS px of
//      desktop teal each side on the device. Portrait is the orientation the
//      phone is narrow in; teal there is never the answer. The picture takes
//      the full width and its foot passes under the floating pad, which is
//      buttons and not a wall.
//   3. Fit in LANDSCAPE was letterboxed left and right whatever it did, and
//      spent 41 of the window's 352 rows on caption and menu bar. The scarce
//      axis there is height, so that chrome comes off and the same picture
//      comes back 12% bigger.
//
// The numbers below are the real ones, read off a rendered frame: Rattler's
// window is 266x352, its menu shadow is row 39, its client rect is x 3..262 /
// y 41..347, its life icons start at row 46 and its playfield wall runs
// x 3..262 / y 81..347.

const assert = require('assert');
const path = require('path');

const { Win98Renderer } = require('../lib/renderer');
const apps = require('../lib/apps.js');

// --- the registry crop, against the artwork it was measured from ------------

const crop = apps.APPS.snake && apps.APPS.snake.mobileCrop;
assert(crop && crop.contain, 'snake must still declare a contain crop');

const W = 266, H = 352;
const left = crop.x * W, right = (crop.x + crop.w) * W;
const top = crop.y * H, bottom = (crop.y + crop.h) * H;

// Content, measured off a rendered frame. None of it may be cut.
assert(top <= 46, `the life icons start at window row 46; crop starts at ${top}`);
assert(bottom >= 348, `the playfield wall's last row is 347; crop ends at ${bottom}`);
assert(left <= 3 && right >= 263,
  `the playfield wall is x 3..262 and the score readout reaches x 259; ` +
  `crop is ${left}..${right}`);
// Furniture, which is what a crop is for. Keeping every pixel of it is the
// same as having no crop at all.
assert(top > 39, 'the menu bar and its shadow (row 39) are not game');
assert(left >= 1 && right <= W - 1, 'the 3D window border is not game either');

// --- placement -------------------------------------------------------------

function makeRenderer(canvasW, canvasH, outputW, outputH, area) {
  const r = new Win98Renderer({ width: canvasW, height: canvasH, getContext() { return {}; } });
  r.singleAppMode = true;
  r.presentationCanvas = { width: outputW, height: outputH };
  r.touchOverlay = { getBoardArea: () => area };
  r.mobileCrop = crop;
  return r;
}
// Rattler's real chrome: 3px of border each side, 41px of caption + menu bar,
// leaving the 260x307 client the phone reports.
const win = (x, y, w, h, chromeW = 3, chromeT = 41, chromeB = 4) =>
  ({ hwnd: 0x10001, x, y, w, h, visible: true, className: 'Snake',
    clientRect: { x: x + chromeW, y: y + chromeT, w: w - chromeW * 2, h: h - chromeT - chromeB } });

// The device's own layout, scaled to the headless probe's 375x667 / 667x375:
// portrait leaves a bottom band for the pad, landscape two side rails.
const PORTRAIT_BAND = { x: 0, y: 0, w: 1, h: 463 / 667 };
const LANDSCAPE_RAILS = { x: 0.3, y: 0, w: 0.4, h: 1 };

// Report 2 -- portrait, both modes. Fit spans the short edge, which in
// portrait is the width, and nothing stands off the sides.
for (const mode of ['fit', 'zoom']) {
  const r = makeRenderer(424, 494, 375, 667, PORTRAIT_BAND);
  r.setViewMode(mode);
  const v = r._computeSingleAppZoom([win(158, 71, W, H)]).viewport;
  assert.strictEqual(v.dstX, 0, `${mode}: no teal to the left`);
  assert.strictEqual(v.dstW, 375, `${mode}: the picture spans the screen's width`);
  assert.strictEqual(v.dstY, 0, `${mode}: top-aligned, so the pad hides as little as it can`);
  // Aspect is kept -- the extra height is overflow, never a stretch.
  assert(Math.abs(v.dstW / v.dstH - v.cropW / v.cropH) < 0.01, `${mode}: no distortion`);
  // And it is still on the screen: running under the buttons is allowed,
  // running off the bottom edge is not.
  assert(v.dstY + v.dstH <= 667, `${mode}: the foot of the picture is still on screen`);
}

// Report 1 -- the portrait Fill crop is the registry's, ungrown: spanning the
// width leaves nothing to grow INTO, and growth here could only put the window
// border back.
{
  const r = makeRenderer(424, 494, 375, 667, PORTRAIT_BAND);
  r.setViewMode('zoom');
  const v = r._computeSingleAppZoom([win(158, 71, W, H)]).viewport;
  assert.strictEqual(v.cropX, 158 + 3, 'the left window border is cropped away');
  assert.strictEqual(v.cropW, 260, 'and the right one with it');
  // Vertically the crop may still GROW, out into the window's own chrome,
  // when that is what fills the band -- growth never cuts. What it may not do
  // is start below the life icons.
  assert(v.cropY <= 71 + 44, `the life icons are whole (cropY ${v.cropY})`);
  assert(v.cropY + v.cropH >= 71 + 348, 'and the playfield wall with them');
}

// The same window on the device's own band (the pad takes a little more of a
// real phone than of the probe's viewport), where the crop is now NARROWER
// than the hole. That is the case report 2 is about, and Fill must answer it
// the same way Fit does rather than falling back to teal sides.
{
  const r = makeRenderer(424, 494, 375, 667, { x: 0, y: 0, w: 1, h: 0.597 });
  r.setViewMode('zoom');
  const v = r._computeSingleAppZoom([win(158, 71, W, H)]).viewport;
  assert.strictEqual(v.dstX, 0, 'no teal to the left in portrait, in either mode');
  assert.strictEqual(v.dstW, 375, 'the picture spans the width');
  assert.strictEqual(v.cropW, 260, 'and the window border stays cropped away');
  assert.strictEqual(v.cropY, 71 + 44, 'ungrown, because there is nothing to grow into');
}

// Report 3 -- landscape Fit sheds the caption and menu bar, and is bigger for
// it. The comparison is against the same window fitted whole.
{
  const r = makeRenderer(667, 375, 667, 375, LANDSCAPE_RAILS);
  r.setViewMode('fit');
  const v = r._computeSingleAppZoom([win(158, 11, W, H)]).viewport;
  assert.strictEqual(v.cropY, 11 + 41, 'Fit starts at the client, not at the caption');
  assert.strictEqual(v.cropH, 307, 'and the whole client is still there');
  assert(v.cropY <= 11 + 44 && v.cropY + v.cropH >= 11 + 348,
    'so every row the crop calls content survives');
  assert.strictEqual(v.dstH, 375, 'it spans the screen height -- the short edge');
  const whole = Math.round(375 * W / H);   // 283: what fitting the window gives
  assert(v.dstW > whole * 1.1,
    `shedding furniture should buy magnification (${v.dstW} vs ${whole})`);
  assert(v.dstW <= 667, 'without running off the sides');
}

// ...but a dialog or an open menu is painted on the desktop outside the
// owner's client rect, and shedding chrome would cut it away. Two windows in
// the union is enough to turn the trim off.
{
  const r = makeRenderer(667, 375, 667, 375, LANDSCAPE_RAILS);
  r.setViewMode('fit');
  const v = r._computeSingleAppZoom([win(158, 11, W, H), win(120, 5, 200, 120)]).viewport;
  assert(v.cropY <= 5, 'the dialog caption is not shed with the owner\'s');
}

// Funtris' 410x724 is very nearly the screen's own shape, so spanning the
// width is free: it reaches the bottom edge and no further.
{
  const r = makeRenderer(424, 800, 375, 667, PORTRAIT_BAND);
  r.mobileCrop = { x: 0.028, y: 0.19, w: 0.935, h: 0.68, contain: true };
  r.setViewMode('fit');
  const v = r._computeSingleAppZoom([win(0, 0, 410, 724)]).viewport;
  assert.strictEqual(v.dstW, 375, 'no teal beside a window this shape either');
  assert(v.dstY + v.dstH <= 667, 'and it stays on the screen');
}

// The guard. A window TALLER than the output's own aspect cannot span the
// width without falling off the bottom, and `contain` promised it would not be
// cut -- so that one letterboxes instead.
{
  const r = makeRenderer(424, 800, 375, 667, PORTRAIT_BAND);
  r.mobileCrop = { x: 0, y: 0, w: 1, h: 1, contain: true };
  r.setViewMode('fit');
  const v = r._computeSingleAppZoom([win(0, 0, 300, 700)]).viewport;
  assert(v.dstY + v.dstH <= 667, 'the foot of the picture is on the screen');
  assert(v.dstW < 375, 'which here means letterboxed rather than cut');
}

// A LANDSCAPE window already as wide as the screen keeps its menu bar: the fit
// is width-limited, so cutting rows off it would buy nothing and lose a bar
// the player can still tap.
{
  const r = makeRenderer(800, 420, 740, 390, { x: 0.28, y: 0, w: 0.45, h: 1 });
  r.mobileCrop = { x: 0.03, y: 0.18, w: 0.49, h: 0.71, contain: true };
  r.setViewMode('fit');
  const v = r._computeSingleAppZoom([win(0, 0, 740, 390)]).viewport;
  assert.strictEqual(v.cropY, 0, 'nothing is shed from a window that fills the width');
  assert.strictEqual(v.dstW, 740);
  assert.strictEqual(v.dstH, 390);
}

console.log('PASS  single-app board crop: Rattler score panel, portrait width, landscape furniture');
