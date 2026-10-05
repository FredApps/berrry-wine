#!/usr/bin/env node
'use strict';

// GAMEPLAY-ONLY A/B by two-point CPU subtraction. StarCraft shareware by
// default; --app/--route/--boot/--end retarget it at any app whose gameplay
// entry recipe is written down.
//
//   node gameplay-ab.js --arms=A:dir,A2:dir,B:dir --reps=2
//
//   # Heroes II, gameplay window per docs/re-notes/heroes2-demo.md
//   node gameplay-ab.js --arms=... --app=heroes2_demo \
//     --route='400:click:535:225,700:click:528:68,1200:click:283:373' \
//     --boot=1400 --end=2600
//
// WHY THIS EXISTS
//   A plain `--max-batches=300` StarCraft run never leaves the Smacker intro
//   (SMK_TREE dominates, every hot block is smackw32). Timing it and calling
//   the result "StarCraft" measures a video decoder. This drives the app to
//   real in-mission gameplay first and measures only what happens after.
//
// HOW GAMEPLAY IS GUARANTEED, NOT ASSUMED
//   The click route below is the one in docs/re-notes/starcraft-shareware.md:
//   clicks skip the Smacker videos, escapes do NOT (six escapes in a row never
//   left the cinematic). It reaches unobstructed gameplay at batch ~1690.
//   The gate is a PNG, never a hit counter -- `--count` ORs into $dbg_any and
//   turns chaining off, so a counter-gated run is not the run under test, and
//   0x004b2ed0 is static (1394928771) so a gate built on it passes anything.
//
// THE TWO POINTS
//   P1 = BOOT_BATCHES  : boot + menus only, no gameplay.
//   P2 = END_BATCHES   : boot + gameplay.
//   gameplay CPU = user(P2) - user(P1), per arm, per rep.
//   Both points are identical work in every arm (no fold changes), so a fixed
//   batch count is a valid work axis here.
//
// NULL BAND
//   Include an arm that is the SAME BUILD as the baseline under a second name
//   (A2). Its gameplay-CPU spread against A is what the box costs. A delta
//   smaller than that band has not been measured.

const { spawnSync } = require('child_process');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};

const BOOT_BATCHES = parseInt(opt('boot', '1750'), 10);
const END_BATCHES = parseInt(opt('end', '4250'), 10);
const REPS = parseInt(opt('reps', '2'), 10);

const APP = opt('app', 'starcraft_shareware');

// StarCraft is bimodal in work at a fixed batch count (~610k vs ~1.06M API
// calls), and pooling the two modes produced a 15% null band that swamped
// everything. Runs are therefore labelled by mode and only compared within one.
// That split point is a property of THIS app: pass --mode-split=0 for an app
// not known to be bimodal, so every run lands in one bucket instead of being
// sorted by a threshold that means nothing to it.
const MODE_SPLIT = parseInt(opt('mode-split', '800000'), 10);

// A batch is a budget of BLOCKS, so a batch NUMBER only means something
// alongside the batch size it was measured at. Every route's boot/end points
// come from its re-notes at that file's batch size -- Heroes II's gameplay
// window of 1400..2600 is at 20000, not at StarCraft's 100000.
const BATCH_SIZE = parseInt(opt('batch-size', '100000'), 10);
// Wall-clock guard per run, in seconds per batch. The StarCraft default of
// 0.25 s/batch is the box's measured 4 batches/s at batch size 100000; a
// million-block Diablo II batch takes ~0.45 s on the same box, so the guard
// must scale with the app or every run is SHORT/FAILED before its P1.
const SECONDS_PER_BATCH = parseFloat(opt('seconds-per-batch', '0.25'));

// docs/re-notes/starcraft-shareware.md, "Clicks skip the Smacker videos".
const SC_ROUTE = [
  '100:focus-main-window',
  '120:keydown:27', '125:keyup:27',
  '670:mousemove:320:240', '675:mousedown:320:240', '685:mouseup:320:240',
  '990:mousemove:320:240', '995:mousedown:320:240', '1005:mouseup:320:240',
  '1140:mousemove:545:393', '1145:mousedown:545:393', '1155:mouseup:545:393',
  '1540:mousemove:198:261', '1545:mousedown:198:261', '1555:mouseup:198:261',
].join(',');

// A route is app-specific and must come from that app's re-notes, not from
// guesswork: the whole point of this harness is that the run reaches gameplay,
// and an input recipe that misses a menu silently measures the menu instead.
const ROUTE = opt('route', SC_ROUTE);

// --perf-events=branches,branch-misses,instructions,cycles wraps every run in
// `perf stat` (Linux, needs kernel.perf_event_paranoid <= 2 or CAP_PERFMON)
// and reports each counter the same two-point way as CPU: P2 - P1 is the
// gameplay window's count. With branches + branch-misses present it also
// prints the window's miss rate, which is the number a dispatch-shape change
// (replicating $next, fusing ops) is actually about -- CPU time alone cannot
// tell "fewer instructions" from "fewer mispredicts". Whole-process counters,
// so the null arm's spread bounds them exactly as it bounds CPU.
const PERF_EVENTS = opt('perf-events', '');

// KEY:dir[:flags] -- flags are '+'-separated extra run.js switches, so one
// build can carry several arms when the lever is a runtime flag (block
// chaining / executor) rather than a different wasm.
const arms = (opt('arms', '') || '').split(',').filter(Boolean).map(spec => {
  const [key, dir, flags] = spec.split(':');
  return { key, dir: path.resolve(dir), flags: flags ? flags.split('+') : [] };
});
if (arms.length < 2) { console.error('need --arms=KEY:dir,KEY:dir[,...]'); process.exit(2); }

function once(dir, batches, png, flags) {
  const input = png ? `${ROUTE},${batches - 50}:png:${png}` : ROUTE;
  const cmd = ['/usr/bin/time', '-p', 'node', 'test/run.js',
    `--app=${APP}`, '--no-threads', '--quiet-api',
    `--batch-size=${BATCH_SIZE}`, `--max-batches=${batches}`, '--no-close',
    '--repaint-every=50', `--max-seconds=${Math.ceil(batches * SECONDS_PER_BATCH)}`,
    `--input=${input}`, ...(flags || []),
  ];
  // perf's own report goes to a file (-o), so /usr/bin/time's stderr and
  // run.js's stdout are untouched and parse exactly as they do without it.
  const perfOut = PERF_EVENTS
    ? path.join(require('os').tmpdir(), `gab-perf-${process.pid}-${Date.now()}.txt`) : null;
  if (perfOut) cmd.unshift('perf', 'stat', '-x,', '-e', PERF_EVENTS, '-o', perfOut);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  const perf = {};
  if (perfOut) {
    let txt = '';
    try { txt = require('fs').readFileSync(perfOut, 'utf8'); require('fs').unlinkSync(perfOut); } catch (e) { /* no report: perf refused */ }
    // CSV: value,unit,event,run-time,pct,... ; "<not counted>"/"<not supported>" become NaN.
    for (const line of txt.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [v, , ev] = line.split(',');
      if (ev) perf[ev] = /^\d+$/.test(v) ? Number(v) : NaN;
    }
  }
  const m = /^user\s+([\d.]+)$/m.exec(r.stderr || '');
  // A run that stopped early on the wall-clock guard did LESS work, so its CPU
  // is not comparable. Reject it loudly rather than averaging it in.
  const done = /(\d+) batches in/.exec(r.stdout || '');
  // THE MODE. At a fixed batch count this app is bimodal in work: repeated runs
  // of ONE build land on ~610k or ~1,060k API calls, and in the gameplay window
  // that is a ~15% swing in CPU -- far larger than any effect under test. So
  // record it and only ever compare runs that took the same path.
  const api = /(\d+) API calls/.exec(r.stdout || '');
  return {
    user: m ? parseFloat(m[1]) : NaN,
    batches: done ? parseInt(done[1], 10) : -1,
    api: api ? parseInt(api[1], 10) : -1,
    status: r.status,
    perf,
  };
}

// Gameplay-window counters: P2 - P1 per event, plus the derived rates.
function perfWindow(p1, p2) {
  const w = {};
  for (const ev of Object.keys(p2.perf || {})) w[ev] = p2.perf[ev] - (p1.perf[ev] || 0);
  if (w['branches'] > 0 && Number.isFinite(w['branch-misses'])) w['miss%'] = w['branch-misses'] / w['branches'] * 100;
  if (w['cycles'] > 0 && Number.isFinite(w['instructions'])) w['ipc'] = w['instructions'] / w['cycles'];
  return w;
}
const fmtCount = v => !Number.isFinite(v) ? 'n/a' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'G' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : String(v);
const perfCols = w => Object.entries(w).map(([k, v]) =>
  `${k}=${k === 'miss%' ? v.toFixed(2) : k === 'ipc' ? v.toFixed(2) : fmtCount(v)}`).join(' ');

const loadavg = () => require('os').loadavg()[0].toFixed(2);
const got = Object.fromEntries(arms.map(a => [a.key, []]));

console.log(`# ${APP} gameplay-only A/B (two-point CPU subtraction)`);
console.log(`# P1 boot=${BOOT_BATCHES}  P2 end=${END_BATCHES}  gameplay=${END_BATCHES - BOOT_BATCHES} batches`);
for (const a of arms) console.log(`# ${a.key} = ${a.dir} ${a.flags.join(' ')}`);
console.log('');
console.log('rep  arm   bootCPU   endCPU   gameplayCPU  batches  load');

for (let rep = 0; rep < REPS; rep++) {
  const order = arms.slice(rep % arms.length).concat(arms.slice(0, rep % arms.length));
  for (const arm of order) {
    const p1 = once(arm.dir, BOOT_BATCHES, null, arm.flags);
    const p2 = once(arm.dir, END_BATCHES, null, arm.flags);
    const ok = p1.batches === BOOT_BATCHES && p2.batches === END_BATCHES
      && Number.isFinite(p1.user) && Number.isFinite(p2.user);
    if (!ok) {
      console.log(`${rep + 1}    ${arm.key.padEnd(4)}  SHORT/FAILED p1=${p1.batches} p2=${p2.batches}`);
      continue;
    }
    const g = p2.user - p1.user;
    // Mode label from the end-point run: "lo" ~610k API calls, "hi" ~1.06M.
    const mode = MODE_SPLIT > 0 ? (p2.api > MODE_SPLIT ? 'hi' : 'lo') : 'one';
    const w = PERF_EVENTS ? perfWindow(p1, p2) : null;
    got[arm.key].push({ g, mode, api: p2.api, w });
    console.log(`${rep + 1}    ${arm.key.padEnd(4)}  ${p1.user.toFixed(2).padStart(7)}  ` +
      `${p2.user.toFixed(2).padStart(7)}  ${g.toFixed(2).padStart(11)}  ` +
      `${String(p2.batches).padStart(7)}  ${mode}  ${String(p2.api).padStart(9)}  ${loadavg()}` +
      (w ? `  ${perfCols(w)}` : ''));
  }
}

const med = xs => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Report per mode. Pooling the two modes is what produced a 15% null band on
// the first attempt; within a mode the runs are comparable.
const base = arms[0].key, nullArm = arms[1] && arms[1].key;
for (const mode of ['lo', 'hi', 'one']) {
  const rows = k => got[k].filter(r => r.mode === mode);
  const of = k => rows(k).map(r => r.g);
  if (!arms.some(a => of(a.key).length)) continue;
  console.log(`\n=== mode "${mode}"`);
  for (const a of arms) {
    const xs = of(a.key);
    console.log(xs.length
      ? `  ${a.key}: n=${xs.length} median gameplay CPU ${med(xs).toFixed(2)}s  ` +
        `min ${Math.min(...xs).toFixed(2)}  max ${Math.max(...xs).toFixed(2)}`
      : `  ${a.key}: no samples in this mode`);
    if (PERF_EVENTS && xs.length) {
      // Median of each window counter across this arm's reps in this mode.
      const keys = Object.keys(rows(a.key)[0].w || {});
      const medW = Object.fromEntries(keys.map(k => [k, med(rows(a.key).map(r => r.w[k]).filter(Number.isFinite))]));
      console.log(`      window medians: ${perfCols(medW)}`);
    }
  }
  const b = of(base), nl = nullArm ? of(nullArm) : [];
  if (!b.length || !nl.length) { console.log('  (need both baseline arms in this mode)'); continue; }
  const bm = med(b);
  const band = Math.abs(med(nl) / bm - 1) * 100;
  console.log(`  NULL BAND (${base} vs ${nullArm}, same build): ${band.toFixed(2)}%`);
  for (const a of arms.slice(2)) {
    const xs = of(a.key);
    if (!xs.length) continue;
    const d = (med(xs) / bm - 1) * 100;
    console.log(`  ${a.key} vs ${base}: ${d >= 0 ? '+' : ''}${d.toFixed(2)}%  ` +
      (Math.abs(d) > band ? '(EXCEEDS null band)' : '(inside null band - NOT measured)'));
  }
}
