#!/usr/bin/env node
'use strict';
// Fixed-work A/B of two pinned toyvm TREES (the IF-enable candidate and the
// stack it is applied to), alternating per rep with the starting tree rotated
// -- tools/toyvm/bench-dos.js's discipline (bench-dos.js:163-167), but across
// two trees, which bench-dos (one tree, one process) cannot do.
//
// Each measurement is a separate `node bench-one.js` child in its own process
// group (the same runDos call bench-dos makes), killed with its descendants at
// min(--per-run, what is left of --total); none starts once the total is
// spent. Trees are built by build-tree.js (cand: sha-pinned candidate) and
// removed on every exit.
//
// THE GATE, before any number: per program, every rep of every tree must give
// the same (dispatched, frame) -- each tree deterministic across reps (as
// bench-dos requires), AND the two trees identical to each other. Otherwise
// the program is NOT COMPARABLE and no ratio is printed for it: a different
// computation is not a cost difference. (The candidate legitimately changes
// where a pending IF-blocked timer IRQ lands; a program where that happens
// measures the behaviour change, not CONT, and is excluded by this gate.)
// A timed-out or failed run makes the program INCOMPLETE; a program never
// reached is SKIPPED. Reported per comparable program: min and median
// ns/dispatch per tree, and the paired ratio (median over reps of
// cand/stack ns-per-dispatch within the same rep; > 1 = candidate slower --
// bench-dos.js:229-236's paired rule, oriented candidate-over-baseline).
//
//   node bench-trees.js --out=<new dir> --progs=a.com,b.exe [--reps=5] [--dispatches=20m]
//     [--cpu-time] [--total=300] [--per-run=60]
//     --candidate=<diff> --candidate-sha=<64 hex>
//   test hook: --prepared-trees=<dir> (contains cand/ and stack/; COPIED into
//   --out and the copies removed, so cleanup is exercised), --one=<bench-one.js>

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const OUT = arg('out'), PROGS = (arg('progs') || '').split(',').filter(Boolean);
const REPS = Number(arg('reps', 5)), DISP = arg('dispatches', '20m'), CPU = argv.includes('--cpu-time');
const TOTAL_MS = Number(arg('total', 300)) * 1000, PER_MS = Number(arg('per-run', 60)) * 1000, t0 = Date.now();
const CAND = arg('candidate'), CAND_SHA = arg('candidate-sha'), PREP = arg('prepared-trees');
const HERE = __dirname, ONE = arg('one', path.join(HERE, 'bench-one.js'));
const TREES = ['cand', 'stack'];
if (!OUT || !PROGS.length || !(REPS >= 1) || (!PREP && (!CAND || !/^[0-9a-f]{64}$/.test(CAND_SHA || '')))) {
  console.error('usage: node bench-trees.js --out=<new dir> --progs=a,b [--reps=5] [--dispatches=20m] [--cpu-time] [--total=300] [--per-run=60] --candidate=<diff> --candidate-sha=<64 hex>');
  process.exit(2);
}
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.error(`refusing: ${OUT} not empty`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const result = { startedAt: new Date(t0).toISOString(), wrapperPid: process.pid, totalS: TOTAL_MS / 1000, perRunS: PER_MS / 1000,
  reps: REPS, dispatches: DISP, cpuTime: CPU, trees: {}, runs: [], programs: {} };
const write = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1) + '\n');
const live = new Set(), owned = [];
const killAll = () => { for (const ch of live) { try { process.kill(-ch.pid, 'SIGKILL'); } catch {} } };
function finish(code) {
  killAll();
  for (const t of owned) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} }
  result.treesRemoved = owned.map((t) => !fs.existsSync(t));
  result.elapsedS = (Date.now() - t0) / 1000;
  write();
  process.exit(code);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { result.signal = s; finish(130); });
const left = () => TOTAL_MS - (Date.now() - t0);

// One child; resolves { status: PASS|FAIL|TIMEOUT|SKIPPED, exit, stdout }.
function run(name, args, capMs) {
  return new Promise((resolve) => {
    const cap = Math.min(capMs, left());
    const rec = { name, args, startedS: (Date.now() - t0) / 1000 };
    if (cap <= 1000) { rec.status = 'SKIPPED'; return resolve(rec); }
    const log = path.join(OUT, `${name}.txt`), fd = fs.openSync(log, 'w');
    let stdout = '';
    const ch = spawn(process.execPath, args, { detached: true, stdio: ['ignore', 'pipe', fd] });
    rec.pid = ch.pid; live.add(ch);
    ch.stdout.on('data', (b) => { stdout += b; fs.writeSync(fd, b); });
    let killed = false;
    const t = setTimeout(() => { killed = true; try { process.kill(-ch.pid, 'SIGKILL'); } catch {} }, cap);
    ch.on('close', (code, sig) => {
      clearTimeout(t); live.delete(ch); fs.closeSync(fd);
      rec.exit = code; rec.signal = sig; rec.elapsedS = (Date.now() - t0) / 1000 - rec.startedS;
      rec.status = killed ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
      rec.stdout = stdout;
      resolve(rec);
    });
  });
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };

(async () => {
  // Trees.
  for (const tree of TREES) {
    const dir = path.join(OUT, `tree-${tree}`); owned.push(dir);
    if (PREP) { fs.cpSync(path.join(PREP, tree), dir, { recursive: true }); result.trees[tree] = { prepared: true }; continue; }
    const b = await run(`build-${tree}`, [path.join(HERE, 'build-tree.js'), `--out=${dir}`, `--tree=${tree}`,
      ...(tree === 'cand' ? [`--candidate=${CAND}`, `--candidate-sha=${CAND_SHA}`] : [])], 60000);
    result.trees[tree] = { build: { status: b.status, exit: b.exit, pins: b.status === 'PASS' ? JSON.parse(b.stdout.trim().split('\n').pop()) : null } };
    if (b.status !== 'PASS') { result.error = `build ${tree} ${b.status}`; finish(2); }
  }
  write();
  // Measurements: program-major, rep-major, tree order rotated per rep.
  for (const prog of PROGS) {
    const p = result.programs[prog] = { samples: { cand: [], stack: [] }, sigs: { cand: [], stack: [] }, order: [], status: 'running' };
    for (let rep = 0; rep < REPS && p.status === 'running'; rep++) {
      const order = TREES.map((_, i) => TREES[(i + rep) % TREES.length]);
      p.order.push(order.join(','));
      for (const tree of order) {
        const r = await run(`${path.basename(prog)}-r${rep}-${tree}`, [ONE, `--tree=${path.join(OUT, `tree-${tree}`)}`,
          `--exe=${path.resolve(prog)}`, `--dispatches=${DISP}`, ...(CPU ? ['--cpu-time'] : [])], PER_MS);
        result.runs.push({ prog, rep, tree, pid: r.pid, status: r.status, exit: r.exit, elapsedS: r.elapsedS });
        write();
        if (r.status === 'SKIPPED') { p.status = 'SKIPPED'; break; }
        if (r.status !== 'PASS') { p.status = `INCOMPLETE (${tree} rep ${rep} ${r.status})`; break; }
        let j;
        try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { p.status = `INCOMPLETE (${tree} rep ${rep} unparsable output)`; break; }
        p.sigs[tree].push(`${j.dispatched}/${j.frame}`);
        p.samples[tree].push(j.nsPerDispatch);
      }
    }
    if (p.status !== 'running') { write(); continue; }
    const all = [...p.sigs.cand, ...p.sigs.stack];
    const det = (t) => new Set(p.sigs[t]).size === 1;
    if (!det('cand') || !det('stack')) p.status = `NOT COMPARABLE (${!det('cand') ? 'cand' : 'stack'} not deterministic across reps)`;
    else if (new Set(all).size !== 1) p.status = `NOT COMPARABLE (trees differ: cand ${p.sigs.cand[0]} vs stack ${p.sigs.stack[0]})`;
    else {
      p.status = 'COMPARABLE';
      p.sig = all[0];
      p.nsMin = { cand: Math.min(...p.samples.cand), stack: Math.min(...p.samples.stack) };
      p.nsMed = { cand: median(p.samples.cand), stack: median(p.samples.stack) };
      // >1 means the candidate is slower (stack/cand ns per dispatch < 1 means cand faster).
      p.pairedCandOverStack = median(p.samples.cand.map((c, i) => c / p.samples.stack[i]));
      p.minCandOverStack = p.nsMin.cand / p.nsMin.stack;
    }
    write();
  }
  finish(0);
})().catch((e) => { result.error = String(e && e.stack || e); finish(1); });
