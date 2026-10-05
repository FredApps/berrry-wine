#!/usr/bin/env node
'use strict';
// Bounded slice-record diagnostic: head and v2v3 (v2 4a9ba394 + v3 76825987,
// the schedule-only patches) on BLIQ and CAVEIRA, P3's exact witness recipe via
// wav-drive.js, plus run-dos's own per-handback slice records, so that every
// moved interrupt delivery can be classified (classify-moves.js) instead of
// argued about. Answers root's review of 2994e486 (2026-10-05 ~17:30Z):
//
//  - LIVE CAP ON THE SLICE RECORD. run-dos holds the records in memory and
//    writes them once at the end with writeFileSync. Pointed at a file, that
//    write is uncappable while it happens. Here --slice-log names a FIFO this
//    process drains (see runChild), writing at most `cap` bytes to disk and
//    killing the run's process group the moment the cap is passed (exit 6).
//  - BOUNDED BEFORE IT STARTS. Each record line has a maximum length fixed by
//    its format (LINE_MAX below), and each run's handback count is pinned by the
//    deterministic full-trace rerun (wav-run-full-20261005), so the worst case
//    of every slice file, plus every capped stdout log, plus the WAVs, is summed
//    before anything runs and must fit --out-cap-mb (default 512), and free disk
//    must exceed the output cap plus a margin; otherwise nothing runs.
//  - MEMORY. The driver runs with --max-old-space-size=--heap-mb (the records
//    live in V8 old space until the end), and this process polls each run's
//    VmRSS from /proc and kills its group past --rss-cap-mb (exit 8). Each row
//    records the kernel's peak RSS for the run.
//  - COMPLETE RECORD ACCOUNTING. DosLoop.step increments `handbacks` and calls
//    afterSlice exactly once per handback (dos-loop.js, one increment site, no
//    return between), and run-dos's afterSlice pushes exactly one line with no
//    return before it. So the slice file must hold exactly row.handbacks lines,
//    each matching the strict format and within LINE_MAX, dispatched
//    non-decreasing, the last equal to row.dispatched; and row.handbacks must
//    equal the pinned count. Anything else is SLICE-INCOMPLETE (exit 7).
//  - Kept from wav-run.js 0555a08d: exact P3 reproduction on every guest field
//    (head = P3 base, v2v3 = P3 cand, both = the full-trace rerun's rows, which
//    also pin handbacks and irqs) or VOID (exit 3); complete irq traces (log
//    lines == irqs, the stdout-flush gate) or exit 7; one total bound with
//    process-group kill (exit 5); hard stdout log cap (exit 6); pinned program
//    directories and patches; fresh --out only; built trees deleted on exit.
//
//   node slice-diag.js --w=<work dir with demos/> --out=<new dir> --dry-run|--run
//     [--total=300] [--log-cap-mb=64] [--out-cap-mb=512] [--rss-cap-mb=3072] [--heap-mb=1536]
//   test hooks: --trees=DIR, --drive=PATH, --expect=FILE (expectations JSON
//   instead of the pinned rows), --no-pins, --min-free-mb=N
// Exit: 0 PASS (classification written; not an audio-correctness verdict),
// 2 prep/pin/driver failure or non-empty --out, 3 VOID, 4 missing/unhealthy
// output, 5 DEADLINE, 6 SIZE (preflight, log, slice or output), 7 trace or
// slice record INCOMPLETE, 8 MEMORY, 130 signalled.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { classify } = require('./classify-moves');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const flag = (k) => argv.includes(`--${k}`);
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const DRIVE = arg('drive', path.join(__dirname, 'wav-drive.js'));
const TOTAL_S = Number(arg('total', 300));
const MB = 1048576;
const LOG_CAP = Number(arg('log-cap-mb', 64)) * MB;
const OUT_CAP = Number(arg('out-cap-mb', 512)) * MB;
const RSS_CAP = Number(arg('rss-cap-mb', 3072)) * MB;
const HEAP_MB = Number(arg('heap-mb', 1536));
const MIN_FREE = Number(arg('min-free-mb', 256)) * MB;
const WAV_ALLOW = MB;   // a WAV is 704,684 bytes at 80M dispatches
const GRACE_MS = 3000;
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const P = {
  v2: [path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch'), '4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78'],
  v3: [path.join(REV, 'v3-delta-on-v2.patch'), '76825987d215d05287ace963b7fb8e15f0448371df0aa6d148cd683e89b2e62f'],
};
const TREES = { head: [], v2v3: ['v2', 'v3'] };
const PROGRAMS = {
  '1994-b-bliq/BLIQ.EXE': { args: ['--trace-irq', '--trace-io=40,43'], regs: true,
    pin: '971da3aaffd61c3d900dabd1abe79fe3beb20476ace2907e41415acc2b76059d' },
  '1993-c-caveira/CAVEIRA.COM': { args: ['--trace-irq'], regs: false,
    pin: '1ab3d3f0178bac8e0821932f75d7d7bac766873a001459f94f525c0bb75ca5a8' },
};
// Line format and its proven maximum lengths: slice-format.js.
const { LINE_MAX, LINE_RE } = require('./slice-format');
const GUEST = ['wav', 'frame', 'dispatched', 'irqs', 'ints', 'pixels'];
// Pinned expectation sources: P3's rows and the deterministic full-trace rerun.
const EXPECT_FILES = {
  'p3-base': [path.join(REV, 'full-stage2-attempt2-20261005/out/arms-base.ndjson'), 'ac7bd434770a9c7873e76bd4086cfb455ae04efda237d6acbc5113d350d5d46d'],
  'p3-cand': [path.join(REV, 'full-stage2-attempt2-20261005/out/arms-cand.ndjson'), 'd0e1c3c72523f2d23d45988e9b6cbaeba565af43ba0a87630412e5ca0edb1095'],
  'head/BLIQ': [path.join(REV, 'wav-run-full-20261005/head-BLIQ.json'), '5373fbef66ade98e26de83d859d0b5eba111a80546c850780e87575a23cef379'],
  'head/CAVEIRA': [path.join(REV, 'wav-run-full-20261005/head-CAVEIRA.json'), 'a17e3bc4413053118e14f9053fb3a4749a2961e2daaf397fa7c6979fa6cfa01b'],
  'v2v3/BLIQ': [path.join(REV, 'wav-run-full-20261005/v2v3-BLIQ.json'), 'ad50981fc97f4f8dc0855a96bbc94559a7d2244988d8877aefba50a18d38adbe'],
  'v2v3/CAVEIRA': [path.join(REV, 'wav-run-full-20261005/v2v3-CAVEIRA.json'), 'e99c4cfec850588a0aa6ceb13a33c9984cf10e1d8c17ac77d60eef23ca882971'],
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stem = (p) => path.basename(p).replace(/\.[^.]+$/, '');
function dirDigest(dir) {
  const lines = fs.readdirSync(dir).sort().filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((n) => `${n} ${sha(path.join(dir, n))}`);
  return crypto.createHash('sha256').update(lines.join('\n') + '\n').digest('hex');
}
const W = arg('w'), OUT = arg('out');
if (!W || !OUT || (!flag('dry-run') && !flag('run'))) {
  console.error('usage: node slice-diag.js --w=<work dir with demos/> --out=<new dir> --dry-run|--run [--total=S] [--log-cap-mb=N] [--out-cap-mb=N] [--rss-cap-mb=N] [--heap-mb=N]');
  process.exit(2);
}
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) {
  console.error(`refusing: --out ${OUT} exists and is not empty (earlier evidence is never overwritten)`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const builtTrees = !arg('trees');
const treesDir = arg('trees', path.join(OUT, 'trees'));
const result = { status: 'running', startedAt: new Date(t0).toISOString(), totalS: TOTAL_S, node: process.version,
  caps: { logMb: LOG_CAP / MB, outMb: OUT_CAP / MB, rssMb: RSS_CAP / MB, heapMb: HEAP_MB, lineMax: LINE_MAX },
  pins: { base: BASE, patches: Object.fromEntries(Object.entries(P).map(([k, [, h]]) => [k, h])),
    driver: sha(DRIVE), runner: sha(__filename), classify: sha(path.join(__dirname, 'classify-moves.js')),
    format: sha(path.join(__dirname, 'slice-format.js')) },
  runs: {}, failures: [] };
const writeResult = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1) + '\n');
function cleanup() {
  if (builtTrees) { try { fs.rmSync(treesDir, { recursive: true, force: true }); result.treesDeleted = true; } catch (e) { result.treesDeleted = String(e.message); } }
}
function finish(status, code, msg) {
  result.status = status;
  if (msg) result.failures.push(msg);
  result.elapsedS = (Date.now() - t0) / 1000;
  killAll();
  cleanup();
  writeResult();
  console.log(`${status}${msg ? `: ${msg}` : ''}`);
  process.exit(code);
}

// --- children: own process group each, all killed together ---------------------
const live = new Set();
function killGroup(ch, sig) { try { process.kill(-ch.pid, sig); } catch { try { ch.kill(sig); } catch {} } }
function killAll() { for (const ch of live) killGroup(ch, 'SIGKILL'); }
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => finish('SIGNALLED', 130, `received ${s}`));
const remainingMs = () => TOTAL_S * 1000 - (Date.now() - t0);
function rssOf(pid) {
  try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m); return m ? Number(m[1]) * 1024 : 0; } catch { return 0; }
}
// One run. stdout+stderr -> `log` and the FIFO `fifo` -> `slices`, each through
// this process with a hard byte cap; RSS polled against RSS_CAP. Resolves
// { code, ... } with code 124 deadline, 125 log cap, 126 slice cap, 123 RSS
// cap, 127 no start.
// The slice record travels through a named FIFO, not an extra stdio pipe: Node
// makes stdio 'pipe's as socketpairs, and run-dos's writeFileSync('/dev/fd/3')
// on a socket fails with ENXIO (measured, fd3-probe). This process holds the
// FIFO O_RDWR|O_NONBLOCK, so the driver's open never blocks and no EOF race
// exists, and drains it with readSync: the driver's write blocks whenever the
// pipe is full, so nothing reaches disk unless this loop wrote it under the cap.
function runChild(cmd, args, log, fifo, slices, logCap, sliceCap) {
  return new Promise((resolve) => {
    const lfd = fs.openSync(log, 'w'), sfd = fs.openSync(slices, 'w');
    if (spawnSync('mkfifo', [fifo]).status !== 0) finish('FAIL', 2, `mkfifo ${fifo} failed`);
    const ffd = fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    const fbuf = Buffer.alloc(1 << 20);
    let ch, done = false, why = 0, t = null, hard = null, poll = null, dt = null, lw = 0, sw = 0, peakRss = 0;
    // Returns bytes read this call; writes at most what the cap leaves.
    const drainFifo = () => {
      let got = 0;
      for (;;) {
        let n;
        try { n = fs.readSync(ffd, fbuf, 0, fbuf.length, null); } catch (e) { if (e.code === 'EAGAIN') break; throw e; }
        if (!n) break;
        got += n;
        if (why) continue;   // stopping: discard
        const room = sliceCap - sw, k = Math.min(room, n);
        if (k > 0) { fs.writeSync(sfd, fbuf, 0, k); sw += k; }
        if (n > room) stop(126);
      }
      return got;
    };
    const pump = () => { if (done) return; dt = drainFifo() ? setImmediate(pump) : setTimeout(pump, 5); };
    const end = (code) => {
      if (done) return;
      drainFifo();
      done = true;
      for (const x of [t, hard]) if (x) clearTimeout(x);
      if (poll) clearInterval(poll);
      if (ch) { live.delete(ch); if (ch.pid) killGroup(ch, 'SIGKILL'); }
      fs.closeSync(lfd); fs.closeSync(sfd); fs.closeSync(ffd); fs.unlinkSync(fifo);
      resolve({ code: why || code, logBytes: lw, sliceBytes: sw, polledPeakRss: peakRss });
    };
    const stop = (code) => { if (why) return; why = code; killGroup(ch, 'SIGTERM'); hard = setTimeout(() => killGroup(ch, 'SIGKILL'), GRACE_MS); };
    const left = remainingMs();
    if (left <= 0) { why = 124; return end(124); }
    try { ch = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { fs.writeSync(lfd, `spawn failed: ${e.message}\n`); return end(127); }
    live.add(ch);
    const logSink = (buf) => {
      if (why || done) return;
      const room = logCap - lw, n = Math.min(room, buf.length);
      if (n > 0) { fs.writeSync(lfd, buf, 0, n); lw += n; }
      if (buf.length > room) stop(125);
    };
    ch.stdout.on('data', logSink); ch.stderr.on('data', logSink);
    ch.on('error', (e) => { fs.writeSync(lfd, `spawn failed: ${e.message}\n`); end(127); });
    t = setTimeout(() => stop(124), left);
    poll = setInterval(() => { const r = rssOf(ch.pid); if (r > peakRss) peakRss = r; if (r > RSS_CAP) stop(123); }, 200);
    pump();
    ch.on('close', (code) => end(code === null ? 1 : code));
  });
}
function outBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (p === treesDir) continue;
    n += e.isDirectory() ? outBytes(p) : e.isFile() ? fs.statSync(p).size : 0;
  }
  return n;
}

// --- expectations ---------------------------------------------------------------
function loadExpect() {
  if (arg('expect')) return JSON.parse(fs.readFileSync(arg('expect'), 'utf8'));
  for (const [k, [f, h]] of Object.entries(EXPECT_FILES)) {
    if (!fs.existsSync(f) || sha(f) !== h) finish('FAIL', 2, `expectation ${k}: ${f} missing or hash mismatch`);
  }
  const p3 = (side, p) => {
    const rows = fs.readFileSync(EXPECT_FILES[`p3-${side}`][0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((r) => r.arm === 'l1' && r.recipe === 'witness' && r.irqSchedule === true && Number(r.budget) === 80e6 && r.exe.endsWith('/' + p));
    if (rows.length !== 1) finish('FAIL', 2, `P3 ${side}: ${rows.length} rows for ${p}`);
    return rows[0];
  };
  const out = {};
  for (const p of Object.keys(PROGRAMS)) {
    for (const [tree, side] of [['head', 'base'], ['v2v3', 'cand']]) {
      const k = `${tree}/${stem(p)}`, full = JSON.parse(fs.readFileSync(EXPECT_FILES[k][0], 'utf8')), p3row = p3(side, p);
      for (const g of GUEST) if (full[g] !== p3row[g]) finish('FAIL', 2, `expectation ${k}: full rerun ${g} ${full[g]} != P3 ${side} ${p3row[g]}`);
      out[k] = { guest: Object.fromEntries(GUEST.map((g) => [g, full[g]])), handbacks: full.handbacks };
    }
  }
  return out;
}
const EXPECT = loadExpect();
result.expect = EXPECT;

// --- pins, trees, preflight -----------------------------------------------------
const progs = {};
for (const [p, cfg] of Object.entries(PROGRAMS)) {
  const file = path.resolve(path.join(W, 'demos', p));
  if (!fs.existsSync(file)) finish('FAIL', 2, `missing program ${file}`);
  const d = dirDigest(path.dirname(file));
  if (!flag('no-pins') && d !== cfg.pin) finish('FAIL', 2, `${p}: directory digest ${d} != pinned ${cfg.pin}`);
  progs[p] = file;
  result.runs[stem(p)] = { file, dirDigest: d };
}
const plan = [];
for (const tree of Object.keys(TREES)) for (const p of Object.keys(PROGRAMS)) {
  const e = EXPECT[`${tree}/${stem(p)}`];
  if (!e || !Number.isInteger(e.handbacks)) finish('FAIL', 2, `no pinned handbacks for ${tree}/${stem(p)}`);
  plan.push({ tree, p, sliceBound: e.handbacks * LINE_MAX[PROGRAMS[p].regs ? 'regs' : 'plain'] });
}
const worst = plan.reduce((n, r) => n + r.sliceBound + LOG_CAP + WAV_ALLOW, 0) + 2 * MB;
result.preflight = { worstCaseBytes: worst, perRun: plan.map((r) => ({ run: `${r.tree}/${stem(r.p)}`, sliceBound: r.sliceBound, logCap: LOG_CAP })) };
if (worst > OUT_CAP) finish('SIZE', 6, `preflight: worst case ${worst} bytes > output cap ${OUT_CAP}`);
const free = (() => { try { const s = fs.statfsSync(OUT); return s.bavail * s.bsize; } catch { return Infinity; } })();
result.preflight.freeBytes = free;
if (free < OUT_CAP + MIN_FREE) finish('FAIL', 2, `preflight: ${free} bytes free < output cap + ${MIN_FREE / MB} MB margin`);
if (builtTrees) {
  const tests = execFileSync('git', ['-C', R, 'ls-tree', '--name-only', BASE, 'test/'], { encoding: 'utf8' })
    .split('\n').filter((l) => l.startsWith('test/test-toyvm-'));
  const tarball = execFileSync('git', ['-C', R, 'archive', BASE, ...CLOSURE, ...tests], { maxBuffer: 1 << 30 });
  for (const [name, patches] of Object.entries(TREES)) {
    const t = path.join(treesDir, name);
    fs.mkdirSync(t, { recursive: true });
    if (spawnSync('tar', ['-x', '-C', t], { input: tarball }).status !== 0) finish('FAIL', 2, `${name}: tar`);
    fs.symlinkSync(path.join(R, 'node_modules'), path.join(t, 'node_modules'));
    for (const k of patches) {
      const [file, want] = P[k];
      if (!fs.existsSync(file) || sha(file) !== want) finish('FAIL', 2, `${name}: ${k} patch missing or hash mismatch`);
      const r = spawnSync('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', t], { input: fs.readFileSync(file) });
      if (r.status !== 0) finish('FAIL', 2, `${name}: patch ${k} failed`);
    }
  }
}
result.trees = {};
for (const name of Object.keys(TREES)) {
  const t = path.join(treesDir, name);
  if (!fs.existsSync(t)) finish('FAIL', 2, `tree ${name} missing at ${t}`);
  result.trees[name] = { patches: TREES[name], files: {} };
  for (const f of ['dos-loop', 'run-dos', 'audio', 'dos']) {
    const file = path.join(t, 'tools/toyvm', f + '.js');
    result.trees[name].files[f] = fs.existsSync(file) ? sha(file).slice(0, 16) : null;
  }
}
const base = (tree, p) => path.join(OUT, `${tree}-${stem(p)}`);
const cmd = (tree, p) => [`--max-old-space-size=${HEAP_MB}`, DRIVE, `--tree=${path.join(treesDir, tree)}`, `--exe=${progs[p]}`,
  `--wav=${base(tree, p)}.wav`, `--row=${base(tree, p)}.json`, ...PROGRAMS[p].args,
  `--slice-log=${base(tree, p)}.fifo`, ...(PROGRAMS[p].regs ? ['--slice-log-regs'] : [])];
result.commands = Object.fromEntries(plan.map((r) => [`${r.tree}/${stem(r.p)}`, `node ${cmd(r.tree, r.p).join(' ')}`]));
if (flag('dry-run')) finish('DRY-RUN', 0, null);

// --- per-run gates ----------------------------------------------------------------
function readRow(tree, p) {
  const f = `${base(tree, p)}.json`, w = `${base(tree, p)}.wav`, key = `${tree}/${stem(p)}`;
  if (!fs.existsSync(f)) finish('FAIL', 4, `${key}: no row`);
  let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { finish('FAIL', 4, `${key}: malformed row`); }
  if (r.ok !== true || r.ranOutOfTime || r.stuckAt) finish('FAIL', 4, `${key}: unhealthy`);
  if (!fs.existsSync(w) || r.wavSha256 !== sha(w)) finish('FAIL', 4, `${key}: WAV missing or not the row's`);
  return r;
}
function sliceAccounting(file, regs, row) {
  const re = LINE_RE[regs ? 'regs' : 'plain'], max = LINE_MAX[regs ? 'regs' : 'plain'];
  const text = fs.readFileSync(file, 'latin1');
  const acc = { bytes: text.length, lines: 0, maxLine: 0, bad: 0, firstBad: null, decreasing: 0, last: null };
  if (text.length && !text.endsWith('\n')) { acc.bad++; acc.firstBad = 'no trailing newline (truncated write)'; }
  let s = 0, prev = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10) continue;
    const l = text.slice(s, i); s = i + 1; acc.lines++;
    if (l.length + 1 > acc.maxLine) acc.maxLine = l.length + 1;
    if (l.length + 1 > max || !re.test(l)) { acc.bad++; if (!acc.firstBad) acc.firstBad = `line ${acc.lines}: ${l.slice(0, 80)}`; continue; }
    const d = Number(l.slice(0, l.indexOf(' ')));
    if (d < prev) acc.decreasing++;
    prev = d; acc.last = d;
  }
  acc.complete = acc.bad === 0 && acc.decreasing === 0 && acc.lines === row.handbacks && acc.last === row.dispatched;
  return acc;
}
const irqLines = (log) => fs.readFileSync(log, 'utf8').split('\n').filter((l) => /^\s*irq vec=/.test(l)).length;

(async () => {
  for (const { tree, p, sliceBound } of plan) {
    const key = `${tree}/${stem(p)}`, log = `${base(tree, p)}.log`, slices = `${base(tree, p)}.slices`;
    const budget = OUT_CAP - outBytes(OUT) - WAV_ALLOW;
    const logCap = Math.max(0, Math.min(LOG_CAP, budget));
    const sliceCap = Math.max(0, Math.min(sliceBound, budget - logCap));
    const r = await runChild(process.execPath, cmd(tree, p), log, `${base(tree, p)}.fifo`, slices, logCap, sliceCap);
    const run = result.runs[stem(p)][tree] = { exit: r.code, logBytes: r.logBytes, sliceBytes: r.sliceBytes,
      logCap, sliceCap, polledPeakRss: r.polledPeakRss };
    writeResult();
    if (r.code === 124) finish('DEADLINE', 5, `total bound ${TOTAL_S}s reached during ${key}`);
    if (r.code === 125) finish('SIZE', 6, `${key}: stdout log reached its cap (${logCap} bytes)`);
    if (r.code === 126) finish('SIZE', 6, `${key}: slice record reached its cap (${sliceCap} bytes)`);
    if (r.code === 123) finish('MEMORY', 8, `${key}: RSS passed ${RSS_CAP / MB} MB`);
    if (r.code !== 0) finish('FAIL', 2, `${key}: driver exit ${r.code}`);
    if (outBytes(OUT) > OUT_CAP) finish('SIZE', 6, `output passed ${OUT_CAP / MB} MB after ${key}`);
    const row = readRow(tree, p);
    run.row = row;
    const e = EXPECT[key];
    const bad = GUEST.filter((g) => row[g] !== e.guest[g]).map((g) => `${g} ${row[g]} != ${e.guest[g]}`);
    if (row.handbacks !== e.handbacks) bad.push(`handbacks ${row.handbacks} != ${e.handbacks}`);
    if (bad.length) finish('VOID', 3, `${key} not reproduced: ${bad.join('; ')}`);
    run.irqTrace = { lines: irqLines(log), irqs: row.irqs };
    if (run.irqTrace.lines !== row.irqs) finish('INCOMPLETE', 7, `${key}: irq trace ${run.irqTrace.lines}/${row.irqs} lines`);
    run.slices = sliceAccounting(slices, PROGRAMS[p].regs, row);
    writeResult();
    if (!run.slices.complete) finish('INCOMPLETE', 7, `${key}: slice record incomplete: ${run.slices.lines}/${row.handbacks} lines, ${run.slices.bad} malformed`
      + `${run.slices.firstBad ? ` (${run.slices.firstBad})` : ''}, ${run.slices.decreasing} decreasing, last ${run.slices.last} vs dispatched ${row.dispatched}`);
  }
  // --- classification ------------------------------------------------------------
  const md = ['# Slice-record classification (head vs v2v3)', '',
    'PASS = every gate held: P3 reproduced, irq traces and slice records complete. Not an audio-correctness verdict.', ''];
  result.classification = {};
  for (const p of Object.keys(PROGRAMS)) {
    const s = stem(p);
    const c = classify({ headLog: `${base('head', p)}.log`, v2v3Log: `${base('v2v3', p)}.log`,
      headSlices: `${base('head', p)}.slices`, v2v3Slices: `${base('v2v3', p)}.slices`, regs: PROGRAMS[p].regs });
    result.classification[s] = c;
    md.push(`## ${s}`, '', `head deliveries ${c.head.irqs}, moved ${c.head.moved}: ${JSON.stringify(c.head.classes)} (ambiguous ${c.head.ambiguous})`,
      `v2v3 deliveries ${c.v2v3.irqs}, moved ${c.v2v3.moved}: ${JSON.stringify(c.v2v3.classes)} (ambiguous ${c.v2v3.ambiguous})`,
      `episodes ${c.episodes}; class of each episode's first head delivery: ${JSON.stringify(c.firstClass)}`, '');
    for (const e of c.detail.slice(0, 10)) md.push(`- head #${e.headIndex} at ${e.at} ${e.class} (left ${e.left}, ${e.ip}) -> v2v3 ${e.v2v3Replacement} (+${e.laterBy})`
      + (e.v2v3Window ? `; v2v3 window ${e.v2v3Window.handbacks} handbacks, ${e.v2v3Window.stops} stops, IF=1 at ${e.v2v3Window.stopsIF1}` : ''));
    md.push('');
  }
  fs.writeFileSync(path.join(OUT, 'classification.md'), md.join('\n') + '\n');
  finish('PASS', 0, null);
})().catch((e) => finish('FAIL', 1, String(e && e.stack || e)));
