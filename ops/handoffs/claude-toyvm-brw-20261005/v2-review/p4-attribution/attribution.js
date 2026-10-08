#!/usr/bin/env node
'use strict';
// Attribute stage 2's P4 control-gate failure (2026-10-05 16:05Z, runner
// c89f3d03): 4 of 199 l1 rows moved under --no-irq-schedule, dispatched count
// only. Which patch of the stack moves them, and does anything guest-visible
// move?
//
// Six trees from base 2683a6e3 (head, J alone, the SMC fix alone, v2+v3+J,
// +v4, the full stack) and P4's EXACT corpus-ab invocation on each:
// --arms=l1 --recipe=sweep --budgets=8m --no-irq-schedule over the four
// programs, so every row's dispatched count is P4's "first handback past
// 8,000,000".
//
// Hardened per root's source review (2026-10-05 ~16:15Z):
//  - every tree must produce EXACTLY the four expected identities, each with
//    arm l1, budget 8000000, irqSchedule false, recipe sweep, ok true, not out
//    of time, no stuckAt; a missing, duplicate, extra or wrong row fails (exit 4);
//  - head and stack must equal P4's preserved base/cand rows on every
//    guest-visible field (dispatched, frame, wav, irqs, ints, pixels), or the
//    attribution is void (exit 3);
//  - ONE total wall bound (default 180 s) for all six runs; every child runs in
//    its own process group and is killed with its descendants on the deadline,
//    on failure, or on a signal; a deadline is exit 5 with what was collected;
//  - --out must be new or empty: nothing earlier is ever overwritten or erased;
//    result.json is written on success AND on every failure.
//
//   node attribution.js --w=<stage-1 work dir with demos/> --out=<new dir> --dry-run|--run
//   test hooks: --trees=DIR (use prepared trees, skip the build), --ab=PATH
//   (corpus-ab), --p4=DIR (preserved nosched-{base,cand}.ndjson), --total=S

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const flag = (k) => argv.includes(`--${k}`);
const R = '/home/user/wine-assembly';
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const J = path.join(R, 'scratch/claude-toyvm-jmpsyn-j-20261005');
const AB = arg('ab', path.join(REV, 'corpus-ab.js'));
const P4DIR = arg('p4', path.join(REV, 'full-stage2-attempt2-20261005/out'));
const TOTAL_S = Number(arg('total', 180));
const GRACE_MS = 3000;
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const P = {
  j: [path.join(J, 'jmp-syn-j.patch'), '7f8a7275d3b8a234e2fc8f1f23930e74426cddc30316fbfaecbb11ab65412239'],
  smc: [path.join(J, 'smc-pure-forward-fix.patch'), 'b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612'],
  v2v3j: [path.join(J, 'v2-v3-j-combined.patch'), '54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82'],
  v4: [path.join(J, 'v4-delta-on-combined.patch'), '4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b'],
};
const TREES = {
  head: [], j: ['j'], smc: ['smc'], v2v3j: ['v2v3j'], v2v3j_v4: ['v2v3j', 'v4'], stack: ['v2v3j', 'v4', 'smc'],
};
const PROGRAMS = ['1995-a-acidrain/ACIDRAIN.EXE', '1995-a-acolors/COLORS.EXE',
  '1995-b-boxtro/NEWSBOX3.EXE', '1995-b-brian/BRIAN.EXE'];
const GUEST = ['dispatched', 'frame', 'wav', 'irqs', 'ints', 'pixels'];

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const W = arg('w'), OUT = arg('out');
if (!W || !OUT || (!flag('dry-run') && !flag('run'))) {
  console.error('usage: node attribution.js --w=<work dir with demos/> --out=<new dir> --dry-run|--run [--total=S]');
  process.exit(2);
}
// Fresh output only.
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) {
  console.error(`refusing: --out ${OUT} exists and is not empty (earlier evidence is never overwritten)`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const result = { status: 'running', startedAt: new Date(t0).toISOString(), totalS: TOTAL_S, trees: {}, failures: [] };
const writeResult = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1) + '\n');
function finish(status, code, msg) {
  result.status = status;
  if (msg) result.failures.push(msg);
  result.elapsedS = (Date.now() - t0) / 1000;
  killAll();
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
// One child with the remaining share of the total bound. Resolves its exit code
// (124 deadline, 127 could not start); its descendants never outlive it.
function runChild(cmd, args, log) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'w');
    let ch, done = false, timedOut = false, t = null, hard = null;
    const end = (code) => {
      if (done) return; done = true;
      if (t) clearTimeout(t); if (hard) clearTimeout(hard);
      if (ch) { live.delete(ch); if (ch.pid) killGroup(ch, 'SIGKILL'); }
      fs.closeSync(fd);
      resolve(timedOut ? 124 : code);
    };
    const left = remainingMs();
    if (left <= 0) { timedOut = true; return end(124); }
    try { ch = spawn(cmd, args, { detached: true, stdio: ['ignore', fd, fd] }); } catch (e) { fs.writeSync(fd, `spawn failed: ${e.message}\n`); return end(127); }
    live.add(ch);
    ch.on('error', (e) => { fs.writeSync(fd, `spawn failed: ${e.message}\n`); end(127); });
    t = setTimeout(() => { timedOut = true; killGroup(ch, 'SIGTERM'); hard = setTimeout(() => killGroup(ch, 'SIGKILL'), GRACE_MS); }, left);
    ch.on('close', (code) => end(code === null ? 1 : code));
  });
}

// --- trees ---------------------------------------------------------------------
const treesDir = arg('trees', path.join(OUT, 'trees'));
if (!arg('trees')) {
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
      if (sha(file) !== want) finish('FAIL', 2, `${name}: ${k} patch hash`);
      const r = spawnSync('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', t], { input: fs.readFileSync(file) });
      if (r.status !== 0) finish('FAIL', 2, `${name}: patch ${k} failed`);
    }
  }
}
for (const name of Object.keys(TREES)) {
  const t = path.join(treesDir, name);
  if (!fs.existsSync(t)) finish('FAIL', 2, `tree ${name} missing at ${t}`);
  result.trees[name] = { patches: TREES[name], files: {} };
  for (const f of ['dos-loop', 'run-dos', 'emit', 'compile']) {
    const file = path.join(t, 'tools/toyvm', f + '.js');
    result.trees[name].files[f] = fs.existsSync(file) ? sha(file).slice(0, 16) : null;
  }
}
const progs = PROGRAMS.map((p) => path.resolve(path.join(W, 'demos', p)));
for (const p of progs) if (!fs.existsSync(p)) finish('FAIL', 2, `missing program ${p}`);
const list = path.join(OUT, 'programs4.txt');
fs.writeFileSync(list, progs.join('\n') + '\n');
const cmd = (name) => [AB, `--tree=${path.join(treesDir, name)}`, `--list=${list}`, '--arms=l1', '--recipe=sweep',
  '--budgets=8m', '--no-irq-schedule', '--jobs=1', '--timeout=180', `--out=${path.join(OUT, `${name}.ndjson`)}`];
result.commands = Object.fromEntries(Object.keys(TREES).map((n) => [n, `node ${cmd(n).join(' ')}`]));
if (flag('dry-run')) finish('DRY-RUN', 0, null);

// --- validation helpers ----------------------------------------------------------
function readRows(file, label) {
  const rows = [];
  let n = 0;
  for (const l of (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n')) {
    if (!l.trim()) continue;
    n++;
    try { rows.push(JSON.parse(l)); } catch { finish('FAIL', 4, `${label}: malformed line ${n}`); }
  }
  return rows;
}
// Exactly the four identities, each healthy and with P4's exact parameters.
function exactRows(rows, label) {
  const want = new Map(progs.map((p) => [p, null]));
  for (const r of rows) {
    const id = typeof r.exe === 'string' ? path.resolve(r.exe) : null;
    if (!id || !want.has(id)) finish('FAIL', 4, `${label}: out-of-domain row ${r.exe}`);
    if (want.get(id)) finish('FAIL', 4, `${label}: duplicate row ${path.basename(id)}`);
    if (r.arm !== 'l1') finish('FAIL', 4, `${label}: ${path.basename(id)} arm ${r.arm}, want l1`);
    if (Number(r.budget) !== 8e6) finish('FAIL', 4, `${label}: ${path.basename(id)} budget ${r.budget}, want 8000000`);
    if (r.irqSchedule !== false) finish('FAIL', 4, `${label}: ${path.basename(id)} irqSchedule ${r.irqSchedule}, want false`);
    if (r.recipe !== 'sweep') finish('FAIL', 4, `${label}: ${path.basename(id)} recipe ${r.recipe}, want sweep`);
    if (r.ok !== true || r.ranOutOfTime || r.stuckAt) finish('FAIL', 4, `${label}: ${path.basename(id)} unhealthy (ok ${r.ok}, ranOutOfTime ${r.ranOutOfTime}, stuckAt ${r.stuckAt})`);
    for (const g of GUEST) if (!(g in r)) finish('FAIL', 4, `${label}: ${path.basename(id)} has no ${g}`);
    want.set(id, r);
  }
  const missing = [...want].filter(([, v]) => !v).map(([k]) => path.basename(k));
  if (missing.length) finish('FAIL', 4, `${label}: missing rows ${missing.join(', ')}`);
  return Object.fromEntries([...want].map(([k, v]) => [path.basename(k), v]));
}

(async () => {
  // --- run: one total bound for all six ----------------------------------------
  for (const name of Object.keys(TREES)) {
    const rc = await runChild(process.execPath, cmd(name), path.join(OUT, `${name}.log`));
    result.trees[name].exit = rc;
    writeResult();
    if (rc === 124) finish('DEADLINE', 5, `total bound ${TOTAL_S}s reached during ${name}`);
    if (rc !== 0) finish('FAIL', 2, `${name}: corpus-ab exit ${rc}`);
  }
  const byTree = {};
  for (const name of Object.keys(TREES)) byTree[name] = exactRows(readRows(path.join(OUT, `${name}.ndjson`), name), name);
  // --- reproduce P4 on every guest-visible field -----------------------------------
  const p4base = exactRows(readRows(path.join(P4DIR, 'nosched-base.ndjson'), 'P4 base').filter((r) => progs.some((p) => path.basename(p) === path.basename(r.exe)))
    .map((r) => ({ ...r, exe: progs.find((p) => path.basename(p) === path.basename(r.exe)) })), 'P4 base');
  const p4cand = exactRows(readRows(path.join(P4DIR, 'nosched-cand.ndjson'), 'P4 cand').filter((r) => progs.some((p) => path.basename(p) === path.basename(r.exe)))
    .map((r) => ({ ...r, exe: progs.find((p) => path.basename(p) === path.basename(r.exe)) })), 'P4 cand');
  const repro = [];
  for (const prog of Object.keys(byTree.head)) {
    for (const g of GUEST) {
      if (byTree.head[prog][g] !== p4base[prog][g]) repro.push(`head ${prog} ${g} ${byTree.head[prog][g]} != P4 base ${p4base[prog][g]}`);
      if (byTree.stack[prog][g] !== p4cand[prog][g]) repro.push(`stack ${prog} ${g} ${byTree.stack[prog][g]} != P4 cand ${p4cand[prog][g]}`);
    }
  }
  // --- table -----------------------------------------------------------------------
  const out = ['| program | tree | dispatched | vs head | frame | wav | irqs | ints | pixels |', '|---|---|---|---|---|---|---|---|---|'];
  for (const prog of Object.keys(byTree.head)) {
    const h = byTree.head[prog];
    for (const name of Object.keys(TREES)) {
      const v = byTree[name][prog];
      const s = (k) => (v[k] === h[k] ? '=' : 'DIFF');
      out.push(`| ${prog} | ${name} | ${v.dispatched} | ${v.dispatched - h.dispatched >= 0 ? '+' : ''}${v.dispatched - h.dispatched} | ${s('frame')} | ${s('wav')} | ${s('irqs')} | ${s('ints')} | ${s('pixels')} |`);
    }
  }
  result.rows = byTree;
  fs.writeFileSync(path.join(OUT, 'table.md'), out.join('\n') + '\n');
  console.log(out.join('\n'));
  if (repro.length) finish('VOID', 3, `P4 not reproduced: ${repro.slice(0, 3).join('; ')}`);
  finish('PASS', 0, null);
})().catch((e) => finish('FAIL', 1, String(e && e.stack || e)));
