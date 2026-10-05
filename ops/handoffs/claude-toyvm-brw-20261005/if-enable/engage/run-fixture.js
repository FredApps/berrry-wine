#!/usr/bin/env node
'use strict';
// Operational wrapper for root's grant (2026-10-05 ~18:11Z): the failing-IRQ
// fixture (test e4aeed77, build-tree 6bc77d15, both from 8db463eb) on the
// stack tree, then head, under ONE total bound (default 300 s). Each test gets
// TOYVM_TEST_TOTAL_S = min(140, what is left). Every child runs in its own
// process group and is killed with its descendants on the bound or a signal.
// Outputs go to a fresh --out; the trees this builds are removed on every exit.
// Each test result is classified:
//   ARCH-FAIL     the test ran and its assertions failed (lines "FAIL <case>: ...")
//   PASS          exit 0
//   HARNESS-FAIL  anything else: a build failure, an uncaught exception (e.g. a
//                 run-dos crash surfacing from execFileSync), the test's own
//                 total-bound stop (exit 5), a kill
//   node run-fixture.js --out=<new dir> [--total=300] [--plan=stack,head|cand]
//     [--candidate=<diff> --candidate-sha=<64 hex>]   test hook: --node=<exe>
// HARDENED 2026-10-05 (root review), as run-toyvm-tests.js: --total finite > 0
// and a non-empty --plan before --out exists; spawn errors recorded
// (HARNESS-FAIL, spawnError); each child's whole process group reaped when the
// child closes (leftoverGroup), so an early-exiting child cannot leave a live
// grandchild behind; each step settles once. The ENGAGEMENT tally the fixture
// prints is observation only: classification is still the test's exit code.
// For a CANDIDATE tree, HARNESS-FAIL includes the candidate failing to compile
// (its WAT assembled for the first time inside run-dos): read the test log.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const OUT = arg('out'), TOTAL_MS = Number(arg('total', 300)) * 1000, t0 = Date.now();
// --plan: which trees, in order (default stack,head as before). `cand` is the
// stack plus a hash-pinned candidate diff (--candidate, --candidate-sha), built
// by build-tree.js, which refuses a diff whose sha256 differs.
const PLAN = arg('plan', 'stack,head').split(',').filter(Boolean);
const CAND = arg('candidate'), CAND_SHA = arg('candidate-sha');
// Test hook: the executable the children run under (default this Node); a
// path that does not exist exercises the SPAWN-ERROR path.
const NODE = arg('node', process.execPath);
// --total must be finite seconds > 0 and --plan non-empty -- checked before
// --out is created or any child starts.
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0 || !PLAN.length) {
  console.error(`refusing: --total must be finite seconds > 0 and --plan non-empty (got total=${arg('total', 300)} plan=${arg('plan', 'stack,head')})`);
  process.exit(2);
}
if (!OUT || PLAN.some((t) => !['stack', 'head', 'cand'].includes(t))
  || (PLAN.includes('cand') && (!CAND || !/^[0-9a-f]{64}$/.test(CAND_SHA || '')))) {
  console.error('usage: node run-fixture.js --out=<new dir> [--total=300] [--plan=stack,head|cand] [--candidate=<diff> --candidate-sha=<64 hex>]');
  process.exit(2);
}
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.error(`refusing: ${OUT} not empty`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const HERE = __dirname;
const result = { startedAt: new Date(t0).toISOString(), wrapperPid: process.pid, totalS: TOTAL_MS / 1000, steps: [] };
const write = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1) + '\n');
const live = new Set();
const killAll = () => { for (const ch of live) { try { process.kill(-ch.pid, 'SIGKILL'); } catch {} } };
const trees = [];
function finish(code) {
  killAll();
  for (const t of trees) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} }
  result.treesRemoved = trees.map((t) => !fs.existsSync(t));
  result.elapsedS = (Date.now() - t0) / 1000;
  write();
  process.exit(code);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { result.signal = s; finish(130); });

// One child in its own process group. Settles exactly once. When the direct
// child CLOSES, its whole group is SIGKILLed too, so a grandchild an early-
// exiting child left behind cannot outlive it; `leftoverGroup` records whether
// anything was there (the child's own exit and status are kept as they were).
// A spawn failure is recorded as `spawnError` and classified HARNESS-FAIL.
function step(name, args, env, capMs) {
  return new Promise((resolve) => {
    const left = Math.min(capMs, TOTAL_MS - (Date.now() - t0));
    const log = path.join(OUT, `${name}.txt`), fd = fs.openSync(log, 'w');
    const rec = { name, cmd: `node ${args.join(' ')}`, env, startedS: (Date.now() - t0) / 1000 };
    result.steps.push(rec);
    if (left <= 0) { rec.exit = 124; rec.why = 'total bound spent before start'; fs.closeSync(fd); write(); return resolve(rec); }
    let ch, done = false, killed = false, t = null;
    const settle = () => { if (done) return false; done = true; if (t) clearTimeout(t); if (ch) live.delete(ch); fs.closeSync(fd); return true; };
    const reap = () => { try { process.kill(-ch.pid, 'SIGKILL'); return true; } catch { return false; } };
    const spawnFailed = (e) => { rec.exit = null; rec.spawnError = String(e && e.message || e); rec.elapsedS = (Date.now() - t0) / 1000 - rec.startedS; write(); resolve(rec); };
    try { ch = spawn(NODE, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } }); } catch (e) {
      settle(); return spawnFailed(e);
    }
    ch.on('error', (e) => { if (ch.pid) reap(); if (settle()) spawnFailed(e); });
    if (!ch.pid) return;   // the 'error' event follows
    rec.pid = ch.pid; live.add(ch); write();
    console.log(`${name}: child Node PID ${ch.pid}`);
    t = setTimeout(() => { killed = true; reap(); }, left);
    ch.on('close', (code, sig) => {
      rec.leftoverGroup = reap();
      if (!settle()) return;
      rec.exit = code; rec.signal = sig; rec.killedAtBound = killed; rec.elapsedS = (Date.now() - t0) / 1000 - rec.startedS;
      resolve(rec);
    });
  });
}
function classify(rec) {
  const text = fs.readFileSync(path.join(OUT, `${rec.name}.txt`), 'utf8');
  const fails = text.split('\n').filter((l) => l.startsWith('FAIL ')), oks = text.split('\n').filter((l) => /^(ok|info) /.test(l));
  rec.caseLines = [...oks, ...fails];
  const harness = rec.spawnError || rec.killedAtBound || rec.signal || rec.exit === 5 || /\n\s+at |Error: Command failed|Uncaught|SyntaxError|ENOENT/.test(text);
  rec.class = harness ? 'HARNESS-FAIL' : rec.exit === 0 ? 'PASS' : (rec.exit === 1 && fails.length ? 'ARCH-FAIL' : 'HARNESS-FAIL');
}

(async () => {
  for (const tree of PLAN) {
    const dir = path.join(OUT, `tree-${tree}`); trees.push(dir);
    const b = await step(`build-${tree}`, [path.join(HERE, 'build-tree.js'), `--out=${dir}`, `--tree=${tree}`,
      ...(tree === 'cand' ? [`--candidate=${CAND}`, `--candidate-sha=${CAND_SHA}`] : [])], {}, 60000);
    if (b.exit !== 0) { b.class = 'HARNESS-FAIL'; write(); continue; }
    b.tree = JSON.parse(fs.readFileSync(path.join(OUT, `build-${tree}.txt`), 'utf8').trim().split('\n').pop());
    const leftS = Math.floor((TOTAL_MS - (Date.now() - t0)) / 1000) - 2;
    const s = Math.max(0, Math.min(140, leftS));
    const r = await step(`test-${tree}`, [path.join(HERE, 'test-toyvm-irq-if-enable.js')], { TOYVM_TREE: dir, TOYVM_TEST_TOTAL_S: String(s) }, (s + 5) * 1000);
    classify(r); write();
  }
  finish(0);
})().catch((e) => { result.error = String(e && e.stack || e); finish(1); });
