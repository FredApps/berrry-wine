#!/usr/bin/env node
'use strict';
// Civilization II MGE's opening movie, from the registry entry alone
// (`--app=civ2_mge`, no overlay, no --media-mount). Three things have to hold
// at once, and each one broke on its own:
//
//   1. The registered CUE is mixed-mode, and its data track is the disc the
//      game reads D:\civ2\video\opening.avi from. The registry mount used to
//      mount only the audio tracks, so the movie was simply not there.
//   2. The movie is IV41, decoded by Intel's ir41_32.dll behind the
//      installable-driver ICM path (registry Drivers32 vidc.iv41).
//   3. Civ2 paces video off waveOutGetPosition and refills audio only on
//      MM_WOM_DONE to its CALLBACK_WINDOW. The host read the callback from
//      stale pre-allocator addresses, never posted WOM_DONE, and the movie
//      froze after its first 8 buffers (1.49s).
//
// The retail disc and Intel's DLL are not in the repository: SKIP without them
// (indeo/ comes from the recipe in docs/re-notes/civilization-2-mge.md).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CIV = path.join(ROOT, 'test/binaries/candidates/civilization-2-mge-win32');
function skip(why) { console.log(`SKIP  ${why}`); process.exit(0); }
if (!fs.existsSync(path.join(CIV, 'installed/civ2.exe'))) skip('Civ2 MGE is not installed locally');
if (!fs.existsSync(path.join(CIV, 'Civilization II - Multiplayer Gold Edition (USA) (Track 01).bin'))) {
  skip('the Civ2 MGE CD image is not present');
}
if (!fs.existsSync(path.join(CIV, 'indeo/ir41_32.dll'))) skip('no indeo/ir41_32.dll (Indeo install recipe)');
let PNG;
try { ({ PNG } = require('pngjs')); } catch (_) { skip('pngjs is not installed'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'civ2-mge-movie-'));
try {
  const shots = [1300, 1390].map(b => ({ batch: b, file: path.join(tmp, `movie-${b}.png`) }));
  // Batch 1210 answers the one-time Diplomatic Heralds prompt (its OK
  // button); the movie starts right after it.
  const r = spawnSync('node', [path.join(__dirname, 'run.js'), '--app=civ2_mge', '--no-build',
    '--quiet-api', '--trace-api=AVIFileOpenA,waveOutWrite', '--screen=800x600', '--no-close',
    '--batch-size=100000', '--tick-ms-per-batch=20', '--max-batches=1400', '--max-seconds=150',
    `--input=1200:mousemove:403:387,1210:mousedown:403:387,1230:mouseup:403:387,` +
      shots.map(s => `${s.batch}:png:${s.file}`).join(',')],
  { cwd: ROOT, encoding: 'utf8', timeout: 200000, maxBuffer: 512 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const LOG = path.join(os.tmpdir(), 'test-civ2-mge-movie.log');
  fs.writeFileSync(LOG, out);
  const fail = (msg) => assert.fail(`${msg} (full log: ${LOG})`);

  if (/UNIMPLEMENTED|\[CRASH\]|eip-zero/i.test(out)) fail('the run crashed');
  if (!/\[cue\] mounted .* label="Civ2:MGE v1\.0" \(\d+ data entries/.test(out)) {
    fail('the CUE data track was not mounted as the disc');
  }
  if (!/\] AVIFileOpenA\(/.test(out)) fail('the game never tried to open its movie');
  const writes = (out.match(/\] waveOutWrite\(/g) || []).length;
  // Eight buffers are queued up front; anything beyond is a refill that only
  // a delivered MM_WOM_DONE triggers.
  if (writes <= 8) fail(`only ${writes} waveOutWrite calls: MM_WOM_DONE never reached the game`);
  // The movie is centred at 640x240 on the 800x600 screen (80,180). It is
  // 8-bit video over a dark starfield, so a frame can hold only a few dozen
  // colours; what proves playback is a picture that keeps changing.
  const frames = shots.map(({ batch, file }) => {
    if (!fs.existsSync(file)) fail(`no capture at batch ${batch}`);
    const cap = PNG.sync.read(fs.readFileSync(file));
    const colours = new Set();
    const px = [];
    for (let y = 180; y < 420; y += 2) {
      for (let x = 80; x < 720; x += 2) {
        const o = (y * cap.width + x) * 4;
        const c = (cap.data[o] << 16) | (cap.data[o + 1] << 8) | cap.data[o + 2];
        colours.add(c);
        px.push(c);
      }
    }
    if (colours.size < 16) fail(`batch ${batch}: movie rectangle has ${colours.size} colours`);
    return { colours: colours.size, px };
  });
  let changed = 0;
  for (let i = 0; i < frames[0].px.length; i++) if (frames[0].px[i] !== frames[1].px[i]) changed++;
  const share = 100 * changed / frames[0].px.length;
  if (share < 1) fail(`the movie did not advance between captures (${share.toFixed(2)}% changed)`);
  console.log(`PASS  Civ2 MGE opening.avi from the registered CD: ${writes} audio buffers, ` +
    `${frames.map(f => f.colours).join('/')} colours, ${share.toFixed(1)}% of the frame changed`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
