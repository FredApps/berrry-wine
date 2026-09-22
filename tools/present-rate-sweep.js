#!/usr/bin/env node
'use strict';

// Which apps does the present-rate cap ($present_pace) get WRONG?
//
//   node tools/present-rate-sweep.js [--apps=a,b] [--cap=60] [--seconds=8]
//        [--warmup=25] [--list] [--limit=N] [--json=F] [--md=F]
//
// THE FAILURE IT LOOKS FOR. The cap paces a present only when that present
// ends a whole frame: a blit covering more than half the target, or the
// Unlock closing a whole-surface Lock. An app that ends one frame with TWO
// such presents -- locks the whole primary for the background and again for
// the sprites -- is paced twice per frame and runs at cap/2. That is a
// halved game, and it is silent: the app looks like it is simply slow.
//
// The symptom is arithmetic, which is why this is a sweep and not an opinion:
//
//   uncapped  ~437/s   capped  60.0/s   -> OK        (one present per frame)
//   uncapped  ~437/s   capped  30.1/s   -> SUBMULTIPLE x2  (two per frame)
//   uncapped    31/s   capped  31.0/s   -> UNDER_CAP (self-paced, untouched)
//
// Each app runs twice, uncapped then capped, and the rate is WinePerf's
// PRESENT/s -- one count per Flip, per D3D Present, per full blit, per
// Unlock-present -- read back from the page. Runs are serial: two browsers
// on one box measure the box.
//
// WHAT IT CANNOT SEE. It drives no input, so an app is measured wherever it
// parks itself on startup: a title screen, a menu, an attract loop. That is
// a real present loop and a real answer for it, but an app whose fast path is
// only reached in gameplay reads as UNDER_CAP or NOPRESENT here. Those rows
// mean "not measured", not "safe" -- drive them with tools/profile-web-frames
// --guest-script and read the same two numbers.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a === undefined ? dflt : a.slice(name.length + 3);
};
const CAP = Number(opt('cap', 60));
const SECONDS = Number(opt('seconds', 8));
const WARMUP = Number(opt('warmup', 25));
const LIMIT = Number(opt('limit', 0));
const JSON_OUT = opt('json', '');
const MD_OUT = opt('md', '');
const ONLY = (opt('apps', '') || '').split(',').filter(Boolean);

// A present-capable app is one whose executable names a DLL that can reach a
// paced path. A byte scan rather than an import walk on purpose: a game that
// LoadLibrary's ddraw at runtime imports nothing and still presents.
const PRESENT_DLLS = ['ddraw.dll', 'd3d8.dll', 'd3d9.dll', 'd3drm.dll', 'opengl32.dll'];
const scanForDlls = file => {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const hay = buf.toString('latin1').toLowerCase();
  return PRESENT_DLLS.filter(d => hay.includes(d));
};

const { APPS } = require(path.join(ROOT, 'lib', 'apps.js'));

const candidates = [];
for (const [id, app] of Object.entries(APPS)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  if (!app || !app.exe) continue;
  const exe = path.join(ROOT, app.exe.startsWith('binaries/') ? 'test/' + app.exe : app.exe);
  const dlls = ONLY.length ? (scanForDlls(exe) || []) : scanForDlls(exe);
  if (dlls === null) continue;              // exe not on this machine
  if (!ONLY.length && !dlls.length) continue;
  candidates.push({ id, dlls });
}
candidates.sort((a, b) => a.id.localeCompare(b.id));
const apps = LIMIT ? candidates.slice(0, LIMIT) : candidates;

if (argv.includes('--list')) {
  for (const c of apps) console.log(`${c.id.padEnd(28)} ${c.dlls.join(' ')}`);
  console.log(`\n${apps.length} present-capable app(s) of ${Object.keys(APPS).length}`);
  process.exit(0);
}

// PRESENT/s as the page itself counts it, plus a liveness hash so a frozen
// app is not reported as a well-behaved slow one.
const REPORT = `JSON.stringify((() => {
  const s = WinePerf.snapshot();
  const a = runningApps.find(x => x && x.wine);
  const c = document.getElementById('screen');
  let hash = 0;
  try {
    const t = document.createElement('canvas'); t.width = 32; t.height = 24;
    const cx = t.getContext('2d', { willReadFrequently: true });
    cx.drawImage(c, 0, 0, 32, 24);
    const d = cx.getImageData(0, 0, 32, 24).data;
    hash = 2166136261;
    for (let i = 0; i < d.length; i += 4) { hash ^= d[i]; hash = Math.imul(hash, 16777619); }
    hash >>>= 0;
  } catch (e) {}
  return { fps: s.guestFps, running: !!(a && a.wine.running), hash };
})())`;

const runOnce = (id, cap) => {
  const args = ['tools/profile-web-frames.js', `--app=${id}`, `--seconds=${SECONDS}`,
    `--warmup=${WARMUP}`, `--query=?debug&perf&present-cap=${cap}`,
    `--report-eval=${REPORT}`];
  let out = '';
  try {
    out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8',
      maxBuffer: 1 << 28, timeout: (WARMUP + SECONDS + 120) * 1000 });
  } catch (e) { out = String((e.stdout || '') + (e.stderr || '')); }
  const m = out.match(/report-eval:\s*(\{.*\})/);
  if (!m) return { fps: null, running: false, hash: 0, error: 'no report' };
  try { return JSON.parse(m[1]); } catch { return { fps: null, running: false, hash: 0, error: 'bad json' }; }
};

const classify = (u, c) => {
  if (u === null || c === null) return { verdict: 'ERROR' };
  if (u < 1) return { verdict: 'NOPRESENT' };
  if (u <= CAP * 1.15) return { verdict: 'UNDER_CAP' };
  if (c >= CAP * 0.85) return { verdict: 'OK' };
  // cap/k for an integer k >= 2 is the multi-present-per-frame signature.
  const k = Math.round(CAP / Math.max(c, 0.001));
  if (k >= 2 && Math.abs(c - CAP / k) <= 0.2 * (CAP / k)) return { verdict: `SUBMULTIPLE_x${k}`, k };
  return { verdict: 'LOW' };
};

(async () => {
  console.log(`present-rate sweep: ${apps.length} app(s), cap ${CAP}/s, ` +
    `${SECONDS}s sample after ${WARMUP}s warmup, serial\n`);
  const rows = [];
  for (const [i, c] of apps.entries()) {
    const load = require('os').loadavg()[0].toFixed(1);
    process.stdout.write(`[${i + 1}/${apps.length}] ${c.id} (load ${load}) ... `);
    const un = runOnce(c.id, 0);
    const cp = runOnce(c.id, CAP);
    const u = typeof un.fps === 'number' ? un.fps : null;
    const p = typeof cp.fps === 'number' ? cp.fps : null;
    const res = classify(u, p);
    const row = { id: c.id, dlls: c.dlls, uncapped: u, capped: p, ...res,
      frozen: un.hash !== 0 && un.hash === cp.hash };
    rows.push(row);
    console.log(`${(u === null ? 'n/a' : u.toFixed(1)).padStart(7)} -> ` +
      `${(p === null ? 'n/a' : p.toFixed(1)).padStart(6)}  ${res.verdict}`);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
  }

  const order = ['SUBMULTIPLE', 'LOW', 'OK', 'UNDER_CAP', 'NOPRESENT', 'ERROR'];
  rows.sort((a, b) => order.findIndex(o => a.verdict.startsWith(o)) -
                      order.findIndex(o => b.verdict.startsWith(o)));
  const lines = ['', '| app | dlls | uncapped/s | capped/s | verdict |', '|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.dlls.join(' ')} | ${r.uncapped === null ? 'n/a' : r.uncapped.toFixed(1)} ` +
      `| ${r.capped === null ? 'n/a' : r.capped.toFixed(1)} | ${r.verdict} |`);
  }
  console.log(lines.join('\n'));
  const bad = rows.filter(r => r.verdict.startsWith('SUBMULTIPLE') || r.verdict === 'LOW');
  if (bad.length) {
    console.log(`\n${bad.length} app(s) the cap may halve -- repro each with:`);
    for (const r of bad) {
      console.log(`  node tools/profile-web-frames.js --app=${r.id} --seconds=${SECONDS} ` +
        `--warmup=${WARMUP} --query='?debug&perf&present-cap=${CAP}' --headful`);
    }
    console.log('  (fix per app with `presentCap: 0` in lib/apps.js, or make the rule coalesce)');
  } else {
    console.log('\nno app landed on a submultiple of the cap');
  }
  if (MD_OUT) fs.writeFileSync(MD_OUT, lines.join('\n') + '\n');
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
})();
