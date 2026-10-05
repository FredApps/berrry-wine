#!/usr/bin/env node
'use strict';
// Fixture tests for corpus-plan.js: every gate must EXIT, child failures must
// abort, a child that cannot start resolves 127, and the slot deadline holds
// across separately invoked phases. Stub tools only -- no emulator, no corpus.
// Usage: node corpus-plan.test.js [fixture-parent-dir]

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const PLAN = path.join(__dirname, 'corpus-plan.js');
const PARENT = process.argv[2] || os.tmpdir();
const ROOT = fs.mkdtempSync(path.join(PARENT, 'corpus-plan-fx-'));
let n = 0, failed = 0;

function write(f, s, mode) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); if (mode) fs.chmodSync(f, mode); }
const exitWith = (code) => `process.exit(${code});\n`;
// A stub node script that writes the value of --out=FILE (when given) and exits.
const outStub = (code, body = '{}') => `const outArg = process.argv.find((x) => x.startsWith('--out='));\n`
  + `if (outArg) require('fs').writeFileSync(outArg.slice(6), ${JSON.stringify(body)});\n${exitWith(code)}`;

function workdir(name) {
  const W = path.join(ROOT, name);
  fs.mkdirSync(path.join(W, 'out'), { recursive: true });
  return W;
}
function plan(phase, W, extra = {}) {
  const r = spawnSync(process.execPath, [PLAN, phase], {
    env: { ...process.env, W, SLOT_S: '7200', JOBS: '1', ...extra }, encoding: 'utf8', timeout: 60000,
  });
  const journal = fs.existsSync(path.join(W, 'out/journal.txt')) ? fs.readFileSync(path.join(W, 'out/journal.txt'), 'utf8') : '';
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), journal };
}
function check(name, fn) {
  n++;
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

// --- P1 tests ------------------------------------------------------------
check('P1 aborts on an empty suite', () => {
  const W = workdir('p1-empty');
  for (const t of ['base', 'cand']) fs.mkdirSync(path.join(W, t, 'test'), { recursive: true });
  const r = plan('tests', W);
  assert.strictEqual(r.code, 3, r.out); assert.match(r.journal, /empty suite/);
});
check('P1 aborts when a suite passes on base and fails on cand', () => {
  const W = workdir('p1-new-fail');
  write(path.join(W, 'base/test/test-toyvm-a.js'), exitWith(0));
  write(path.join(W, 'cand/test/test-toyvm-a.js'), exitWith(1));
  const r = plan('tests', W);
  assert.strictEqual(r.code, 3, r.out); assert.match(r.journal, /newly failing on cand: test-toyvm-a/);
});
check('P1 passes when both trees pass', () => {
  const W = workdir('p1-ok');
  for (const t of ['base', 'cand']) write(path.join(W, t, 'test/test-toyvm-a.js'), exitWith(0));
  const r = plan('tests', W);
  assert.strictEqual(r.code, 0, r.out); assert.match(r.journal, /\[P1\] tests ok \(1 suites/);
});

// The program list coverage is measured against.
const PROGS = 3;
function programs(W, k = PROGS) {
  write(path.join(W, 'programs.txt'), Array.from({ length: k }, (_, i) => `/demos/p${i}/P${i}.EXE`).join('\n') + '\n');
}
const sweepRow = (i) => ({ exe: `/demos/p${i}/P${i}.EXE`, name: `P${i}.EXE` });
// rows: a count (programs 0..n-1) or an explicit list of program indices
const sweepBody = (rows) => JSON.stringify({ rows: (Array.isArray(rows) ? rows : Array.from({ length: rows }, (_, i) => i)).map(sweepRow) });

// --- P2 sweep ------------------------------------------------------------
function sweepTree(W, { baseRc = 0, candRc = 0, diffRc = 0, rows = PROGS, candRows = rows } = {}) {
  programs(W);
  write(path.join(W, 'base/tools/toyvm/sweep-dos.js'), outStub(baseRc, sweepBody(rows)));
  write(path.join(W, 'cand/tools/toyvm/sweep-dos.js'), outStub(candRc, sweepBody(candRows)));
  write(path.join(W, 'cand/tools/toyvm/sweep-diff.js'),
    `console.log('REGRESSIONS: run status got worse (block the change) (${diffRc === 1 ? 1 : 0})');\n${exitWith(diffRc)}`);
}
check('P2 aborts when a sweep child fails', () => {
  const W = workdir('p2-child'); sweepTree(W, { candRc: 3 });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 2, r.out); assert.match(r.journal, /sweep-dos cand failed \(exit 3\)/);
});
check('P2 aborts on a sweep-diff regression', () => {
  const W = workdir('p2-regress'); sweepTree(W, { diffRc: 1 });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 4, r.out); assert.match(r.journal, /sweep gate: REGRESSIONS/);
});
check('P2 aborts when sweep-diff itself fails', () => {
  const W = workdir('p2-diff-err'); sweepTree(W, { diffRc: 2 });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 2, r.out); assert.match(r.journal, /sweep-diff failed \(exit 2\)/);
});
check('P2 passes clean', () => {
  const W = workdir('p2-ok'); sweepTree(W);
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 0, r.out); assert.match(r.journal, /\[P2\] sweep gate clean, 3\/3 programs/);
});
check('P2 with a short sweep is INCOMPLETE, not clean', () => {
  const W = workdir('p2-partial'); sweepTree(W, { candRows: 2 });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 11, r.out); assert.match(r.journal, /\[INCOMPLETE\] P2 sweep cand: 1 of 3 expected rows missing/);
});
check('P2 rejects an equal-count sweep with a WRONG program in place of a missing one', () => {
  const W = workdir('p2-wrong-prog'); sweepTree(W, { candRows: [0, 1, 9] });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 12, r.out); assert.match(r.journal, /P2 sweep cand: 1 invalid row\(s\): out-of-domain \/demos\/p9\/P9\.EXE/);
});
check('P2 rejects an equal-count sweep with a DUPLICATE row in place of a missing one', () => {
  const W = workdir('p2-dup'); sweepTree(W, { candRows: [0, 1, 1] });
  const r = plan('sweep', W);
  assert.strictEqual(r.code, 12, r.out); assert.match(r.journal, /duplicate \/demos\/p1\/P1\.EXE/);
});

// --- SMOKE mode -------------------------------------------------------------
check('SMOKE sweep passes the listed programs, not --dir, and labels the journal', () => {
  const W = workdir('smoke-sweep'); sweepTree(W);
  const argvFile = path.join(W, 'sweep-argv.json');
  for (const t of ['base', 'cand']) {
    write(path.join(W, t, 'tools/toyvm/sweep-dos.js'),
      `require('fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n` + outStub(0, sweepBody(PROGS)));
  }
  const r = plan('sweep', W, { SMOKE: '3' });
  assert.strictEqual(r.code, 0, r.out);
  const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  assert.ok(!argv.some((a) => a.startsWith('--dir=')), `smoke sweep still used --dir: ${argv}`);
  assert.ok(argv.includes('/demos/p0/P0.EXE') && argv.includes('--dispatches=2m'), `argv ${argv}`);
  assert.match(r.journal, /\[SMOKE P2\] sweep gate clean, 3\/3/);
});
check('SMOKE P1 runs only the SMOKE_TESTS suites', () => {
  const W = workdir('smoke-tests');
  for (const t of ['base', 'cand']) {
    write(path.join(W, t, 'test/test-toyvm-keep.js'), exitWith(0));
    write(path.join(W, t, 'test/test-toyvm-skip.js'), exitWith(1));
  }
  const r = plan('tests', W, { SMOKE: '3', SMOKE_TESTS: 'test-toyvm-keep' });
  assert.strictEqual(r.code, 0, r.out); assert.match(r.journal, /\[SMOKE P1\] tests ok \(1 suites\)/);
});

// --- P4 control (corpus-ab stub) ------------------------------------------
// A corpus-ab stub: --compare writes the moved line; a run writes `rows`
// distinct ndjson rows (one per program, arm l1, budget 8m).
// `rows`: a count (programs 0..n-1, arm l1, budget 8m) or an explicit list of
// row objects / raw strings (for malformed lines).
function abStub(dir, moved, total, compareRc = 0, rows = PROGS) {
  programs(dir);
  const f = path.join(dir, 'ab-stub.js');
  const list = Array.isArray(rows) ? rows : Array.from({ length: rows }, (_, i) => ({ exe: `/demos/p${i}/P${i}.EXE`, arm: 'l1', budget: 8e6 }));
  const nd = list.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
  write(f, `const a = process.argv.slice(2);\nconst fs = require('fs');\n`
    + `const md = a.find((x) => x.startsWith('--md='));\n`
    + `if (a.some((x) => x.startsWith('--compare='))) {\n`
    + `  if (md) fs.writeFileSync(md.slice(5), '   ${moved} of ${total} l1 rows moved\\n');\n  process.exit(${compareRc});\n}\n`
    + outStub(0, nd));
  return f;
}
check('P4 aborts when l1 rows moved off the schedule', () => {
  const W = workdir('p4-moved');
  const r = plan('control', W, { AB: abStub(W, 2, 5) });
  assert.strictEqual(r.code, 6, r.out); assert.match(r.journal, /2 of 5 l1 rows moved/);
});
check('P4 aborts when nothing was compared', () => {
  const W = workdir('p4-empty');
  const r = plan('control', W, { AB: abStub(W, 0, 0) });
  assert.strictEqual(r.code, 6, r.out); assert.match(r.journal, /0 l1 rows compared/);
});
check('P4 aborts when the compare fails', () => {
  const W = workdir('p4-cmp-err');
  const r = plan('control', W, { AB: abStub(W, 0, 5, 1) });
  assert.strictEqual(r.code, 6, r.out); assert.match(r.journal, /nosched compare failed/);
});
check('P4 passes on 0 of N moved', () => {
  const W = workdir('p4-ok');
  const r = plan('control', W, { AB: abStub(W, 0, 5) });
  assert.strictEqual(r.code, 0, r.out); assert.match(r.journal, /\[P4\] 0 of 5 l1 rows moved/);
});
check('P4 with missing rows is INCOMPLETE even when 0 moved', () => {
  const W = workdir('p4-partial');
  const r = plan('control', W, { AB: abStub(W, 0, 2, 0, 2) });
  assert.strictEqual(r.code, 11, r.out); assert.match(r.journal, /\[INCOMPLETE\] P4 nosched base: 1 of 3 expected rows missing/);
});
const row = (i, arm = 'l1', budget = 8e6) => ({ exe: `/demos/p${i}/P${i}.EXE`, arm, budget });
check('P4 rejects an equal-count run with a WRONG arm in place of a missing row', () => {
  const W = workdir('p4-wrong-arm');
  const r = plan('control', W, { AB: abStub(W, 0, 3, 0, [row(0), row(1), row(2, 'fold64')]) });
  assert.strictEqual(r.code, 12, r.out); assert.match(r.journal, /out-of-domain \/demos\/p2\/P2\.EXE fold64 8000000/);
});
check('P4 rejects an equal-count run with a WRONG budget', () => {
  const W = workdir('p4-wrong-budget');
  const r = plan('control', W, { AB: abStub(W, 0, 3, 0, [row(0), row(1), row(2, 'l1', 2e6)]) });
  assert.strictEqual(r.code, 12, r.out); assert.match(r.journal, /out-of-domain \/demos\/p2\/P2\.EXE l1 2000000/);
});
check('P4 rejects a malformed row even when the rest is complete', () => {
  const W = workdir('p4-malformed');
  const r = plan('control', W, { AB: abStub(W, 0, 3, 0, [row(0), row(1), row(2), '{not json']) });
  assert.strictEqual(r.code, 12, r.out); assert.match(r.journal, /malformed row/);
});

// --- P5 BRW parity gate (brw-bisect stubs) -----------------------------------
// Each tree gets a stub brw-bisect.js that writes an IRQ list and a BRWBISECT
// line; `cand` arms either agree or differ in one delivery / the frame.
function brwTree(W, { candSepcDelivery = 'from 8:423a', candSepcFrame = 'f00d' } = {}) {
  for (const t of ['base', 'cand']) {
    const sepcLine = t === 'cand' ? candSepcDelivery : 'from 8:4299';
    const frameSepc = t === 'cand' ? candSepcFrame : 'beef';
    write(path.join(W, t, 'scratch/o/toyvm-brw/brw-bisect.js'),
      `const a = process.argv.slice(2); const fs = require('fs');\n`
      + `const arm = a.find((x) => x.startsWith('--arm=')).slice(6);\n`
      + `const out = a.find((x) => x.startsWith('--irq-out=')).slice(10);\n`
      + `const last = arm === 'sepc' ? ${JSON.stringify(sepcLine)} : 'from 8:423a';\n`
      + `fs.writeFileSync(out, 'irq vec=08 timer at=100 hb=' + (arm === 'sepc' ? 7 : 3) + ' t=0.1 from 8:1000\\nirq vec=08 timer at=200 hb=9 t=0.2 ' + last + '\\n');\n`
      + `console.log('BRWBISECT ' + JSON.stringify({ arm, dispatched: 500918122, frame: arm === 'sepc' ? ${JSON.stringify(frameSepc)} : 'f00d' }));\n`);
  }
}
check('P5 passes when the candidate arms agree (hb ignored)', () => {
  const W = workdir('p5-ok'); brwTree(W);
  const r = plan('brw', W);
  assert.strictEqual(r.code, 0, r.out); assert.match(r.journal, /\[P5\] BRW parity on cand: 2 identical deliveries/);
});
check('P5 aborts on one differing candidate delivery', () => {
  const W = workdir('p5-irq'); brwTree(W, { candSepcDelivery: 'from 8:4299' });
  const r = plan('brw', W);
  assert.strictEqual(r.code, 9, r.out); assert.match(r.journal, /delivery #1 differs/);
});
check('P5 aborts on a differing candidate frame', () => {
  const W = workdir('p5-frame'); brwTree(W, { candSepcFrame: 'beef' });
  const r = plan('brw', W);
  assert.strictEqual(r.code, 9, r.out); assert.match(r.journal, /frame f00d vs beef/);
});

// --- process hygiene ---------------------------------------------------------
// A stub that starts a grandchild which records its pid and sleeps.
const spawner = (pidFile, sleepMs, rc = 0, delayMs = 0) => `const { spawn } = require('child_process');\n`
  + `const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${sleepMs})'], { stdio: 'ignore' });\n`
  + `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));\n`
  + `setTimeout(() => process.exit(${rc}), ${delayMs || sleepMs});\n`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitDead = (pid, ms = 3000) => { const t = Date.now(); while (alive(pid) && Date.now() - t < ms) spawnSync('sleep', ['0.1']); return !alive(pid); };
check('an abort in P2 kills the concurrent P1 suite and its grandchild (p1p2)', () => {
  const W = workdir('p1p2-sibling');
  const pidFile = path.join(W, 'sibling-grandchild.pid');
  write(path.join(W, 'base/test/test-toyvm-slow.js'), spawner(pidFile, 30000));
  write(path.join(W, 'cand/test/test-toyvm-slow.js'), spawner(pidFile + '.cand', 30000));
  sweepTree(W, { candRc: 3 });
  // give P1 a moment to start before P2's child fails: the sweep stub sleeps first
  write(path.join(W, 'cand/tools/toyvm/sweep-dos.js'), `setTimeout(() => process.exit(3), 800);\n`);
  const t0 = Date.now();
  const r = plan('p1p2', W);
  assert.strictEqual(r.code, 2, r.out);
  assert.ok(Date.now() - t0 < 20000, 'the runner waited for the sibling suite instead of aborting');
  assert.match(r.journal, /\[CLEANUP\] killing \d+ live child group/);
  const gp = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(waitDead(gp), `sibling grandchild ${gp} survived the abort`);
});
check('a stack candidate with a wrong patch hash is refused', () => {
  const W = workdir('stack-hash');
  const patch = path.join(W, 'x.patch'); write(patch, 'not a patch\n');
  // prep checks the v2 hash first: give it an empty v2 file and that file's hash.
  const v2 = path.join(W, 'empty.patch'); write(v2, '');
  const r = plan('prep', W, { CAND: 'stack', PATCHES: `${patch}:${'0'.repeat(64)}`, V2: v2,
    V2_SHA: require('crypto').createHash('sha256').update('').digest('hex') });
  assert.strictEqual(r.code, 8, r.out); assert.match(r.journal, /stack patch hash: x\.patch/);
});

// --- slot deadline across invocations --------------------------------------
check('a later phase honours the slot deadline set by an earlier one', () => {
  const W = workdir('deadline');
  for (const t of ['base', 'cand']) write(path.join(W, t, 'test/test-toyvm-a.js'), exitWith(0));
  fs.writeFileSync(path.join(W, 'out/slot-spent.txt'), '7100\n');   // 100 s of the 7200 s budget left
  const r = plan('tests', W);
  assert.strictEqual(r.code, 7, r.out); assert.match(r.journal, /P1: slot deadline/);
});

check('spent time accumulates across invocations', () => {
  const W = workdir('spent');
  for (const t of ['base', 'cand']) write(path.join(W, t, 'test/test-toyvm-a.js'), exitWith(0));
  fs.writeFileSync(path.join(W, 'out/slot-spent.txt'), '40\n');
  const r = plan('tests', W);
  assert.strictEqual(r.code, 0, r.out);
  const spent = Number(fs.readFileSync(path.join(W, 'out/slot-spent.txt'), 'utf8'));
  assert.ok(spent >= 40 && spent < 100, `slot-spent.txt = ${spent}`);
});

// --- checkpointed stages -------------------------------------------------------
// A small but real tree closure in both trees; the checkpoint itself is written
// by the runner's own `checkpoint` phase, so the test cannot drift from it.
function stageTree(W) {
  programs(W);
  for (const tr of ['base', 'cand']) {
    for (const fn of ['dos-loop', 'run-dos', 'emit', 'compile']) write(path.join(W, tr, 'tools/toyvm', fn + '.js'), `// ${tr} ${fn}\n`);
    write(path.join(W, tr, 'lib/compile-wat.js'), `// ${tr} lib\n`);
    write(path.join(W, tr, 'scratch/o/toyvm-brw/brw-bisect.js'), '// bisect\n');
  }
  const cp = plan('checkpoint', W);
  assert.strictEqual(cp.code, 0, cp.out);
}
check('stage2 refuses to run without a stage1 checkpoint', () => {
  const W = workdir('stage2-nocp'); programs(W);
  const r = plan('stage2', W);
  assert.strictEqual(r.code, 13, r.out); assert.match(r.journal, /stage2 needs a passed stage1/);
  assert.match(r.journal, /SLOT\] stage2: \d+s this invocation \(cap 2400s/);   // default stage-2 cap
});
check('stage2 refuses when a tree file changed after stage1', () => {
  const W = workdir('stage2-changed'); stageTree(W);
  write(path.join(W, 'cand/lib/compile-wat.js'), '// edited after stage1\n');   // outside the old 4-file set
  const r = plan('stage2', W);
  assert.strictEqual(r.code, 13, r.out); assert.match(r.journal, /tree files changed since stage1/);
});
check('stage2 refuses a same-count substitution in the program list', () => {
  const W = workdir('stage2-sublist'); stageTree(W);
  write(path.join(W, 'programs.txt'), ['/demos/p0/P0.EXE', '/demos/p1/P1.EXE', '/demos/pX/PX.EXE'].join('\n') + '\n');
  const r = plan('stage2', W);
  assert.strictEqual(r.code, 13, r.out); assert.match(r.journal, /program list \(programs\.txt\) changed since stage1/);
});
check('stage2 refuses an added file in a tree closure', () => {
  const W = workdir('stage2-added'); stageTree(W);
  write(path.join(W, 'base/tools/toyvm/extra.js'), '// new\n');
  const r = plan('stage2', W);
  assert.strictEqual(r.code, 13, r.out); assert.match(r.journal, /tree files changed since stage1/);
});
check('INVOCATION_S bounds one invocation even with total budget left', () => {
  const W = workdir('invocation-cap');
  for (const tr of ['base', 'cand']) write(path.join(W, tr, 'test/test-toyvm-a.js'), exitWith(0));
  const r = plan('tests', W, { SLOT_S: '7200', INVOCATION_S: '100' });   // P1 needs 300 s
  assert.strictEqual(r.code, 7, r.out); assert.match(r.journal, /P1: slot deadline \(\d+s left/);
  assert.match(r.journal, /SLOT\] tests: 100s this invocation \(cap 100s; 0s of 7200s already spent\)/);
});

// --- candidate completeness -------------------------------------------------
check('`all` refuses a candidate without the jmp_syn fix', () => {
  const W = workdir('all-v3');
  const r = plan('all', W, { CAND: 'v3' });
  assert.strictEqual(r.code, 8, r.out); assert.match(r.journal, /needs CAND=stack \(PATCHES=\.\.\.\) or CAND=v3j/);
});

// --- prep exit codes, on a tiny fixture git repo ----------------------------
function fixtureRepo(name, { bundleRc = 0 } = {}) {
  const R = path.join(ROOT, name);
  write(path.join(R, 'tools/toyvm/dos-loop.js'), 'module.exports = 1;\n');
  write(path.join(R, 'tools/toyvm/emit.js'), 'module.exports = 1;\n');
  write(path.join(R, 'tools/toyvm/run-dos.js'), exitWith(0));
  write(path.join(R, 'tools/toyvm/bundle-browser.js'), exitWith(bundleRc));
  write(path.join(R, 'test/test-toyvm-a.js'), exitWith(0));
  fs.mkdirSync(path.join(R, 'node_modules'), { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', R, '-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('add', 'tools', 'test'); g('commit', '-q', '-m', 'fixture');
  const patch = path.join(R, 'v2.patch');
  write(patch, '--- a/tools/toyvm/dos-loop.js\n+++ b/tools/toyvm/dos-loop.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n');
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(patch)).digest('hex');
  return { R, BASE: g('rev-parse', 'HEAD').trim(), V2: patch, V2_SHA: sha };
}
function prepEnv(fx, extra = {}) {
  const bisect = path.join(ROOT, 'bisect-stub.js'); write(bisect, exitWith(0));
  return { R: fx.R, BASE: fx.BASE, V2: fx.V2, V2_SHA: fx.V2_SHA, CAND: 'v2', CLOSURE: 'tools/toyvm',
    BISECT: bisect, ...extra };
}
check('prep aborts on a bundle-browser failure', () => {
  const fx = fixtureRepo('repo-bundle', { bundleRc: 1 });
  const W = workdir('prep-bundle');
  const r = plan('prep', W, prepEnv(fx));
  assert.strictEqual(r.code, 2, r.out); assert.match(r.journal, /base bundle-browser failed \(exit 1\)/);
});
check('prep aborts on an unpack-corpus failure', () => {
  const fx = fixtureRepo('repo-unpack');
  const W = workdir('prep-unpack');
  const unpack = path.join(ROOT, 'unpack-fail.js'); write(unpack, exitWith(5));
  const r = plan('prep', W, prepEnv(fx, { UNPACK: unpack }));
  assert.strictEqual(r.code, 2, r.out); assert.match(r.journal, /unpack-corpus failed \(exit 5\)/);
});
check('prep (v3j) aborts with no jmp_syn patch', () => {
  const fx = fixtureRepo('repo-v3j');
  const W = workdir('prep-v3j');
  const r = plan('prep', W, prepEnv(fx, { CAND: 'v3j' }));
  assert.strictEqual(r.code, 8, r.out); assert.match(r.journal, /needs JMPSYN/);
});

// --- run(): spawn errors and timeouts never throw ---------------------------
const { run } = require(PLAN);
const sleeper = path.join(ROOT, 'sleep-stub.js'); write(sleeper, 'setTimeout(() => {}, 5000);\n');
(async () => {
  const missing = await run(path.join(ROOT, 'no-such-binary'), [], { log: path.join(ROOT, 'missing.log') });
  check('run() resolves 127 when the child cannot start', () => {
    assert.strictEqual(missing, 127);
    assert.match(fs.readFileSync(path.join(ROOT, 'missing.log'), 'utf8'), /spawn failed/);
  });
  const slow = await run(process.execPath, [sleeper], { timeoutS: 1 });
  check('run() resolves 124 on timeout', () => assert.strictEqual(slow, 124));
  const gpFile = path.join(ROOT, 'timeout-grandchild.pid');
  const parentStub = path.join(ROOT, 'spawner-stub.js'); write(parentStub, spawner(gpFile, 30000));
  const t0 = Date.now();
  const rc = await run(process.execPath, [parentStub], { timeoutS: 1 });
  check('a timeout kills the child AND its descendants', () => {
    assert.strictEqual(rc, 124);
    assert.ok(Date.now() - t0 < 10000, 'run() waited for the grandchild');
    const gp = Number(fs.readFileSync(gpFile, 'utf8'));
    assert.ok(waitDead(gp), `grandchild ${gp} survived the timeout`);
  });
  console.log(`${n - failed}/${n} passed`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
