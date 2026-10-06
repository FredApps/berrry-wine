#!/usr/bin/env node
'use strict';

// WinBoard starts GNUChess with its stdin and stdout redirected through two
// anonymous pipes (CreatePipe + STARTF_USESTDHANDLES). Before
// docs/design-anonymous-pipes.md that trapped in the CreatePipe stub; with
// phase 1 alone it failed its first write with ERROR_NO_DATA because no child
// existed. This runs the real pair: test/run.js forks GNUChess.exe as a
// second emulator process, and the protocol bytes cross the vlan wire in both
// directions.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { APPS } = require('../lib/apps');
const app = APPS.winboard;
const exe = app && path.join(ROOT, 'test', app.exe);
if (!exe || !fs.existsSync(exe) ||
    !fs.existsSync(path.join(path.dirname(exe), 'GNUChess.exe'))) {
  console.log('SKIP  WinBoard / GNUChess.exe are not installed');
  process.exit(0);
}

const args = [path.join(ROOT, 'test', 'run.js'), '--app=winboard', '--quiet-api',
  '--quiet-blocks', '--stuck-after=0', '--max-seconds=25', '--max-batches=100000000',
  '--trace-net'];
if (process.env.WINE_ASSEMBLY_WASM) args.push('--no-build', `--wasm=${process.env.WINE_ASSEMBLY_WASM}`);
const r = spawnSync(process.execPath, args, {
  cwd: ROOT, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024,
});
const out = (r.stdout || '') + (r.stderr || '');

assert.doesNotMatch(out, /UNIMPLEMENTED API|\*\*\* CRASH/, 'no trap on the way');
assert.match(out, /\[pipe\] CreateProcess "GNUChess" -> GNUChess\.exe at 10\.0\.0\.2/,
  'CreateProcess starts a real GNUChess child');
assert.match(out, /\[child 10\.0\.0\.2 GNUChess\.exe\] \[pipe\] std -10 = 0x33/,
  'the child gets a pipe as its standard input');
assert.match(out, /\[child 10\.0\.0\.2 GNUChess\.exe\] \[net\] \.\. arrived DATA 10\.0\.0\.1:\d+ -> 10\.0\.0\.2/,
  "WinBoard's commands reach GNUChess's stdin");
assert.match(out, /^\[net\] \.\. arrived DATA 10\.0\.0\.2:\d+ -> 10\.0\.0\.1/m,
  "GNUChess's output reaches WinBoard");
assert.doesNotMatch(out, /Error writing to first chess program|exited unexpectedly/,
  'WinBoard never sees a dead engine');

console.log('PASS test-winboard-gnuchess-pipes');
