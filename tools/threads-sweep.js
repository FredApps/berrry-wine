#!/usr/bin/env node
// Does each desktop app still work, and is it at least as fast, with guest
// threads in Workers instead of the cooperative scheduler?
//
//   node tools/threads-sweep.js [--apps=a,b | --desktop] [--seconds=20]
//        [--warmup=10] [--reps=1] [--headful] [--out=DIR] [--timeout=300] [--software-browser]
//   node tools/threads-sweep.js --desktop --list-files
//
// Every app is run through tools/profile-web-frames.js in both modes, one
// browser at a time. The mode order alternates per app and per rep, so a box
// that drifts over the sweep (thermal, a background job) cannot hand one mode a
// systematic edge.
//
// What it reports, per app and mode:
//   backend       which scheduler actually came up. --threads can fall back to
//                 cooperative silently; a row whose threads arm did not start
//                 a Worker measures nothing about Workers.
//   problems      page errors, RuntimeError / UNIMPLEMENTED / FATAL console lines
//   live          whether the screen changed during the sample
//   blocks/s      retired guest blocks over the whole sample, from the HUD's
//                 cumulative counter (not the HUD's 2 s window)
//   presents/s    DirectDraw/GL presents or GDI surface flushes, same window
//   long tasks    main-thread tasks over 50 ms, and ms blocked by them
// plus a screenshot per run and a verdict row per app.
//
// The rates are only worth quoting from a quiet machine, and a headless Chrome
// has no compositor, so pass --headful for anything that will be quoted. On a
// busy box, or headless, read backend / problems / live only.
//
// Blocks are not a fixed amount of work (CLAUDE.md, --batch-size), but both
// arms run the same app over the same screens, so blocks/s compares the two
// schedulers at like-for-like work. presents/s is the number a user sees; an
// app that sits on an idle screen presents nothing in either mode and carries
// no timing verdict at all.
//
// distinct/s counts DISPLAYED frames: a 160x120 downsample of the screen
// canvas hashed on every rAF. presents/s is not a frame rate -- StarCraft
// makes ~97 presents a second while its screen changes 18 times -- so read
// distinct/s for what a user sees. (tools/present-rate-sweep.js uses the same
// count to decide which apps the present limiter belongs on.)
//
// --list-files prints every repository path the chosen apps load (exe, path
// DLLs, data files), for copying assets to a bench box.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const has = name => argv.includes(`--${name}`);

const { APPS, DESKTOP_APPS } = require(path.join(ROOT, 'lib', 'apps.js'));
const desktopIds = DESKTOP_APPS.map(e => (Array.isArray(e) ? e[0] : e.id || e));
const ids = opt('apps', '') ? opt('apps', '').split(',').filter(Boolean) : desktopIds;
for (const id of ids) {
  if (!APPS[id]) { console.error(`unknown app id: ${id}`); process.exit(2); }
}

if (has('list-files')) {
  const out = new Set();
  // `binaries/` is a symlink to test/binaries; print the real path so the list
  // can be compared against `git ls-files`.
  const real = p => { try { return fs.realpathSync(p); } catch (_) { return p; } };
  const add = p => { if (p) out.add(path.relative(real(ROOT), real(path.isAbsolute(p) ? p : path.join(ROOT, p)))); };
  for (const id of ids) {
    const app = APPS[id];
    add(app.exe);
    for (const d of (app.dlls || [])) if (d.includes('/')) add(d);
    for (const f of (app.files || [])) add(typeof f === 'string' ? f : f && f.url);
  }
  for (const p of [...out].sort()) console.log(p);
  process.exit(0);
}

const SECONDS = Number(opt('seconds', 20));
const WARMUP = Number(opt('warmup', 10));
const REPS = Math.max(1, Number(opt('reps', 1)));
const TIMEOUT = Number(opt('timeout', 300));
const HEADFUL = has('headful');
// Appended to both arms' page query. `&present-cap=0` lifts the default 60/s
// present pacing, without which any app that can reach 60 reads the cap in
// both modes and says nothing about the scheduler; `&rpc-census` turns on the
// brokered-call counts the report reads.
const QUERY_EXTRA = opt('query-extra', '');
const ARMS = [{ name: 'coop', threads: false, query: '' },
  { name: 'threads', threads: true, query: '' }];
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'threads-sweep')));
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'png'), { recursive: true });

// Marks the HUD's cumulative counters when the warmup ends, so the report can
// difference them over exactly the sample window.
// Also marks the guest Worker's own slice counters and the broker's call
// census (needs ?rpc-census), so a threads run can say how much of the wall
// clock its Worker actually spent running the guest, and what it waited on.
//
// It also starts the distinct-displayed-frame counter and marks the
// cooperative instance's present-pacing counters.
const AFTER_LAUNCH = `setTimeout(() => {
  const w = (runningApps[0] || {}).wine;
  const screen = w && w.renderer && w.renderer.canvas;
  if (screen) {
    const small = document.createElement('canvas');
    small.width = 160; small.height = 120;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const D = window.__tswDistinct = { n: 0, raf: 0, last: -1 };
    const tick = () => {
      if (!window.__tswDistinct) return;
      try {
        sctx.drawImage(screen, 0, 0, 160, 120);
        const px = new Uint32Array(sctx.getImageData(0, 0, 160, 120).data.buffer);
        let h = 0x811c9dc5;
        for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619);
        if (h !== D.last) { D.n++; D.last = h; }
        D.raf++;
      } catch (_) {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const ex = w && w.instance && w.instance.exports;
  window.__tswPaced0 = ex && ex.get_present_paced_ms
    ? { ms: ex.get_present_paced_ms(), n: ex.get_present_paced_count() } : null;
  const gw = (runningApps[0] || {}).wine && runningApps[0].wine.guestWorker;
  const ss = gw && gw.sliceStats, bs = gw && gw.broker && gw.broker.stats ? gw.broker.stats() : null;
  window.__tsw0 = { t: performance.now(), b: WinePerf._blockTotal, f: WinePerf._frameTotal,
    slices: ss ? ss.slices : 0, guestMs: ss ? ss.guestMs : 0, served: bs ? bs.served : 0,
    ends: ss && ss.ends ? Object.assign({}, ss.ends) : {},
    calls: bs ? Object.fromEntries(bs.calls.map(c => [c.slot + ':' + c.name, c.count])) : {} };
}, ${WARMUP * 1000}); 'armed'`;
const REPORT = `(() => { const s = WinePerf.snapshot(), m = window.__tsw0 || null,
  t = performance.now(), sec = m ? (t - m.t) / 1000 : 0;
  const gw = (runningApps[0] || {}).wine && runningApps[0].wine.guestWorker;
  const ss = gw && gw.sliceStats, bs = gw && gw.broker && gw.broker.stats ? gw.broker.stats() : null;
  const per = v => (m && sec > 0 ? v / sec : null);
  const calls = bs && m ? bs.calls.map(c => ({ k: c.slot + ':' + c.name,
    n: c.count - (m.calls[c.slot + ':' + c.name] || 0) })).filter(c => c.n > 0)
    .sort((a, b) => b.n - a.n).map(c => ({ k: c.k, perSec: c.n / sec })) : null;
  const sync = calls ? calls.filter(c => !/~async$/.test(c.k)) : null;
  const w = (runningApps[0] || {}).wine, ex = w && w.instance && w.instance.exports;
  const p0 = window.__tswPaced0, D = window.__tswDistinct;
  return JSON.stringify({ sec,
    distinctPerSec: D ? per(D.n) : null, rafPerSec: D ? per(D.raf) : null,
    pacedMsPerSec: p0 && ex ? per(ex.get_present_paced_ms() - p0.ms) : null,
    pacedPerSec: p0 && ex ? per(ex.get_present_paced_count() - p0.n) : null,
    blocksPerSec: per(s.blocksTotal - (m ? m.b : 0)),
    presentsPerSec: per(s.presentsTotal - (m ? m.f : 0)),
    workerDuty: ss && m && sec > 0 ? (ss.guestMs - m.guestMs) / (sec * 1000) : null,
    slicesPerSec: ss ? per(ss.slices - m.slices) : null,
    rpcPerSec: bs ? per(bs.served - m.served) : null, topRpc: calls && calls.slice(0, 8),
    syncRpcPerSec: sync ? sync.reduce((a, c) => a + c.perSec, 0) : null,
    topSync: sync && sync.slice(0, 12),
    sliceEnds: ss && ss.ends && m ? Object.fromEntries(Object.entries(ss.ends)
      .map(([k, n]) => [k, Math.round((n - (m.ends[k] || 0)) / sec)])
      .filter(([, n]) => n > 0)) : null,
    longTasks: s.longTasks, blockedMs: s.blockedMs, fps: s.fps,
    frameP99: s.frameMs.p99, throttledPct: s.throttledPct,
    mainMs: s.phaseMs.main, workersMs: s.phaseMs.workers, presentMs: s.phaseMs.present,
    otherMs: s.phaseMs.other, steps: s.steps }); })()`;

function runOne(id, arm, rep) {
  const mode = arm.name;
  const tag = `${id}-${mode}-${rep}`;
  const logPath = path.join(OUT, 'logs', `${tag}.log`);
  const png = path.join(OUT, 'png', `${tag}.png`);
  const args = [path.join(ROOT, 'tools', 'profile-web-frames.js'),
    `--app=${id}`, `--seconds=${SECONDS}`, `--warmup=${WARMUP}`, `--query=?perf${arm.query}${QUERY_EXTRA}`,
    `--screenshot=${png}`, `--after-launch=${AFTER_LAUNCH}`, `--report-eval=${REPORT}`];
  if (arm.threads) args.push('--threads');
  if (HEADFUL) args.push('--headful');
  if (has('software-browser')) args.push('--software-browser');
  return new Promise(resolve => {
    const log = fs.createWriteStream(logPath);
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10000); }, TIMEOUT * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      log.end(() => resolve(parse(fs.readFileSync(logPath, 'utf8'), { id, mode, rep, code, timedOut, logPath, png })));
    });
  });
}

function parse(text, base) {
  const r = { ...base, backend: null, problems: [], live: null, report: null, load: null };
  const b = text.match(/^guest backend: (\S+)/m);
  if (b) r.backend = b[1];
  const rep = text.match(/^report-eval: (\{.*\})$/m);
  if (rep) { try { r.report = JSON.parse(rep[1]); } catch (_) {} }
  if (/screen never changed/.test(text)) r.live = false;
  else if (/^screen changed in/m.test(text)) r.live = true;
  const pp = text.split('\npage problems:\n')[1];
  if (pp) r.problems = pp.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim());
  const la = text.match(/^load average before: (\S+)/m);
  if (la) r.load = Number(la[1]);
  if (!rep && !r.timedOut && base.code !== 0) r.problems.push(`profiler exit ${base.code}`);
  if (r.timedOut) r.problems.push(`timed out after ${TIMEOUT}s`);
  return r;
}

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
const mean = xs => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };

function verdict(coop, thr) {
  const workerUp = thr.every(r => r.backend === 'worker');
  const thrBroken = thr.some(r => r.problems.length || r.timedOut);
  const coopBroken = coop.some(r => r.problems.length || r.timedOut);
  if (!workerUp) return 'NO-WORKER';
  if (thrBroken && !coopBroken) return 'BREAKS';
  if (thrBroken) return 'BROKEN-BOTH';
  if (coop.some(r => r.live) && !thr.some(r => r.live)) return 'STALLS';
  // Displayed frames when the screen moves at all, presents otherwise.
  const cd = mean(coop.map(r => r.report && r.report.distinctPerSec));
  const td = mean(thr.map(r => r.report && r.report.distinctPerSec));
  const useDistinct = cd > 0.5 || td > 0.5;
  const cp = useDistinct ? cd : mean(coop.map(r => r.report && r.report.presentsPerSec));
  const tp = useDistinct ? td : mean(thr.map(r => r.report && r.report.presentsPerSec));
  const cb = mean(coop.map(r => r.report && r.report.blocksPerSec));
  const tb = mean(thr.map(r => r.report && r.report.blocksPerSec));
  // An idle app has no rate to lose; its verdict is only "still works".
  if (!(cp > 0.5) && !(tp > 0.5)) return 'OK-IDLE';
  const ratio = cp > 0.5 ? tp / cp : (cb > 0 ? tb / cb : null);
  if (ratio == null) return 'OK-IDLE';
  if (ratio < 0.9) return 'SLOWER';
  if (ratio > 1.1) return 'FASTER';
  return 'SAME';
}

async function main() {
  console.log(`threads sweep: ${ids.length} apps x ${REPS} rep(s), ${SECONDS}s sample after ${WARMUP}s warmup,` +
    ` ${HEADFUL ? 'headful' : 'HEADLESS (functional only)'}, out ${OUT}`);
  console.log(`load average at start: ${os.loadavg().map(n => n.toFixed(2)).join(' ')}`);
  const all = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    for (let rep = 0; rep < REPS; rep++) {
      const order = (i + rep) % 2 ? [ARMS[1], ARMS[0]] : [ARMS[0], ARMS[1]];
      for (const arm of order) {
        const mode = arm.name;
        const r = await runOne(id, arm, rep);
        all.push(r);
        const x = r.report || {};
        console.log(`  ${id.padEnd(22)} ${mode.padEnd(8)} backend=${String(r.backend).padEnd(12)}` +
          ` blk/s=${fmt(x.blocksPerSec / 1e6, 2)}M pres/s=${fmt(x.presentsPerSec, 1)}` +
          ` distinct/s=${fmt(x.distinctPerSec, 1)}/${fmt(x.rafPerSec, 0)}raf paced=${fmt(x.pacedMsPerSec)}ms/s` +
          ` live=${r.live} long=${fmt(x.longTasks)} load=${fmt(r.load, 1)}` +
          (x.workerDuty != null ? ` duty=${fmt(100 * x.workerDuty)}% slices/s=${fmt(x.slicesPerSec)}` +
            ` rpc/s=${fmt(x.rpcPerSec)} sync/s=${fmt(x.syncRpcPerSec)}` : '') +
          (x.sliceEnds ? ` ends/s=${Object.entries(x.sliceEnds).map(([k, n]) => `${k}:${n}`).join(',')}` : '') +
          (x.topSync && x.topSync.length ? ` sync=${x.topSync.slice(0, 5).map(c => `${c.k}:${fmt(c.perSec)}`).join(',')}` : '') +
          (r.problems.length ? `  PROBLEM: ${r.problems[0].slice(0, 140)}` : ''));
      }
    }
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(all, null, 1));
  }

  const rows = ids.map(id => {
    const coop = all.filter(r => r.id === id && r.mode === 'coop');
    const thr = all.filter(r => r.id === id && r.mode === 'threads');
    const g = (rs, k) => mean(rs.map(r => r.report && r.report[k]));
    return { id, verdict: verdict(coop, thr),
      coopPres: g(coop, 'presentsPerSec'), thrPres: g(thr, 'presentsPerSec'),
      coopDistinct: g(coop, 'distinctPerSec'), thrDistinct: g(thr, 'distinctPerSec'),
      coopBlk: g(coop, 'blocksPerSec'), thrBlk: g(thr, 'blocksPerSec'),
      coopLong: g(coop, 'blockedMs'), thrLong: g(thr, 'blockedMs'),
      problem: [...thr, ...coop].flatMap(r => r.problems.map(p => `${r.mode}: ${p}`))[0] || '' };
  });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rows, null, 1));
  console.log('');
  console.log('app                    verdict      distinct/s coop->thr   pres/s coop->thr   Mblk/s coop->thr   blockedMs coop->thr');
  for (const r of rows) {
    console.log(`${r.id.padEnd(22)} ${r.verdict.padEnd(12)} ${fmt(r.coopDistinct, 1).padStart(7)} -> ${fmt(r.thrDistinct, 1).padEnd(7)}   ` +
      ` ${fmt(r.coopPres, 1).padStart(7)} -> ${fmt(r.thrPres, 1).padEnd(7)}` +
      `  ${fmt(r.coopBlk / 1e6, 2).padStart(6)} -> ${fmt(r.thrBlk / 1e6, 2).padEnd(6)}` +
      `  ${fmt(r.coopLong).padStart(6)} -> ${fmt(r.thrLong)}` + (r.problem ? `   ${r.problem.slice(0, 120)}` : ''));
  }
  console.log(`load average at end: ${os.loadavg().map(n => n.toFixed(2)).join(' ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
