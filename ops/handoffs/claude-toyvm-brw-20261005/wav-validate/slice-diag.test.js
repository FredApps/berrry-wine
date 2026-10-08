#!/usr/bin/env node
'use strict';
// Fixture tests for slice-diag.js. The REAL wav-drive.js and the REAL runner run
// against fake trees whose tools/toyvm/run-dos.js writes the slice record with
// run-dos's own statement -- fs.writeFileSync(sliceLogFile, sliceLog.join('\n')
// + '\n') -- so the FIFO transport, the caps and the record accounting are
// exercised on the path the real runs take. No emulator.
// Usage: node slice-diag.test.js [fixture-parent-dir]

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'slice-diag.js');
const DRIVE = path.join(__dirname, 'wav-drive.js');
const ROOT = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'slicediag-fx-'));
const PROGS = ['1994-b-bliq/BLIQ.EXE', '1993-c-caveira/CAVEIRA.COM'];
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// Scenario: handbacks at d = 1000, 2000, ...; irq instants per tree/program;
// `left` overrides at chosen instants (default -2, a budget stop); IF per record.
const SCEN = {
  'head/BLIQ': { n: 12, irqs: [1000, 5000, 9000], left: { 5000: 0 }, ifAt: {} },
  'v2v3/BLIQ': { n: 12, irqs: [1000, 6000, 9000], left: { 6000: -3 }, ifAt: { 5000: 0, 6000: 1 } },
  'head/CAVEIRA': { n: 10, irqs: [2000, 3000, 7000], left: {}, ifAt: {} },
  'v2v3/CAVEIRA': { n: 10, irqs: [2000, 4000, 7000], left: {}, ifAt: {} },
};
// The fake run-dos. FX_TREE/FX_PROG select the run a fault applies to.
const FAKE = (tree) => `'use strict';
const fs = require('fs'), path = require('path');
const SCEN = ${JSON.stringify(SCEN)};
exports.runDos = async (o) => {
  const prog = path.basename(o.exe).replace(/\\.[^.]+$/, ''), key = '${tree}/' + prog;
  const s = { ...SCEN[key] };
  const hit = process.env.FX_TREE === '${tree}' && (!process.env.FX_PROG || process.env.FX_PROG === prog);
  const mode = hit ? process.env.FX_MODE : '';
  if (mode === 'big') s.n = Number(process.env.FX_N);
  if (mode === 'hang') {
    const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.FX_PIDFILE, String(g.pid));
    await new Promise(() => {});
  }
  if (mode === 'rss') { const b = Buffer.alloc(400 * 1048576); b.fill(1); await new Promise((r) => setTimeout(r, 20000)); }
  if (mode === 'heap') { const a = []; for (;;) a.push('x'.repeat(64) + a.length); }
  const irqs = mode === 'short-irq' ? s.irqs.slice(1) : s.irqs;
  irqs.forEach((at, i) => o.log('  irq vec=08 timer   at=' + at + ' hb=' + i + ' t=0.000000 from 1:2'));
  const sliceLog = [];
  for (let i = 1; i <= s.n; i++) {
    const d = i * 1000, left = s.left[d] !== undefined ? s.left[d] : -2;
    let line = d + ' ' + left + ' 1aeb:' + (i % 2 ? '36' : '46');
    if (o.sliceLogRegs) line += ' ' + Array(14).fill('ab').join(',') + ',' + ((s.ifAt[d] === 0 ? 0 : 0x200) | 2).toString(16);
    sliceLog.push(line);
  }
  if (mode === 'short-slices') sliceLog.pop();
  if (mode === 'bad-line') sliceLog[3] = 'garbage';
  if (mode === 'huge-slices') for (let i = 0; i < 100000; i++) sliceLog.push((s.n * 1000) + ' -2 1aeb:36');
  // run-dos.js's own statement:
  if (o.sliceLogFile) fs.writeFileSync(o.sliceLogFile, sliceLog.join('\\n') + '\\n');
  return { audioChunks: [Float32Array.of(prog.length, '${tree}'.length)], audioRate: 22050, frame: 'f' + prog, pixels: 7,
    irqs: s.irqs.length, ints: 3, dispatched: s.n * 1000, handbacks: s.n, exitKinds: { date: 1 },
    machine: { audio: { rendered: 1, outAcc: 0, dma: { writes: 0 }, speakerWrites: 0 } } };
};
`;
// wavBytes stand-in: 44-byte header + the chunk values, deterministic.
const AUDIO = `exports.wavBytes = (chunks) => { const b = Buffer.alloc(52); b.write('RIFF', 0); b.writeFloatLE(chunks[0][0], 44); b.writeFloatLE(chunks[0][1], 48); return new Uint8Array(b); };\n`;
const wavSha = (prog, tree) => { const b = Buffer.alloc(52); b.write('RIFF', 0); b.writeFloatLE(prog.length, 44); b.writeFloatLE(tree.length, 48); return crypto.createHash('sha256').update(b).digest('hex'); };

const W = path.join(ROOT, 'W');
for (const p of PROGS) write(path.join(W, 'demos', p), 'MZ');
const TR = path.join(ROOT, 'trees');
for (const t of ['head', 'v2v3']) {
  write(path.join(TR, t, 'tools/toyvm/run-dos.js'), FAKE(t));
  write(path.join(TR, t, 'tools/toyvm/audio.js'), AUDIO);
}
function expect(over = {}) {
  const e = {};
  for (const [k, s] of Object.entries(SCEN)) {
    const [tree, prog] = k.split('/');
    e[k] = { guest: { wav: wavSha(prog, tree).slice(0, 16), frame: 'f' + prog, dispatched: s.n * 1000, irqs: s.irqs.length, ints: 3, pixels: 7 }, handbacks: s.n };
  }
  for (const [k, v] of Object.entries(over)) e[k] = { ...e[k], ...v, guest: { ...e[k].guest, ...(v.guest || {}) } };
  const f = path.join(ROOT, `expect-${Object.keys(over).join('-').replace(/\//g, '_') || 'base'}-${n}.json`);
  fs.writeFileSync(f, JSON.stringify(e));
  return f;
}
function run(name, env = {}, extra = [], { pins = false, exp } = {}) {
  const out = path.join(ROOT, 'out-' + name);
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--drive=${DRIVE}`,
    `--expect=${exp || expect()}`, ...(pins ? [] : ['--no-pins']), ...extra],
  { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 90000 });
  const res = fs.existsSync(path.join(out, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')) : null;
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), res, dir: out };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const noFifo = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.fifo')).length === 0;

check("base 2683a6e3's own afterSlice push statement, at the extremes, matches slice-format.js", () => {
  const { LINE_MAX, LINE_RE } = require('./slice-format');
  const git = (p) => spawnSync('git', ['-C', '/home/user/wine-assembly', 'show', `2683a6e31d0e95e7ffd1805fcafe013f94f1bcec:${p}`], { encoding: 'utf8' }).stdout;
  const src = git('tools/toyvm/run-dos.js');
  const at = src.indexOf('sliceLog.push(');
  assert.ok(at > 0 && src.indexOf('sliceLog.push(', at + 1) < 0, 'exactly one push site');
  const stmt = src.slice(at, src.indexOf('));', at) + 3);
  const isaSrc = git('tools/toyvm/isa.js');
  const isa = { REG16: eval(isaSrc.match(/const REG16 = (\[[^\]]*\])/)[1]), SEG: eval(isaSrc.match(/const SEG = (\[[^\]]*\])/)[1]) };
  assert.strictEqual(isa.REG16.length + isa.SEG.length, 14);
  const line = new Function('dispatched', 'left', 'cs', 'ip', 'sliceLogRegs', 'isa', 'vm', `const sliceLog = []; ${stmt}; return sliceLog[0];`);
  const vmOf = (reg, fl) => ({ get: (k) => (k === 'flags' ? fl : reg) });
  const cases = [[999999999, -2147483648, 0xffff, 0xffffffff, -0x80000000, 0xffffffff], [80000001, 2147483647, 0, 0, 0xffffffff, 0],
    [1000, -2, 0x1aeb, 0x46, 0xab, 0x202]];
  for (const [d, l, cs, ip, reg, fl] of cases) {
    for (const regs of [false, true]) {
      const s = line(d, l, cs, ip, regs, isa, vmOf(reg, fl));
      const k = regs ? 'regs' : 'plain';
      assert.ok(LINE_RE[k].test(s), `${k} format rejects ${s}`);
      assert.ok(s.length + 1 <= LINE_MAX[k], `${k} line ${s.length + 1} > ${LINE_MAX[k]}`);
    }
  }
});
check('real driver -> FIFO -> capped file: complete accounting, P3 gates, classification', () => {
  const r = run('pass');
  assert.strictEqual(r.code, 0, r.out); assert.strictEqual(r.res.status, 'PASS');
  const acc = r.res.runs.CAVEIRA.head.slices;
  assert.strictEqual(acc.lines, 10); assert.strictEqual(acc.complete, true); assert.strictEqual(acc.last, 10000);
  assert.strictEqual(r.res.runs.BLIQ.v2v3.slices.complete, true);
  assert.ok(r.res.runs.BLIQ.head.row.mem.maxRssKiB > 0, 'measured peak RSS recorded');
  const b = r.res.classification.BLIQ, c = r.res.classification.CAVEIRA;
  assert.deepStrictEqual(b.firstClass, { ondate: 1, budget: 0, early: 0, unmatched: 0 });
  assert.deepStrictEqual(b.detail[0].v2v3Window, { handbacks: 2, stops: 2, stopsIF1: 1, firstStop: { dispatched: 5000, left: -2, ip: '1aeb:36', IF: 0 } });
  assert.deepStrictEqual(c.firstClass, { ondate: 0, budget: 1, early: 0, unmatched: 0 });
  assert.ok(noFifo(r.dir), 'FIFOs removed');
});
check('volume: 400,000 records (~5 MB) arrive whole through the FIFO', () => {
  const N = 400000;
  const exp = expect({ 'v2v3/CAVEIRA': { handbacks: N, guest: { dispatched: N * 1000 } } });
  const r = run('big', { FX_TREE: 'v2v3', FX_PROG: 'CAVEIRA', FX_MODE: 'big', FX_N: String(N) }, [], { exp });
  // The fake's irq instants are fixed, so classification is not the point here; accounting is.
  assert.strictEqual(r.res.runs.CAVEIRA.v2v3.slices.lines, N, r.out);
  assert.strictEqual(r.res.runs.CAVEIRA.v2v3.slices.complete, true);
});
check('a record with one line missing is SLICE-INCOMPLETE (exit 7)', () => {
  const r = run('short', { FX_TREE: 'head', FX_PROG: 'CAVEIRA', FX_MODE: 'short-slices' });
  assert.strictEqual(r.code, 7, r.out); assert.match(r.res.failures.join(), /head\/CAVEIRA: slice record incomplete: 9\/10 lines/);
});
check('a malformed record line is SLICE-INCOMPLETE (exit 7)', () => {
  const r = run('bad', { FX_TREE: 'v2v3', FX_PROG: 'BLIQ', FX_MODE: 'bad-line' });
  assert.strictEqual(r.code, 7, r.out); assert.match(r.res.failures.join(), /1 malformed \(line 4: garbage\)/);
});
check('a record past its bound is cut live at the cap, the run killed (exit 6)', () => {
  const r = run('huge', { FX_TREE: 'head', FX_PROG: 'CAVEIRA', FX_MODE: 'huge-slices' });
  assert.strictEqual(r.code, 6, r.out); assert.match(r.res.failures.join(), /head\/CAVEIRA: slice record reached its cap \(480 bytes\)/);
  assert.ok(fs.statSync(path.join(r.dir, 'head-CAVEIRA.slices')).size <= 480);
  assert.ok(noFifo(r.dir));
});
check('RSS past --rss-cap-mb kills the run (exit 8)', () => {
  const t0 = Date.now();
  const r = run('rss', { FX_TREE: 'head', FX_PROG: 'BLIQ', FX_MODE: 'rss' }, ['--rss-cap-mb=200']);
  assert.strictEqual(r.code, 8, r.out); assert.strictEqual(r.res.status, 'MEMORY');
  assert.ok(Date.now() - t0 < 15000, 'not killed promptly');
  assert.ok(r.res.runs.BLIQ.head.polledPeakRss > 200 * 1048576);
});
check('the V8 heap flag bounds the in-memory record: OOM fails the run, nothing on disk (exit 2)', () => {
  const r = run('heap', { FX_TREE: 'head', FX_PROG: 'BLIQ', FX_MODE: 'heap' }, ['--heap-mb=32']);
  assert.strictEqual(r.code, 2, r.out); assert.match(r.res.failures.join(), /head\/BLIQ: driver exit/);
  assert.strictEqual(r.res.runs.BLIQ.head.sliceBytes, 0);
});
check('an irq trace with a missing line is INCOMPLETE (exit 7)', () => {
  const r = run('irq', { FX_TREE: 'v2v3', FX_PROG: 'CAVEIRA', FX_MODE: 'short-irq' });
  assert.strictEqual(r.code, 7, r.out); assert.match(r.res.failures.join(), /v2v3\/CAVEIRA: irq trace 2\/3 lines/);
});
check('a handback count that differs from the pin is VOID (exit 3)', () => {
  const r = run('void', {}, [], { exp: expect({ 'head/BLIQ': { handbacks: 13 } }) });
  assert.strictEqual(r.code, 3, r.out); assert.match(r.res.failures.join(), /head\/BLIQ not reproduced: handbacks 12 != 13/);
});
check('one total bound: a hung run hits the deadline and its grandchild dies (exit 5)', () => {
  const pidFile = path.join(ROOT, 'hang.pid');
  const r = run('deadline', { FX_TREE: 'head', FX_PROG: 'CAVEIRA', FX_MODE: 'hang', FX_PIDFILE: pidFile }, ['--total=3']);
  assert.strictEqual(r.code, 5, r.out);
  const gp = Number(fs.readFileSync(pidFile, 'utf8'));
  const tw = Date.now(); while (alive(gp) && Date.now() - tw < 3000) spawnSync('sleep', ['0.1']);
  assert.ok(!alive(gp), `grandchild ${gp} survived`);
  assert.ok(noFifo(r.dir));
});
check('preflight: a worst case over --out-cap-mb refuses before anything runs (exit 6)', () => {
  const r = run('preflight', {}, ['--out-cap-mb=1']);
  assert.strictEqual(r.code, 6, r.out); assert.match(r.res.failures.join(), /preflight: worst case \d+ bytes > output cap/);
  assert.deepStrictEqual(fs.readdirSync(r.dir), ['result.json']);
});
check('preflight: too little free disk refuses (exit 2)', () => {
  const r = run('disk', {}, ['--min-free-mb=100000000']);
  assert.strictEqual(r.code, 2, r.out); assert.match(r.res.failures.join(), /bytes free < output cap/);
});
check('program directories are pinned (exit 2 without --no-pins)', () => {
  const r = run('pins', {}, [], { pins: true });
  assert.strictEqual(r.code, 2, r.out); assert.match(r.res.failures.join(), /BLIQ\.EXE: directory digest [0-9a-f]{64} != pinned 971da3aa/);
});
check('refuses a non-empty --out', () => {
  const out = path.join(ROOT, 'out-used'); write(path.join(out, 'old.json'), '{}');
  const r = spawnSync(process.execPath, [SCRIPT, `--w=${W}`, `--out=${out}`, '--run', `--trees=${TR}`, `--expect=${expect()}`, '--no-pins'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2); assert.match(r.stderr, /not empty/);
});
console.log(`${n - failed}/${n} passed`);
if (!process.env.FX_KEEP) fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
