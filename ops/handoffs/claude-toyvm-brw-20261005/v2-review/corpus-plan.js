#!/usr/bin/env node
'use strict';
// Before/after corpus run for the toyvm IRQ-schedule patch (v2, or v2 + v3 delta).
// JavaScript port of corpus-plan.sh (same phases, gates, files and environment
// knobs). NOT RUN yet. See corpus-plan.md for what each phase gates.
//
//   W=/path/to/workdir CAND=v3 JOBS=3 node corpus-plan.js prep
//   ... node corpus-plan.js tests      # P1  (both trees, parallel)
//   ... node corpus-plan.js sweep      # P2  doc gate: sweep-dos + sweep-diff (both trees, parallel)
//   ... node corpus-plan.js arms       # P3  cross-arm corpus, witness recipe, 80M
//   ... node corpus-plan.js control    # P4  --no-irq-schedule must be byte-identical
//   ... node corpus-plan.js brw        # P5  BRW 500M L1 vs jit-sepc, both trees
//   ... node corpus-plan.js nudge      # P6  rubric for moved l1 frames
//   ... node corpus-plan.js all        # P0..P6 in slot order
//
// Every child is a separate node/git/tar process with its own wall-clock
// timeout; stdout+stderr go to $W/logs exactly as the shell version wrote them.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const env = process.env;
const R = env.R || '/home/user/wine-assembly';
const W = env.W;
const CAND = env.CAND || 'v3';            // v2 | v3
const JOBS = Number(env.JOBS || 3);
const SLOT_S = Number(env.SLOT_S || 7200); // requested slot, seconds
const SWEEP_S = Number(env.SWEEP_S || 3000);
const BASE = '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const V2 = path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch');
const V3 = path.join(REV, 'v3-delta-on-v2.patch');
const AB = path.join(REV, 'corpus-ab.js');
const BISECT = path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/brw-bisect.js');
const CLOSURE = ['tools/toyvm', 'tools/fnt-read.js', 'tools/ne-dump.js', 'tools/disasm.js',
  'tools/simd-ops.js', 'lib/compile-wat.js', 'lib/wat-manifest.js', 'fonts/Terminal.fon'];
const V2_SHA = '4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78';
const CORPUS_SHA = '3f9b202376eec52a72f9c1c0eb9f0dfd993292c344d62b95a820a9e5606fc475';
const T0 = Date.now();
const TREES = ['base', 'cand'];

const p = (...x) => path.join(W, ...x);
const now = () => new Date().toISOString().slice(11, 19);
function say(tag, msg) {
  const line = `${now()} [${tag}] ${msg}`;
  console.log(line);
  fs.appendFileSync(p('out', 'journal.txt'), line + '\n');
}
function abort(msg, code = 2) { say('ABORT', msg); process.exit(code); }
const left = () => SLOT_S - Math.floor((Date.now() - T0) / 1000);
function diskok() {
  const s = fs.statfsSync(W);
  const kb = Math.floor((s.bavail * s.bsize) / 1024);
  if (kb <= 307200) abort(`free disk ${kb}KB < 300MB`);
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// One child process. Resolves to its exit code (124 on timeout, like timeout(1)).
// `log` receives stdout+stderr; `tee` also echoes stdout to ours.
function run(cmd, args, { cwd, log, timeoutS = 0, signal = 'SIGKILL', input = null, tee = false } = {}) {
  return new Promise((resolve) => {
    const fd = log ? fs.openSync(log, 'w') : 'ignore';
    const ch = spawn(cmd, args, { cwd, stdio: [input === null ? 'ignore' : 'pipe', tee ? 'pipe' : fd, fd] });
    if (tee) ch.stdout.on('data', (d) => { process.stdout.write(d); if (log) fs.writeSync(fd, d); });
    if (input !== null) ch.stdin.end(input);
    let timedOut = false;
    const t = timeoutS ? setTimeout(() => { timedOut = true; ch.kill(signal); }, timeoutS * 1000) : null;
    ch.on('close', (code) => {
      if (t) clearTimeout(t);
      if (log) fs.closeSync(fd);
      resolve(timedOut ? 124 : (code === null ? 1 : code));
    });
  });
}
const node = (args, opts) => run(process.execPath, args, opts);

async function prep() {
  for (const d of ['base', 'cand', 'out', 'logs']) fs.mkdirSync(p(d), { recursive: true });
  diskok();
  if (sha256(V2) !== V2_SHA) abort('v2 patch hash');
  const tests = execFileSync('git', ['-C', R, 'ls-tree', '--name-only', BASE, 'test/'], { encoding: 'utf8' })
    .split('\n').filter((l) => l.startsWith('test/test-toyvm-'));
  for (const t of TREES) {
    const tarball = execFileSync('git', ['-C', R, 'archive', BASE, ...CLOSURE, ...tests],
      { maxBuffer: 1 << 30 });
    if (await run('tar', ['-x', '-C', p(t)], { input: tarball })) abort(`${t} tar extract`);
    try { fs.unlinkSync(p(t, 'node_modules')); } catch {}
    fs.symlinkSync(path.join(R, 'node_modules'), p(t, 'node_modules'));
    fs.mkdirSync(p(t, 'scratch/o/toyvm-brw'), { recursive: true });
    fs.copyFileSync(BISECT, p(t, 'scratch/o/toyvm-brw/brw-bisect.js'));
  }
  if (await run('patch', ['-p1', '-d', p('cand')], { input: fs.readFileSync(V2) })) abort('v2 patch apply');
  if (CAND === 'v3' && await run('patch', ['-p1', '-d', p('cand')], { input: fs.readFileSync(V3) })) abort('v3 patch apply');
  for (const t of TREES) {
    await node([path.join('tools/toyvm/bundle-browser.js')], { cwd: p(t), log: p('logs', `${t}-bundle.log`) });
  }
  // expected: base dos-loop ebe0eb30..., cand dos-loop bd4f1ee9... (v2) / eeb9e2cd... (v3); cand run-dos 82ae85cd... (v3)
  const hashes = [];
  for (const t of TREES) for (const f of ['dos-loop', 'run-dos']) {
    const file = p(t, 'tools/toyvm', `${f}.js`);
    hashes.push(`${sha256(file)}  ${file}`);
  }
  fs.writeFileSync(p('out', 'tree-hashes.txt'), hashes.join('\n') + '\n');
  console.log(hashes.join('\n'));
  await node([path.join(REV, 'unpack-corpus.js'), `--out=${p('demos')}`, `--list=${p('programs.txt')}`],
    { log: p('out', 'corpus.txt'), tee: true });
  if (!read(p('out', 'corpus.txt')).includes(CORPUS_SHA)) abort('corpus hash');
  for (const t of TREES) {
    const rc = await node([p(t, 'tools/toyvm/run-dos.js'), p('demos/1995-c-cma_brw/BRW.EXE'), '--dispatches=10m'],
      { log: p('logs', `${t}-smoke.log`), timeoutS: 120 });
    if (rc) abort(`${t} smoke run failed`);
  }
  say('P0', `prep ok (${CAND})`);
}

async function tests() {
  await Promise.all(TREES.map(async (t) => {
    const files = fs.readdirSync(p(t, 'test')).filter((f) => /^test-toyvm-.*\.js$/.test(f)).sort();
    for (const f of files) {
      const n = path.basename(f, '.js');
      const rc = await node([p(t, 'test', f)], { cwd: p(t), log: p('logs', `${t}-${n}.log`), timeoutS: 600 });
      fs.appendFileSync(p('out', 'tests.txt'), `${t} ${n} ${rc}\n`);
    }
  }));
  // Gate: a suite that passes on base and fails on cand ABORTS the slot.
  const s = new Map();
  for (const l of read(p('out', 'tests.txt')).split('\n').filter(Boolean)) {
    const [t, n, rc] = l.split(' ');
    s.set(`${n} ${t}`, rc);
  }
  const names = new Set([...s.keys()].map((k) => k.split(' ')[0]));
  const bad = [...names].filter((n) => s.get(`${n} base`) === '0' && s.get(`${n} cand`) !== '0');
  if (bad.length) abort(`suites newly failing on cand: ${bad.join(' ')}`, 3);
  say('P1', 'tests ok');
}

async function sweep() {
  // sweep-dos.js has no wall-clock guard of its own; it rewrites --out after every
  // program, so a TERM at SWEEP_S leaves a valid partial JSON (sweep-diff then
  // lists the missing names as "only in").
  await Promise.all(TREES.map((t) => node([p(t, 'tools/toyvm/sweep-dos.js'), `--dir=${p('demos')}`,
    '--dispatches=8m', '--reps=1', '--timeout=180', `--out=${p('out', `sweep-${t}.json`)}`],
  { log: p('logs', `sweep-${t}.log`), timeoutS: SWEEP_S, signal: 'SIGTERM' })));
  // exits 1 on a regression or a blank; the gate reads the text, so keep going.
  await node([p('cand/tools/toyvm/sweep-diff.js'), p('out/sweep-base.json'), p('out/sweep-cand.json')],
    { log: p('out', 'sweep-diff.txt') });
  const txt = read(p('out', 'sweep-diff.txt'));
  console.log(txt);
  say('P2', txt.split('\n').filter((l) => /^(REGRESSIONS|WENT BLANK)/.test(l)).join(' '));
}

async function arms() {
  diskok();
  const secs = left() - 1800;              // leave 30 min for P4-P6
  if (secs <= 600) { say('SKIP', 'P3: not enough slot left'); return; }
  // Both trees at once over the same list order, so a run cut short by the slot
  // still covers the same prefix of programs in both.
  await Promise.all(TREES.map((t) => node([AB, `--tree=${p(t)}`, `--list=${p('programs.txt')}`,
    '--arms=l1,jit-early,jit-sepc,fold64', '--recipe=witness', '--budgets=80m',
    `--jobs=${Math.floor((JOBS + 1) / 2)}`, '--timeout=300', `--max-seconds=${secs}`,
    `--out=${p('out', `arms-${t}.ndjson`)}`], { log: p('logs', `arms-${t}.log`) })));
  await node([AB, `--compare=${p('out/arms-base.ndjson')},${p('out/arms-cand.ndjson')}`,
    `--md=${p('out', 'arms-compare.txt')}`, `--moved=${p('out', 'moved-80m.txt')}`]);
  say('P3', read(p('out', 'arms-compare.txt')).split('\n')
    .filter((l) => /BROKE|health regressions|before .* after/.test(l)).join(' '));
}

async function control() {
  for (const t of TREES) {
    await node([AB, `--tree=${p(t)}`, `--list=${p('programs.txt')}`, '--arms=l1', '--recipe=sweep',
      '--budgets=8m', '--no-irq-schedule', `--jobs=${JOBS}`, '--timeout=180',
      `--out=${p('out', `nosched-${t}.ndjson`)}`], { log: p('logs', `nosched-${t}.log`) });
  }
  await node([AB, `--compare=${p('out/nosched-base.ndjson')},${p('out/nosched-cand.ndjson')}`,
    `--md=${p('out', 'nosched-compare.txt')}`]);
  // Gate: "0 of N l1 rows moved". Anything else means the patch leaks off the schedule.
  say('P4', read(p('out', 'nosched-compare.txt')).split('\n').filter((l) => /l1 rows moved/.test(l)).join(' '));
}

// The first few lines where two IRQ lists differ (what `diff | head -4` showed).
function firstDiffs(a, b, n = 2) {
  const x = read(a).split('\n'), y = read(b).split('\n');
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length) && out.length < n * 2; i++) {
    if (x[i] !== y[i]) out.push(`< ${x[i] ?? ''}`, `> ${y[i] ?? ''}`);
  }
  return out.join('\n');
}

async function brw() {
  const exe = p('demos/1995-c-cma_brw/BRW.EXE');
  for (const t of TREES) {
    await Promise.all(['l1', 'sepc'].map((a) => node(['scratch/o/toyvm-brw/brw-bisect.js', `--arm=${a}`,
      `--exe=${exe}`, '--budget=500918116', '--trace-irq', `--irq-out=${p('out', `brw-${t}-${a}.irq`)}`],
    { cwd: p(t), log: p('logs', `brw-${t}-${a}.log`), timeoutS: 900 })));
  }
  const lines = [];
  for (const t of TREES) {
    for (const a of ['l1', 'sepc']) {
      const hit = read(p('logs', `brw-${t}-${a}.log`)).split('\n').find((l) => l.includes('BRWBISECT')) || '';
      lines.push(`${t}: ${hit.slice(0, 200)}`);
    }
    lines.push(`${t} first differing delivery l1 vs sepc:`);
    lines.push(firstDiffs(p('out', `brw-${t}-l1.irq`), p('out', `brw-${t}-sepc.irq`)));
  }
  fs.writeFileSync(p('out', 'brw.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  say('P5', 'brw done');
}

async function nudge() {
  // The moved list: sweep-diff's `changed` rows (P2) plus the l1 rows P3 saw move.
  // sweep-diff prints `  NAME: frame X -> Y, ...` (basename); corpus-ab --moved prints paths.
  const names = new Set();
  for (const l of read(p('out', 'sweep-diff.txt')).split('\n')) {
    const m = /^ {2}([^:]+): frame /.exec(l);
    if (m) names.add(m[1]);
  }
  for (const l of read(p('out', 'moved-80m.txt')).split('\n').filter(Boolean)) names.add(l.replace(/.*\//, ''));
  fs.writeFileSync(p('out', 'nudge-names.txt'), [...names].sort().join('\n') + (names.size ? '\n' : ''));
  // Every corpus path with one of those names (duplicate basenames all get re-run).
  const paths = read(p('programs.txt')).split('\n').filter((l) => l && names.has(l.split('/').pop()));
  fs.writeFileSync(p('out', 'nudge-paths.txt'), paths.join('\n') + (paths.length ? '\n' : ''));
  if (!paths.length) { say('P6', 'nothing moved'); return; }
  for (const t of TREES) {
    await node([AB, `--tree=${p(t)}`, `--list=${p('out', 'nudge-paths.txt')}`, '--arms=l1', '--recipe=sweep',
      '--budgets=8m,8.01m,8.02m,8.04m', `--jobs=${JOBS}`, '--timeout=180',
      `--out=${p('out', `nudge-${t}.ndjson`)}`], { log: p('logs', `nudge-${t}.log`) });
  }
  await node([AB, `--nudge=${p('out/nudge-base.ndjson')},${p('out/nudge-cand.ndjson')}`],
    { log: p('out', 'nudge.txt'), tee: true });
  const tail = read(p('out', 'nudge.txt')).trimEnd().split('\n').pop();
  say('P6', tail);
}

const PHASES = { prep, tests, sweep, arms, control, brw, nudge };

(async () => {
  const cmd = process.argv[2] || '';
  if (!W) { console.error('set W to an empty work dir (needs ~90 MB)'); process.exit(2); }
  fs.mkdirSync(p('out'), { recursive: true });
  if (PHASES[cmd]) return PHASES[cmd]();
  if (cmd === 'all') {
    await prep();
    // P1 and P2 together: tests take two cores, the two sweeps take two more.
    const t = tests();
    await sweep();
    await t;
    await arms(); await control(); await brw(); await nudge();
    say('DONE', `elapsed ${Math.floor((Date.now() - T0) / 1000)}s`);
    return;
  }
  console.error(`usage: W=DIR [CAND=v2|v3] [JOBS=N] node ${path.basename(__filename)} prep|tests|sweep|arms|control|brw|nudge|all`);
  process.exit(2);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
