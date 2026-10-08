#!/usr/bin/env node
'use strict';

// WinBoard starts GNUChess with its stdin and stdout redirected through two
// anonymous pipes (CreatePipe + STARTF_USESTDHANDLES). Before
// docs/design-anonymous-pipes.md that trapped in the CreatePipe stub; with
// phase 1 alone it failed its first write with ERROR_NO_DATA because no child
// existed. This runs the real pair: test/run.js forks GNUChess.exe as a
// second emulator process, and the protocol bytes cross the vlan wire in both
// directions. The route plays 1.e4 with two clicks on the board and requires
// GNUChess's own reply to come back after it: GNUChess never calls
// WSAStartup, and while the wire pump was gated on Winsock its stdin never
// drained, so it read nothing and never moved.

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
  '--quiet-blocks', '--stuck-after=0', '--max-seconds=40', '--max-batches=100000000',
  '--tick-ms-per-batch=2', '--trace-net',
  // e2 then e4 on the default board (47px squares from x=30, y=105).
  '--input=100500:mousedown:241:410,100600:mouseup:241:410,101500:mousedown:241:316,101600:mouseup:241:316'];
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

// After WinBoard sends the move ("e2e4\n", the last 5-byte frame it writes),
// GNUChess must answer with at least "move xxxx\n".
const lines = out.split('\n');
const moveAt = lines.map((l, i) => (/^\[net\] -> DATA 10\.0\.0\.1:\d+ -> 10\.0\.0\.2:\d+ len=5$/.test(l) ? i : -1))
  .filter(i => i >= 0).pop();
assert.ok(moveAt !== undefined, 'WinBoard sends the human move to GNUChess');
const replyBytes = lines.slice(moveAt)
  .map(l => l.match(/^\[child 10\.0\.0\.2 GNUChess\.exe\] \[net\] -> DATA 10\.0\.0\.2:\d+ -> 10\.0\.0\.1:\d+ len=(\d+)$/))
  .filter(Boolean).reduce((n, m) => n + Number(m[1]), 0);
assert.ok(replyBytes >= 10, `GNUChess replies to the move (${replyBytes} bytes after it)`);

console.log('PASS test-winboard-gnuchess-pipes');
