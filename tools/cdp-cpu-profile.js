#!/usr/bin/env node
'use strict';
// Take a V8 CPU profile of a page that is ALREADY OPEN, at the moment you ask.
//
//   node tools/cdp-cpu-profile.js --seconds=15 --out=intro.cpuprofile [--port=9333]
//        [--match=8130] [--top=25] [--interval=200]
//
// profile-web-frames.js owns its browser and samples one fixed window after a
// fixed warmup, so profiling "the intro", then "the menu", then "gameplay" of
// one run means three runs and three guesses at the clock. This attaches to a
// Chrome started with a debugging port and profiles whatever the tab is doing
// right now, so a remote-controlled session (tools/ctl.js against the
// dev-server hub) can be profiled section by section while it is driven:
//
//   open -na "Google Chrome" --args --remote-debugging-port=9333 \
//        --user-data-dir=/tmp/chrome-rc --disable-backgrounding-occluded-windows \
//        --disable-renderer-backgrounding --disable-background-timer-throttling \
//        'http://127.0.0.1:8130/?debug&perf'
//
// The three --disable-* flags matter: host.js pauses the guest when the tab
// reports itself hidden, and macOS Chrome reports a window hidden as soon as
// another window covers it, so a run measured from a terminal in front of it
// came back at 1 guest fps and 80% idle. With them the tab stays "visible".
//   node tools/ctl.js -s 'http://127.0.0.1:8130/?debug&perf' launch black_white_2_demo
//   ... drive it to the section you care about ...
//   node tools/cdp-cpu-profile.js --seconds=15 --out=intro.cpuprofile
//
// Prints self time per function (wasm functions resolved to their WAT names
// through tools/func-index.js, so run `node tools/concat-wat.js` first if the
// build changed), the load average either side of the window, and the guest
// frame rate over the window from window.WinePerf when the page has the perf
// HUD on (?debug&perf) — a profile of a guest that was not advancing is a
// profile of nothing.
//
// --match picks the tab by URL substring (default: the first page whose URL
// contains "/?"). Headful only: a profile of a headless Chrome describes a
// browser nobody runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { scan } = require('./func-index');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const PORT = Number(flag('port', 9333));
const SECONDS = Number(flag('seconds', 15));
const OUT = flag('out', '');
const MATCH = flag('match', '/?');
const TOP = Number(flag('top', 25));
const INTERVAL = Number(flag('interval', 200));
const WORKER = argv.includes('--worker') ? 'list' : flag('worker', null);

// --combined=PATH names the combined.wat of the BUILD THE PAGE IS RUNNING, when
// that is not this tree's (a worktree served on another port). Indices are
// per-build, so resolving against the wrong tree prints plausible wrong names.
const COMBINED = flag('combined', '');

function wasmNames() {
  const combined = COMBINED || path.join(__dirname, '..', 'build', 'combined.wat');
  if (!fs.existsSync(combined)) return null;
  const { imports, defined } = scan(fs.readFileSync(combined, 'utf8'));
  return index => {
    const i = index - imports.length;
    if (i < 0) return imports[index] ? `import ${imports[index].name}` : null;
    return defined[i] ? defined[i].name : null;
  };
}

// A minimal CDP client over the browser-level WebSocket, for the worker path.
function rawCdp(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    const pending = new Map();
    let nextId = 1;
    ws.on('open', () => resolve({
      send(method, params = {}, sessionId) {
        const id = nextId++;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      close() { ws.close(); },
    }));
    ws.on('message', data => {
      const m = JSON.parse(data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(`${m.error.message} (${m.error.code})`)) : res(m.result);
      }
    });
    ws.on('error', reject);
  });
}

function summarize(profile, resolve) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    if (!n) continue;
    const d = profile.timeDeltas[i] || 0;
    total += d;
    const f = n.callFrame;
    let name = f.functionName || '(anonymous)';
    const wasm = name.match(/^wasm-function\[(\d+)\]$/);
    if (wasm && resolve) name = `${resolve(Number(wasm[1])) || name}  [${wasm[1]}]`;
    const where = f.url && !f.url.startsWith('wasm://') ? `  ${f.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')}:${f.lineNumber + 1}` : '';
    const key = name + where;
    self.set(key, (self.get(key) || 0) + d);
  }
  // Coarse buckets, so "interpreter-bound or host-bound" is one line rather
  // than a sum over thirty rows: the guest's wasm (the emulator itself), the
  // JS host (renderer, D3D backends, audio), the browser's own work, and
  // idle. GPU time is invisible here -- a WebGL call's self time is the
  // driver's CPU side only.
  const buckets = { wasm: 0, host: 0, gc: 0, program: 0, idle: 0 };
  for (const [k, us] of self) {
    if (k === '(idle)') buckets.idle += us;
    else if (k === '(garbage collector)') buckets.gc += us;
    else if (k === '(program)' || k === '(root)') buckets.program += us;
    else if (/\[\d+\]$/.test(k) || /^wasm-function/.test(k)) buckets.wasm += us;
    else buckets.host += us;
  }
  return { total, rows: [...self.entries()].sort((a, b) => b[1] - a[1]), buckets };
}

function report(profile, wall) {
  const { total, rows, buckets } = summarize(profile, wasmNames());
  console.log(`sampled ${(total / 1000).toFixed(0)} ms over ${wall.toFixed(1)} s wall (${(100 * total / 1000 / wall / 1000).toFixed(0)}% of one core)`);
  console.log('by bucket: ' + Object.entries(buckets).map(([k, us]) => `${k} ${(100 * us / total).toFixed(1)}%`).join('  '));
  console.log(`CPU self time (top ${TOP}):`);
  for (const [k, us] of rows.slice(0, TOP)) {
    console.log(`  ${(100 * us / total).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)}ms  ${k}`);
  }
}

// --from=FILE: summarize a saved .cpuprofile instead of taking a new one.
const FROM = flag('from', '');
if (FROM) {
  const profile = JSON.parse(fs.readFileSync(FROM, 'utf8'));
  report(profile, (profile.endTime - profile.startTime) / 1e6);
  process.exit(0);
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes(MATCH));
  if (!page) {
    console.error(`no tab matching "${MATCH}"; open tabs:\n  ${pages.map(p => p.url()).join('\n  ')}`);
    browser.disconnect();
    process.exit(2);
  }
  console.log(`tab: ${page.url()}`);
  // A background tab is paused by host.js's visibility handler (and Chrome
  // throttles its timers), so a profile of one measures nothing. Bring it
  // forward first and say so if that did not take.
  // Activate through the HTTP endpoint rather than page.bringToFront(): the
  // CDP Target.activateTarget round trip has been seen to never answer on a
  // headful Chrome whose omnibox popup is open, and a profiler that hangs
  // before it starts is worse than one that warns.
  await new Promise(resolve => {
    const req = require('http').get(`http://127.0.0.1:${PORT}/json/activate/${page.target()._targetId}`, r => { r.resume(); r.on('end', resolve); });
    req.on('error', resolve); req.setTimeout(2000, () => { req.destroy(); resolve(); });
  });
  await new Promise(r => setTimeout(r, 300));
  const visibility = await Promise.race([
    page.evaluate(() => document.visibilityState).catch(() => 'unknown'),
    new Promise(r => setTimeout(() => r('unknown (page did not answer)'), 3000)),
  ]);
  if (visibility !== 'visible') console.log(`** tab is ${visibility}: the guest is paused or throttled; this profile is not the app **`);
  const perf = () => page.evaluate(() => (window.WinePerf && window.WinePerf.snapshot) ? window.WinePerf.snapshot() : null).catch(() => null);
  const loadBefore = os.loadavg();
  const before = await perf();
  // --worker=MATCH profiles a dedicated Worker of the tab (URL substring)
  // instead of the page: the software D3D9 rasterizer and real guest threads
  // run there, and a main-thread profile of a page waiting on them is mostly
  // (idle). --worker alone (or =list) prints the workers and exits.
  // --worker=MATCH profiles a dedicated Worker of the tab (URL substring)
  // instead of the page: the software D3D9 rasterizer and real guest threads
  // run there, and a main-thread profile of a page waiting on them is mostly
  // (idle). --worker alone (or =list) prints the workers and exits. Dedicated
  // workers are not puppeteer targets (page.workers() hands back handles with
  // no target behind them), so this speaks CDP over the browser WebSocket
  // itself: Target.getTargets lists them, Target.attachToTarget with flatten
  // gives a sessionId every Profiler command is addressed by.
  let cdp;
  if (WORKER !== null) {
    const raw = await rawCdp(browser.wsEndpoint());
    const { targetInfos } = await raw.send('Target.getTargets');
    const workers = targetInfos.filter(t => t.type === 'worker' || t.type === 'shared_worker');
    console.log(`workers: ${workers.length ? workers.map(w => w.url.replace(/\?.*$/, '')).join(', ') : '(none)'}`);
    const w = WORKER && WORKER !== 'list' ? workers.find(w => w.url.includes(WORKER)) : null;
    if (!w) { raw.close(); browser.disconnect(); process.exit(WORKER && WORKER !== 'list' ? 2 : 0); }
    const { sessionId } = await raw.send('Target.attachToTarget', { targetId: w.targetId, flatten: true });
    console.log(`profiling worker ${w.url.replace(/\?.*$/, '')}`);
    cdp = { send: (m, p) => raw.send(m, p, sessionId), detach: async () => { await raw.send('Target.detachFromTarget', { sessionId }).catch(() => {}); raw.close(); } };
  } else {
    cdp = await page.target().createCDPSession();
  }
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: INTERVAL });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, SECONDS * 1000));
  const { profile } = await cdp.send('Profiler.stop');
  const wall = (Date.now() - t0) / 1000;
  const after = await perf();
  const loadAfter = os.loadavg();
  await cdp.detach();
  browser.disconnect();

  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(profile)); console.log(`wrote ${OUT}`); }
  console.log(`load average before ${loadBefore.map(n => n.toFixed(1)).join(' ')}  after ${loadAfter.map(n => n.toFixed(1)).join(' ')}` +
    (Math.max(loadBefore[0], loadAfter[0]) > 4 ? '   ** loaded box: numbers describe the machine **' : ''));
  if (before && after) {
    const dPresent = (after.presents || 0) - (before.presents || 0);
    console.log(`guest over the window: guestFps ${before.guestFps.toFixed(1)} -> ${after.guestFps.toFixed(1)}  ` +
      `page fps ${after.fps.toFixed(0)}  blocks/s ${(after.blocksPerSec / 1e6).toFixed(2)}M  ` +
      (dPresent ? `presents ${dPresent} (${(dPresent / wall).toFixed(1)}/s)  ` : '') +
      `phase ms main ${after.phaseMs.main.toFixed(0)} workers ${after.phaseMs.workers.toFixed(0)} present ${after.phaseMs.present.toFixed(0)} other ${after.phaseMs.other.toFixed(0)}`);
  }
  report(profile, wall);
})().catch(error => { console.error(error.message || error); process.exit(1); });
