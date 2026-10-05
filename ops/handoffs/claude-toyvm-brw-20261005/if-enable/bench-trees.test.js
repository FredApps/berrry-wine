#!/usr/bin/env node
'use strict';
// Synthetic tests for bench-trees.js + bench-one.js: the REAL driver and the
// REAL child, against prepared fake trees whose tools/toyvm/run-dos.js is a
// tiny stub runDos. No emulator. Covers: a comparable program with rotation,
// a cross-tree frame mismatch, a non-deterministic tree, a per-run timeout
// whose grandchild must die, the total bound skipping what is left, and
// removal of the owned tree copies.
//   node bench-trees.test.js [fixture-parent-dir]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DRIVER = path.join(__dirname, 'bench-trees.js');
const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'benchtrees-fx-'));
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// Stub runDos: the program's basename picks a behaviour; FX_TREE names this tree.
const STUB = (tree) => `'use strict';
const fs = require('fs'), path = require('path');
let calls = 0;
exports.runDos = async (o) => {
  const prog = path.basename(o.exe);
  if (o.variant !== 'tailcall' || o.cpu !== 386 || o.autoKey !== true || typeof o.budget !== 'number') throw new Error('bench-dos call shape not mirrored');
  const n = Number(fs.existsSync(process.env.FX_COUNTER) ? fs.readFileSync(process.env.FX_COUNTER, 'utf8') : 0) + 1;
  fs.writeFileSync(process.env.FX_COUNTER, String(n));
  if (prog === 'hang.com' && '${tree}' === 'stack') {
    const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.FX_PIDFILE, String(g.pid));
    await new Promise(() => {});
  }
  if (prog === 'orphan.com') {
    // The child will exit normally right after this, leaving a live grandchild
    // in its process group.
    const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    g.unref();
    fs.appendFileSync(process.env.FX_PIDFILE + '-orphans', g.pid + '\\n');
  }
  let frame = 'f-' + prog;
  if (prog === 'differ.com' && '${tree}' === 'cand') frame = 'f-other';
  if (prog === 'nondet.com' && '${tree}' === 'stack') frame = 'f-' + n;
  const secs = '${tree}' === 'cand' ? 0.011 : 0.010;
  return { dispatched: o.budget, frame, handbacks: 5, pixels: 9, guestSecs: secs, guestCpuSecs: secs };
};
`;
const PREP = path.join(ROOT, 'prep');
for (const t of ['cand', 'stack']) write(path.join(PREP, t, 'tools/toyvm/run-dos.js'), STUB(t));
const P = path.join(ROOT, 'progs');
for (const p of ['ok.com', 'differ.com', 'nondet.com', 'hang.com', 'orphan.com']) write(path.join(P, p), 'MZ');
const prog = (p) => path.join(P, p);

function run(name, progs, extra = [], env = {}) {
  const out = path.join(ROOT, 'out-' + name);
  const r = spawnSync(process.execPath, [DRIVER, `--out=${out}`, `--progs=${progs.map(prog).join(',')}`, `--prepared-trees=${PREP}`,
    '--reps=3', '--dispatches=1m', ...extra],
  { env: { ...process.env, FX_COUNTER: path.join(ROOT, `counter-${name}`), FX_PIDFILE: path.join(ROOT, `pid-${name}`), ...env }, encoding: 'utf8', timeout: 90000 });
  const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res, dir: out };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

check('comparable program: exact (dispatched, frame) gate, paired ratio, rotation, cleanup', () => {
  const r = run('ok', ['ok.com']);
  assert.strictEqual(r.code, 0, r.out);
  const p = r.res.programs[prog('ok.com')];
  assert.strictEqual(p.status, 'COMPARABLE'); assert.strictEqual(p.sig, '1000000/f-ok.com');
  assert.deepStrictEqual(p.order, ['cand,stack', 'stack,cand', 'cand,stack']);
  assert.ok(Math.abs(p.pairedCandOverStack - 1.1) < 1e-9, String(p.pairedCandOverStack));
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
  assert.strictEqual(r.res.runs.length, 6);
});
check('trees disagree on the frame: NOT COMPARABLE, no ratio', () => {
  const p = run('differ', ['differ.com']).res.programs[prog('differ.com')];
  assert.match(p.status, /^NOT COMPARABLE \(trees differ: cand 1000000\/f-other vs stack 1000000\/f-differ\.com\)$/);
  assert.strictEqual(p.pairedCandOverStack, undefined);
});
check('a tree not deterministic across reps: NOT COMPARABLE', () => {
  const p = run('nondet', ['nondet.com']).res.programs[prog('nondet.com')];
  assert.match(p.status, /^NOT COMPARABLE \(stack not deterministic across reps\)$/);
});
check('per-run timeout: INCOMPLETE, grandchild killed, later programs still run, cleanup', () => {
  const r = run('hang', ['hang.com', 'ok.com'], ['--per-run=3', '--total=60']);
  assert.match(r.res.programs[prog('hang.com')].status, /^INCOMPLETE \(stack rep 0 TIMEOUT\)$/);
  assert.strictEqual(r.res.programs[prog('ok.com')].status, 'COMPARABLE');
  const gp = Number(fs.readFileSync(path.join(ROOT, 'pid-hang'), 'utf8'));
  const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.ok(!alive(gp), `grandchild ${gp} survived`);
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('total bound: the hung run is cut at the total, the rest is SKIPPED, cleanup', () => {
  const t0 = Date.now();
  const r = run('total', ['hang.com', 'ok.com'], ['--per-run=60', '--total=4']);
  assert.ok(Date.now() - t0 < 20000, 'not stopped at the total bound');
  assert.match(r.res.programs[prog('hang.com')].status, /^INCOMPLETE \(stack rep 0 TIMEOUT\)$/);
  assert.strictEqual(r.res.programs[prog('ok.com')].status, 'SKIPPED');
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('a child that exits early leaving live grandchildren: statuses kept, every group reaped, all grandchildren dead', () => {
  const r = run('orphan', ['orphan.com']);
  assert.strictEqual(r.res.programs[prog('orphan.com')].status, 'COMPARABLE');
  assert.ok(r.res.runs.every((x) => x.status === 'PASS' && x.exit === 0 && x.leftoverGroup === true), JSON.stringify(r.res.runs));
  const pids = fs.readFileSync(path.join(ROOT, 'pid-orphan-orphans'), 'utf8').trim().split('\n').map(Number);
  assert.strictEqual(pids.length, 6);
  const tw = Date.now(); while (pids.some(alive) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.deepStrictEqual(pids.filter(alive), [], 'grandchildren survived their parents');
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('spawn error: SPAWN-ERROR recorded, program INCOMPLETE, no ratio, cleanup', () => {
  const r = run('spawnerr', ['ok.com'], ['--node=/nonexistent/node-binary']);
  const p = r.res.programs[prog('ok.com')];
  assert.match(p.status, /^INCOMPLETE \(cand rep 0 SPAWN-ERROR\)$/);
  assert.match(r.res.runs[0].error, /ENOENT/);
  assert.strictEqual(p.pairedCandOverStack, undefined);
  assert.deepStrictEqual(r.res.treesRemoved, [true, true]);
});
check('refuses a non-empty --out', () => {
  const out = path.join(ROOT, 'out-used'); write(path.join(out, 'x'), '1');
  const r = spawnSync(process.execPath, [DRIVER, `--out=${out}`, `--progs=${prog('ok.com')}`, `--prepared-trees=${PREP}`], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});
console.log(`${n - failed}/${n} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
