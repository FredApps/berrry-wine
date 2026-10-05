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
//   node run-fixture.js --out=<new dir> [--total=300]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const OUT = arg('out'), TOTAL_MS = Number(arg('total', 300)) * 1000, t0 = Date.now();
if (!OUT) { console.error('usage: node run-fixture.js --out=<new dir> [--total=300]'); process.exit(2); }
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

function step(name, args, env, capMs) {
  return new Promise((resolve) => {
    const left = Math.min(capMs, TOTAL_MS - (Date.now() - t0));
    const log = path.join(OUT, `${name}.txt`), fd = fs.openSync(log, 'w');
    const rec = { name, cmd: `node ${args.join(' ')}`, env, startedS: (Date.now() - t0) / 1000 };
    result.steps.push(rec);
    if (left <= 0) { rec.exit = 124; rec.why = 'total bound spent before start'; fs.closeSync(fd); write(); return resolve(rec); }
    const ch = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } });
    rec.pid = ch.pid; live.add(ch); write();
    console.log(`${name}: child Node PID ${ch.pid}`);
    let killed = false;
    const t = setTimeout(() => { killed = true; try { process.kill(-ch.pid, 'SIGKILL'); } catch {} }, left);
    ch.on('close', (code, sig) => {
      clearTimeout(t); live.delete(ch); fs.closeSync(fd);
      rec.exit = code; rec.signal = sig; rec.killedAtBound = killed; rec.elapsedS = (Date.now() - t0) / 1000 - rec.startedS;
      resolve(rec);
    });
  });
}
function classify(rec) {
  const text = fs.readFileSync(path.join(OUT, `${rec.name}.txt`), 'utf8');
  const fails = text.split('\n').filter((l) => l.startsWith('FAIL ')), oks = text.split('\n').filter((l) => /^(ok|info) /.test(l));
  rec.caseLines = [...oks, ...fails];
  const harness = rec.killedAtBound || rec.signal || rec.exit === 5 || /\n\s+at |Error: Command failed|Uncaught|SyntaxError|ENOENT/.test(text);
  rec.class = harness ? 'HARNESS-FAIL' : rec.exit === 0 ? 'PASS' : (rec.exit === 1 && fails.length ? 'ARCH-FAIL' : 'HARNESS-FAIL');
}

(async () => {
  for (const tree of ['stack', 'head']) {
    const dir = path.join(OUT, `tree-${tree}`); trees.push(dir);
    const b = await step(`build-${tree}`, [path.join(HERE, 'build-tree.js'), `--out=${dir}`, `--tree=${tree}`], {}, 60000);
    if (b.exit !== 0) { b.class = 'HARNESS-FAIL'; write(); continue; }
    b.tree = JSON.parse(fs.readFileSync(path.join(OUT, `build-${tree}.txt`), 'utf8').trim().split('\n').pop());
    const leftS = Math.floor((TOTAL_MS - (Date.now() - t0)) / 1000) - 2;
    const s = Math.max(0, Math.min(140, leftS));
    const r = await step(`test-${tree}`, [path.join(HERE, 'test-toyvm-irq-if-enable.js')], { TOYVM_TREE: dir, TOYVM_TEST_TOTAL_S: String(s) }, (s + 5) * 1000);
    classify(r); write();
  }
  finish(0);
})().catch((e) => { result.error = String(e && e.stack || e); finish(1); });
