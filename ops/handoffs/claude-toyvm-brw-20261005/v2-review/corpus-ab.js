#!/usr/bin/env node
'use strict';
// Before/after x arm corpus driver for the toyvm IRQ-schedule patch v2.
// NOT RUN by the reviewer (it runs guests). Written to fill the one gap the
// repo's own sweep tools leave: none of sweep-dos.js / region-live-ab.js /
// arm-bench.js records frame AND wav AND irqs AND ints AND dispatched for an
// arbitrary arm, keyed by full path (sweep-diff.js keys by basename, so the
// corpus's duplicate names -- two BLIQ.EXE, three ZERO-BBS.EXE -- collapse).
//
//   run:     node corpus-ab.js --tree=W/base --list=programs.txt --arms=l1,jit-sepc,fold64,uop \
//              --recipe=witness --budgets=80m --jobs=4 --timeout=900 --out=W/out/base.ndjson
//   compare: node corpus-ab.js --compare=W/out/base.ndjson,W/out/v2.ndjson [--md=FILE]
//   child:   node corpus-ab.js --child='{"tree":..,"exe":..,"arm":..,"budget":..,"recipe":..}'
//
// Each (tree, exe, arm, budget) is one child process; a row already in --out is
// skipped, so a killed run resumes. Rows are appended, one JSON line each.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const count = (s) => {
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s).trim());
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()]);
};
const quiet = () => {};

// Arms, verbatim from tools/toyvm/arm-bench.js ARMS (l1, uop, jit, jit-sepc, only)
// plus the schedule doc's fold arm (sweep-dos `--tree-fold --tree-fold-hot=64`).
const ARMS = {
  l1: () => ({}),
  uop: (b) => ({ uop: { sampleAfter: Math.floor(b / 10), profileFor: 1e6 } }),
  jit: (b) => ({ regionJit: { sampleAfter: Math.floor(b / 4), profileFor: Math.floor(b / 4), gateAt: 0, log: quiet } }),
  // the CLI's --region-jit schedule (6M after 6M), gate off: arm-bench 'jit-early'
  'jit-early': () => ({ regionJit: { sampleAfter: 6e6, profileFor: 6e6, gateAt: 0, log: quiet } }),
  'jit-sepc': () => ({ regionJit: { sampleAfter: 6e6, profileFor: 6e6, gateAt: 0, sep: true,
    continuous: true, minShare: 5, log: quiet } }),
  only: () => ({ uopOnly: { shape: 'loop' } }),
  fold64: () => ({ treeFold: { log: quiet, hot: 64 } }),
};
// Recipes. `sweep` is sweep-dos.js/arm-bench.js's runDos shape (silent card).
// `witness` is region-live-ab.js baseOpts / docs/toyvm-irq-schedule.md "The
// witnesses": PIT clock, auto-key, SB preferred, an Ultrasound in the env, audio.
const RECIPES = {
  sweep: () => ({ variant: 'tailcall', cpu: 386, autoKey: true }),
  witness: () => ({ variant: 'tailcall', cpu: 386, autoKey: true, pitClock: true, soundPref: 'sb',
    env: ['ULTRASND=220,1,1,11,7'], audioRate: 22050 }),
};

async function child(spec) {
  const { tree, exe, arm, budget, recipe, seconds, irqSchedule } = JSON.parse(spec);
  const T = (m) => require(path.join(path.resolve(tree), 'tools/toyvm', m));
  const { runDos } = T('run-dos');
  const { wavBytes } = T('audio');
  const t0 = process.hrtime.bigint();
  const r = await runDos({ exe, budget, log: quiet, seconds: seconds || 0,
    ...(irqSchedule === false ? { irqSchedule: false } : {}),
    ...RECIPES[recipe](), ...ARMS[arm](budget) });
  const wav = r.audioChunks && r.audioChunks.length
    ? crypto.createHash('sha256').update(Buffer.from(wavBytes(r.audioChunks, r.audioRate))).digest('hex').slice(0, 16)
    : 'none';
  const ek = r.exitKinds || {};
  const kinds = { date: ek.date || 0, budget: ek.budget || 0, cut: ek.cut || 0,
    early: Object.entries(ek).filter(([k]) => k.startsWith('early')).reduce((n, [, v]) => n + v, 0) };
  return {
    ok: true, frame: r.frame, pixels: r.pixels, wav, irqs: r.irqs, ints: r.ints,
    dispatched: r.dispatched, handbacks: r.handbacks, kinds, stuckAt: r.stuckAt || null,
    ranOutOfTime: !!r.ranOutOfTime, cpuSecs: r.cpuSecs, wallSecs: Number(process.hrtime.bigint() - t0) / 1e9,
    jit: r.jit ? { phase: r.jit.phase, installs: r.jit.installs } : null,
  };
}

function runChild(spec, timeoutS) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [`--max-old-space-size=${Number(arg('heap', 1536))}`, __filename, `--child=${JSON.stringify(spec)}`],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 8192) err = err.slice(-8192); });
    const kill = setTimeout(() => p.kill('SIGKILL'), timeoutS * 1000);
    p.on('close', (code, sig) => {
      clearTimeout(kill);
      const line = out.split('\n').find((l) => l.startsWith('CORPUSAB '));
      if (line) return resolve(JSON.parse(line.slice(9)));
      resolve({ ok: false, reason: sig === 'SIGKILL' ? 'timeout' : `exit ${code}`, detail: err.trim().split('\n').slice(-3).join(' | ') });
    });
  });
}

const keyOf = (r) => `${r.exe}\t${r.arm}\t${r.budget}\t${r.recipe}\t${r.irqSchedule === false ? 'nosched' : 'sched'}`;

async function run() {
  const tree = arg('tree');
  const exes = fs.readFileSync(arg('list'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const arms = arg('arms', 'l1').split(',').filter(Boolean);
  for (const a of arms) if (!ARMS[a]) throw new Error(`unknown arm ${a}; have ${Object.keys(ARMS)}`);
  const budgets = arg('budgets', '8m').split(',').map(count);
  const recipe = arg('recipe', 'sweep');
  const irqSchedule = !argv.includes('--no-irq-schedule');
  const jobs = Number(arg('jobs', Math.max(1, os.cpus().length - 1)));
  const timeoutS = Number(arg('timeout', 900));
  const outFile = arg('out');
  const deadline = arg('max-seconds') ? Date.now() + Number(arg('max-seconds')) * 1000 : 0;
  const done = new Set();
  if (fs.existsSync(outFile)) {
    for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) if (l) done.add(keyOf(JSON.parse(l)));
  }
  const work = [];
  for (const exe of exes) for (const budget of budgets) for (const arm of arms) {
    const spec = { tree, exe, arm, budget, recipe, seconds: Math.max(10, timeoutS - 30), irqSchedule };
    if (!done.has(keyOf(spec))) work.push(spec);
  }
  console.log(`corpus-ab: ${work.length} runs to go (${done.size} already in ${outFile}), jobs ${jobs}, `
    + `tree ${tree}, loadavg ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  let next = 0, n = 0, failed = 0;
  const worker = async () => {
    while (next < work.length) {
      if (deadline && Date.now() > deadline) return;
      const spec = work[next++];
      const res = await runChild(spec, timeoutS);
      const row = { ...spec, seconds: undefined, ...res };
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      n++; if (!res.ok) failed++;
      console.log(`[${n}/${work.length}] ${path.basename(spec.exe)} ${spec.arm} ${spec.budget}`
        + ` ${res.ok ? `${res.frame} ${res.wav} irqs ${res.irqs} d ${res.dispatched} ${res.wallSecs.toFixed(1)}s` : `FAIL ${res.reason}`}`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log(`done: ${n} runs, ${failed} failed, loadavg ${os.loadavg()[0].toFixed(2)}`);
}

// Before/after comparison. Three questions, in order of severity:
//  A. CROSS-ARM: per tree, does each non-l1 arm agree with l1 on frame, wav,
//     irqs, ints (and dispatched within OVERSHOOT)? The patch exists to raise
//     this count; a program that agreed before and disagrees after BLOCKS.
//  B. L1 BASELINE: which l1 rows moved (frame / wav / irqs / ints / pixels)?
//     Expected for time-paced programs; each one gets the doc's rubric.
//  C. HEALTH: run status got worse (ok -> fail/timeout/stuck), or pixels -> 0.
const OVERSHOOT = 64;   // arm-bench.js: last-slice overshoot tolerance
function compare() {
  const [a, b] = arg('compare').split(',');
  const load = (f) => {
    const m = new Map();
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) { const r = JSON.parse(l); m.set(keyOf(r), r); }
    return m;
  };
  const A = load(a), B = load(b);
  const same = (x, y) => x.ok && y.ok && x.frame === y.frame && x.wav === y.wav && x.irqs === y.irqs
    && x.ints === y.ints && Math.abs(x.dispatched - y.dispatched) <= OVERSHOOT;
  const L = [];
  const agree = (M) => {
    const res = new Map();
    for (const [k, r] of M) {
      if (r.arm === 'l1') continue;
      const ref = M.get(keyOf({ ...r, arm: 'l1' }));
      if (!ref) continue;
      res.set(k, same(ref, r));
    }
    return res;
  };
  const ga = agree(A), gb = agree(B);
  const byArm = {};
  const broke = [], fixed = [];
  for (const [k, before] of ga) {
    if (!gb.has(k)) continue;
    const after = gb.get(k);
    const arm = k.split('\t')[1];
    byArm[arm] = byArm[arm] || { before: 0, after: 0, n: 0 };
    byArm[arm].n++; byArm[arm].before += before; byArm[arm].after += after;
    if (before && !after) broke.push(k); if (!before && after) fixed.push(k);
  }
  L.push('A. cross-arm agreement with l1 (frame, wav, irqs, ints, dispatched +-64)');
  for (const [arm, s] of Object.entries(byArm)) L.push(`   ${arm.padEnd(10)} before ${s.before}/${s.n}  after ${s.after}/${s.n}`);
  L.push(`   BROKE (agreed before, not after) -- BLOCKING: ${broke.length}`);
  for (const k of broke) L.push(`     ${k.replace(/\t/g, ' ')}`);
  L.push(`   fixed (disagreed before, agree after): ${fixed.length}`);
  for (const k of fixed) L.push(`     ${k.replace(/\t/g, ' ')}`);
  L.push('B. l1 rows that moved (rubric: docs/toyvm-irq-schedule.md "The corpus run")');
  const health = [];
  let moved = 0, l1n = 0;
  const movedExes = new Set();
  for (const [k, x] of A) {
    if (x.arm !== 'l1' || !B.has(k)) continue;
    const y = B.get(k); l1n++;
    const fields = ['frame', 'wav', 'irqs', 'ints', 'pixels'].filter((f) => x[f] !== y[f]);
    if (Math.abs((x.dispatched || 0) - (y.dispatched || 0)) > OVERSHOOT) fields.push('dispatched');
    if (fields.length) {
      moved++; movedExes.add(x.exe);
      L.push(`   ${path.basename(x.exe)} (${x.exe}) ${x.budget}: ${fields.map((f) => `${f} ${x[f]}->${y[f]}`).join(' ')}`);
    }
  }
  L.push(`   ${moved} of ${l1n} l1 rows moved`);
  for (const [k, x] of A) {
    const y = B.get(k); if (!y) continue;
    const bad = (r) => !r.ok || r.ranOutOfTime || !!r.stuckAt;
    if (!bad(x) && bad(y)) health.push(`${k.replace(/\t/g, ' ')}: ${y.reason || (y.stuckAt ? `stuck ${y.stuckAt}` : 'out of time')}`);
    if (x.ok && y.ok && x.pixels > 0 && !y.pixels) health.push(`${k.replace(/\t/g, ' ')}: WENT BLANK`);
  }
  L.push(`C. health regressions (ok -> fail/timeout/stuck, or went blank) -- BLOCKING: ${health.length}`);
  for (const h of health) L.push(`   ${h}`);
  const missing = [...A.keys()].filter((k) => !B.has(k)).length + [...B.keys()].filter((k) => !A.has(k)).length;
  L.push(`rows present in only one file: ${missing}`);
  const text = L.join('\n');
  console.log(text);
  if (arg('md')) fs.writeFileSync(arg('md'), text + '\n');
  // --moved=FILE: the l1 programs whose row moved, one path per line (the nudge list).
  if (arg('moved')) fs.writeFileSync(arg('moved'), [...movedExes].sort().join('\n') + (movedExes.size ? '\n' : ''));
  process.exitCode = broke.length || health.length ? 1 : 0;
}

// The schedule doc's three-way rubric for a frame that moved ("The corpus run"):
// each moved program re-run at 8.00/8.01/8.02/8.04M in both trees (l1 only).
//   reappears   a frame the before tree draws at some nudge, the after tree draws too
//   unstable    no shared frame, but one tree's own hash changes across the nudge
//   STABLE-DIFF one frame per tree across the nudge, and they differ: one line of
//               reason each, located by a finer walk (the doc's BKSNOTE/brainbug)
function nudge() {
  const [a, b] = arg('nudge').split(',');
  const rows = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.arm === 'l1');
  const group = (rs) => { const m = new Map(); for (const r of rs) { if (!m.has(r.exe)) m.set(r.exe, new Set()); m.get(r.exe).add(r.ok ? r.frame : `FAIL:${r.reason}`); } return m; };
  const A = group(rows(a)), B = group(rows(b));
  const tally = { reappears: 0, unstable: 0, 'STABLE-DIFF': 0, same: 0 };
  for (const [exe, fa] of A) {
    const fb = B.get(exe); if (!fb) continue;
    const shared = [...fa].some((f) => fb.has(f));
    const cls = shared ? (fa.size === 1 && fb.size === 1 ? 'same' : 'reappears')
      : (fa.size > 1 || fb.size > 1 ? 'unstable' : 'STABLE-DIFF');
    tally[cls]++;
    console.log(`${cls.padEnd(11)} ${exe}  before {${[...fa].join(',')}}  after {${[...fb].join(',')}}`);
  }
  console.log(JSON.stringify(tally));
}

if (require.main === module) {
  const spec = arg('child');
  if (spec) {
    child(spec).then((r) => { console.log('CORPUSAB ' + JSON.stringify(r)); process.exit(0); })
      .catch((e) => { console.log('CORPUSAB ' + JSON.stringify({ ok: false, reason: 'crash', detail: String(e.stack || e).split('\n').slice(0, 3).join(' | ') })); process.exit(0); });
  } else if (arg('compare')) compare();
  else if (arg('nudge')) nudge();
  else run().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
}
