#!/usr/bin/env node
'use strict';
// An Indeo 4 (IV41) movie decoded by Intel's own ir41_32.dll, running as
// guest x86 behind the installable-driver ICM path in src/09a7g-video-icm.wat.
// There is no WAT Indeo decoder: this is the Windows route, SYSTEM.INI
// [drivers32] VIDC.IV41 -> LoadLibrary -> DriverProc.
//
// The DLL is Intel's and is NOT in the repository. Civilization II MGE ships it
// inside "Win_95nt Indeo/IVI_95NT.EXE"; installing that headless (recipe in
// docs/re-notes/civilization-2-mge.md) leaves c:\windows\system\ir41_32.dll in
// the overlay. Point INDEO_IR41_DLL at that file, or copy it to the gitignored
// test/binaries/candidates/civilization-2-mge-win32/indeo/ir41_32.dll. The test
// SKIPs without it, without Civ2 MGE's ANARCHY0.AVI, or without Half-Life:
// Uplink.
//
// Host: Uplink opens "media\intro.avi" through the MCI avivideo device and
// plays it with `play sierravideo wait` at 0,0 320x240 of its 640x480 window.
// The overlay swaps in ANARCHY0.AVI (480x120 IV41, 111 frames), so every frame
// Uplink shows went through ir41_32's DriverProc. Checks: the play completes
// and stop/close return 0; the movie rectangle mid-play is a picture; and,
// with ffmpeg on PATH, >= 99% of that rectangle is within 24 of the nearest
// ffmpeg `indeo4` frame, point-sampled the way StretchDIBits scales it.
// (Measured 2026-09-28: 99.98% within 24, max delta 27 -- YUV->RGB rounding.)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CIV = path.join(ROOT, 'test/binaries/candidates/civilization-2-mge-win32');
const DLL = process.env.INDEO_IR41_DLL || path.join(CIV, 'indeo/ir41_32.dll');
const AVI = path.join(CIV, 'cd/Civ2/VIDEO/ANARCHY0.AVI');

function skip(why) { console.log(`SKIP  ${why}`); process.exit(0); }
if (!fs.existsSync(DLL)) skip(`no ir41_32.dll at ${DLL} (set INDEO_IR41_DLL)`);
if (!fs.existsSync(AVI)) skip(`no Civ2 MGE movie at ${AVI}`);
const apps = require(path.join(ROOT, 'lib/apps.js'));
const reg = (apps.APPS || apps.apps || apps).halflife_uplink;
if (!reg || !fs.existsSync(path.join(ROOT, reg.exe))) skip('Half-Life: Uplink is not present');

let PNG;
try { ({ PNG } = require('pngjs')); } catch (_) { skip('pngjs is not installed'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-indeo4-'));
try {
  const ovl = path.join(tmp, 'overlay');
  fs.mkdirSync(path.join(ovl, 'blobs'), { recursive: true });
  const files = [
    ['c:\\windows\\system.ini', Buffer.from('[drivers32]\r\nVIDC.IV41=ir41_32.dll\r\n', 'ascii')],
    ['c:\\windows\\system\\ir41_32.dll', fs.readFileSync(DLL)],
    ['c:\\media\\intro.avi', fs.readFileSync(AVI)],
  ];
  const records = files.map(([p, bytes], i) => {
    fs.writeFileSync(path.join(ovl, 'blobs', `f${i}.bin`), bytes);
    return { path: p, kind: 'file', attrs: 128, size: bytes.length, creationTime: null,
             lastAccessTime: null, lastWriteTime: null, blob: `f${i}.bin` };
  });
  fs.writeFileSync(path.join(ovl, 'index.json'), JSON.stringify({ version: 1, records }));

  const shot = path.join(tmp, 'movie.png');
  const r = spawnSync('node', [path.join(__dirname, 'run.js'), '--app=halflife_uplink', '--no-build',
    '--quiet-api', `--overlay-dir=${ovl}`, '--trace-api=mciSendStringA', '--tick-ms-per-batch=20',
    '--max-batches=1300', '--max-seconds=100', '--no-close', `--input=900:png:${shot}`],
    { cwd: ROOT, encoding: 'utf8', timeout: 150000, maxBuffer: 256 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const LOG = path.join(os.tmpdir(), 'test-icm-indeo4-candidate.log');
  fs.writeFileSync(LOG, out);
  const fail = (msg) => {
    console.log(out.split('\n').filter((l) => /crash|unimpl|ca1cd000|eip-zero|error/i.test(l)).slice(0, 20).join('\n'));
    assert.fail(`${msg} (full log: ${LOG})`);
  };
  if (/ca1cd000/i.test(out)) fail('a nested DriverProc call never returned');
  if (/UNIMPLEMENTED|\[CRASH\]|eip-zero/i.test(out)) fail('the run crashed');
  if (!/open media\\intro\.avi type AVIVideo[^\n]*\n\s*=> 0\b/.test(out)) fail('MCI open of the IV41 movie failed');
  if (!/stop sierravideo wait[^\n]*\n\s*=> 0\b/.test(out)) fail('`play wait` never finished (no stop => 0)');
  if (!/close sierravideo wait[^\n]*\n\s*=> 0\b/.test(out)) fail('close did not return 0');
  if (!fs.existsSync(shot)) fail('no capture at batch 900');

  const cap = PNG.sync.read(fs.readFileSync(shot));
  const X = 160, Y = 120, W = 320, H = 240;          // the movie's 0,0 320x240 on the centred 640x480 window
  const px = (dx, dy) => { const o = ((Y + dy) * cap.width + X + dx) * 4; return [cap.data[o], cap.data[o + 1], cap.data[o + 2]]; };
  const colours = new Set();
  for (let dy = 0; dy < H; dy += 3) for (let dx = 0; dx < W; dx += 3) colours.add(px(dx, dy).join(','));
  if (colours.size < 200) fail(`movie rectangle has ${colours.size} colours: not a decoded picture`);

  let ffOk = false;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffOk = true; } catch (_) {}
  if (!ffOk) {
    console.log(`PASS  IV41 via guest ir41_32.dll: played, ${colours.size} colours (ffmpeg absent, no reference compare)`);
    process.exit(0);
  }
  const FW = 480, FH = 120;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', AVI, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 << 20 });
  const frames = Math.floor(raw.length / (FW * FH * 3));
  let best = { f: -1, within: -1, max: 0 };
  for (let f = 0; f < frames; f++) {
    const base = f * FW * FH * 3;
    let within = 0, max = 0;
    for (let dy = 0; dy < H; dy++) {
      const sy = Math.floor(dy * FH / H);
      for (let dx = 0; dx < W; dx++) {
        const sx = Math.floor(dx * FW / W);
        const c = px(dx, dy), o = base + (sy * FW + sx) * 3;
        const d = Math.max(Math.abs(c[0] - raw[o]), Math.abs(c[1] - raw[o + 1]), Math.abs(c[2] - raw[o + 2]));
        if (d <= 24) within++;
        if (d > max) max = d;
      }
    }
    if (within > best.within) best = { f, within, max };
  }
  const share = 100 * best.within / (W * H);
  if (share < 99) fail(`best ffmpeg frame ${best.f} matches only ${share.toFixed(2)}% within 24`);
  console.log(`PASS  IV41 via guest ir41_32.dll: frame ${best.f + 1}/${frames}, ${share.toFixed(2)}% within 24 of ffmpeg indeo4 (max ${best.max})`);
} finally {
  if (process.env.ICM_TEST_KEEP) console.log(`kept ${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
