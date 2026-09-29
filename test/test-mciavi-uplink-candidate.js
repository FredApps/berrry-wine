#!/usr/bin/env node

'use strict';

// MCI avivideo (src/09a7h-video-mciavi.wat) end to end on Half-Life Uplink,
// which plays media\intro.avi (RLE8 320x240, 25 fps, PCM) through
//   open ... type AVIVideo alias sierravideo parent H style child wait
//   mciGetDeviceIDA("sierravideo")
//   window / put destination / seek to start / break on 27 wait
//   play sierravideo wait            <- parks on its thunk until the end
//   stop / close
// Checks every command succeeds, that "play wait" really blocks (the call
// re-enters many times instead of returning at once), that the movie runs to
// its end, and that the frames land in the child window.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const AVI = path.join(ROOT,
  'test/binaries/candidates/half-life-uplink-installer/installed/media/intro.avi');

if (!fs.existsSync(AVI)) {
  console.log('SKIP test-mciavi-uplink-candidate: Half-Life Uplink is not installed');
  process.exit(0);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mciavi-uplink-'));
const shot = path.join(out, 'mid.png');
// 20 ms of guest time per batch: the movie is 53.8 s, so it is ~2700 batches
// long and batch 1350 is a few hundred batches into it.
const args = [
  'test/run.js', '--app=halflife_uplink', '--no-build', '--quiet-api',
  '--trace-api=mciSendStringA,mciGetDeviceIDA', '--tick-ms-per-batch=20',
  '--max-batches=4000', '--max-seconds=150', '--no-close',
  `--input=1350:png:${shot}`,
];
const run = spawnSync(process.execPath, args, {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 200000,
});
const log = `${run.stdout || ''}${run.stderr || ''}`;
fs.writeFileSync(path.join(out, 'run.log'), log);
assert.strictEqual(run.status, 0, `run.js exited ${run.status}; log in ${out}`);

// Pair every traced call with its result line.
const calls = [];
const lines = log.split('\n');
for (let i = 0; i < lines.length; i++) {
  const m = /\] (mciSendStringA|mciGetDeviceIDA)\((?:lpszCommand|pszDevice)="([^"]*)"/.exec(lines[i]);
  if (!m) continue;
  const r = /^\s*=> (-?\d+)/.exec(lines[i + 1] || '');
  calls.push({ api: m[1], text: m[2], ret: r ? Number(r[1]) : null });
}
const firstIs = (prefix) => calls.find(c => c.text.startsWith(prefix));

const open = firstIs('open media\\intro.avi');
assert(open, `the app opened its intro movie; log in ${out}`);
assert.strictEqual(open.ret, 0, 'open avivideo succeeds');
const id = calls.find(c => c.api === 'mciGetDeviceIDA' && c.text === 'sierravideo');
assert(id && id.ret >= 0x7F00, `mciGetDeviceIDA finds the WAT device (got ${id && id.ret})`);
for (const cmd of ['window sierravideo', 'put sierravideo', 'seek sierravideo', 'break sierravideo']) {
  const c = firstIs(cmd);
  assert(c, `the app sent "${cmd} ..."`);
  assert.strictEqual(c.ret, 0, `"${c.text}" succeeds`);
}
const plays = calls.filter(c => c.text === 'play sierravideo wait');
assert(plays.length > 100,
  `"play wait" blocks across many turns (${plays.length} entries)`);
const stop = firstIs('stop sierravideo');
const close = firstIs('close sierravideo');
assert(stop && stop.ret === 0, 'the play returned and the app stopped the device');
assert(close && close.ret === 0, 'the device closed');

// Mid-movie: the 320x240 child at (160,120) holds a non-uniform picture.
const png = PNG.sync.read(fs.readFileSync(shot));
const seen = new Set();
for (let y = 120; y < 360; y += 2) {
  for (let x = 160; x < 480; x += 2) {
    const o = (y * png.width + x) * 4;
    seen.add((png.data[o] << 16) | (png.data[o + 1] << 8) | png.data[o + 2]);
  }
}
assert(seen.size >= 8, `the movie paints into its window (${seen.size} colours mid-play)`);

console.log(`PASS test-mciavi-uplink-candidate: ${plays.length} play-wait turns, ` +
  `${seen.size} colours mid-movie`);
