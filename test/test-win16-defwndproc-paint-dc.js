#!/usr/bin/env node
'use strict';

// Tetravex (Entertainment Pack) passes every WM_PAINT to DefWindowProc. The
// 32-bit default paint does its own BeginPaint/EndPaint and sends
// WM_ERASEBKGND to the 16-bit window procedure with the DC narrowed into the
// Win16 handle map. That DC was released on the 32-bit side but its narrow
// slot never was, so each paint burned one of the 4096 slots and $win16_h16
// trapped at batch ~20300 (found by tools/crash-sweep.js). This run goes well
// past that point.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { APPS } = require('../lib/apps');
const exe = APPS.wep16_tetravex && path.join(ROOT, APPS.wep16_tetravex.exe);
const OPTIONAL_WASM = process.env.WINE_ASSEMBLY_WASM || '';

if (!exe || !fs.existsSync(exe)) {
  console.log('SKIP  Tetravex (wep16_tetravex) is not installed');
  process.exit(0);
}

const args = [path.join(ROOT, 'test', 'run.js'), '--app=wep16_tetravex',
  '--max-batches=26000', '--quiet-api', '--quiet-blocks'];
if (OPTIONAL_WASM) args.push('--no-build', `--wasm=${OPTIONAL_WASM}`);

const output = execFileSync(process.execPath, args, {
  cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 256 * 1024 * 1024,
});

// 0xCA16A9F4 is the marker $win16_h16 logs just before trapping on a full map.
assert.doesNotMatch(output, /0xca16a9f4/i,
  'the Win16 handle map must not fill with DCs DefWindowProc already released');
assert.doesNotMatch(output, /\*\*\* CRASH|UNIMPLEMENTED API|RuntimeError/,
  'Tetravex must keep running past the batch-20300 handle-map exhaustion');
const batches = [...output.matchAll(/(\d+) batches in /g)].pop();
assert.ok(batches && +batches[1] >= 26000, `run should reach 26000 batches (got ${batches && batches[1]})`);

console.log('PASS test-win16-defwndproc-paint-dc');
