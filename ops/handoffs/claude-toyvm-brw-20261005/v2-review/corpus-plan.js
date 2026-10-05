#!/usr/bin/env node
'use strict';
// Before/after corpus run for the toyvm IRQ-schedule candidate (v2 / v2+v3, plus
// the jmp_syn budget-test fix). JavaScript port of the reviewer's corpus-plan.sh,
// hardened after root's 12:29Z review: every gate EXITS (never only logs), every
// child's exit code is checked, a child that cannot start is a failure, and one
// slot deadline is enforced across separately invoked phases. NOT RUN yet; see
// corpus-plan.md. Fixture tests: corpus-plan.test.js (stub tools, no corpus).
//
//   W=/path/to/workdir CAND=v3j JMPSYN=/path/jmp-syn.patch JMPSYN_SHA=<sha256> JOBS=3 \
//     node corpus-plan.js prep|tests|sweep|arms|control|brw|nudge|all
//
// Exit codes: 0 ok, 2 setup/prep/child failure, 3 test gate, 4 sweep gate,
// 5 arms gate, 6 control gate, 7 slot deadline, 8 candidate incomplete,
// 9 BRW interrupt-list/frame parity gate, 11 INCOMPLETE corpus coverage (a
// partial comparison is never a pass, even when every compared row agrees),
// 130 the runner itself was signalled.
//
// Process hygiene (root review 116210a7): every child runs in its OWN process
// group and is tracked; a timeout signals the whole group (then SIGKILL after a
// grace period), and any abort -- a gate in one phase while a sibling phase is
// still running (`all` runs P1 and P2 together), or a signal to the runner --
// kills every live group before exiting, so no descendant outlives the slot.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const env = process.env;
const R = env.R || '/home/user/wine-assembly';
const W = env.W;
const CAND = env.CAND || 'v3j';                 // v2 | v3 | v3j (v2+v3+jmp_syn)
const JOBS = Number(env.JOBS || 3);
// SMOKE=N: a bounded real smoke of the runner itself -- N programs (BRW.EXE
// first), small budgets, the SMOKE_TESTS suites only, BRW to BRW_BUDGET. Every
// journal line says SMOKE; it is a harness check, never the corpus A/B.
const SMOKE = Number(env.SMOKE || 0);
const SMOKE_TESTS = String(env.SMOKE_TESTS || 'test-toyvm-region-live,test-toyvm-region-install-clock').split(',').filter(Boolean);
const BRW_BUDGET = Number(env.BRW_BUDGET || (SMOKE ? 50000000 : 500918116));
const B = (full, smoke) => (SMOKE ? smoke : full);          // per-phase budget picker
const SLOT_S = Number(env.SLOT_S || (SMOKE ? 900 : 7200));  // the whole slot, all phases, seconds
const SWEEP_S = Number(env.SWEEP_S || 3000);
const BASE = env.BASE || '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec';
const REV = env.REV || path.join(R, 'scratch/claude-toyvm-brw-v2-review-20261005');
const V2 = env.V2 || path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch');
const V2_SHA = env.V2_SHA || '4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78';
const V3 = env.V3 || path.join(REV, 'v3-delta-on-v2.patch');
const JMPSYN = env.JMPSYN || '';                 // required for CAND=v3j; not written yet
const JMPSYN_SHA = env.JMPSYN_SHA || '';
// CAND=stack: an ordered, hash-pinned patch list "file:sha256,file:sha256".
const STACK = String(env.PATCHES || '').split(',').filter(Boolean).map((e) => {
  const i = e.lastIndexOf(':');
  return { file: e.slice(0, i), sha: e.slice(i + 1) };
});
const AB = env.AB || path.join(REV, 'corpus-ab.js');
const UNPACK = env.UNPACK || path.join(REV, 'unpack-corpus.js');
const BISECT = env.BISECT || path.join(R, 'scratch/claude-orchestrator-20261004/toyvm-brw/brw-bisect.js');
const CORPUS_SHA = env.CORPUS_SHA || '3f9b202376eec52a72f9c1c0eb9f0dfd993292c344d62b95a820a9e5606fc475';
const CLOSURE = (env.CLOSURE || 'tools/toyvm tools/fnt-read.js tools/ne-dump.js tools/disasm.js '
  + 'tools/simd-ops.js lib/compile-wat.js lib/wat-manifest.js fonts/Terminal.fon').split(' ');
const TREES = ['base', 'cand'];

const p = (...x) => path.join(W, ...x);
const now = () => new Date().toISOString().slice(11, 19);
function say(tag, msg) {
  if (SMOKE) tag = `SMOKE ${tag}`;
  const line = `${now()} [${tag}] ${msg}`;
  console.log(line);
  fs.appendFileSync(p('out', 'journal.txt'), line + '\n');
}
// Every live child, so an abort can take the whole tree down with it.
const live = new Set();
function killGroup(ch, sig) {
  try { process.kill(-ch.pid, sig); } catch { try { ch.kill(sig); } catch {} }
}
function killAll(sig = 'SIGKILL') { for (const ch of live) killGroup(ch, sig); }
function abort(msg, code) {
  say(code === 11 ? 'INCOMPLETE' : 'ABORT', msg);
  if (live.size) say('CLEANUP', `killing ${live.size} live child group(s)`);
  killAll('SIGKILL');
  process.exit(code);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { if (W) abort(`runner received ${s}`, 130); else { killAll(); process.exit(130); } });
const GRACE_MS = 5000;
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// ONE deadline for the slot, whichever phase runs first sets it and every later
// invocation reads it back: phases may be run one at a time.
let deadline = 0;
function startSlot() {
  const f = p('out', 'slot-start.txt');
  let start = Number(read(f).trim());
  if (!start) { start = Date.now(); fs.writeFileSync(f, String(start) + '\n'); }
  deadline = start + SLOT_S * 1000;
}
const remainingS = () => Math.floor((deadline - Date.now()) / 1000);
function needSlot(phase, minS) {
  if (SMOKE) minS = Math.ceil(minS / 10);
  const r = remainingS();
  if (r < minS) abort(`${phase}: slot deadline (${r}s left, needs ${minS}s)`, 7);
}

function diskok() {
  const s = fs.statfsSync(W);
  const kb = Math.floor((s.bavail * s.bsize) / 1024);
  if (kb <= 307200) abort(`free disk ${kb}KB < 300MB`, 2);
}

// One child. Resolves to its exit code: 124 on timeout (like timeout(1)), 127 if
// it could not be started. Never rejects. The child's timeout is capped by the
// slot deadline. `log` gets stdout+stderr; `tee` also echoes stdout.
function run(cmd, args, { cwd, log, timeoutS = 0, signal = 'SIGKILL', input = null, tee = false } = {}) {
  return new Promise((resolve) => {
    const capS = deadline ? Math.max(1, remainingS()) : 0;
    const limitS = timeoutS && capS ? Math.min(timeoutS, capS) : (timeoutS || capS);
    const fd = log ? fs.openSync(log, 'w') : 'ignore';
    let done = false, timedOut = false, t = null, hard = null, ch = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (t) clearTimeout(t);
      if (hard) clearTimeout(hard);
      if (ch) live.delete(ch);
      // The direct child is gone; make sure nothing it started survives it.
      if (ch && ch.pid) killGroup(ch, 'SIGKILL');
      if (log) fs.closeSync(fd);
      resolve(code);
    };
    try {
      // detached: the child leads its own process group, so the group -- the
      // child AND its descendants -- can be signalled as one.
      ch = spawn(cmd, args, { cwd, detached: true, stdio: [input === null ? 'ignore' : 'pipe', tee ? 'pipe' : fd, fd] });
    } catch (e) {
      if (log) fs.writeSync(fd, `spawn failed: ${e.message}\n`);
      return finish(127);
    }
    live.add(ch);
    ch.on('error', (e) => { if (log) fs.writeSync(fd, `spawn failed: ${e.message}\n`); finish(127); });
    if (tee) ch.stdout.on('data', (d) => { process.stdout.write(d); if (log) fs.writeSync(fd, d); });
    if (input !== null) { ch.stdin.on('error', () => {}); ch.stdin.end(input); }
    if (limitS) {
      t = setTimeout(() => {
        timedOut = true;
        killGroup(ch, signal);
        hard = setTimeout(() => killGroup(ch, 'SIGKILL'), GRACE_MS);
      }, limitS * 1000);
    }
    ch.on('close', (code) => finish(timedOut ? 124 : (code === null ? 1 : code)));
  });
}
const node = (args, opts) => run(process.execPath, args, opts);
async function must(label, rc, code = 2) { if (rc !== 0) abort(`${label} failed (exit ${rc})`, code); }

async function prep() {
  for (const d of ['base', 'cand', 'logs']) fs.mkdirSync(p(d), { recursive: true });
  diskok();
  needSlot('P0', 600);
  if (sha256(V2) !== V2_SHA) abort('v2 patch hash', 2);
  if (CAND === 'v3j') {
    if (!JMPSYN || !fs.existsSync(JMPSYN)) abort('CAND=v3j needs JMPSYN=<jmp_syn fix patch>; none written yet', 8);
    if (!JMPSYN_SHA || sha256(JMPSYN) !== JMPSYN_SHA) abort('jmp_syn patch hash (set JMPSYN_SHA)', 8);
  }
  // CAND=stack: PATCHES="file:sha256,file:sha256,..." applied IN ORDER to the
  // candidate tree, each one hash-checked (the BRW stack is the v2+v3+J
  // combined patch, then v4, then the forward-SMC fix).
  if (CAND === 'stack') {
    if (!STACK.length) abort('CAND=stack needs PATCHES="file:sha256,..."', 8);
    for (const s of STACK) {
      if (!fs.existsSync(s.file)) abort(`stack patch missing: ${s.file}`, 8);
      if (sha256(s.file) !== s.sha) abort(`stack patch hash: ${path.basename(s.file)}`, 8);
    }
  }
  let tests;
  try {
    tests = execFileSync('git', ['-C', R, 'ls-tree', '--name-only', BASE, 'test/'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('test/test-toyvm-'));
  } catch (e) { abort(`git ls-tree ${BASE}: ${e.message.split('\n')[0]}`, 2); }
  for (const t of TREES) {
    let tarball;
    try { tarball = execFileSync('git', ['-C', R, 'archive', BASE, ...CLOSURE, ...tests], { maxBuffer: 1 << 30 }); }
    catch (e) { abort(`git archive ${BASE}: ${e.message.split('\n')[0]}`, 2); }
    await must(`${t} tar extract`, await run('tar', ['-x', '-C', p(t)], { input: tarball, log: p('logs', `${t}-tar.log`) }));
    try { fs.unlinkSync(p(t, 'node_modules')); } catch {}
    fs.symlinkSync(path.join(R, 'node_modules'), p(t, 'node_modules'));
    fs.mkdirSync(p(t, 'scratch/o/toyvm-brw'), { recursive: true });
    fs.copyFileSync(BISECT, p(t, 'scratch/o/toyvm-brw/brw-bisect.js'));
  }
  const patches = CAND === 'stack' ? STACK.map((s) => s.file)
    : [V2, ...(CAND === 'v2' ? [] : [V3]), ...(CAND === 'v3j' ? [JMPSYN] : [])];
  for (const f of patches) {
    await must(`patch ${path.basename(f)}`, await run('patch', ['-p1', '-d', p('cand')],
      { input: fs.readFileSync(f), log: p('logs', `patch-${path.basename(f)}.log`) }));
  }
  for (const t of TREES) {
    await must(`${t} bundle-browser`, await node(['tools/toyvm/bundle-browser.js'],
      { cwd: p(t), log: p('logs', `${t}-bundle.log`), timeoutS: 300 }));
  }
  // The candidate must actually differ where each patch says it does.
  const hashes = [];
  for (const t of TREES) for (const f of ['dos-loop', 'run-dos', 'emit']) {
    const file = p(t, 'tools/toyvm', `${f}.js`);
    if (fs.existsSync(file)) hashes.push(`${sha256(file)}  ${t}/tools/toyvm/${f}.js`);
  }
  fs.writeFileSync(p('out', 'tree-hashes.txt'), hashes.join('\n') + '\n');
  console.log(hashes.join('\n'));
  const h = (t, f) => (hashes.find((l) => l.endsWith(`${t}/tools/toyvm/${f}.js`)) || '').slice(0, 64);
  if (h('base', 'dos-loop') === h('cand', 'dos-loop')) abort('candidate dos-loop.js is unpatched', 8);
  if ((CAND === 'v3j' || CAND === 'stack') && h('base', 'emit') === h('cand', 'emit')) abort('candidate emit.js lacks the jmp_syn fix', 8);
  await must('unpack-corpus', await node([UNPACK, `--out=${p('demos')}`, `--list=${p('programs.txt')}`],
    { log: p('out', 'corpus.txt'), tee: true, timeoutS: 900 }));
  if (!read(p('out', 'corpus.txt')).includes(CORPUS_SHA)) abort('corpus hash', 2);
  if (!read(p('programs.txt')).trim()) abort('empty program list', 2);
  if (SMOKE) {
    const full = read(p('programs.txt')).split('\n').filter(Boolean);
    fs.writeFileSync(p('programs-full.txt'), full.join('\n') + '\n');
    const brw = full.filter((l) => /BRW\.EXE$/i.test(l));
    const pick = [...brw, ...full.filter((l) => !brw.includes(l))].slice(0, SMOKE);
    fs.writeFileSync(p('programs.txt'), pick.join('\n') + '\n');
    say('P0', `smoke list: ${pick.length} of ${full.length} programs (${pick.map((l) => path.basename(l)).join(' ')})`);
  }
  for (const t of TREES) {
    await must(`${t} smoke run`, await node([p(t, 'tools/toyvm/run-dos.js'), p('demos/1995-c-cma_brw/BRW.EXE'),
      '--dispatches=10m'], { log: p('logs', `${t}-smoke.log`), timeoutS: 120 }));
  }
  say('P0', `prep ok (${CAND})`);
}

async function tests() {
  needSlot('P1', 300);
  const lists = TREES.map((t) => {
    let files = [];
    try { files = fs.readdirSync(p(t, 'test')).filter((f) => /^test-toyvm-.*\.js$/.test(f)).sort(); } catch {}
    if (SMOKE) files = files.filter((f) => SMOKE_TESTS.includes(path.basename(f, '.js')));
    return files;
  });
  if (lists.some((l) => l.length === 0)) abort(`empty suite (base ${lists[0].length}, cand ${lists[1].length})`, 3);
  if (lists[0].join() !== lists[1].join()) abort('base and cand suites differ', 3);
  const results = {};
  await Promise.all(TREES.map(async (t, i) => {
    for (const f of lists[i]) {
      const n = path.basename(f, '.js');
      const rc = await node([p(t, 'test', f)], { cwd: p(t), log: p('logs', `${t}-${n}.log`), timeoutS: 600 });
      results[`${n} ${t}`] = rc;
      fs.appendFileSync(p('out', 'tests.txt'), `${t} ${n} ${rc}\n`);
    }
  }));
  // Gate: a suite that passes on base and fails on cand aborts. A suite that
  // fails on BOTH is reported (the comparison is blind there) but not blocking.
  const names = lists[0].map((f) => path.basename(f, '.js'));
  const bad = names.filter((n) => results[`${n} base`] === 0 && results[`${n} cand`] !== 0);
  const blind = names.filter((n) => results[`${n} base`] !== 0);
  if (bad.length) abort(`suites newly failing on cand: ${bad.join(' ')}`, 3);
  say('P1', `tests ok (${names.length} suites${blind.length ? `; failing on base too: ${blind.join(' ')}` : ''})`);
}

// Coverage. The program list is the one prep unpacked; a comparison that did
// not reach every program (x arm x budget) is INCOMPLETE, exit 11, whatever
// its compared rows say.
const programList = () => read(p('programs.txt')).split('\n').filter(Boolean);
function sweepRows(t) {
  try { return (JSON.parse(read(p('out', `sweep-${t}.json`))).rows || []).length; } catch { return -1; }
}
function abKeys(file) {
  const keys = new Set();
  for (const l of read(file).split('\n')) {
    if (!l) continue;
    try { const r = JSON.parse(l); keys.add(`${r.exe}\t${r.arm}\t${r.budget}`); } catch {}
  }
  return keys.size;
}
function needComplete(label, got, want) {
  if (!(want > 0)) abort(`${label}: no program list to measure coverage against`, 11);
  if (got < want) abort(`${label}: ${got} of ${want} rows -- a partial comparison, not a pass`, 11);
}

async function sweep() {
  needSlot('P2', 600);
  // sweep-dos.js rewrites --out after every program, so a TERM at SWEEP_S (exit
  // 124 here) leaves a valid partial JSON; any other non-zero exit is a failure.
  const rcs = await Promise.all(TREES.map((t) => node([p(t, 'tools/toyvm/sweep-dos.js'), `--dir=${p('demos')}`,
    `--dispatches=${B('8m', '2m')}`, '--reps=1', '--timeout=180', `--out=${p('out', `sweep-${t}.json`)}`,
    // smoke: the listed programs as positional args instead of the whole --dir
    ...(SMOKE ? programList() : [])].filter((a) => !(SMOKE && a.startsWith('--dir='))),
  { log: p('logs', `sweep-${t}.log`), timeoutS: Math.min(SWEEP_S, remainingS()), signal: 'SIGTERM' })));
  rcs.forEach((rc, i) => {
    if (rc !== 0 && rc !== 124) abort(`sweep-dos ${TREES[i]} failed (exit ${rc})`, 2);
    if (!read(p('out', `sweep-${TREES[i]}.json`)).trim()) abort(`sweep-dos ${TREES[i]} wrote no results`, 2);
  });
  if (rcs.includes(124)) say('P2', `partial sweep (deadline): ${rcs.join(',')}`);
  // sweep-diff: 0 clean, 1 regression or went-blank (BLOCKS), anything else broken.
  const rc = await node([p('cand/tools/toyvm/sweep-diff.js'), p('out/sweep-base.json'), p('out/sweep-cand.json')],
    { log: p('out', 'sweep-diff.txt') });
  const txt = read(p('out', 'sweep-diff.txt'));
  console.log(txt);
  if (rc === 1) abort(`sweep gate: ${txt.split('\n').filter((l) => /^(REGRESSIONS|WENT BLANK)/.test(l)).join(' ')}`, 4);
  if (rc !== 0) abort(`sweep-diff failed (exit ${rc})`, 2);
  // A deadline-cut sweep compared a prefix: report it as INCOMPLETE, not clean.
  const want = programList().length;
  for (const t of TREES) needComplete(`P2 sweep ${t}${rcs[TREES.indexOf(t)] === 124 ? ' (deadline)' : ''}`, sweepRows(t), want);
  say('P2', `sweep gate clean, ${want}/${want} programs in both trees`);
}

async function arms() {
  diskok();
  const secs = remainingS() - B(1800, 180);   // leave room for P4-P6
  if (secs <= B(600, 60)) abort('P3: not enough slot left', 7);
  const rcs = await Promise.all(TREES.map((t) => node([AB, `--tree=${p(t)}`, `--list=${p('programs.txt')}`,
    '--arms=l1,jit-early,jit-sepc,fold64', '--recipe=witness', `--budgets=${B('80m', '4m')}`,
    `--jobs=${Math.floor((JOBS + 1) / 2)}`, '--timeout=300', `--max-seconds=${secs}`,
    `--out=${p('out', `arms-${t}.ndjson`)}`], { log: p('logs', `arms-${t}.log`) })));
  rcs.forEach((rc, i) => { if (rc !== 0) abort(`corpus-ab ${TREES[i]} failed (exit ${rc})`, 2); });
  // corpus-ab --compare: exitCode 1 on BROKE or health regressions (BLOCKING).
  const rc = await node([AB, `--compare=${p('out/arms-base.ndjson')},${p('out/arms-cand.ndjson')}`,
    `--md=${p('out', 'arms-compare.txt')}`, `--moved=${p('out', 'moved-80m.txt')}`], { log: p('logs', 'arms-compare.log') });
  const summary = read(p('out', 'arms-compare.txt')).split('\n')
    .filter((l) => /BROKE|health regressions|before .* after/.test(l)).join(' ');
  if (rc === 1) abort(`arms gate: ${summary}`, 5);
  if (rc !== 0) abort(`corpus-ab compare failed (exit ${rc})`, 2);
  // --max-seconds may have stopped both trees at the same prefix; that is a
  // partial comparison and must say so (4 arms x 1 budget per program).
  const want = programList().length * 4;
  for (const t of TREES) needComplete(`P3 arms ${t}`, abKeys(p('out', `arms-${t}.ndjson`)), want);
  say('P3', `${summary} (${want}/${want} rows per tree)`);
}

async function control() {
  needSlot('P4', 600);
  for (const t of TREES) {
    await must(`nosched ${t}`, await node([AB, `--tree=${p(t)}`, `--list=${p('programs.txt')}`, '--arms=l1',
      '--recipe=sweep', `--budgets=${B('8m', '2m')}`, '--no-irq-schedule', `--jobs=${JOBS}`, '--timeout=180',
      `--out=${p('out', `nosched-${t}.ndjson`)}`], { log: p('logs', `nosched-${t}.log`) }));
  }
  const rc = await node([AB, `--compare=${p('out/nosched-base.ndjson')},${p('out/nosched-cand.ndjson')}`,
    `--md=${p('out', 'nosched-compare.txt')}`], { log: p('logs', 'nosched-compare.log') });
  // Gate: exactly "0 of N l1 rows moved" with N > 0, and a clean compare.
  const line = read(p('out', 'nosched-compare.txt')).split('\n').find((l) => /l1 rows moved/.test(l)) || '';
  const m = /(\d+) of (\d+) l1 rows moved/.exec(line);
  if (!m) abort('control gate: no "l1 rows moved" line', 6);
  if (Number(m[2]) === 0) abort('control gate: 0 l1 rows compared', 6);
  if (Number(m[1]) !== 0) abort(`control gate: ${line.trim()} (the patch leaks off the schedule)`, 6);
  if (rc !== 0) abort(`nosched compare failed (exit ${rc})`, 6);
  const want = programList().length;          // 1 arm x 1 budget per program
  for (const t of TREES) needComplete(`P4 nosched ${t}`, abKeys(p('out', `nosched-${t}.ndjson`)), want);
  say('P4', line.trim());
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
  needSlot('P5', 900);
  const exe = p('demos/1995-c-cma_brw/BRW.EXE');
  for (const t of TREES) {
    const rcs = await Promise.all(['l1', 'sepc'].map((a) => node(['scratch/o/toyvm-brw/brw-bisect.js', `--arm=${a}`,
      `--exe=${exe}`, `--budget=${BRW_BUDGET}`, '--trace-irq', `--irq-out=${p('out', `brw-${t}-${a}.irq`)}`],
    { cwd: p(t), log: p('logs', `brw-${t}-${a}.log`), timeoutS: 900 })));
    rcs.forEach((rc, i) => { if (rc !== 0) abort(`brw ${t} ${['l1', 'sepc'][i]} failed (exit ${rc})`, 2); });
  }
  const lines = [];
  const res = {};
  for (const t of TREES) {
    for (const a of ['l1', 'sepc']) {
      const hit = read(p('logs', `brw-${t}-${a}.log`)).split('\n').find((l) => l.startsWith('BRWBISECT ')) || '';
      if (!hit) abort(`brw ${t} ${a}: no BRWBISECT line`, 2);
      try { res[`${t} ${a}`] = JSON.parse(hit.slice('BRWBISECT '.length)); } catch { abort(`brw ${t} ${a}: unreadable BRWBISECT`, 2); }
      lines.push(`${t}: ${hit.slice(0, 200)}`);
    }
    lines.push(`${t} first differing delivery l1 vs sepc:`);
    lines.push(firstDiffs(p('out', `brw-${t}-l1.irq`), p('out', `brw-${t}-sepc.irq`)) || '(none)');
  }
  fs.writeFileSync(p('out', 'brw.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  // GATE (root review 116210a7): the candidate's two arms must deliver every
  // interrupt identically (vec, src, at, cs:ip -- `hb=` is the handback index
  // and legitimately differs) and end on the same frame and dispatch count.
  // The base tree is informational: it is expected to differ.
  const strip = (f) => read(f).split('\n').filter(Boolean).map((l) => l.replace(/ hb=\d+/, ''));
  const il = strip(p('out', 'brw-cand-l1.irq')), is = strip(p('out', 'brw-cand-sepc.irq'));
  const cl = res['cand l1'], cs = res['cand sepc'];
  const bad = [];
  if (!il.length) bad.push('empty interrupt list');
  if (il.length !== is.length) bad.push(`interrupt counts ${il.length} vs ${is.length}`);
  const firstBad = il.findIndex((l, i) => l !== is[i]);
  if (firstBad >= 0) bad.push(`delivery #${firstBad} differs: ${il[firstBad]} | ${is[firstBad]}`);
  if (cl.frame !== cs.frame) bad.push(`frame ${cl.frame} vs ${cs.frame}`);
  if (cl.dispatched !== cs.dispatched) bad.push(`dispatched ${cl.dispatched} vs ${cs.dispatched}`);
  if (bad.length) abort(`P5 BRW parity gate (cand): ${bad.join('; ')}`, 9);
  say('P5', `BRW parity on cand: ${il.length} identical deliveries, frame ${cl.frame}, dispatched ${cl.dispatched}`);
}

async function nudge() {
  needSlot('P6', 300);
  // The moved list: sweep-diff's `changed` rows (P2) plus the l1 rows P3 saw move.
  const names = new Set();
  for (const l of read(p('out', 'sweep-diff.txt')).split('\n')) {
    const m = /^ {2}([^:]+): frame /.exec(l);
    if (m) names.add(m[1]);
  }
  for (const l of read(p('out', 'moved-80m.txt')).split('\n').filter(Boolean)) names.add(l.replace(/.*\//, ''));
  fs.writeFileSync(p('out', 'nudge-names.txt'), [...names].sort().join('\n') + (names.size ? '\n' : ''));
  const paths = read(p('programs.txt')).split('\n').filter((l) => l && names.has(l.split('/').pop()));
  fs.writeFileSync(p('out', 'nudge-paths.txt'), paths.join('\n') + (paths.length ? '\n' : ''));
  if (!paths.length) { say('P6', 'nothing moved'); return; }
  for (const t of TREES) {
    await must(`nudge ${t}`, await node([AB, `--tree=${p(t)}`, `--list=${p('out', 'nudge-paths.txt')}`, '--arms=l1',
      '--recipe=sweep', `--budgets=${B('8m,8.01m,8.02m,8.04m', '2m,2.01m,2.02m,2.04m')}`, `--jobs=${JOBS}`, '--timeout=180',
      `--out=${p('out', `nudge-${t}.ndjson`)}`], { log: p('logs', `nudge-${t}.log`) }));
  }
  await must('nudge rubric', await node([AB, `--nudge=${p('out/nudge-base.ndjson')},${p('out/nudge-cand.ndjson')}`],
    { log: p('out', 'nudge.txt'), tee: true }));
  say('P6', read(p('out', 'nudge.txt')).trimEnd().split('\n').pop());
}

// P1 and P2 together, as `all` runs them (tests take two cores, the sweeps two
// more). A gate in either aborts both: abort() kills every live child group.
async function p1p2() {
  const t = tests();
  await sweep();
  await t;
}

const PHASES = { prep, tests, sweep, p1p2, arms, control, brw, nudge };

async function main(cmd) {
  if (!W) { console.error('set W to an empty work dir (needs ~90 MB)'); process.exit(2); }
  if (!PHASES[cmd] && cmd !== 'all') {
    console.error(`usage: W=DIR [CAND=stack PATCHES=file:sha,...|CAND=v2|v3|v3j JMPSYN=patch JMPSYN_SHA=sha] [JOBS=N] node ${path.basename(__filename)} prep|tests|sweep|p1p2|arms|control|brw|nudge|all`);
    process.exit(2);
  }
  // Every phase can run on its own, so every phase needs both directories.
  for (const d of ['out', 'logs']) fs.mkdirSync(p(d), { recursive: true });
  startSlot();
  if (cmd !== 'all') return PHASES[cmd]();
  if (CAND !== 'v3j' && CAND !== 'stack') abort('`all` is the scheduled A/B and needs CAND=stack (PATCHES=...) or CAND=v3j', 8);
  await prep();
  await p1p2();
  await arms(); await control(); await brw(); await nudge();
  say('DONE', `${SMOKE ? 'harness smoke only, NOT the corpus A/B; ' : ''}elapsed ${Math.floor((Date.now() - (deadline - SLOT_S * 1000)) / 1000)}s`);
}

if (require.main === module) {
  main(process.argv[2] || '').catch((e) => { console.error(e.stack || e); process.exit(1); });
} else {
  module.exports = { run };
}
