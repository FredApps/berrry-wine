'use strict';

// Whole toy-VM programs on more than one wasm engine, with nothing but the
// engine: no Node, no browser, no disk.
//
//   node tools/toyvm/shell-bench.js --from=sweep.json [--arms=node,v8,sm,v8-liftoff,sm-baseline]
//   node tools/toyvm/shell-bench.js --exe=/tmp/demos/1995-c-cma_brw/BRW.EXE --dispatches=20m
//
// WHY. engine-bench.js already races node's V8, d8, SpiderMonkey and JSC -- but
// on one hot block replayed from a snapshot, because the whole-program runner
// "needs the node-side decoder in the loop". It does not: the page's JIT bundle
// (docs/dos-corpus/live/toyvm-jit-bundle.js, tools/toyvm/bundle-browser.js)
// already carries run-dos.js and everything it requires, with `fs` faked over
// an in-memory map of Uint8Arrays. A bare engine shell can therefore run the
// SAME sources the CLI runs -- decoder, block cache, SMC repair, the lot -- over
// a program whose whole directory is mounted in memory. What is left to shim is
// four globals (`self`, `atob`, a file reader, a printer).
//
// Every arm, `node` included, runs the bundle rather than the loose sources, so
// the arms differ in the engine and nothing else.
//
// WHAT IS MEASURED. Per run, runDos's own `secs` (wall from the first slice to
// the last, after the VM is built and the program loaded) and `guestSecs` (wall
// inside wasm), and the whole process's wall as `total`, so `total - secs` is
// the start-up: bundle evaluation, the WATX compile of the VM, the engine's
// compile of the module. ns/dispatch is guestSecs over the dispatch count, the
// unit sweep-dos.js quotes. Every arm must retire the same dispatch count and
// draw the same frame as the others -- and, with --from, as the sweep that
// named the program -- or its row is marked, never averaged.
//
// One process per run, arms rotated per program so no engine always runs
// first. Wall clock, so run it on a quiet box: see `loadavg` in the output.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'docs', 'dos-corpus', 'live', 'toyvm-jit-bundle.js');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const flag = (k) => argv.includes(`--${k}`);

function count(s) {
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s).trim());
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()]);
}

// The shells, and the flag that stops each at its baseline compiler. The
// optimizing arms take the engine's DEFAULT tiering (baseline first, optimizer
// on hot functions), which is what a browser runs; engine-bench.js forces
// SpiderMonkey to Ion-only instead, which is a different question.
const JSVU = path.join(os.homedir(), '.jsvu', 'bin');
const ARMS = {
  node: { bin: [process.execPath], flags: [] },
  v8: { bin: [path.join(JSVU, 'v8')], flags: [] },
  sm: { bin: [path.join(JSVU, 'sm'), path.join(JSVU, 'spidermonkey')], flags: [] },
  jsc: { bin: [path.join(JSVU, 'jsc'), path.join(JSVU, 'javascriptcore')], flags: [] },
  'node-liftoff': { bin: [process.execPath], flags: ['--liftoff-only'] },
  'v8-liftoff': { bin: [path.join(JSVU, 'v8')], flags: ['--liftoff-only'] },
  'sm-baseline': { bin: [path.join(JSVU, 'sm'), path.join(JSVU, 'spidermonkey')],
    flags: ['--wasm-compiler=baseline'] },
  'jsc-bbq': { bin: [path.join(JSVU, 'jsc'), path.join(JSVU, 'javascriptcore')],
    flags: ['--useOMGJIT=false'] },
};

function binOf(id) {
  const a = ARMS[id];
  if (!a) throw new Error(`unknown arm ${id} (known: ${Object.keys(ARMS).join(',')})`);
  return a.bin.find((b) => b === process.execPath || fs.existsSync(b)) || null;
}

// The runner, with every parameter baked in as a literal: argv reaches a shell
// script differently in every engine, and a mis-parsed one would silently
// benchmark a default. Only the file reader is feature-detected.
// `--mode=interp` (default) is the threaded interpreter alone. `--mode=jit`
// installs region-jit's compiled region into the same whole-program run, with
// sweep-dos.js's own settings (profile a quarter of the budget, starting a
// quarter in), so the jit arm is the corpus sweep's `--region-jit` run.
function runnerSource(exe, budget, mode) {
  const jit = mode === 'jit'
    ? `, regionJit: { sampleAfter: ${Math.floor(budget / 4)}, profileFor: ${Math.floor(budget / 4)}, gateAt: 0, log: function () {} }`
    // `--mode=uop`: the µop tier (uop-live.js), first profile window a tenth
    // of the way in, then one every 10M dispatches.
    // `--uop-opts=` overrides those two (and adds any other UopLive option) for
    // a diagnosis arm: `--uop-opts={"sampleAfter":1e18}` leaves the tier
    // installed and never profiling, which prices the hook against the
    // programs. Defaulted away, so a run without it is byte-identical.
    : mode === 'uop'
      ? `, uop: { sampleAfter: ${Math.floor(budget / 10)}, profileFor: 1000000`
        + `${arg('uop-opts') ? `, ...${arg('uop-opts')}` : ''} }`
      : '';
  const dir = path.dirname(exe);
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  return `'use strict';
var T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
var nowMs = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
globalThis.self = globalThis;
var nodeFs = (typeof require === 'function') ? require('fs') : null;
function readBin(p) {
  if (typeof readbuffer === 'function') return new Uint8Array(readbuffer(p));           // d8
  if (typeof os !== 'undefined' && os.file && os.file.readFile) return os.file.readFile(p, 'binary'); // sm
  if (typeof read === 'function') return new Uint8Array(read(p, 'binary'));             // jsc
  return new Uint8Array(nodeFs.readFileSync(p));                                        // node
}
var say = (typeof print === 'function') ? print : function (s) { console.log(s); };
if (typeof atob === 'undefined') {
  globalThis.atob = function (s) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = '', b = 0, n = 0;
    for (var i = 0; i < s.length; i++) {
      var v = A.indexOf(s[i]); if (v < 0) continue;
      b = ((b << 6) | v) & 0xFFFFFF; n += 6;
      if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); }
    }
    return o;
  };
}
if (typeof load === 'function') load(${JSON.stringify(BUNDLE)});
else require('vm').runInThisContext(nodeFs.readFileSync(${JSON.stringify(BUNDLE)}, 'utf8'), { filename: 'toyvm-jit-bundle.js' });
var DIR = ${JSON.stringify(dir)}, FILES = ${JSON.stringify(files)};
for (var i = 0; i < FILES.length; i++) ToyVM.mount(FILES[i], readBin(DIR + '/' + FILES[i]));
var runDos = ToyVM.require('tools/toyvm/run-dos.js').runDos;
var T1 = nowMs();
runDos({ exe: ${JSON.stringify(path.basename(exe))}, variant: 'tailcall', budget: ${budget},
  cpu: 386, autoKey: true, log: function () {}${jit} }).then(function (r) {
  say('SHELLBENCH ' + JSON.stringify({ secs: r.secs, guestSecs: r.guestSecs,
    dispatched: r.dispatched, frame: r.frame, startMs: T1 - T0, totalMs: nowMs() - T0,
    jit: r.jit ? { phase: r.jit.phase, installs: r.jit.installs, share: r.jit.share } : null,
    uop: r.uop ? { outcome: r.uop.outcome, windows: r.uop.windows, samples: r.uop.samples, bestShare: r.uop.bestShare,
      installs: r.uop.installs, entries: r.uop.entries, steps: r.uop.steps, bails: r.uop.bails,
      rebuilds: r.uop.rebuilds, gaveUp: r.uop.gaveUp, demoted: r.uop.demoted.length,
      declined: r.uop.declined, demotedWhy: r.uop.demoted, refusedHeads: r.uop.refusedHeads,
      demotedHeads: r.uop.demotedHeads, liveHeads: r.uop.heads.map(function (h) { return { head: h.head, share: h.share }; }) } : null }));
}, function (e) { say('SHELLBENCH-ERR ' + String(e && e.stack || e).split('\\n').slice(0, 4).join(' | ')); });
`;
}

function runArm(id, script, timeoutS) {
  return new Promise((resolve) => {
    const bin = binOf(id);
    const args = [...ARMS[id].flags, script];
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => p.kill('SIGKILL'), timeoutS * 1000);
    p.on('close', (code, sig) => {
      clearTimeout(kill);
      const m = /^SHELLBENCH (.*)$/m.exec(out);
      if (m) return resolve({ ok: true, ...JSON.parse(m[1]) });
      const e = /^SHELLBENCH-ERR (.*)$/m.exec(out);
      resolve({ ok: false, reason: sig === 'SIGKILL' ? 'timeout'
        : e ? `error: ${e[1]}` : `exit ${code}: ${(err || out).trim().split('\n').slice(-2).join(' | ')}` });
    });
  });
}

// Start-up, in two halves the runner can see: `startMs` is evaluating the bundle
// and mounting the files, and runDos builds the VM (the WATX compile of the
// toy VM's module, then the engine's compile of it) BEFORE its own clock starts
// -- so what is left of the process wall after `secs` is bundle + build.
const buildS = (r) => Math.max(0, r.totalMs / 1000 - r.secs);

const geomean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

async function main() {
  // A stale bundle benchmarks yesterday's VM. bundle-browser.js --check is the
  // same gate build.sh runs.
  const chk = spawnSync(process.execPath, [path.join(__dirname, 'bundle-browser.js'), '--check'],
    { encoding: 'utf8' });
  if (chk.status !== 0 || !/toyvm-jit-bundle\.js: up to date/.test(chk.stdout)) {
    throw new Error(`the JIT bundle is stale -- run node tools/toyvm/bundle-browser.js\n${chk.stdout}${chk.stderr}`);
  }

  const arms = arg('arms', 'node,v8,sm').split(',').filter(Boolean);
  for (const a of arms) if (!binOf(a)) throw new Error(`no binary for arm ${a} (npx jsvu --engines=v8,spidermonkey)`);
  const timeoutS = Number(arg('timeout', 300));
  const outFile = arg('out', null);
  const mode = arg('mode', 'interp');
  if (!['interp', 'jit', 'uop'].includes(mode)) throw new Error(`--mode= is interp, jit or uop, not ${mode}`);

  // The programs: a sweep's own rows and budget (so the frames it recorded are
  // a check on every arm), or an explicit list.
  let progs, budget, from = null;
  if (arg('from')) {
    from = JSON.parse(fs.readFileSync(arg('from'), 'utf8'));
    budget = count(arg('dispatches', String(from.opts.budget)));
    progs = from.rows.map((r) => ({ exe: r.exe, sweepFrame: arg('dispatches') ? null : r.frame,
      sweepDispatched: arg('dispatches') ? null : r.dispatched }));
  } else {
    budget = count(arg('dispatches', '20m'));
    progs = arg('exe', '').split(',').filter(Boolean).map((exe) => ({ exe }));
  }
  const only = arg('only', null);
  if (only) progs = progs.filter((p) => new RegExp(only, 'i').test(path.basename(p.exe)));
  if (!progs.length) throw new Error('no programs: pass --from=sweep.json or --exe=a,b');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-bench-'));
  console.log(`shell-bench: ${progs.length} program(s), ${budget} dispatches, arms ${arms.join(',')}`
    + `, loadavg ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  const rows = [];
  for (let pi = 0; pi < progs.length; pi++) {
    const p = progs[pi];
    const script = path.join(work, `run-${pi}.js`);
    fs.writeFileSync(script, runnerSource(p.exe, budget, mode));
    const row = { exe: p.exe, name: path.basename(p.exe), load: os.loadavg()[0], arms: {} };
    for (let i = 0; i < arms.length; i++) {
      const a = arms[(i + pi) % arms.length];
      row.arms[a] = await runArm(a, script, timeoutS);
    }
    // Agreement: every arm that finished against the first that did, and
    // against the sweep's record when there is one.
    const done = arms.map((a) => row.arms[a]).filter((r) => r.ok);
    // A region is allowed to move the picture by a phase against the plain
    // sweep (docs: region census `phase`), so the jit arms answer to each other.
    const ref = p.sweepFrame && mode === 'interp'
      ? { frame: p.sweepFrame, dispatched: p.sweepDispatched } : done[0];
    const bad = done.length && ref ? arms.filter((a) => row.arms[a].ok
      && (row.arms[a].frame !== ref.frame || row.arms[a].dispatched !== ref.dispatched)) : [];
    row.disagree = bad;
    row.failed = arms.filter((a) => !row.arms[a].ok);
    rows.push(row);
    const cell = (a) => {
      const r = row.arms[a];
      if (!r.ok) return `${a} FAIL(${r.reason.slice(0, 40)})`;
      return `${a} ${(r.guestSecs * 1e9 / r.dispatched).toFixed(1)}ns/d build ${buildS(r).toFixed(2)}s`;
    };
    console.log(`[${pi + 1}/${progs.length}] ${row.name.padEnd(14)} ${arms.map(cell).join('  ')}`
      + (bad.length ? `  DISAGREE ${bad.join(',')}` : '') + `  load ${row.load.toFixed(2)}`);
    if (outFile) fs.writeFileSync(outFile, JSON.stringify({ budget, arms, from: arg('from', null), rows }, null, 1));
  }
  // `--keep` leaves the generated runners, so one can be re-run under a
  // profiler (`node --cpu-prof run-0.js`, `sm run-0.js`) exactly as benchmarked.
  if (flag('keep')) console.log(`runners kept in ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });

  // Summary: each arm's ns/dispatch against the first arm's, over the programs
  // where every arm finished and agreed. A geometric mean, because these are
  // ratios and one 10x program must not outvote a hundred 1.1x ones.
  const clean = rows.filter((r) => !r.failed.length && !r.disagree.length);
  const base = arms[0];
  console.log(`\n${clean.length} of ${rows.length} program(s) clean in every arm`
    + ` (${rows.filter((r) => r.failed.length).length} with a failed arm,`
    + ` ${rows.filter((r) => r.disagree.length).length} disagreeing)`);
  const nsd = (r, a) => r.arms[a].guestSecs * 1e9 / r.arms[a].dispatched;
  for (const a of arms) {
    if (!clean.length) break;
    const ratios = clean.map((r) => nsd(r, a) / nsd(r, base));
    ratios.sort((x, y) => x - y);
    const q = (f) => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))];
    const start = clean.map((r) => buildS(r.arms[a])).sort((x, y) => x - y);
    console.log(`  ${a.padEnd(12)} run vs ${base}: geomean x${geomean(ratios).toFixed(3)}`
      + `  p10 x${q(0.1).toFixed(2)}  p50 x${q(0.5).toFixed(2)}  p90 x${q(0.9).toFixed(2)}`
      + `  | median ns/d ${geomean(clean.map((r) => nsd(r, a))).toFixed(1)} (geo)`
      + `  | bundle+build median ${start[start.length >> 1].toFixed(2)}s`);
  }
  for (const r of rows) {
    if (r.failed.length) console.log(`  FAIL ${r.name}: ${r.failed.map((a) => `${a}: ${r.arms[a].reason}`).join('; ')}`);
    if (r.disagree.length) {
      console.log(`  DISAGREE ${r.name}: ${r.disagree.map((a) => `${a} ${r.arms[a].dispatched}/${r.arms[a].frame}`).join(', ')}`);
    }
  }
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
