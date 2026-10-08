#!/usr/bin/env node
'use strict';
// Fixture tests for attribution.js with a stub corpus-ab: exact identities x six
// trees, full guest-field reproduction of P4, one total bound with real
// child-group cleanup, and fresh-output-only. No emulator.
// Usage: node attribution.test.js [fixture-parent-dir]

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'attribution.js');
const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'p4attr-fx-'));
const TREES = ['head', 'j', 'smc', 'v2v3j', 'v2v3j_v4', 'stack'];
const PROGS = ['1995-a-acidrain/ACIDRAIN.EXE', '1995-a-acolors/COLORS.EXE', '1995-b-boxtro/NEWSBOX3.EXE', '1995-b-brian/BRIAN.EXE'];
const BASE = { 'ACIDRAIN.EXE': 8024330, 'COLORS.EXE': 8001200, 'NEWSBOX3.EXE': 8009352, 'BRIAN.EXE': 8001195 };
const CAND = { 'ACIDRAIN.EXE': 8024454, 'COLORS.EXE': 8001270, 'NEWSBOX3.EXE': 8009532, 'BRIAN.EXE': 8001780 };
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// Shared fixture: work dir with the four programs, six trees, preserved P4 rows.
const W = path.join(ROOT, 'W');
for (const p of PROGS) write(path.join(W, 'demos', p), 'MZ');
const TR = path.join(ROOT, 'trees');
for (const t of TREES) fs.mkdirSync(path.join(TR, t, 'tools/toyvm'), { recursive: true });
const row = (exe, d, extra = {}) => ({ exe, arm: 'l1', budget: 8e6, recipe: 'sweep', irqSchedule: false, ok: true,
  ranOutOfTime: false, stuckAt: null, dispatched: d, frame: 'f' + path.basename(exe), wav: 'none', irqs: 0, ints: 7, pixels: 100, ...extra });
const P4 = path.join(ROOT, 'p4');
write(path.join(P4, 'nosched-base.ndjson'), PROGS.map((p) => JSON.stringify(row(path.join(W, 'demos', p), BASE[path.basename(p)]))).join('\n') + '\n');
write(path.join(P4, 'nosched-cand.ndjson'), PROGS.map((p) => JSON.stringify(row(path.join(W, 'demos', p), CAND[path.basename(p)]))).join('\n') + '\n');

// The stub: tree name from --tree; rows = P4 base (head and others) or cand (stack).
// FX_TREE selects the tree a fault applies to; FX_MODE picks the fault.
const STUB = path.join(ROOT, 'ab-stub.js');
write(STUB, `const a = process.argv.slice(2); const fs = require('fs'); const path = require('path');
const get = (k) => (a.find((x) => x.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const tree = path.basename(get('tree')); const out = get('out');
const progs = fs.readFileSync(get('list'), 'utf8').split('\\n').filter(Boolean);
const BASE = ${JSON.stringify(BASE)}, CAND = ${JSON.stringify(CAND)};
const mode = tree === process.env.FX_TREE ? process.env.FX_MODE : '';
if (mode === 'hang') {
  const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FX_PIDFILE, String(g.pid));
  setTimeout(() => {}, 60000);
} else {
  let rows = progs.map((p) => ({ exe: p, arm: 'l1', budget: 8000000, recipe: 'sweep', irqSchedule: false, ok: true,
    ranOutOfTime: false, stuckAt: null, dispatched: (tree === 'stack' ? CAND : BASE)[path.basename(p)],
    frame: 'f' + path.basename(p), wav: 'none', irqs: 0, ints: 7, pixels: 100 }));
  if (mode === 'missing') rows = rows.slice(1);
  if (mode === 'duplicate') rows = [rows[0], ...rows.slice(0, 3)];
  if (mode === 'wrong-arm') rows[2].arm = 'jit-sepc';
  if (mode === 'head-frame') rows[0].frame = 'changed';
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\\n') + '\\n');
}
`);

function run(name, env = {}, extra = []) {
  const out = path.join(ROOT, 'out-' + name);
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--ab=${STUB}`, `--p4=${P4}`, ...extra],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  const res = fs.existsSync(path.join(out, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')) : null;
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res, dir: out };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

check('passes when all six trees produce exactly the four rows and head/stack reproduce P4', () => {
  const r = run('pass');
  assert.strictEqual(r.code, 0, r.out); assert.strictEqual(r.res.status, 'PASS');
  assert.ok(fs.readFileSync(path.join(r.dir, 'table.md'), 'utf8').includes('| ACIDRAIN.EXE | stack | 8024454 | +124 |'));
});
check('a missing row in one tree fails (exit 4)', () => {
  const r = run('missing', { FX_TREE: 'j', FX_MODE: 'missing' });
  assert.strictEqual(r.code, 4, r.out); assert.match(r.res.failures.join(), /j: missing rows ACIDRAIN\.EXE/);
});
check('a duplicate row fails rather than overwriting (exit 4)', () => {
  const r = run('dup', { FX_TREE: 'smc', FX_MODE: 'duplicate' });
  assert.strictEqual(r.code, 4, r.out); assert.match(r.res.failures.join(), /smc: duplicate row ACIDRAIN\.EXE/);
});
check('a wrong-arm row fails (exit 4)', () => {
  const r = run('arm', { FX_TREE: 'v2v3j', FX_MODE: 'wrong-arm' });
  assert.strictEqual(r.code, 4, r.out); assert.match(r.res.failures.join(), /v2v3j: NEWSBOX3\.EXE arm jit-sepc, want l1/);
});
check('head must reproduce P4 base on every guest field, not only dispatched (exit 3)', () => {
  const r = run('void', { FX_TREE: 'head', FX_MODE: 'head-frame' });
  assert.strictEqual(r.code, 3, r.out); assert.strictEqual(r.res.status, 'VOID');
  assert.match(r.res.failures.join(), /head ACIDRAIN\.EXE frame changed != P4 base/);
});
check('one total bound: a hung tree hits the deadline, its grandchild is killed, result is preserved', () => {
  const pidFile = path.join(ROOT, 'hang.pid');
  const t0 = Date.now();
  const r = run('deadline', { FX_TREE: 'j', FX_MODE: 'hang', FX_PIDFILE: pidFile }, ['--total=3']);
  assert.strictEqual(r.code, 5, r.out); assert.strictEqual(r.res.status, 'DEADLINE');
  assert.ok(Date.now() - t0 < 15000, 'did not stop at the total bound');
  assert.strictEqual(r.res.trees.head.exit, 0); assert.strictEqual(r.res.trees.j.exit, 124);
  const gp = Number(fs.readFileSync(pidFile, 'utf8'));
  const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.ok(!alive(gp), `grandchild ${gp} survived`);
});
check('refuses a non-empty --out (fresh output only)', () => {
  const out = path.join(ROOT, 'out-used'); write(path.join(out, 'old.json'), '{}');
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--ab=${STUB}`, `--p4=${P4}`], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2); assert.match(r.stderr, /not empty/);
  assert.strictEqual(fs.readFileSync(path.join(out, 'old.json'), 'utf8'), '{}');
});
console.log(`${n - failed}/${n} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
