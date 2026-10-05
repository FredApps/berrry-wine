#!/usr/bin/env node
'use strict';

// --input=B:tick-ms:N changes how much guest time a batch is worth from batch
// B on. A run can then boot on the fast default clock and slow it down only
// for the stage that needs it (Morrowind's Bink videos skip frames forever at
// 200ms/batch). The clock itself is covered by test-batch-clock.js; this checks
// the scheduled-input wiring rebases rather than jumps.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(__dirname, 'binaries', 'notepad.exe');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  notepad.exe not found at ' + EXE);
  process.exit(0);
}

const r = spawnSync(process.execPath, [
  path.join(__dirname, 'run.js'), '--exe=' + EXE, '--no-build', '--quiet-api',
  '--max-batches=40', '--max-seconds=30',
  '--input=10:tick-ms:5,20:tick-ms:50',
], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
const out = (r.stdout || '') + (r.stderr || '');

// 10 batches at the default 200ms, then 10 at 5ms.
const first = /\[input\] tick-ms 5 at batch 10 \(guest (\d+)ms\)/.exec(out);
const second = /\[input\] tick-ms 50 at batch 20 \(guest (\d+)ms\)/.exec(out);
assert.ok(first, 'first tick-ms switch was not applied:\n' + out.slice(-2000));
assert.ok(second, 'second tick-ms switch was not applied:\n' + out.slice(-2000));
assert.strictEqual(Number(first[1]), 2000, 'switch at batch 10 keeps 10 x 200ms');
assert.strictEqual(Number(second[1]), 2050, 'batches 10..20 advanced 5ms each');

console.log('PASS  scheduled tick-ms input rebases the headless clock');
