#!/usr/bin/env node

// Paint's docked child bars share the frame's backing surface. Hiding the
// Color Box makes the frame repaint its client area, but the still-visible
// status bar must be repainted afterward instead of becoming a flat gray strip.

'use strict';

const assert = require('assert');
const fs = require('fs');
const { diffPng } = require('../tools/png-diff');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'mspaint.exe');
const OUT = path.join(ROOT, 'scratch', 'mspaint-dock-toggle');
const shots = Object.fromEntries(['initial', 'colors-off', 'colors-on']
  .map(name => [name, path.join(OUT, `${name}.png`)]));

if (!fs.existsSync(EXE)) {
  console.log('SKIP  mspaint.exe not found at', EXE);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const file of Object.values(shots)) {
  try { fs.unlinkSync(file); } catch (_) {}
}

const input = [
  `14:png:${shots.initial}`,
  '16:0x111:59416',
  `21:png:${shots['colors-off']}`,
  '23:0x111:59416',
  `29:png:${shots['colors-on']}`,
  '30:dump-windows:dock-toggle',
  '31:stop',
].join(',');

let output = '';
let runFailed = false;
try {
  output = execFileSync(process.execPath, [
    RUN,
    `--exe=${EXE}`,
    `--input=${input}`,
    '--max-batches=33',
    '--batch-size=50000',
    '--no-close',
    '--quiet-api',
    '--quiet-blocks',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
} catch (error) {
  runFailed = true;
  output = `${error.stdout || ''}${error.stderr || ''}`;
}

assert(!runFailed, `Paint dock-toggle run failed:\n${output.slice(-3000)}`);
for (const file of Object.values(shots)) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 0, `missing screenshot: ${file}`);
}

const images = Object.fromEntries(Object.entries(shots)
  .map(([name, file]) => [name, PNG.sync.read(fs.readFileSync(file))]));

function statusDifference(a, b) {
  // Paint's initial 269x23 status child occupies this screen rectangle.
  const result = diffPng(a, b, { includeAlpha: false,
    region: { x: 23, y: 393, w: 269, h: 23 } });
  assert(!result.sizeMismatch, 'cannot compare differently sized Paint frames');
  return result.changed;
}

const hiddenDifference = statusDifference(images.initial, images['colors-off']);
const restoredDifference = statusDifference(images.initial, images['colors-on']);
assert(hiddenDifference <= 10,
  `hiding Color Box overwrote ${hiddenDifference} visible status-bar pixels`);
assert(restoredDifference <= 10,
  `showing Color Box left ${restoredDifference} status-bar pixels overwritten`);
// The canvas grows by the 49px Color Box dock height. Its horizontal bar
// must move with the bottom edge, replacing pixels formerly owned by the
// palette. Status-only checks miss this stale-palette/non-client regression.
function scrollbar(image, y) {
  const crop = new PNG({ width: 206, height: 16 });
  PNG.bitblt(image, crop, 83, y, 206, 16, 0, 0);
  return crop;
}
const initialBar = scrollbar(images.initial, 326);
const hiddenBar = diffPng(initialBar, scrollbar(images['colors-off'], 375),
  { includeAlpha: false }).changed;
const restoredBar = diffPng(initialBar, scrollbar(images['colors-on'], 326),
  { includeAlpha: false }).changed;
assert.strictEqual(hiddenBar, 0, 'resized canvas must repaint its relocated horizontal scrollbar');
assert.strictEqual(restoredBar, 0, 'restoring Color Box must restore the horizontal scrollbar');
assert(/window:dock-toggle .*class="msctls_statusbar32".*visible=true/.test(output),
  'Paint status child was not visible after Color Box toggle');
assert(!/UNIMPLEMENTED API:|RuntimeError|LinkError|CRASH/.test(output),
  'Paint dock toggle triggered an emulator failure');

console.log(`PASS  Paint Color Box toggle preserves status pixels (${hiddenDifference}/${restoredDifference} changed)`);
console.log(`PASS  Paint scrollbar follows resized canvas (${hiddenBar}/${restoredBar} changed)`);
