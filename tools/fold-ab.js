#!/usr/bin/env node
//
// fold-ab.js -- three-arm interleaved A/B for a fold flag, on a loaded box.
//
// The problem this exists for: every timing table in docs/toyvm-tree-fold.md
// and docs/tree-fold-design-a.md carries a disclaimer that its percentages are
// not quotable, because this machine sits at load 10-190 and wall clock there
// measures the box. Two arms cannot say whether a 3% difference is the feature
// or the neighbours. So this harness runs THREE arms:
//
//   off   -- baseline flags
//   on    -- baseline flags plus --arm-on
//   null  -- baseline flags again, under a different label
//
// `null` is the control. It is the same binary running the same work as `off`,
// so every difference it shows is noise by construction, and it is the ruler
// the `on` arm is measured against. A verdict is "resolved" only when the
// paired on-off difference is more than twice the null spread; anything
// smaller is a number this box cannot produce.
//
// Everything else is the protocol the docs already settled on: fixed work
// (a batch or dispatch count, never a time budget), USER CPU rather than wall
// clock, arms interleaved within a rep with the order rotated per rep, and
// `uptime`'s loadavg printed before every rep so a rep taken in a quiet window
// can be told apart afterwards.
//
// Usage:
//   node tools/fold-ab.js --target=win98 --app=mw3 --work=1200 --reps=8 \
//     --arm-on='--tree-fold' --base='--quiet-api --batch-size=200000'
//   node tools/fold-ab.js --target=toyvm --exe=/tmp/demos/1995-c-cma_brw/BRW.EXE \
//     --work=20m --reps=8 --arm-on='--tree-fold --tree-fold-hot=64'
//
// win98 arms shell out to test/run.js under /usr/bin/time -l and read the
// child's `user` seconds. toyvm arms call runDos() in this process and read
// `guestCpuSecs`, the per-slice getrusage meter bench-dos.js --cpu-time uses --
// spawning would bury a 0.4s guest slice under node startup and module build.
//
// --out=FILE writes the whole sample set as JSON so a re-run on a quiet box can
// be diffed against this one rather than re-argued.

'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function arg(name, dflt) {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
}
function flag(name) { return process.argv.slice(2).includes(`--${name}`); }
// Repeatable, and passed through to the child VERBATIM -- `--base` is split on
// whitespace and so cannot carry `--args=+set vid_ref soft +map demo1`, which
// is exactly the flag quake2 must be pinned with on every run (lib/apps.js
// persists config.cfg across processes, so an unpinned rep inherits the last
// one's video driver and is not the same work).
function args(name) {
  return process.argv.slice(2)
    .filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
}

// "20m" / "1.2m" / "800k" / "1200"
function count(s) {
  if (s === undefined || s === null) return undefined;
  const m = String(s).trim().match(/^([\d.]+)\s*([kmg]?)$/i);
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * { '': 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase()]);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};

// ---------------------------------------------------------------- win98 arm

// macOS /usr/bin/time -l writes "  3.29 real  2.94 user  0.30 sys" to stderr.
// The child's own stdout is kept (a --loopmatch-stats line is read off it) but
// never printed: a run.js run is thousands of lines and the point of the
// harness is the four numbers at the end.
function runWin98(flags, timeoutMs) {
  return new Promise((resolve, reject) => {
    const argv = ['-l', process.execPath, path.join(ROOT, 'test', 'run.js'), ...flags];
    const t0 = Date.now();
    const p = spawn('/usr/bin/time', argv, { cwd: ROOT });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error(`killed by ${signal} after ${timeoutMs}ms`));
      const m = err.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
      if (!m) return reject(new Error(`no /usr/bin/time line (exit ${code})`));
      resolve({
        cpu: Number(m[2]), sys: Number(m[3]), wall: (Date.now() - t0) / 1000,
        code, out, err,
      });
    });
    p.on('error', reject);
  });
}

// ---------------------------------------------------------------- toyvm arm

// The ON arm is given as a command line so the same string works for both
// targets; for toyvm it has to become the options object runDos takes.
function toyvmOpts(armFlags) {
  const o = {};
  for (const f of armFlags) {
    let m;
    if (f === '--tree-fold') o.treeFold = Object.assign({}, o.treeFold);
    else if ((m = f.match(/^--tree-fold-hot=(\d+)$/))) o.treeFold = Object.assign({ hot: Number(m[1]) }, o.treeFold, { hot: Number(m[1]) });
    else if ((m = f.match(/^--tree-fold-min=(\d+)$/))) o.treeFold = Object.assign({}, o.treeFold, { minOps: Number(m[1]) });
    else if (f === '--region-jit') o.regionJit = true;
    else if (f === '--block-hits') o.blockHits = true;
    else throw new Error(`fold-ab: no toyvm mapping for arm flag ${f}`);
  }
  return o;
}

async function runToyvm(exe, opts, budget) {
  const { runDos } = require(path.join(ROOT, 'tools', 'toyvm', 'run-dos.js'));
  const r = await runDos({
    exe, variant: 'tailcall', budget, cpu: 386,
    log: () => {}, autoKey: true, cpuMeter: true,
    ...opts,
  });
  return {
    cpu: r.guestCpuSecs, wall: r.secs,
    dispatched: r.dispatched, frame: r.frame,
    tree: r.tree || null,
  };
}

// -------------------------------------------------------- deterministic side

// The half of the answer that does not depend on the box. A fold either
// substituted blocks the program then re-entered, or it did not, and that is a
// COUNT: same number at load 2 and at load 190. On a machine this loaded it is
// the only part of a fold's case that can be stated without a disclaimer, so
// --det runs one on-arm run per target and reports it.
async function det(target, opts) {
  if (target === 'toyvm') {
    const { runDos } = require(path.join(ROOT, 'tools', 'toyvm', 'run-dos.js'));
    const r = await runDos({
      exe: opts.exe, variant: 'tailcall', budget: opts.budget, cpu: 386,
      log: () => {}, autoKey: true, hist: 1, ...opts.arm,
    });
    const t = r.tree || {};
    const entries = r.treeEntries || [];
    // A tree standing for `ops` guest instructions, entered `n` times, removed
    // n*(ops-1) trips through $next. That, over the dispatch count, is the
    // share of the run's dispatch work the fold actually caught.
    let removed = 0, runs = 0;
    (t.treeOps || []).forEach((ops, i) => {
      const n = entries[i] || 0; runs += n; removed += n * (ops - 1);
    });
    console.log(`det ${opts.label}: dispatched ${r.dispatched} frame ${r.frame}`);
    console.log(`det ${opts.label}: trees ${t.trees || 0} installs ${t.installs || 0}`
      + ` folds ${t.folds || 0} foldedOps ${t.foldedOps || 0}`
      + ` hotPromoted ${t.hotPromoted || 0} coldSkipped ${t.coldSkipped || 0}`);
    console.log(`det ${opts.label}: tree entries ${runs}`
      + ` dispatches removed ${removed} (${(100 * removed / r.dispatched).toFixed(3)}% of ${r.dispatched})`);
    return;
  }
  // win98: --loopmatch-stats prints the TREE_FOLD census, --handler-hist the
  // retired-op total the caught share is a fraction of.
  const r = await runWin98([...opts.flags, '--loopmatch-stats', '--handler-hist'], opts.timeoutMs);
  const lines = r.out.split('\n').filter(l =>
    /TREE_FOLD|handler hist|total ops|self-loop blocks|blocks in/.test(l));
  console.log(`det ${opts.label}:`);
  for (const l of lines.slice(0, 20)) console.log(`  ${l}`);
  if (opts.detOut) fs.writeFileSync(opts.detOut, r.out);
}

// ------------------------------------------------------------------ driver

async function main() {
  const target = arg('target', 'win98');
  const reps = Number(arg('reps', 8));
  const armOn = (arg('arm-on', '--tree-fold')).split(/\s+/).filter(Boolean);
  const base = (arg('base', '')).split(/\s+/).filter(Boolean);
  const label = arg('label', target === 'toyvm' ? path.basename(arg('exe', '?')) : arg('app', '?'));
  const timeoutMs = Number(arg('timeout', 120)) * 1000;
  const outFile = arg('out', null);

  const ARMS = ['off', 'on', 'null'];
  const samples = { off: [], on: [], null: [] };
  const meta = { off: [], on: [], null: [] };
  const loads = [];

  let doArm, detCommon = [];
  if (target === 'win98') {
    const app = arg('app', null);
    const work = count(arg('work', '1000'));
    if (!app) throw new Error('--app= is required for --target=win98');
    // --no-build so a rep never pays for a build, and --max-batches is the
    // fixed work. Every arm gets byte-identical flags but the arm switch.
    const common = ['--no-build', `--app=${app}`, `--max-batches=${work}`, ...base, ...args('extra')];
    detCommon = common;
    doArm = (a) => runWin98(a === 'on' ? [...common, ...armOn] : common, timeoutMs);
  } else if (target === 'toyvm') {
    const exe = arg('exe', null);
    const budget = count(arg('work', '20m'));
    if (!exe) throw new Error('--exe= is required for --target=toyvm');
    const on = toyvmOpts(armOn);
    doArm = (a) => runToyvm(exe, a === 'on' ? on : {}, budget);
  } else throw new Error(`unknown --target=${target}`);

  if (flag('det')) {
    if (target === 'toyvm') {
      await det('toyvm', {
        exe: arg('exe'), budget: count(arg('work', '20m')),
        arm: toyvmOpts(armOn), label,
      });
    } else {
      await det('win98', {
        flags: [...detCommon, ...armOn], timeoutMs, label,
        detOut: arg('det-out', null),
      });
    }
    return;
  }

  console.log(`fold-ab  ${target}  ${label}  reps=${reps}  on=[${armOn.join(' ')}]`);
  for (let rep = 0; rep < reps; rep++) {
    const load = os.loadavg()[0];
    loads.push(load);
    // Rotate which arm runs first. A fixed order lets a warm cache on the
    // first arm or a thermal ramp on the last masquerade as the feature.
    const order = ARMS.map((_, i) => ARMS[(i + rep) % ARMS.length]);
    const line = [`rep ${rep} load ${load.toFixed(1)}`];
    for (const a of order) {
      const r = await doArm(a);
      samples[a].push(r.cpu);
      meta[a].push(r);
      line.push(`${a} ${r.cpu.toFixed(2)}s`);
    }
    console.log(line.join('  '));
  }

  // Agreement: the arms must have done the same work. For toyvm that is the
  // frame hash and the dispatch count; for win98 the batch count is the flag
  // and there is nothing cheaper than trusting it.
  if (target === 'toyvm') {
    const frames = new Set(ARMS.flatMap(a => meta[a].map(m => m.frame)));
    const disp = ARMS.flatMap(a => meta[a].map(m => m.dispatched));
    console.log(`frames ${[...frames].join(',')}  dispatched ${Math.min(...disp)}..${Math.max(...disp)}`);
  }

  const paired = (a) => samples[a].map((v, i) => v - samples.off[i]);
  const onOff = paired('on'), nullOff = paired('null');
  const nullSpread = sd(nullOff);
  const resolved = Math.abs(mean(onOff)) > 2 * nullSpread && nullSpread > 0;

  console.log('');
  for (const a of ARMS) {
    console.log(`${a.padEnd(5)} median ${median(samples[a]).toFixed(3)}s  min ${Math.min(...samples[a]).toFixed(3)}s`);
  }
  console.log(`on-off   mean ${mean(onOff).toFixed(3)}s  sd ${sd(onOff).toFixed(3)}  median ${median(onOff).toFixed(3)}`);
  console.log(`null-off mean ${mean(nullOff).toFixed(3)}s  sd ${nullSpread.toFixed(3)}  median ${median(nullOff).toFixed(3)}`);
  const dir = mean(onOff) < 0 ? 'gain' : 'loss';
  console.log(`VERDICT ${resolved ? `resolved ${dir}` : 'unresolvable at this load'}`
    + `  (|on-off| ${Math.abs(mean(onOff)).toFixed(3)} vs 2x null spread ${(2 * nullSpread).toFixed(3)})`);
  const quiet = loads.map((l, i) => (l < 4 ? i : -1)).filter(i => i >= 0);
  if (quiet.length) console.log(`quiet reps (loadavg < 4 at rep start): ${quiet.join(',')}`);

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({
      target, label, armOn, base, reps, loads, samples,
      stats: {
        median: Object.fromEntries(ARMS.map(a => [a, median(samples[a])])),
        min: Object.fromEntries(ARMS.map(a => [a, Math.min(...samples[a])])),
        onOff: { mean: mean(onOff), sd: sd(onOff), median: median(onOff) },
        nullOff: { mean: mean(nullOff), sd: nullSpread, median: median(nullOff) },
        resolved,
      },
      toyvm: target === 'toyvm'
        ? { frames: ARMS.map(a => meta[a].map(m => m.frame)), tree: meta.on.map(m => m.tree) }
        : null,
    }, null, 2) + '\n');
    console.log(`wrote ${outFile}`);
  }
}

main().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
