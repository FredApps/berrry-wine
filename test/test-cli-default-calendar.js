#!/usr/bin/env node
'use strict';

// The CLI pins the guest calendar to 1999-06-01T12:00:00Z unless told
// otherwise, so a guest that seeds from the time of day is the same run every
// time. Notepad's F5 (Time/Date) calls GetLocalTime into a stack SYSTEMTIME;
// the harness dumps it and we read wYear/wMonth/wDay.
//   default              -> 1999-06-01
//   --wall-clock-ms=N    -> the date N names
//   --real-calendar      -> today's year

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SYSTEMTIME = '0x074ffdd8';

function localDate(extra) {
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'test/run.js'), '--exe=test/binaries/notepad.exe',
    '--max-batches=40', '--quiet-api',
    `--input=30:keydown:116,31:keyup:116,33:dump-mem:${SYSTEMTIME}:16`, ...extra,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 90000 });
  assert.strictEqual(r.status, 0, `run.js ${extra.join(' ')} exited ${r.status}\n${r.stderr}`);
  const line = r.stdout.split('\n').find((l) => l.trim().toLowerCase().startsWith(SYSTEMTIME));
  assert(line, `no SYSTEMTIME dump in output for ${extra.join(' ')}`);
  const b = line.trim().split(/\s+/).slice(1, 9).map((h) => parseInt(h, 16));
  return { year: b[0] | (b[1] << 8), month: b[2] | (b[3] << 8), day: b[6] | (b[7] << 8) };
}

const def = localDate([]);
assert.deepStrictEqual(def, { year: 1999, month: 6, day: 1 }, 'default calendar is pinned to 1999-06-01');

const pinned = localDate(['--wall-clock-ms=' + Date.parse('2003-02-10T12:00:00Z')]);
assert.deepStrictEqual(pinned, { year: 2003, month: 2, day: 10 }, '--wall-clock-ms wins over the default');

const real = localDate(['--real-calendar']);
assert.strictEqual(real.year, new Date().getFullYear(), '--real-calendar gives today\'s year');

console.log('PASS test-cli-default-calendar');
