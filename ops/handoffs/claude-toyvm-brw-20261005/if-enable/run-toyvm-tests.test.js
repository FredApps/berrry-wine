#!/usr/bin/env node
'use strict';
// Synthetic tests for run-toyvm-tests.js with tiny JS child fixtures as the
// "tests" (no emulator): PASS / FAIL statuses, the per-test cap killing a hung
// test AND its grandchild, the total bound turning the rest into SKIPPED, the
// cand-vs-stack REGRESSION/FIXED/same/incomplete comparison, cwd = the tree,
// and removal of the owned tree copies.
//   node run-toyvm-tests.test.js [fixture-parent-dir]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, 'run-toyvm-tests.js');
const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'toyvmtests-fx-'));
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

const PASS = `if (!require('fs').existsSync('test')) process.exit(3); console.log('ok');\n`;   // cwd must be the tree
const FAIL = `console.error('assertion failed: x'); process.exit(1);\n`;
const HANG = `const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
require('fs').writeFileSync(process.env.FX_PIDFILE, String(g.pid)); setTimeout(() => {}, 60000);\n`;
// Exits 0 AT ONCE, leaving a live grandchild in its process group.
const EARLY = `const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
require('fs').writeFileSync(process.env.FX_PIDFILE + '-' + require('path').basename(process.cwd()), String(g.pid)); g.unref(); process.exit(0);\n`;
const PREP = path.join(ROOT, 'prep');
// cand: a=PASS b=FAIL c=PASS d=FAIL ; stack: a=PASS b=PASS c=FAIL d=FAIL
const SCRIPTS = { cand: { a: PASS, b: FAIL, c: PASS, d: FAIL, h: HANG, e: EARLY }, stack: { a: PASS, b: PASS, c: FAIL, d: FAIL, h: PASS, e: EARLY } };
for (const [tree, m] of Object.entries(SCRIPTS)) for (const [t, s] of Object.entries(m)) write(path.join(PREP, tree, 'test', `test-toyvm-${t}.js`), s);

function run(name, tests, extra = []) {
  const out = path.join(ROOT, 'out-' + name);
  const r = spawnSync(process.execPath, [RUNNER, `--out=${out}`, '--plan=cand,stack', `--tests=${tests}`, `--prepared-trees=${PREP}`, ...extra],
    { env: { ...process.env, FX_PIDFILE: path.join(ROOT, `pid-${name}`) }, encoding: 'utf8', timeout: 90000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res: JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')) };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

check('statuses, cwd = tree, comparison, cleanup', () => {
  const r = run('basic', 'a,b,c,d');
  assert.strictEqual(r.code, 0, r.out);
  const st = (tree, t) => r.res.trees[tree].tests[t].status;
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map((t) => st('cand', t)), ['PASS', 'FAIL', 'PASS', 'FAIL']);
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map((t) => st('stack', t)), ['PASS', 'PASS', 'FAIL', 'FAIL']);
  assert.deepStrictEqual(r.res.compare, { a: 'same', b: 'REGRESSION', c: 'FIXED', d: 'same' });
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('per-test cap kills a hung test and its grandchild; the next test still runs', () => {
  const r = run('cap', 'h,a', ['--per-test=3', '--total=60']);
  assert.strictEqual(r.res.trees.cand.tests.h.status, 'TIMEOUT');
  assert.strictEqual(r.res.trees.cand.tests.a.status, 'PASS');
  // A TIMEOUT is the bound, not the test: never a REGRESSION.
  assert.strictEqual(r.res.compare.h, 'incomplete (timeout: cand TIMEOUT, stack PASS)');
  const gp = Number(fs.readFileSync(path.join(ROOT, 'pid-cap'), 'utf8'));
  const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.ok(!alive(gp), `grandchild ${gp} survived`);
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('total bound: the hung test is cut at the total, everything after it SKIPPED (never counted), cleanup', () => {
  const t0 = Date.now();
  const r = run('total', 'h,a', ['--per-test=60', '--total=4']);
  assert.ok(Date.now() - t0 < 20000, 'not stopped at the total bound');
  assert.strictEqual(r.res.trees.cand.tests.h.status, 'TIMEOUT');
  assert.strictEqual(r.res.trees.cand.tests.a.status, 'SKIPPED');
  assert.strictEqual(r.res.trees.stack.tests.a.status, 'SKIPPED');
  assert.deepStrictEqual(r.res.compare, { h: 'incomplete (timeout: cand TIMEOUT, stack SKIPPED)', a: 'incomplete (cand SKIPPED, stack SKIPPED)' });
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('a test that exits early leaving a live grandchild: status kept PASS, group reaped, grandchild dead', () => {
  const r = run('early', 'e,a');
  for (const tree of ['cand', 'stack']) {
    const rec = r.res.trees[tree].tests.e;
    assert.strictEqual(rec.status, 'PASS'); assert.strictEqual(rec.exit, 0);
    assert.strictEqual(rec.leftoverGroup, true, `${tree}: the grandchild's group was not found`);
    const gp = Number(fs.readFileSync(path.join(ROOT, `pid-early-tree-${tree}`), 'utf8'));
    const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
    assert.ok(!alive(gp), `${tree}: grandchild ${gp} survived its parent's early exit`);
  }
  assert.strictEqual(r.res.trees.cand.tests.a.leftoverGroup, false);
  assert.strictEqual(r.res.compare.e, 'same');
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('spawn error: SPAWN-ERROR recorded, comparison incomplete, trees still removed', () => {
  const r = run('spawnerr', 'a', ['--node=/nonexistent/node-binary']);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.res.trees.cand.tests.a.status, 'SPAWN-ERROR');
  assert.match(r.res.trees.cand.tests.a.error, /ENOENT/);
  assert.strictEqual(r.res.compare.a, 'incomplete (cand SPAWN-ERROR, stack SPAWN-ERROR)');
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('invalid bounds refused before --out exists; valid 600/60 still accepted', () => {
  for (const bad of [['--total=0'], ['--total=-5'], ['--total=abc'], ['--total=Infinity'], ['--per-test=0'], ['--per-test=NaN']]) {
    const out = path.join(ROOT, `out-bad-${bad[0].replace(/[^a-z0-9]/gi, '_')}`);
    const r = spawnSync(process.execPath, [RUNNER, `--out=${out}`, '--plan=stack', '--tests=a', `--prepared-trees=${PREP}`, ...bad], { encoding: 'utf8' });
    assert.strictEqual(r.status, 2, `${bad}: exit ${r.status}`); assert.match(r.stderr, /must be finite seconds > 0/);
    assert.ok(!fs.existsSync(out), `${bad}: --out was created`);
  }
  const r = run('valid', 'a', ['--total=600', '--per-test=60']);
  assert.strictEqual(r.code, 0, r.out); assert.strictEqual(r.res.totalS, 600); assert.strictEqual(r.res.perTestS, 60);
  assert.strictEqual(r.res.trees.cand.tests.a.status, 'PASS');
});
check('--tests=uop-only still archives every default test plus the test-to-test require closure (static, git only)', () => {
  const r = spawnSync(process.execPath, [RUNNER, '--list-archive', '--tests=uop-only'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const files = r.stdout.trim().split('\n');
  for (const t of ['uop-only', 'uop', 'uop-live', 'pm-timer-vector', 'live', 'arena-recycle']) assert.ok(files.includes(`test/test-toyvm-${t}.js`), `missing ${t}`);
  assert.strictEqual(new Set(files).size, files.length);
  assert.strictEqual(files.length, 15);
});
check('refuses a non-empty --out', () => {
  const out = path.join(ROOT, 'out-used'); write(path.join(out, 'x'), '1');
  assert.strictEqual(spawnSync(process.execPath, [RUNNER, `--out=${out}`, '--plan=stack', `--prepared-trees=${PREP}`], { encoding: 'utf8' }).status, 2);
});
console.log(`${n - failed}/${n} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
