#!/usr/bin/env node
'use strict';
// The bounded WAV reference check of wav-validate/PLAN.md: BLIQ, CYCLE and
// CAVEIRA on five hash-pinned trees from base 2683a6e3 (head, v2v3, v2v3j,
// v2v3j_v4, stack), one wav-drive.js run per tree x program, with P3's exact
// witness recipe plus read-only irq/PIT traces.
//
// Gates (result.json is written on success AND on every failure):
//  - inputs are pinned: base commit, every patch by sha256, every program
//    directory by a digest of its files; a mismatch is a prep failure (exit 2);
//  - head and stack run FIRST and must reproduce P3's preserved l1 rows
//    (full-stage2-attempt2-20261005/out/arms-{base,cand}.ndjson) on every guest
//    field -- wav, frame, dispatched, irqs, ints, pixels -- or nothing is
//    attributed and the middle trees are not run (VOID, exit 3);
//  - every run must leave its WAV and its row, healthy (exit 4 otherwise);
//  - ONE total wall bound for all runs (default 300 s); every child runs in its
//    own process group and is killed with its descendants on the deadline, on
//    failure or on a signal (DEADLINE, exit 5);
//  - output size: each log is polled while it is written and its run is killed
//    past --log-cap-mb (default 64); the output directory, trees excluded, may
//    not pass --out-cap-mb (default 512) (SIZE, exit 6);
//  - trace completeness: under --trace-irq every run's irq line count must
//    equal its `irqs` counter (each raise() both counts and logs); otherwise
//    analysis.md is still written, marked prefix-only (TRACE-INCOMPLETE, exit 7);
//  - --out must be new or empty; nothing earlier is ever overwritten;
//  - the trees this script builds are deleted on every exit (they are
//    reproducible from the pins); logs, WAVs and rows are kept.
// PASS (exit 0) means the reference check COMPLETED with P3 reproduced. It is
// not a verdict that the new audio is correct; analysis.md reports the
// per-tree changes, the audio clock and the first trace divergences.
//
//   node wav-run.js --w=<work dir with demos/> --out=<new dir> --dry-run|--run
//     [--total=S] [--log-cap-mb=N] [--out-cap-mb=N] [--no-trace]
//   test hooks: --trees=DIR (prepared trees, not built, not deleted),
//   --drive=PATH (driver), --p3=DIR (preserved arms rows), --no-pins (skip the
//   program-digest pins, for fixtures)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { readWav, compare } = require('./wav-compare');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const flag = (k) => argv.includes(`--${k}`);
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const J = path.join(R, 'scratch/claude-toyvm-jmpsyn-j-20261005');
const DRIVE = arg('drive', path.join(__dirname, 'wav-drive.js'));
const P3DIR = arg('p3', path.join(REV, 'full-stage2-attempt2-20261005/out'));
const TOTAL_S = Number(arg('total', 300));
const LOG_CAP = Number(arg('log-cap-mb', 64)) * 1048576;
const OUT_CAP = Number(arg('out-cap-mb', 512)) * 1048576;
const GRACE_MS = 3000;
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const P = {
  v2: [path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch'), '4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78'],
  v3: [path.join(REV, 'v3-delta-on-v2.patch'), '76825987d215d05287ace963b7fb8e15f0448371df0aa6d148cd683e89b2e62f'],
  v2v3j: [path.join(J, 'v2-v3-j-combined.patch'), '54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82'],
  v4: [path.join(J, 'v4-delta-on-combined.patch'), '4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b'],
  smc: [path.join(J, 'smc-pure-forward-fix.patch'), 'b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612'],
};
// Order matters: head and stack first (the P3 gate), then the middle trees.
const TREES = { head: [], stack: ['v2v3j', 'v4', 'smc'], v2v3: ['v2', 'v3'], v2v3j: ['v2v3j'], v2v3j_v4: ['v2v3j', 'v4'] };
const LADDER = ['head', 'v2v3', 'v2v3j', 'v2v3j_v4', 'stack'];
// Program -> extra driver args (PIT port trace only where the PIT is the question).
const PROGRAMS = {
  // --slice-log: run-dos's per-handback log with FLAGS (BLIQ-DIVERGENCE-20261005.md).
  '1994-b-bliq/BLIQ.EXE': ['--trace-irq', '--trace-io=40,43', '--slice-log'],
  '1994-c-cyclewar/CYCLE.EXE': ['--trace-irq'],
  '1993-c-caveira/CAVEIRA.COM': ['--trace-irq'],
};
// Program -> digest of its directory (sorted "name sha256" lines).
const PIN = {
  '1994-b-bliq/BLIQ.EXE': '971da3aaffd61c3d900dabd1abe79fe3beb20476ace2907e41415acc2b76059d',
  '1994-c-cyclewar/CYCLE.EXE': '1a7c999d9790dde6a3699d70bfe8e0d89eb2303d87071fdd69feb7f1fd53e60e',
  '1993-c-caveira/CAVEIRA.COM': '1ab3d3f0178bac8e0821932f75d7d7bac766873a001459f94f525c0bb75ca5a8',
};
const GUEST = ['wav', 'frame', 'dispatched', 'irqs', 'ints', 'pixels'];

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function dirDigest(dir) {
  const lines = fs.readdirSync(dir).sort().filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((n) => `${n} ${sha(path.join(dir, n))}`);
  return crypto.createHash('sha256').update(lines.join('\n') + '\n').digest('hex');
}
const W = arg('w'), OUT = arg('out');
if (!W || !OUT || (!flag('dry-run') && !flag('run'))) {
  console.error('usage: node wav-run.js --w=<work dir with demos/> --out=<new dir> --dry-run|--run [--total=S] [--log-cap-mb=N] [--out-cap-mb=N] [--no-trace]');
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
const result = { status: 'running', startedAt: new Date(t0).toISOString(), totalS: TOTAL_S,
  logCapMb: LOG_CAP / 1048576, outCapMb: OUT_CAP / 1048576, node: process.version,
  pins: { base: BASE, patches: Object.fromEntries(Object.entries(P).map(([k, [, h]]) => [k, h])),
    driver: sha(DRIVE), runner: sha(__filename), wavCompare: sha(path.join(__dirname, 'wav-compare.js')) },
  trees: {}, runs: {}, failures: [] };
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
// One child with the remaining share of the total bound and a HARD log cap:
// its output comes through a pipe and this process writes at most `cap` bytes
// of it (a polled file size is not a bound -- a synchronous writer put 492 MB
// on disk inside one 250 ms poll in the fixture test). Resolves its exit code
// (124 deadline, 125 log cap, 127 could not start).
function runChild(cmd, args, log, cap) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'w');
    let ch, done = false, why = 0, t = null, hard = null, written = 0;
    const end = (code) => {
      if (done) return; done = true;
      for (const x of [t, hard]) if (x) clearTimeout(x);
      if (ch) { live.delete(ch); if (ch.pid) killGroup(ch, 'SIGKILL'); }
      fs.closeSync(fd);
      resolve(why || code);
    };
    const stop = (code) => { if (why) return; why = code; killGroup(ch, 'SIGTERM'); hard = setTimeout(() => killGroup(ch, 'SIGKILL'), GRACE_MS); };
    const sink = (buf) => {
      if (why === 125 || done) return;
      const room = cap - written;
      const n = Math.min(room, buf.length);
      if (n > 0) { fs.writeSync(fd, buf, 0, n); written += n; }
      if (buf.length > room) stop(125);
    };
    const left = remainingMs();
    if (left <= 0) { why = 124; return end(124); }
    try { ch = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { fs.writeSync(fd, `spawn failed: ${e.message}\n`); return end(127); }
    live.add(ch);
    ch.stdout.on('data', sink); ch.stderr.on('data', sink);
    ch.on('error', (e) => { fs.writeSync(fd, `spawn failed: ${e.message}\n`); end(127); });
    t = setTimeout(() => stop(124), left);
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

// --- pins and trees -------------------------------------------------------------
const progs = {};
for (const [p] of Object.entries(PROGRAMS)) {
  const file = path.resolve(path.join(W, 'demos', p));
  if (!fs.existsSync(file)) finish('FAIL', 2, `missing program ${file}`);
  const d = dirDigest(path.dirname(file));
  if (!flag('no-pins') && d !== PIN[p]) finish('FAIL', 2, `${p}: directory digest ${d} != pinned ${PIN[p]}`);
  progs[p] = file;
  result.runs[p] = { file, dirDigest: d };
}
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
      if (r.status !== 0) finish('FAIL', 2, `${name}: patch ${k} failed: ${String(r.stdout || '') + String(r.stderr || '')}`.trim());
    }
  }
}
for (const name of Object.keys(TREES)) {
  const t = path.join(treesDir, name);
  if (!fs.existsSync(t)) finish('FAIL', 2, `tree ${name} missing at ${t}`);
  result.trees[name] = { patches: TREES[name], files: {} };
  for (const f of ['dos-loop', 'run-dos', 'emit', 'compile', 'audio', 'dos']) {
    const file = path.join(t, 'tools/toyvm', f + '.js');
    result.trees[name].files[f] = fs.existsSync(file) ? sha(file).slice(0, 16) : null;
  }
}
const stem = (p) => path.basename(p).replace(/\.[^.]+$/, '');
const sliceFile = (tree, p) => path.join(OUT, `${tree}-${stem(p)}.slices`);
const cmd = (tree, p) => ['--max-old-space-size=1536', DRIVE, `--tree=${path.join(treesDir, tree)}`, `--exe=${progs[p]}`,
  `--wav=${path.join(OUT, `${tree}-${stem(p)}.wav`)}`, `--row=${path.join(OUT, `${tree}-${stem(p)}.json`)}`,
  ...(flag('no-trace') ? [] : PROGRAMS[p].map((a) => (a === '--slice-log' ? `--slice-log=${sliceFile(tree, p)}` : a)))];
result.commands = Object.fromEntries(Object.keys(TREES).flatMap((t) => Object.keys(PROGRAMS).map((p) => [`${t}/${stem(p)}`, `node ${cmd(t, p).join(' ')}`])));
if (flag('dry-run')) finish('DRY-RUN', 0, null);

// --- P3 rows ---------------------------------------------------------------------
function p3Row(side, p) {
  const file = path.join(P3DIR, `arms-${side}.ndjson`);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.arm === 'l1' && r.recipe === 'witness' && r.irqSchedule === true && Number(r.budget) === 80e6
      && typeof r.exe === 'string' && r.exe.endsWith('/' + p));
  if (rows.length !== 1) finish('FAIL', 2, `P3 ${side}: ${rows.length} l1 witness rows for ${p}, want exactly 1`);
  return rows[0];
}
function readRow(tree, p) {
  const f = path.join(OUT, `${tree}-${stem(p)}.json`), w = path.join(OUT, `${tree}-${stem(p)}.wav`);
  if (!fs.existsSync(f)) finish('FAIL', 4, `${tree}/${stem(p)}: no row`);
  let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { finish('FAIL', 4, `${tree}/${stem(p)}: malformed row`); }
  if (r.ok !== true || r.ranOutOfTime || r.stuckAt) finish('FAIL', 4, `${tree}/${stem(p)}: unhealthy (ok ${r.ok}, ranOutOfTime ${r.ranOutOfTime}, stuckAt ${r.stuckAt})`);
  for (const g of GUEST) if (!(g in r)) finish('FAIL', 4, `${tree}/${stem(p)}: row has no ${g}`);
  if (!fs.existsSync(w)) finish('FAIL', 4, `${tree}/${stem(p)}: no WAV`);
  if (r.wavSha256 !== sha(w)) finish('FAIL', 4, `${tree}/${stem(p)}: WAV on disk does not match its row`);
  if (!flag('no-trace') && PROGRAMS[p].includes('--slice-log') && !fs.existsSync(sliceFile(tree, p))) finish('FAIL', 4, `${tree}/${stem(p)}: no slice log`);
  return r;
}

// --- trace divergence ------------------------------------------------------------
// irq lines minus `hb=` (the handback index is cache-dependent by design);
// [io] lines as written (their @ stamp is the dispatch count).
function traceLines(log, kind) {
  if (!fs.existsSync(log)) return [];
  const re = kind === 'irq' ? /^\s*irq vec=/ : /^\s*\[io\] /;
  return fs.readFileSync(log, 'utf8').split('\n').filter((l) => re.test(l))
    .map((l) => (kind === 'irq' ? l.replace(/ hb=\d+/, '') : l).trim());
}
function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i] === b[i]) i++;
  if (i === n && a.length === b.length) return { identical: true, lines: a.length };
  return { identical: false, index: i, linesA: a.length, linesB: b.length,
    context: { a: a.slice(Math.max(0, i - 3), i + 4), b: b.slice(Math.max(0, i - 3), i + 4) } };
}

(async () => {
  for (const tree of Object.keys(TREES)) {
    for (const p of Object.keys(PROGRAMS)) {
      const key = `${tree}/${stem(p)}`, log = path.join(OUT, `${tree}-${stem(p)}.log`);
      // The log may use at most the per-log cap AND what is left of the output
      // cap (a WAV is ~0.7 MB at 80M dispatches; the 1 MB margin keeps room for it).
      const budget = OUT_CAP - outBytes(OUT) - 1048576;
      const cap = Math.max(0, Math.min(LOG_CAP, budget));
      const rc = await runChild(process.execPath, cmd(tree, p), log, cap);
      result.runs[p][tree] = { exit: rc, logBytes: fs.statSync(log).size, logCapBytes: cap };
      writeResult();
      if (rc === 124) finish('DEADLINE', 5, `total bound ${TOTAL_S}s reached during ${key}`);
      if (rc === 125) finish('SIZE', 6, cap < LOG_CAP ? `${key}: log reached the remaining output budget (${cap} bytes of ${OUT_CAP / 1048576} MB)`
        : `${key}: log passed ${LOG_CAP / 1048576} MB`);
      if (rc !== 0) finish('FAIL', 2, `${key}: driver exit ${rc}`);
      if (outBytes(OUT) > OUT_CAP) finish('SIZE', 6, `output passed ${OUT_CAP / 1048576} MB after ${key}`);
      result.runs[p][tree].row = readRow(tree, p);
    }
    if (tree === 'stack') {
      // P3 gate, before any middle tree runs.
      const bad = [];
      for (const p of Object.keys(PROGRAMS)) {
        for (const [tree, side] of [['head', 'base'], ['stack', 'cand']]) {
          const want = p3Row(side, p), got = result.runs[p][tree].row;
          for (const g of GUEST) if (got[g] !== want[g]) bad.push(`${tree} ${stem(p)} ${g} ${got[g]} != P3 ${side} ${want[g]}`);
        }
      }
      result.p3Gate = bad.length ? { reproduced: false, mismatches: bad } : { reproduced: true };
      if (bad.length) finish('VOID', 3, `P3 not reproduced: ${bad.slice(0, 3).join('; ')}`);
    }
  }

  // --- analysis --------------------------------------------------------------------
  const md = ['# WAV reference check', '',
    'PASS = completed with P3 reproduced on every guest field. Not a verdict that the new audio is correct.', ''];
  const an = {}, traceIncomplete = [];
  for (const p of Object.keys(PROGRAMS)) {
    const s = stem(p), h = result.runs[p].head.row;
    an[s] = { trees: {}, compare: {}, irq: null, io: null };
    md.push(`## ${s}`, '', '| tree | wav | frames | seconds | guestSeconds | outAcc | dispatched | irqs | ints | frame | date | early | first-diff s | differing share |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const tree of LADDER) {
      const r = result.runs[p][tree].row, c = r.clock || {};
      const cmp = compare(readWav(path.join(OUT, `head-${s}.wav`)), readWav(path.join(OUT, `${tree}-${s}.wav`)));
      an[s].trees[tree] = Object.fromEntries(GUEST.map((g) => [g, r[g] === h[g] ? '=' : 'DIFF']));
      an[s].compare[tree] = cmp;
      md.push(`| ${tree} | ${r.wav} | ${c.frames} | ${c.seconds} | ${c.guestSeconds} | ${c.outAccResidue} | ${r.dispatched} | ${r.irqs} | ${r.ints} | ${r.frame === h.frame ? '=' : 'DIFF'} | ${r.kinds.date} | ${r.kinds.early} | ${cmp.firstDiffSeconds} | ${cmp.differingShare} |`);
    }
    an[s].firstChange = Object.fromEntries(GUEST.map((g) => [g, LADDER.find((t) => result.runs[p][t].row[g] !== h[g]) || null]));
    const lh = path.join(OUT, `head-${s}.log`), ls = path.join(OUT, `stack-${s}.log`);
    const traced = !flag('no-trace') && PROGRAMS[p].includes('--trace-irq');
    // Completeness: every raise() is counted in `irqs` AND logged, so a log with
    // fewer irq lines than the counter lost lines and is a prefix at best.
    an[s].irqTrace = Object.fromEntries(LADDER.map((t) => {
      const lines = traced ? traceLines(path.join(OUT, `${t}-${s}.log`), 'irq').length : null;
      return [t, { lines, irqs: result.runs[p][t].row.irqs, complete: traced ? lines === result.runs[p][t].row.irqs : null }];
    }));
    const incomplete = LADDER.filter((t) => an[s].irqTrace[t].complete === false);
    if (incomplete.length) traceIncomplete.push(`${s}: ${incomplete.map((t) => `${t} ${an[s].irqTrace[t].lines}/${an[s].irqTrace[t].irqs}`).join(', ')}`);
    an[s].irq = traced ? firstDivergence(traceLines(lh, 'irq'), traceLines(ls, 'irq')) : null;
    if (traced && PROGRAMS[p].some((a) => a.startsWith('--trace-io'))) an[s].io = firstDivergence(traceLines(lh, 'io'), traceLines(ls, 'io'));
    md.push('', `first tree to change each field (ladder ${LADDER.join(' -> ')}): ${JSON.stringify(an[s].firstChange)}`);
    if (an[s].irq) md.push(`irq trace head vs stack${incomplete.length ? ' (INCOMPLETE logs: prefix only, line totals unreliable)' : ''}: `
      + `${an[s].irq.identical ? `identical (${an[s].irq.lines} lines)` : `first divergence at line ${an[s].irq.index}`}`);
    if (an[s].io) md.push(`PIT io trace head vs stack: ${an[s].io.identical ? `identical (${an[s].io.lines} lines)` : `first divergence at line ${an[s].io.index}`}`);
    md.push('');
  }
  result.analysis = an;
  if (traceIncomplete.length) md.push(`TRACE-INCOMPLETE (irq log lines vs irqs counter): ${traceIncomplete.join('; ')}`, '');
  fs.writeFileSync(path.join(OUT, 'analysis.md'), md.join('\n') + '\n');
  if (traceIncomplete.length) finish('TRACE-INCOMPLETE', 7, `irq trace lost lines: ${traceIncomplete.join('; ')}`);
  finish('PASS', 0, null);
})().catch((e) => finish('FAIL', 1, String(e && e.stack || e)));
