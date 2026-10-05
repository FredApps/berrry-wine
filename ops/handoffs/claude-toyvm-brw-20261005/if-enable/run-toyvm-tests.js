#!/usr/bin/env node
'use strict';
// Run the EXISTING toyvm tests most at risk from the IF-enable candidate
// (impl-draft/CANDIDATE.md, "Existing toyvm tests most at risk") against pinned
// trees -- the candidate, and the stack baseline it is applied to -- under ONE
// total wall bound, one test at a time.
//
// Each tree is built by build-tree.js (hash-pinned patches; `cand` refuses a
// candidate whose full sha256 differs). The tests come from base 2683a6e3 by
// `git archive` into <tree>/test/, so every test resolves its own
// `../tools/toyvm` to THAT tree. Every test runs in its own process group with
// cwd = the tree, and is SIGKILLed with its descendants at min(--per-test,
// what is left of --total); none starts once the total is spent. Trees are
// removed on every exit. Each test result is one of:
//   PASS     exit 0
//   FAIL     exited non-zero by itself (its log says why; quoted as is)
//   TIMEOUT  killed at its per-test cap or at the total bound
//   SKIPPED  never started (total bound spent)
// result.json also lists, per test, the cand-vs-stack comparison:
//   REGRESSION  stack PASS, cand FAIL/TIMEOUT
//   FIXED       stack FAIL, cand PASS
//   same / incomplete
// A REGRESSION is a finding about the candidate (or about the test's own
// assumptions -- read the log); a test that fails on BOTH trees says nothing
// about the candidate.
//
//   node run-toyvm-tests.js --out=<new dir> --plan=cand,stack [--total=300] [--per-test=60]
//     [--tests=a,b,...] --candidate=<diff> --candidate-sha=<64 hex>
//   test hook: --prepared-trees=<dir> (contains <tree>/test/test-toyvm-<t>.js;
//   copied into --out, skipping build and git archive; copies removed)
// Default test list, in risk order (CANDIDATE.md 1-8; browser-bundle and live
// are left out: browser-bundle reads the committed docs/ bundle, which the
// candidate is EXPECTED to break until bundle regeneration, a separate gate).

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const DEFAULT_TESTS = ['pm-timer-vector', 'sb-single-cycle', 'sb-highspeed-autoinit', 'uop-only',
  'region-live', 'region-install-clock', 'tree-fold', 'uop', 'uop-live', 'retrace', 'audio',
  'operand-patch', 'volatile', 'arena-recycle', 'live'];
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const OUT = arg('out'), TOTAL_MS = Number(arg('total', 300)) * 1000, PER_MS = Number(arg('per-test', 60)) * 1000, t0 = Date.now();
const PLAN = arg('plan', 'cand,stack').split(',').filter(Boolean);
const TESTS = arg('tests') ? arg('tests').split(',').filter(Boolean) : DEFAULT_TESTS;
const CAND = arg('candidate'), CAND_SHA = arg('candidate-sha'), PREP = arg('prepared-trees');
if (!OUT || PLAN.some((t) => !['stack', 'head', 'cand'].includes(t)) || TESTS.some((t) => !/^[a-z0-9-]+$/.test(t))
  || (!PREP && PLAN.includes('cand') && (!CAND || !/^[0-9a-f]{64}$/.test(CAND_SHA || '')))) {
  console.error('usage: node run-toyvm-tests.js --out=<new dir> --plan=cand,stack [--total=300] [--per-test=60] [--tests=a,b] --candidate=<diff> --candidate-sha=<64 hex>');
  process.exit(2);
}
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.error(`refusing: ${OUT} not empty`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const HERE = __dirname;
const result = { startedAt: new Date(t0).toISOString(), wrapperPid: process.pid, totalS: TOTAL_MS / 1000,
  perTestS: PER_MS / 1000, plan: PLAN, tests: TESTS, trees: {}, compare: {} };
const write = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1) + '\n');
const live = new Set();
const trees = [];
const killAll = () => { for (const ch of live) { try { process.kill(-ch.pid, 'SIGKILL'); } catch {} } };
function finish(code) {
  killAll();
  for (const t of trees) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} }
  result.treesRemoved = trees.map((t) => !fs.existsSync(t));
  result.elapsedS = (Date.now() - t0) / 1000;
  write();
  process.exit(code);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { result.signal = s; finish(130); });
const left = () => TOTAL_MS - (Date.now() - t0);

function run(name, cmd, args, cwd, capMs) {
  return new Promise((resolve) => {
    const log = path.join(OUT, `${name}.txt`), fd = fs.openSync(log, 'w');
    const rec = { name, cmd: `${cmd} ${args.join(' ')}`, cwd, startedS: (Date.now() - t0) / 1000 };
    const cap = Math.min(capMs, left());
    if (cap <= 1000) { fs.closeSync(fd); rec.status = 'SKIPPED'; return resolve(rec); }
    const ch = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', fd, fd] });
    rec.pid = ch.pid; live.add(ch); write();
    let killed = false;
    const t = setTimeout(() => { killed = true; try { process.kill(-ch.pid, 'SIGKILL'); } catch {} }, cap);
    ch.on('close', (code, sig) => {
      clearTimeout(t); live.delete(ch); fs.closeSync(fd);
      rec.exit = code; rec.signal = sig; rec.elapsedS = (Date.now() - t0) / 1000 - rec.startedS;
      rec.status = killed ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
      resolve(rec);
    });
  });
}

(async () => {
  for (const tree of PLAN) {
    const dir = path.join(OUT, `tree-${tree}`); trees.push(dir);
    const tr = result.trees[tree] = { tests: {} };
    // Test hook: a prepared tree (with its own test/test-toyvm-<t>.js) is
    // COPIED in, so the copy is owned and removed like a built tree.
    if (PREP) {
      fs.cpSync(path.join(PREP, tree), dir, { recursive: true });
      tr.prepared = true;
      for (const t of TESTS) { tr.tests[t] = await run(`${tree}-${t}`, process.execPath, [path.join('test', `test-toyvm-${t}.js`)], dir, PER_MS); write(); }
      continue;
    }
    const b = await run(`build-${tree}`, process.execPath, [path.join(HERE, 'build-tree.js'), `--out=${dir}`, `--tree=${tree}`,
      ...(tree === 'cand' ? [`--candidate=${CAND}`, `--candidate-sha=${CAND_SHA}`] : [])], HERE, 60000);
    tr.build = b;
    if (b.status !== 'PASS') { write(); continue; }
    tr.pins = JSON.parse(fs.readFileSync(path.join(OUT, `build-${tree}.txt`), 'utf8').trim().split('\n').pop());
    // The tests, from the base commit, into <tree>/test/.
    const files = TESTS.map((t) => `test/test-toyvm-${t}.js`);
    const tar = execFileSync('git', ['-C', R, 'archive', BASE, ...files], { maxBuffer: 1 << 28 });
    if (spawnSync('tar', ['-x', '-C', dir], { input: tar }).status !== 0) { tr.error = 'test extraction failed'; write(); continue; }
    for (const t of TESTS) {
      tr.tests[t] = await run(`${tree}-${t}`, process.execPath, [path.join('test', `test-toyvm-${t}.js`)], dir, PER_MS);
      write();
    }
  }
  if (result.trees.cand && result.trees.stack) {
    for (const t of TESTS) {
      const c = (result.trees.cand.tests[t] || {}).status, s = (result.trees.stack.tests[t] || {}).status;
      result.compare[t] = !c || !s || c === 'SKIPPED' || s === 'SKIPPED' ? 'incomplete'
        : s === 'PASS' && c !== 'PASS' ? 'REGRESSION' : s !== 'PASS' && c === 'PASS' ? 'FIXED' : 'same';
    }
  }
  finish(0);
})().catch((e) => { result.error = String(e && e.stack || e); finish(1); });
