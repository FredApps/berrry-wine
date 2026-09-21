#!/usr/bin/env node
'use strict';

// --trace-from=N / --trace-to=N confine every trace category to a window of
// batches. The point is a bug that only shows up deep into a long route: the
// trace flags themselves are affordable, but writing their output for the
// 100,000 batches of boot in front of the question is blocking I/O on the
// thread the guest runs on -- the same cost --quiet-api exists for.
//
// Two halves to the contract, and the second is the one that silently rots:
// per-batch trace output is windowed, and everything OUTSIDE the batch loop
// (setup, the exit summary) is not. A gate that swallowed the summary too
// would still look like it worked on the flag it was added for.

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

const run = (extra) => {
  const r = spawnSync(process.execPath, [
    path.join(__dirname, 'run.js'), '--exe=' + EXE, '--no-build', '--quiet-api',
    '--max-batches=60', '--max-seconds=60', '--trace-fs',
  ].concat(extra), { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return (r.stdout || '') + (r.stderr || '');
};

const ungated = run([]);
const fsLines = (s) => s.split('\n').filter((l) => l.includes('[fs]')).length;

assert.ok(fsLines(ungated) > 0,
  'baseline: --trace-fs alone must produce [fs] lines, or this test proves nothing:\n'
  + ungated.slice(-2000));
assert.ok(/Stats: .* batches/.test(ungated), 'baseline prints the exit summary');

// A window that starts past the end of the run: the category is on, and every
// one of its per-batch lines is dropped.
const past = run(['--trace-from=100000']);
assert.strictEqual(fsLines(past), 0,
  'a window starting past the last batch must drop every [fs] line:\n' + past.slice(-2000));
assert.ok(/\[trace-window\] tracing batches 100000\.\.end/.test(past),
  'the run says which window it is tracing');
// ...but the run is otherwise unchanged. The summary is printed after the
// loop, where the gate is off.
assert.ok(/Stats: .* batches/.test(past),
  'the exit summary is never windowed:\n' + past.slice(-2000));

// A window that covers the whole run behaves like no window at all.
const all = run(['--trace-from=0']);
assert.ok(fsLines(all) > 0,
  '--trace-from=0 must not suppress anything:\n' + all.slice(-2000));

console.log('PASS  --trace-from/--trace-to window per-batch trace output only');
