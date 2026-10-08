#!/usr/bin/env node
'use strict';
// Synthetic tests for the hardened run-fixture.js, no emulator: the REAL
// wrapper is copied into a temp dir beside a fake build-tree.js (creates the
// tree dir, prints its JSON pin line) and a fake test-toyvm-irq-if-enable.js
// whose behaviour FX_MODE_<tree> selects. Covers: PASS / ARCH-FAIL
// classification with ENGAGEMENT lines that must NOT affect it, an early-exiting
// child leaving a live grandchild (group reaped), spawn errors, the total bound
// killing a hung test and its grandchild, and the --total / --plan refusals.
//   node run-fixture.test.js [fixture-parent-dir]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'runfixture-fx-'));
const W = path.join(ROOT, 'wrapper');
fs.mkdirSync(W);
fs.copyFileSync(path.join(__dirname, 'run-fixture.js'), path.join(W, 'run-fixture.js'));
fs.writeFileSync(path.join(W, 'build-tree.js'), `const fs = require('fs');
const out = process.argv.find((a) => a.startsWith('--out=')).slice(6), tree = process.argv.find((a) => a.startsWith('--tree=')).slice(7);
fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/marker', tree);
console.log(JSON.stringify({ tree, base: 'fake' }));\n`);
fs.writeFileSync(path.join(W, 'test-toyvm-irq-if-enable.js'), `const fs = require('fs'), path = require('path');
const tree = path.basename(process.env.TOYVM_TREE).replace('tree-', '');
if (!fs.existsSync(path.join(process.env.TOYVM_TREE, 'marker'))) { console.log('no tree'); process.exit(9); }
const mode = process.env['FX_MODE_' + tree] || 'pass';
const grandchild = () => { const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  fs.appendFileSync(process.env.FX_PIDFILE, g.pid + '\\n'); return g; };
// Observation lines the wrapper must not read as a verdict.
console.log('ENGAGEMENT region: installed in 0/8 []; executed evidence in 0/8 []');
if (mode === 'pass') { console.log('ok   sti_nop'); console.log('all passed'); process.exit(0); }
if (mode === 'archfail') { console.log('ok   sti_nop'); console.log('FAIL popf: [1] l1: 0 at X'); console.log('1 case(s) failed'); process.exit(1); }
if (mode === 'early') { grandchild().unref(); console.log('ok   sti_nop'); process.exit(0); }
if (mode === 'hang') { grandchild(); setTimeout(() => {}, 600000); }\n`);
const RUN = path.join(W, 'run-fixture.js');
const SHA = 'ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4';
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitDead = (pids) => { const t = Date.now(); while (pids.some(alive) && Date.now() - t < 3000) spawnSync('sleep', ['0.1']); return pids.filter(alive); };

function run(name, extra = [], env = {}) {
  const out = path.join(ROOT, `out-${name}`), pidfile = path.join(ROOT, `pids-${name}`);
  const r = spawnSync(process.execPath, [RUN, `--out=${out}`, '--plan=cand,stack', `--candidate=${path.join(ROOT, 'x.diff')}`, `--candidate-sha=${SHA}`, ...extra],
    { env: { ...process.env, FX_PIDFILE: pidfile, ...env }, encoding: 'utf8', timeout: 60000 });
  const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
  const pids = fs.existsSync(pidfile) ? fs.readFileSync(pidfile, 'utf8').trim().split('\n').filter(Boolean).map(Number) : [];
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res, pids, step: (s) => res.steps.find((x) => x.name === s) };
}

check('PASS and ARCH-FAIL classified from the exit code; ENGAGEMENT lines are not a verdict; trees removed', () => {
  const r = run('basic', [], { FX_MODE_stack: 'archfail' });
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.step('test-cand').class, 'PASS');
  assert.strictEqual(r.step('test-stack').class, 'ARCH-FAIL');
  assert.ok(r.step('test-cand').caseLines.every((l) => !l.startsWith('ENGAGEMENT')));
  assert.strictEqual(r.step('test-cand').leftoverGroup, false);
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('a test exiting early with a live grandchild: its status kept, the group reaped, the grandchild dead', () => {
  const r = run('early', [], { FX_MODE_cand: 'early', FX_MODE_stack: 'early' });
  for (const t of ['cand', 'stack']) {
    const s = r.step(`test-${t}`);
    assert.strictEqual(s.exit, 0); assert.strictEqual(s.class, 'PASS'); assert.strictEqual(s.leftoverGroup, true, `${t}: group not found`);
  }
  assert.strictEqual(r.pids.length, 2);
  assert.deepStrictEqual(waitDead(r.pids), [], 'grandchildren survived their parents');
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('spawn error: recorded as spawnError, HARNESS-FAIL, no crash, no tree left', () => {
  const r = run('spawnerr', ['--node=/nonexistent/node-binary']);
  assert.strictEqual(r.code, 0, r.out);
  for (const t of ['cand', 'stack']) {
    const b = r.step(`build-${t}`);
    assert.match(b.spawnError || '', /ENOENT/); assert.strictEqual(b.class, 'HARNESS-FAIL');
  }
  assert.strictEqual(r.res.steps.filter((s) => s.name.startsWith('test-')).length, 0);
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('total bound: a hung test is killed with its grandchild, HARNESS-FAIL, the next tree still recorded', () => {
  const t0 = Date.now();
  const r = run('hang', ['--total=8'], { FX_MODE_cand: 'hang' });
  assert.ok(Date.now() - t0 < 30000, 'not stopped at the bound');
  const s = r.step('test-cand');
  assert.strictEqual(s.killedAtBound, true); assert.strictEqual(s.class, 'HARNESS-FAIL');
  assert.deepStrictEqual(waitDead(r.pids), [], 'the hung test\'s grandchild survived');
  assert.ok(r.step('build-stack'), 'the stack tree was never reached');
  assert.deepStrictEqual(r.res.treesRemoved, r.res.treesRemoved.map(() => true));
});
check('invalid --total and empty --plan refused before --out exists; a valid 300 is accepted', () => {
  for (const bad of [['--total=0'], ['--total=-1'], ['--total=abc'], ['--total=Infinity'], ['--total=NaN'], ['--plan=']]) {
    const out = path.join(ROOT, `out-bad-${bad[0].replace(/[^a-z0-9]/gi, '_')}`);
    const args = [RUN, `--out=${out}`, ...(bad[0].startsWith('--plan') ? [] : ['--plan=stack']), ...bad];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.strictEqual(r.status, 2, `${bad}: exit ${r.status}`);
    assert.match(r.stderr, /must be finite seconds > 0 and --plan non-empty/);
    assert.ok(!fs.existsSync(out), `${bad}: --out was created`);
  }
  const r = run('valid', ['--total=300']);
  assert.strictEqual(r.code, 0, r.out); assert.strictEqual(r.res.totalS, 300);
  assert.strictEqual(r.step('test-cand').class, 'PASS');
});
check('refuses a non-empty --out', () => {
  const out = path.join(ROOT, 'out-used'); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'x'), '1');
  assert.strictEqual(spawnSync(process.execPath, [RUN, `--out=${out}`, '--plan=stack'], { encoding: 'utf8' }).status, 2);
});
console.log(`${n - failed}/${n} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
