#!/usr/bin/env node
'use strict';

// WinBoard's engine-input thread hands GNUChess's output to the main window
// with a cross-thread SendMessage. Under --threads (a node worker per guest
// thread) that send used to be dispatched into the main thread at whatever
// point its last slice stopped -- in the middle of WinBoard's own redraw --
// so after 1.e4 the e2 square still drew a white pawn and the last-move
// highlights stayed on e2/e4. Windows only delivers such a send inside a
// message call; ThreadManager now holds a Worker sender until main is at
// one. This plays 1.e4 cooperatively and with --threads and requires the e2
// square to look the same (empty, no highlight) in both: the engine may
// choose different replies, but e2 is White's square in every one of them.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { diffPng } = require('../tools/png-diff');

const ROOT = path.join(__dirname, '..');
const { APPS } = require('../lib/apps');
const app = APPS.winboard;
const exe = app && path.join(ROOT, 'test', app.exe);
if (!exe || !fs.existsSync(exe) ||
    !fs.existsSync(path.join(path.dirname(exe), 'GNUChess.exe'))) {
  console.log('SKIP  WinBoard / GNUChess.exe are not installed');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winboard-repaint-'));
function play(mode) {
  const png = path.join(dir, `${mode}.png`);
  const args = [path.join(ROOT, 'test', 'run.js'), '--app=winboard', '--quiet-api',
    '--quiet-blocks', '--stuck-after=0', '--max-seconds=35', '--max-batches=100000000',
    '--tick-ms-per-batch=2', `--${mode}`, '--no-close',
    // e2 then e4 on the default board (47px squares from x=30, y=105).
    '--input=100500:mousedown:241:410,100600:mouseup:241:410,101500:mousedown:241:316,101600:mouseup:241:316',
    `--png=${png}`];
  if (process.env.WINE_ASSEMBLY_WASM) args.push('--no-build', `--wasm=${process.env.WINE_ASSEMBLY_WASM}`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.doesNotMatch(out, /UNIMPLEMENTED API|\*\*\* CRASH/, `${mode}: no trap`);
  assert.ok(fs.existsSync(png), `${mode}: a capture was written`);
  return png;
}

const coop = play('no-threads');
const threads = play('threads');
const d = diffPng(coop, threads, { region: { x: 220, y: 390, w: 40, h: 40 }, tolerance: 8 });
assert.ok(!d.sizeMismatch, 'both captures are the same size');
assert.strictEqual(d.changed, 0,
  `the e2 square must draw the same under --threads as cooperatively (${d.changed} pixels differ)`);
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS test-winboard-threads-repaint');
