#!/usr/bin/env node
'use strict';

// End-to-end gameplay gate for the RollerCoaster Tycoon demo. The original
// package is local/gitignored, so this test skips when the fixture is absent.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { diffPng } = require('../tools/png-diff');
const { startControlSession } = require('./control-session');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'binaries', 'shareware', 'rct', 'English', 'RCT.exe');
const SCENARIOS = path.join(ROOT, 'binaries', 'shareware', 'rct', 'Scenarios', 'SC.IDX');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function readPng(filename) {
  return PNG.sync.read(fs.readFileSync(filename));
}

function frameStats(png) {
  const colors = new Set();
  for (let i = 0; i < png.data.length; i += 4) {
    colors.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
  }
  return { width: png.width, height: png.height, colors: colors.size };
}

function changedPixels(a, b, x0 = 0, y0 = 0, x1 = a.width, y1 = a.height) {
  const result = diffPng(a, b, {
    includeAlpha: false,
    region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  });
  assert(!result.sizeMismatch, 'cannot compare differently sized RCT frames');
  return result.changed;
}

function paintedParkPixels(png) {
  // The closed park has no guests or moving rides. Its original camera points
  // mostly off the map, where the viewport uses this dark backdrop colour.
  // Count terrain in the unobstructed right side after recentering via Map.
  let painted = 0;
  for (let y = 32; y < 445; y++) {
    for (let x = 367; x < 640; x++) {
      const i = (y * png.width + x) * 4;
      const rgb = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      if (rgb !== 0x172323) painted++;
    }
  }
  return painted;
}

async function main() {
  if (!fs.existsSync(EXE) || !fs.existsSync(SCENARIOS)) {
    console.log('SKIP RollerCoaster Tycoon gameplay: local demo fixture is absent');
    return;
  }
  assert(sha256(EXE) ===
    'ebeef3544924254ab78cc02d080f67dff4fe44916fd16d57bbc9df37b7bbb0a7',
  'RCT.exe does not match the pinned demo executable');
  assert(sha256(SCENARIOS) ===
    'cc2445201274727c2c64cb798864f2aae72775882a83a3536232bd20c30f1c02',
  'SC.IDX does not match the pinned demo scenario index');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-rct-gameplay-'));
  const frameAPath = path.join(temp, 'park-a.png');
  const frameBPath = path.join(temp, 'park-b.png');
  const constructionPath = process.env.RCT_SCREENSHOT || path.join(temp, 'construction.png');
  const session = startControlSession([
    'test/run.js', '--app=rct', '--control-stdin', '--frozen',
    '--max-seconds=180', '--max-batches=1000000000', '--batch-size=200000',
    '--quiet-api', '--quiet-blocks', '--no-close', '--no-build',
    '--repaint-every=1000000',
  ], { cwd: ROOT, idPrefix: 'r' });
  const { send } = session;

  try {
    await send({ action: 'ping' });
    await send({ action: 'step', n: 3000 });
    await send('click:198:430');
    await send({ action: 'step', n: 200 });
    await send('click:310:166');
    await send({ action: 'step', n: 1000 });
    await send('click:428:157');
    await send({ action: 'step', n: 40 });
    // Forest Frontiers' saved camera initially points at the map edge. In a
    // clean 0fd9aeb7 probe its two park PNGs were identical even while the
    // game-update routine ran 780 times in 120 batches. Open Map with the
    // toolbar, then click inside it to bring terrain into the main viewport.
    await send('click:246:15');
    await send({ action: 'step', n: 40 });
    await send('click:120:160');
    await send({ action: 'step', n: 60 });
    // 0x436234 is the actual game update routine. A static screenshot from a
    // closed, empty park says nothing about whether the simulation is running.
    await send({ action: 'eval', code: 'exports.set_count(0, 0x00436234)' });
    await send({ action: 'png', path: frameAPath });
    await send({ action: 'step', n: 120 });
    const health = await send({ action: 'eval',
      code: '({updates: exports.get_count(0), paused: new Uint8Array(memory.buffer)[g2w(0x8e31a9)]})' });
    await send({ action: 'png', path: frameBPath });
    await send('click:382:15');
    await send({ action: 'step', n: 60 });
    await send({ action: 'png', path: constructionPath });

    const a = readPng(frameAPath);
    const b = readPng(frameBPath);
    const construction = readPng(constructionPath);
    const stats = frameStats(construction);
    const parkChanged = changedPixels(a, b);
    const paintedA = paintedParkPixels(a);
    const paintedB = paintedParkPixels(b);
    const panelChanged = changedPixels(b, construction, 0, 32, 120, 446);
    assert(stats.width === 640 && stats.height === 480 && stats.colors > 100,
      `expected a detailed 640x480 park, got ${JSON.stringify(stats)}`);
    assert(paintedA > 50000 && paintedB > 50000,
      `Forest Frontiers park viewport is mostly off-map: ${paintedA}/${paintedB} painted pixels`);
    assert(health.paused === 0 && health.updates > 10,
      `Forest Frontiers simulation did not advance: ${JSON.stringify(health)}`);
    assert(parkChanged > 10000,
      `Forest Frontiers park view did not change: ${parkChanged} changed pixels`);
    assert(panelChanged > 10000,
      `Path Construction did not open: ${panelChanged} changed panel pixels`);
    assert(!/STUCK|CRASH|RuntimeError|LinkError|UNIMPLEMENTED API:/i.test(session.output()),
      `RCT emitted a failure marker:\n${session.output().slice(-12000)}`);
    console.log(`PASS RCT Forest Frontiers gameplay (${health.updates} game updates, ` +
      `${paintedA}/${paintedB} painted park pixels, ${parkChanged} changed pixels, ` +
      `${panelChanged} construction-panel pixels)`);
    console.log(`  screenshot: ${constructionPath}`);
  } finally {
    await session.quit({ ignoreReplyError: true });
    if (!process.env.RCT_SCREENSHOT) fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
