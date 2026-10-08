#!/usr/bin/env node
'use strict';
// Fixture tests for wav-run.js with a stub wav-drive: the P3 gate on every
// guest field, missing output, one total bound with real grandchild cleanup,
// the per-log and output size caps, program pins and fresh output only. No
// emulator. Usage: node wav-run.test.js [fixture-parent-dir]

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'wav-run.js');
const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'wavrun-fx-'));
const TREES = ['head', 'stack', 'v2v3', 'v2v3j', 'v2v3j_v4'];
const PROGS = ['1994-b-bliq/BLIQ.EXE', '1994-c-cyclewar/CYCLE.EXE', '1993-c-caveira/CAVEIRA.COM'];
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// The stub driver. Its WAV for (tree, program) is deterministic: the stack
// tree flips a few samples, every other tree renders the head audio. FX_TREE
// selects the tree a fault applies to (FX_PROG optionally narrows it), FX_MODE
// picks the fault.
const STUB = path.join(ROOT, 'drive-stub.js');
write(STUB, `'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function wavFor(tree, prog) {
  const frames = 2205 + prog.length, data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames * 2; i++) data.writeInt16LE(Math.round(8000 * Math.sin((i + prog.length) / 7)), i * 2);
  if (tree === 'stack') for (const i of [100, 101, 900]) data.writeInt16LE(data.readInt16LE(i * 2) + 5, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(22050, 24);
  h.writeUInt32LE(88200, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
function rowFor(tree, prog, bytes) {
  const stack = tree === 'stack';
  return { ok: true, ranOutOfTime: false, stuckAt: null, frame: 'f' + prog, pixels: 100,
    wav: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    wavSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    irqs: stack ? 381 : 384, ints: stack ? 2978 : 2985, dispatched: 80000001,
    kinds: { date: stack ? 3298 : 3290, budget: 0, cut: 0, early: 41112 },
    clock: { audioRate: 22050, frames: (bytes.length - 44) / 4, seconds: (bytes.length - 44) / 4 / 22050,
      rendered: (bytes.length - 44) / 4, outAccResidue: 0.25, guestSeconds: 8 } };
}
module.exports = { wavFor, rowFor };
if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => (a.find((x) => x.startsWith('--' + k + '=')) || '').slice(k.length + 3);
  const tree = path.basename(get('tree')), prog = path.basename(get('exe'));
  const hit = tree === process.env.FX_TREE && (!process.env.FX_PROG || prog === process.env.FX_PROG);
  const mode = hit ? process.env.FX_MODE : '';
  if (mode === 'hang') {
    const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.FX_PIDFILE, String(g.pid));
    setTimeout(() => {}, 60000);
  } else if (mode === 'flood') {
    const line = '  irq vec=08 pit     at=1 hb=1 t=0.000000 from 0:0\\n'.repeat(2000);
    const go = () => { process.stdout.write(line, go); };
    go();
  } else {
    const bytes = wavFor(tree, prog);
    // One irq line per counted irq (the runner's completeness gate); line 0's
    // hb differs by tree and must be ignored, line 1's at= is the real divergence.
    const irqs = rowFor(tree, prog, bytes).irqs - (mode === 'short-trace' ? 5 : 0);
    let log = '';
    for (let i = 0; i < irqs; i++) {
      const at = i === 1 && tree === 'stack' ? 250 : 100 + 100 * i;
      log += '  irq vec=08 timer   at=' + at + ' hb=' + (i === 0 && tree === 'stack' ? 7 : 3) + ' t=0.000010 from 0:0\\n';
    }
    process.stdout.write(log);
    if (mode !== 'no-wav') fs.writeFileSync(get('wav'), bytes);
    fs.writeFileSync(get('row'), JSON.stringify(rowFor(tree, prog, bytes)) + '\\n');
  }
}
`);
const { wavFor, rowFor } = require(STUB);

// Work dir, prepared trees, and preserved P3 rows built from the stub's own bytes.
const W = path.join(ROOT, 'W');
for (const p of PROGS) write(path.join(W, 'demos', p), 'MZ');
const TR = path.join(ROOT, 'trees');
for (const t of TREES) fs.mkdirSync(path.join(TR, t, 'tools/toyvm'), { recursive: true });
const P3 = path.join(ROOT, 'p3');
const p3row = (tree, p, extra = {}) => {
  const exe = path.join('/elsewhere/demos', p), r = rowFor(tree, path.basename(p), wavFor(tree, path.basename(p)));
  return JSON.stringify({ exe, arm: 'l1', recipe: 'witness', irqSchedule: true, budget: 80000000, ...r, ...extra });
};
// Distractors: another arm, the sweep recipe and the other BLIQ directory must not be picked.
const noise = (tree) => [p3row(tree, PROGS[0], { arm: 'fold64', wav: 'x' }), p3row(tree, PROGS[1], { recipe: 'sweep', wav: 'x' })];
write(path.join(P3, 'arms-base.ndjson'), [...PROGS.map((p) => p3row('head', p)), ...noise('head')].join('\n') + '\n');
write(path.join(P3, 'arms-cand.ndjson'), [...PROGS.map((p) => p3row('stack', p)), ...noise('stack')].join('\n') + '\n');

function run(name, env = {}, extra = [], pins = false) {
  const out = path.join(ROOT, 'out-' + name);
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--drive=${STUB}`,
    `--p3=${P3}`, ...(pins ? [] : ['--no-pins']), ...extra], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  const res = fs.existsSync(path.join(out, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')) : null;
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res, dir: out };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

check('passes when head/stack reproduce P3 on every guest field; analysis names first changes and divergences', () => {
  const r = run('pass');
  assert.strictEqual(r.code, 0, r.out); assert.strictEqual(r.res.status, 'PASS'); assert.deepStrictEqual(r.res.p3Gate, { reproduced: true });
  const a = r.res.analysis.BLIQ;
  assert.strictEqual(a.firstChange.wav, 'stack'); assert.strictEqual(a.firstChange.ints, 'stack'); assert.strictEqual(a.firstChange.frame, null);
  assert.strictEqual(a.compare.stack.differingSamples, 3); assert.strictEqual(a.compare.v2v3.differingSamples, 0);
  // hb= is stripped, so the first divergence is the second line's `at`, not the first line's handback.
  assert.strictEqual(a.irq.index, 1); assert.match(a.irq.context.b[1], /at=250/);
  assert.ok(fs.readFileSync(path.join(r.dir, 'analysis.md'), 'utf8').includes('Not a verdict that the new audio is correct'));
  assert.strictEqual(r.res.treesDeleted, undefined, 'prepared --trees must never be deleted');
  assert.ok(fs.existsSync(path.join(TR, 'head')));
});
check('a head row that differs from P3 base on a non-wav field is VOID and the middle trees never run (exit 3)', () => {
  const p3b = path.join(P3, 'arms-base.ndjson'), keep = fs.readFileSync(p3b, 'utf8');
  try {
    fs.writeFileSync(p3b, keep.replace('"irqs":384', '"irqs":999'));
    const r = run('void');
    assert.strictEqual(r.code, 3, r.out); assert.strictEqual(r.res.status, 'VOID');
    assert.match(r.res.failures.join(), /head BLIQ irqs 384 != P3 base 999/);
    assert.ok(!r.res.runs[PROGS[0]].v2v3, 'a middle tree ran after a VOID gate');
  } finally { fs.writeFileSync(p3b, keep); }
});
check('an irq log with fewer lines than the irqs counter is TRACE-INCOMPLETE (exit 7), analysis kept', () => {
  const r = run('short', { FX_TREE: 'v2v3j', FX_PROG: 'CYCLE.EXE', FX_MODE: 'short-trace' });
  assert.strictEqual(r.code, 7, r.out); assert.strictEqual(r.res.status, 'TRACE-INCOMPLETE');
  assert.match(r.res.failures.join(), /CYCLE: v2v3j 379\/384/);
  assert.strictEqual(r.res.analysis.CYCLE.irqTrace.head.complete, true);
  assert.ok(fs.readFileSync(path.join(r.dir, 'analysis.md'), 'utf8').includes('TRACE-INCOMPLETE'));
});
check('the real wav-drive.js flushes a 254,307-line trace through a pipe before exiting', () => {
  // A fake tree whose runDos logs like --trace-irq on CAVEIRA, then returns.
  const t = path.join(ROOT, 'faketree');
  write(path.join(t, 'tools/toyvm/run-dos.js'), `exports.runDos = async (o) => {
    for (let i = 0; i < 254307; i++) o.log('  irq vec=08 timer   at=' + i + ' hb=' + i + ' t=0.000000 from 110:7ae');
    return { audioChunks: [new Float32Array([0, 0])], audioRate: 22050, frame: 'f', pixels: 1, irqs: 254307, ints: 0,
      dispatched: 80000000, handbacks: 1, exitKinds: {}, machine: { audio: { rendered: 1, outAcc: 0, dma: { writes: 0 }, speakerWrites: 0 } } };
  };\n`);
  write(path.join(t, 'tools/toyvm/audio.js'), `exports.wavBytes = () => new Uint8Array(48);\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'wav-drive.js'), `--tree=${t}`, '--exe=x', `--wav=${path.join(t, 'o.wav')}`,
    `--row=${path.join(t, 'o.json')}`, '--trace-irq'], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.includes('irq vec='));
  assert.strictEqual(lines.length, 254307, `received ${lines.length} of 254307 lines`);
  assert.match(lines[lines.length - 1], /at=254306 /);
});
check('a run that leaves no WAV fails (exit 4)', () => {
  const r = run('nowav', { FX_TREE: 'stack', FX_PROG: 'CYCLE.EXE', FX_MODE: 'no-wav' });
  assert.strictEqual(r.code, 4, r.out); assert.match(r.res.failures.join(), /stack\/CYCLE: no WAV/);
});
check('one total bound: a hung run hits the deadline, its grandchild is killed, the result is preserved (exit 5)', () => {
  const pidFile = path.join(ROOT, 'hang.pid'), t0 = Date.now();
  const r = run('deadline', { FX_TREE: 'stack', FX_PROG: 'BLIQ.EXE', FX_MODE: 'hang', FX_PIDFILE: pidFile }, ['--total=3']);
  assert.strictEqual(r.code, 5, r.out); assert.strictEqual(r.res.status, 'DEADLINE');
  assert.ok(Date.now() - t0 < 15000, 'did not stop at the total bound');
  assert.strictEqual(r.res.runs[PROGS[0]].head.exit, 0); assert.strictEqual(r.res.runs[PROGS[0]].stack.exit, 124);
  const gp = Number(fs.readFileSync(pidFile, 'utf8'));
  const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.ok(!alive(gp), `grandchild ${gp} survived`);
});
check('a log past --log-cap-mb kills its run (exit 6)', () => {
  const r = run('logcap', { FX_TREE: 'head', FX_PROG: 'CAVEIRA.COM', FX_MODE: 'flood' }, ['--log-cap-mb=1']);
  assert.strictEqual(r.code, 6, r.out); assert.strictEqual(r.res.status, 'SIZE'); assert.match(r.res.failures.join(), /head\/CAVEIRA: log passed 1 MB/);
  // A hard bound: the log on disk never exceeds the cap, however fast the child writes.
  assert.ok(r.res.runs[PROGS[2]].head.logBytes <= 1048576, `log ${r.res.runs[PROGS[2]].head.logBytes} bytes past the 1 MB cap`);
});
check('output past --out-cap-mb stops the check (exit 6)', () => {
  const r = run('outcap', {}, ['--out-cap-mb=0.01']);
  assert.strictEqual(r.code, 6, r.out); assert.match(r.res.failures.join(), /remaining output budget|output passed/);
  assert.ok(r.res.runs[PROGS[0]].head.logBytes <= r.res.runs[PROGS[0]].head.logCapBytes);
});
check('a program directory that does not match its pin is refused before anything runs (exit 2)', () => {
  const r = run('pins', {}, [], true);
  assert.strictEqual(r.code, 2, r.out); assert.match(r.res.failures.join(), /BLIQ\.EXE: directory digest [0-9a-f]{64} != pinned 971da3aa/);
  assert.deepStrictEqual(fs.readdirSync(r.dir), ['result.json'], 'something ran before the pin check');
});
check('refuses a non-empty --out (fresh output only)', () => {
  const out = path.join(ROOT, 'out-used'); write(path.join(out, 'old.json'), '{}');
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--drive=${STUB}`, `--p3=${P3}`, '--no-pins'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2); assert.match(r.stderr, /not empty/);
  assert.strictEqual(fs.readFileSync(path.join(out, 'old.json'), 'utf8'), '{}');
});
console.log(`${n - failed}/${n} passed`);
if (!process.env.FX_KEEP) fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
