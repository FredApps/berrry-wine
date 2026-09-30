#!/usr/bin/env node
'use strict';

// Whole programs on each execution ARM, against L1.
//
//   node tools/toyvm/arm-bench.js --exe=A.EXE,B.EXE [--arms=l1,uop,jit,only]
//        [--dispatches=20m] [--reps=1] [--timeout=300] [--out=FILE.json]
//
//   l1         threaded x86 alone (the oracle)
//   uop        l1 + the µop loop tier (uop-live.js), shell-bench's schedule
//   uopc       ...with its programs chained in one E1 arena (--uop-chain)
//   jit        l1 + the live region JIT (region-live.js), sweep-dos's schedule
//   only       the µop-only arm (uop-only.js): loop nests and straight lines
//   only-line  ...straight lines only, linked
//   only-bl    only, with straight lines built on the baseline passes
//   only-min   only, every program built with promote + flaglive (promoteLiveRP)
//   only-base  only, every program built on the baseline passes (baselineRP)
//   only-R     only, on resident: true (narrow registers stored in place, allR)
//   only-RF    only, on resident: 'full' (allRF)
//   only-naive only, every program the naive lowering (naiveR): no passes
//   only-nK    tier-up from naiveR: rebuilt on allRP once its loop headers
//              have counted K (only-n1k, only-n100k, ...)
//   only-tK    tier-up: built on promoteLiveRP, rebuilt on allRP once its loop
//              headers have counted K (only-t64, only-t1k, ...)
//
// Any arm name + `@spill` (only-naive@spill) runs it on the E1 engine as it
// was before uop-wasm.js callSafe: the A/B for that change. `@nofuse` runs it
// without the fused `X_s` step µops (TOYVM_STEPFUSE=0), `@nomask` without the
// fused narrow masks (TOYVM_MASKFUSE=0). They stack: only-naive@spill@nofuse.
//
// Name an arm twice (--arms=l1,l1,only) to time a second copy of it: that
// pair's spread is this run's null band.
//
// One node process per run, arm order rotated per program. The number quoted
// is the whole run's CPU time (runDos `cpuSecs`: user + system over the run
// loop, builds and handbacks included) -- wall clock on this box measures the
// other agents -- beside the slice-only wasm time (`guestSecs`). Every arm
// must retire the same dispatch count and draw the same frame as l1, or its
// row is marked and left out of the summary, never averaged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const count = (s) => {
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s).trim());
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()]);
};

const ARMS = {
  l1: () => ({}),
  uop: (b) => ({ uop: { sampleAfter: Math.floor(b / 10), profileFor: 1e6 } }),
  uopc: (b) => ({ uop: { sampleAfter: Math.floor(b / 10), profileFor: 1e6, chain: true } }),
  jit: (b) => ({ regionJit: { sampleAfter: Math.floor(b / 4), profileFor: Math.floor(b / 4), gateAt: 0 } }),
  only: () => ({ uopOnly: { shape: 'loop' } }),
  'only-line': () => ({ uopOnly: { shape: 'straight' } }),
  // ...loops fully optimized, straight lines on the baseline passes
  'only-bl': () => ({ uopOnly: { shape: 'loop', linePasses: 'baselineRP' } }),
  'only-min': () => ({ uopOnly: { shape: 'loop', passes: 'promoteLiveRP', linePasses: 'promoteLiveRP' } }),
  'only-base': () => ({ uopOnly: { shape: 'loop', passes: 'baselineRP', linePasses: 'baselineRP' } }),
  // only, on the other two resident models: narrow registers stored in place
  // (allR) and the same with read-modify-write narrow stores (allRF)
  'only-R': () => ({ uopOnly: { shape: 'loop', passes: 'allR', linePasses: 'allR' } }),
  'only-RF': () => ({ uopOnly: { shape: 'loop', passes: 'allRF', linePasses: 'allRF' } }),
  'only-naive': () => ({ uopOnly: { shape: 'loop', passes: 'naiveR', linePasses: 'naiveR' } }),
};

// `ARM@spill` runs ARM on the E1 engine without uop-wasm.js callSafe
// (TOYVM_CALLSAFE=0): Ion keeps $pc and the machine params on the stack.
// `ARM@nofuse` runs it without step fusion (TOYVM_STEPFUSE=0), `ARM@nomask`
// without mask fusion (TOYVM_MASKFUSE=0).
const KNOBS = { '@spill': 'TOYVM_CALLSAFE', '@nofuse': 'TOYVM_STEPFUSE', '@nomask': 'TOYVM_MASKFUSE' };
const armOf = (a) => {
  for (const k of Object.keys(KNOBS)) if (a.endsWith(k)) return armOf(a.slice(0, -k.length));
  const t = /^only-t(\d+[km]?)$/i.exec(a);
  const nv = /^only-n(\d+[km]?)$/i.exec(a);
  if (nv) {
    const after = count(nv[1]);
    return () => ({ uopOnly: { shape: 'loop', passes: 'naiveR', linePasses: 'naiveR', tier: { passes: 'allRP', after } } });
  }
  if (t) {
    const after = count(t[1]);
    return () => ({ uopOnly: { shape: 'loop', passes: 'promoteLiveRP', linePasses: 'promoteLiveRP', tier: { passes: 'allRP', after } } });
  }
  return ARMS[a];
};

// --child: one run, printed as one JSON line.
async function child(spec) {
  const { exe, budget, arm } = JSON.parse(spec);
  const { runDos } = require('./run-dos');
  const r = await runDos({ exe, variant: 'tailcall', budget, cpu: 386, autoKey: true, log: () => {},
    ...armOf(arm)(budget) });
  const u = r.uop;
  console.log('ARMBENCH ' + JSON.stringify({
    secs: r.secs, cpuSecs: r.cpuSecs, guestSecs: r.guestSecs, dispatched: r.dispatched, frame: r.frame,
    handbacks: r.session ? r.session.handbacks : undefined,
    only: u && u.fallbacks ? { share: u.uopShare, builds: u.builds, fbSites: u.fbSites, fbEntries: u.fbEntries,
      fbSteps: u.fbSteps, entries: u.entries, chains: u.chains, buildSecs: u.buildSecs, invalidated: u.invalidated,
      tierUps: u.tierUps, tierSecs: u.tierSecs, tierFails: u.tierFails,
      top: u.fallbacks.slice(0, 5).map((f) => `${f.why}:${f.steps}`) } : null,
    uop: u && !u.fallbacks ? { steps: u.steps, installs: u.installs } : null,
    jit: r.jit ? { phase: r.jit.phase, installs: r.jit.installs } : null,
  }));
}

function runOne(exe, budget, arm, timeoutS) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const [k, v] of Object.entries(KNOBS)) if (arm.split('@').includes(k.slice(1))) env[v] = '0';
    const p = spawn(process.execPath, [__filename, `--child=${JSON.stringify({ exe, budget, arm })}`],
      { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => p.kill('SIGKILL'), timeoutS * 1000);
    p.on('close', (code, sig) => {
      clearTimeout(kill);
      const m = /^ARMBENCH (.*)$/m.exec(out);
      if (m) return resolve({ ok: true, ...JSON.parse(m[1]) });
      resolve({ ok: false, reason: sig === 'SIGKILL' ? 'timeout'
        : `exit ${code}: ${(err || out).trim().split('\n').slice(-2).join(' | ')}` });
    });
  });
}

const OVERSHOOT = 64;
const geomean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

async function main() {
  const spec = arg('child');
  if (spec) return child(spec);
  const arms = arg('arms', 'l1,uop,jit,only').split(',').filter(Boolean);
  for (const a of arms) if (!armOf(a)) throw new Error(`unknown arm ${a} (known: ${Object.keys(ARMS).join(',')})`);
  if (arms[0] !== 'l1') throw new Error('the first arm is the oracle: l1');
  const budget = count(arg('dispatches', '20m'));
  const reps = Number(arg('reps', 1));
  const timeoutS = Number(arg('timeout', 300));
  const outFile = arg('out', null);
  const progs = arg('exe', '').split(',').filter(Boolean);
  if (!progs.length) throw new Error('--exe=A.EXE,B.EXE');
  // Arms named twice are timed twice, and labelled apart.
  const labels = arms.map((a, i) => (arms.indexOf(a) === i ? a : `${a}#${arms.slice(0, i).filter((x) => x === a).length + 1}`));
  console.log(`arm-bench: ${progs.length} program(s), ${budget} dispatches, arms ${labels.join(',')}, reps ${reps},`
    + ` loadavg ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  const rows = [];
  for (let pi = 0; pi < progs.length; pi++) {
    const exe = progs[pi];
    const row = { exe, name: path.basename(exe), arms: {} };
    for (let rep = 0; rep < reps; rep++) {
      for (let i = 0; i < arms.length; i++) {
        const k = (i + pi + rep) % arms.length;
        const r = await runOne(exe, budget, arms[k], timeoutS);
        const prev = row.arms[labels[k]];
        // Best of the reps, by CPU time; a failure anywhere marks the arm.
        if (!prev || (prev.ok && (!r.ok || r.cpuSecs < prev.cpuSecs))) row.arms[labels[k]] = r;
      }
    }
    const ref = row.arms.l1;
    // The last slice overshoots its budget by however many ops the arm's last
    // block or fold billed at once (L1's port-poll spin charges a run of turns
    // together), so the totals may differ by that much with the same frame.
    row.bad = labels.filter((l) => row.arms[l].ok && ref.ok
      && (Math.abs(row.arms[l].dispatched - ref.dispatched) > OVERSHOOT || row.arms[l].frame !== ref.frame));
    row.failed = labels.filter((l) => !row.arms[l].ok);
    rows.push(row);
    const cell = (l) => {
      const r = row.arms[l];
      if (!r.ok) return `${l} FAIL(${r.reason.slice(0, 50)})`;
      const x = ref.ok ? ` x${(r.cpuSecs / ref.cpuSecs).toFixed(2)}` : '';
      return `${l} ${r.cpuSecs.toFixed(2)}s${x}`
        + (r.only ? ` [${(100 * r.only.share).toFixed(0)}% µop, fb ${r.only.fbEntries}, build ${r.only.buildSecs.toFixed(2)}s`
          + (r.only.tierUps !== undefined && (r.only.tierUps || r.only.tierFails.length) ? `, up ${r.only.tierUps} ${r.only.tierSecs.toFixed(2)}s` : '') + ']' : '');
    };
    console.log(`[${pi + 1}/${progs.length}] ${row.name.padEnd(14)} ${labels.map(cell).join('  ')}`
      + (row.bad.length ? `  DISAGREE ${row.bad.map((l) => `${l} ${row.arms[l].dispatched}/${row.arms[l].frame} vs ${ref.dispatched}/${ref.frame}`).join(', ')}` : '')
      + `  load ${os.loadavg()[0].toFixed(1)}`);
    for (const l of labels) {
      const o = row.arms[l].only;
      if (o) console.log(`      ${l}: fallback ${o.top.join(' ')}`);
    }
    if (outFile) fs.writeFileSync(outFile, JSON.stringify({ budget, arms: labels, rows }, null, 1));
  }
  const clean = rows.filter((r) => !r.failed.length && !r.bad.length);
  console.log(`\n${clean.length} of ${rows.length} program(s) clean in every arm`);
  for (const l of labels) {
    if (!clean.length) break;
    const cpu = clean.map((r) => r.arms[l].cpuSecs / r.arms.l1.cpuSecs).sort((a, b) => a - b);
    const g = clean.map((r) => r.arms[l].guestSecs / r.arms.l1.guestSecs);
    const q = (f) => cpu[Math.min(cpu.length - 1, Math.floor(f * cpu.length))];
    console.log(`  ${l.padEnd(10)} cpu vs l1: geomean x${geomean(cpu).toFixed(3)}  p10 x${q(0.1).toFixed(2)}`
      + `  p50 x${q(0.5).toFixed(2)}  p90 x${q(0.9).toFixed(2)}  | slice time geomean x${geomean(g).toFixed(3)}`);
  }
  for (const r of rows) {
    if (r.failed.length) console.log(`  FAIL ${r.name}: ${r.failed.map((l) => `${l}: ${r.arms[l].reason}`).join('; ')}`);
    if (r.bad.length) console.log(`  DISAGREE ${r.name}: ${r.bad.join(',')}`);
  }
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
