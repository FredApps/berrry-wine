#!/usr/bin/env node

// Is a two-browser Blobby match actually laggy, and if so, where?
//
//   node tools/blobby-lag-probe.js [--seconds=20] [--reps=3] [--control]
//                                  [--timeout=420] [--keep] [--headless]
//
// test/test-web-blobby-rtc.js already proves two browsers can find each other
// and play. It is a pass/fail gate, and for a timing question it does two
// things that make it the wrong instrument: it CPU-throttles the guest 4x on
// purpose (to catch a consumer that falls behind), and it puts both players in
// one browser process. This runs the same pairing with neither -- two separate
// Chromium processes, positioned side by side so BOTH are visible, because an
// occluded window has its timers clamped and would measure the clamp instead
// of the emulator.
//
// It answers two different questions that both get called "lag":
//
//   A  Is each emulator keeping up on its own?  WinePerf.snapshot() per
//      second: step p50/p99, the guest/threads/paint split, throttled share.
//      ?debug&perf is what makes that object exist.
//
//   B  How long after a key does the OTHER screen show the move? Each page
//      samples its own blob positions on a timer and stamps them with
//      performance.timeOrigin + performance.now(), which is wall-clock epoch
//      ms on both -- one shared clock, so the two series can be subtracted.
//      lag = (peer screen first moves) - (own screen first moves).
//
// B is the number a player feels. A says whose fault it is: a big B with both
// sides keeping up in A is the wire; a big B with a starved A is throughput,
// and then the browsers are simply not getting enough CPU between them.
//
// --control repeats measurement A with ONE browser in a LOCAL match, which is
// what separates "two emulators on this box" from "the network path".
//
// Every number is reported next to loadavg, taken before and after. This box
// routinely sits above 20, and above ~4 these numbers describe the machine.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('./dev-server');
const H = require('../test/hearts-web-helper');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'packages', 'freeware', 'blobby-volley', 'volley.exe');
const OUT = path.join(ROOT, 'test', 'output', 'blobby-lag-probe');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const flag = name => process.argv.includes(`--${name}`);

const SECONDS = arg('seconds', 20);
const REPS = arg('reps', 3);
const MILESTONE_MS = arg('milestone-timeout', 120) * 1000;
const MENU_MS = arg('menu-wait', 8) * 1000;

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (_) {}
const CHROME = H.findChrome();
if (!fs.existsSync(EXE)) { console.log('SKIP  volley.exe not found'); process.exit(0); }
if (!puppeteer || !CHROME) { console.log('SKIP  no Chrome or no puppeteer (set CHROME=)'); process.exit(0); }

H.budget(arg('timeout', 420) * 1000);
fs.mkdirSync(OUT, { recursive: true });

const DOWN = 40, UP = 38, ENTER = 13;
const A = 65, RIGHT = 39;
const KEYNAME = { 40: 'ArrowDown', 38: 'ArrowUp', 13: 'Enter', 65: 'a', 39: 'ArrowRight' };
const load = () => os.loadavg().map(v => v.toFixed(2)).join(' ');

// ---------------------------------------------------------------- page code
//
// Injected into each page. Kept here as source strings because they run in the
// browser, not in node: a rest position and a cheap per-sample blob read.
//
// The probe deliberately reads only every 8th scanline of the court's lower
// band. A full-band getImageData at sampling rate is itself a load on the main
// thread we are trying to measure, and the blobs are ~40px tall -- eight rows
// apart still lands several samples on one.

const PAGE_PROBE = `
window.__lagProbe = {
  band: [0.64, 0.98],
  read() {
    const app = (typeof runningApps !== 'undefined' && runningApps[0]) || null;
    if (!app) return null;
    const r = app.wine && app.wine.renderer;
    if (!r || !r.windows) return null;
    const win = Object.values(r.windows)
      .filter(w => w && w.visible && !w.isChild)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!win) return null;
    const surface = r.getWindowCanvas(win.hwnd);
    if (!surface || !surface.canvas) return null;
    const c = surface.canvas;
    const y0 = Math.floor(c.height * this.band[0]);
    const y1 = Math.floor(c.height * this.band[1]);
    const d = surface.ctx.getImageData(0, y0, c.width, y1 - y0).data;
    let rn = 0, rx = 0, gn = 0, gx = 0;
    const stride = c.width * 4 * 8;
    for (let row = 0; row < d.length; row += stride) {
      for (let i = row; i < row + c.width * 4 && i < d.length; i += 4) {
        const x = (i % (c.width * 4)) / 4;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        if (Math.abs(R - 200) <= 70 && Math.abs(G - 30) <= 70 && Math.abs(B - 30) <= 70) { rn++; rx += x; }
        else if (Math.abs(R - 30) <= 70 && Math.abs(G - 210) <= 70 && Math.abs(B - 30) <= 70) { gn++; gx += x; }
      }
    }
    return {
      red: rn < 12 ? null : rx / rn / c.width,
      green: gn < 12 ? null : gx / gn / c.width,
    };
  },
  samples: [],
  timer: null,
  start() {
    this.samples = [];
    if (this.timer) clearInterval(this.timer);
    // 25ms: fine enough to time a move against a 60Hz picture, coarse enough
    // that the probe is not itself a frame's worth of work.
    this.timer = setInterval(() => {
      const v = this.read();
      if (v) this.samples.push([performance.timeOrigin + performance.now(), v.red, v.green]);
    }, 25);
  },
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; return this.samples; },
};
`;

// A page is "showing the main menu" when its surface has real variety on it.
// Brightness cannot be used: Blobby's menu is a night beach that is nearly
// black, and a flat pre-menu fill would score the same.
const menuDrawn = () => {
  const app = (typeof runningApps !== 'undefined' && runningApps[0]) || null;
  if (!app) return 0;
  const r = app.wine && app.wine.renderer;
  if (!r || !r.windows) return 0;
  const win = Object.values(r.windows)
    .filter(w => w && w.visible && !w.isChild)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!win) return 0;
  const surface = r.getWindowCanvas(win.hwnd);
  if (!surface || !surface.canvas) return 0;
  const c = surface.canvas;
  const d = surface.ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 37) {
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (seen.size > 64) return seen.size;
  }
  return 0;
};

const wireOf = () => {
  const app = (typeof runningApps !== 'undefined' && runningApps[0]) || null;
  if (!app || !app.wine || !app.wine.vlanWire) return null;
  return { sent: app.wine.vlanWire.sentFrames, recv: app.wine.vlanWire.recvFrames };
};

const perfOf = () => {
  if (!window.WinePerf || typeof window.WinePerf.snapshot !== 'function') return null;
  try { return window.WinePerf.snapshot(); } catch (e) { return { error: String(e) }; }
};

// ------------------------------------------------------------------- driving

async function keys(page, list, gap = 900) {
  for (const vk of list) {
    await page.keyboard.down(KEYNAME[vk]);
    await H.sleep(60);
    await page.keyboard.up(KEYNAME[vk]);
    await H.sleep(gap);
  }
}

// Two separate processes, not two contexts of one: a real pair of windows is
// what the report was about, and one renderer process hosting both would share
// a main thread they do not share in practice.
async function openBrowser(label, base, x, y, headless) {
  const browser = await puppeteer.launch({
    headless,
    executablePath: CHROME,
    args: [
      '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      `--window-position=${x},${y}`, '--window-size=760,640',
    ],
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 740, height: 560, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', e => problems.push(String(e)));
  page.on('console', m => {
    const t = m.text();
    if (/UNIMPLEMENTED API:|RuntimeError|LinkError|crashed|FATAL:/i.test(t)) problems.push(t.slice(0, 200));
  });
  // ?debug&perf is what creates window.WinePerf; without it the seam is null.
  await page.goto(`${base}/index.html?debug&perf`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('typeof launchApp === "function"', { timeout: 60000 });
  await page.evaluate(() => {
    document.getElementById('app-select').value = 'blobby_volley';
    window.__launching = launchApp();
  });
  return { label, browser, page, problems };
}

async function waitForMenu(side) {
  const t0 = Date.now();
  const colours = await H.until(side.page, `${side.label}: no main menu`,
    menuDrawn, null, MILESTONE_MS);
  console.log(`  ${side.label}: main menu after ${((Date.now() - t0) / 1000).toFixed(1)}s`
    + ` (${colours || 0} colours)`);
  return !!colours;
}

// ---------------------------------------------------------------- measuring

async function sampleA(sides, seconds) {
  const series = sides.map(() => []);
  for (let t = 0; t < seconds; t++) {
    await H.sleep(1000);
    for (let i = 0; i < sides.length; i++) {
      const [perf, wire] = await Promise.all([
        sides[i].page.evaluate(perfOf),
        sides[i].page.evaluate(wireOf),
      ]);
      series[i].push({ perf, wire });
    }
  }
  return series;
}

const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
};
const median = xs => (xs.length ? pct(xs, 50) : NaN);

function reportA(label, samples) {
  const num = (f) => samples.map(f).filter(v => Number.isFinite(v));
  const p50 = num(s => s.perf && s.perf.stepMs && s.perf.stepMs.p50);
  const p99 = num(s => s.perf && s.perf.stepMs && s.perf.stepMs.p99);
  const fps = num(s => s.perf && (s.perf.guestFps !== undefined ? s.perf.guestFps : s.perf.fps));
  const blocks = num(s => s.perf && s.perf.blocksPerSec);
  const thr = num(s => s.perf && s.perf.throttledPct);
  const longs = num(s => s.perf && s.perf.longTasks);
  // The phase split is the answer to "whose fault": phaseMs sums one
  // sampling window, so the shares are what matter, not the milliseconds.
  const phase = (k) => num(s => s.perf && s.perf.phaseMs && s.perf.phaseMs[k]);
  const shares = () => {
    const m = median(phase('main')), w = median(phase('workers'));
    const p = median(phase('present')), o = median(phase('other'));
    const tot = [m, w, p, o].reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    if (!tot) return '';
    const s = v => `${Math.round((v / tot) * 100)}%`;
    return `  guest ${s(m)} threads ${s(w)} paint ${s(p)} other ${s(o)}`;
  };
  const first = samples.find(s => s.wire), last = [...samples].reverse().find(s => s.wire);
  const dt = samples.length;
  console.log(`  ${label.padEnd(7)} step p50 ${median(p50).toFixed(1)}ms  p99 ${median(p99).toFixed(1)}ms`
    + `  present ${median(fps).toFixed(1)}/s`
    + (blocks.length ? `  ${(median(blocks) / 1e6).toFixed(1)}M blocks/s` : ''));
  console.log(`  ${''.padEnd(7)}${shares()}`
    + (thr.length ? `  throttled ${median(thr).toFixed(0)}%` : '')
    + (longs.length ? `  longTasks ${median(longs)}` : ''));
  console.log(`  ${''.padEnd(7)}`
    + (first && last && first.wire && last.wire
      ? `wire +${last.wire.sent - first.wire.sent} sent / +${last.wire.recv - first.wire.recv} recv in ${dt}s`
      : 'wire n/a'));
}

// Measurement B. Hold a key on one side; both pages are already sampling their
// own screens against the shared epoch clock. Afterwards, find on each series
// the first sample where that blob has moved past a threshold, and subtract.
//
// The threshold is in court widths. A blob is about 0.08 wide, so 0.02 is a
// clear move and well outside the sampling jitter of a stationary blob.
const MOVE = 0.02;

function firstMove(samples, which, t0) {
  const idx = which === 'red' ? 1 : 2;
  const base = samples.filter(s => s[0] <= t0 && s[idx] !== null).slice(-4).map(s => s[idx]);
  if (!base.length) return null;
  const rest = base.reduce((a, b) => a + b, 0) / base.length;
  for (const s of samples) {
    if (s[0] <= t0 || s[idx] === null) continue;
    if (Math.abs(s[idx] - rest) >= MOVE) return s[0];
  }
  return null;
}

async function measureB(presser, other, vk, which, reps) {
  const out = [];
  for (let i = 0; i < reps; i++) {
    await Promise.all([presser, other].map(s => s.page.evaluate('window.__lagProbe.start()')));
    await H.sleep(700);                    // a rest baseline on both series
    const t0 = Date.now();
    await presser.page.keyboard.down(KEYNAME[vk]);
    await H.sleep(1800);
    await presser.page.keyboard.up(KEYNAME[vk]);
    await H.sleep(400);
    const [ownS, peerS] = await Promise.all(
      [presser, other].map(s => s.page.evaluate('window.__lagProbe.stop()')));
    const own = firstMove(ownS, which, t0);
    const peer = firstMove(peerS, which, t0);
    out.push({
      own: own === null ? null : own - t0,
      peer: peer === null ? null : peer - t0,
      lag: (own === null || peer === null) ? null : peer - own,
    });
    await H.sleep(900);
  }
  return out;
}

function reportB(label, reps) {
  const fmt = v => (v === null || v === undefined ? '  --  ' : `${Math.round(v)}ms`.padStart(6));
  for (const r of reps) {
    console.log(`  ${label}  own ${fmt(r.own)}   peer ${fmt(r.peer)}   lag ${fmt(r.lag)}`);
  }
  const lags = reps.map(r => r.lag).filter(v => v !== null);
  const misses = reps.filter(r => r.own === null || r.peer === null).length;
  console.log(`  ${label}  median lag ${lags.length ? `${Math.round(median(lags))}ms` : 'n/a'}`
    + ` over ${lags.length}/${reps.length} reps`
    + (misses ? `  (${misses} rep(s) saw no move on one side)` : ''));
  return lags.length ? median(lags) : null;
}

// --------------------------------------------------------------------- main

(async () => {
  console.log(`loadavg before: ${load()}   cpus: ${os.cpus().length}`);
  if (os.loadavg()[0] > 4) {
    console.log('WARNING  this box is loaded; treat every timing below as a '
      + 'measurement of the machine, not of the emulator.');
  }

  const server = createServer({ quiet: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headless = flag('headless');
  const browsers = [];

  try {
    const host = await openBrowser('host', base, 0, 0, headless);
    browsers.push(host);
    const guest = await openBrowser('guest', base, 780, 0, headless);
    browsers.push(guest);
    const sides = [host, guest];

    if (!(await waitForMenu(host)) || !(await waitForMenu(guest))) {
      throw new Error('a browser never drew the main menu');
    }
    await H.sleep(MENU_MS);

    // Same walk the RTC gate uses: NETZWERKSPIEL is one down from the top of
    // an untouched main menu.
    await keys(host.page, [DOWN, ENTER, ENTER, DOWN, DOWN, ENTER]);
    await keys(guest.page, [DOWN, ENTER, DOWN, ENTER, DOWN, DOWN, ENTER]);

    const lobbyOpen = s => H.until(s.page, `${s.label}: no lobby`,
      () => document.querySelectorAll('.vln-lobby').length > 0, null, 60000);
    if (!(await lobbyOpen(host)) || !(await lobbyOpen(guest))) {
      throw new Error('a browser never asked for a room');
    }
    const peerRows = s => s.page.evaluate(() => document.querySelectorAll('.vln-peer').length);
    for (let i = 0; i < 60 && !((await peerRows(host)) && (await peerRows(guest))); i++) {
      await H.sleep(1000);
    }
    if (!((await peerRows(host)) && (await peerRows(guest)))) {
      throw new Error('the two browsers never saw each other in the lobby');
    }
    await host.page.evaluate(() => document.querySelector('.vln-peer button').click());
    const wired = s => H.until(s.page, `${s.label}: never got a wire`,
      () => runningApps.length > 0 && !!runningApps[0].wine.vlanWire, null, MILESTONE_MS);
    if (!(await wired(host)) || !(await wired(guest))) throw new Error('no data channel');
    await H.sleep(2500);
    const found = await H.until(guest.page, 'the search got no answer',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w && w.recvFrames > 0; },
      null, MILESTONE_MS);
    if (!found) throw new Error('the guest never saw the host session');
    await H.sleep(2000);
    await keys(guest.page, [UP, ENTER]);
    await H.sleep(6000);
    console.log('  match joined; both windows should now be playing');

    for (const s of sides) await s.page.evaluate(PAGE_PROBE);

    console.log(`\n== A: is each emulator keeping up? (${SECONDS}s) ==`);
    const seriesA = await sampleA(sides, SECONDS);
    reportA('host', seriesA[0]);
    reportA('guest', seriesA[1]);

    console.log(`\n== B: how long until the OTHER screen shows the move? ==`);
    console.log('  (own = presser\'s own screen, peer = the other machine)');
    const hostReps = await measureB(host, guest, A, 'red', REPS);
    const hostLag = reportB('host drives player one ', hostReps);
    const guestReps = await measureB(guest, host, RIGHT, 'green', REPS);
    const guestLag = reportB('guest drives player two', guestReps);

    await host.page.screenshot({ path: path.join(OUT, 'host.png') });
    await guest.page.screenshot({ path: path.join(OUT, 'guest.png') });

    console.log(`\nloadavg after:  ${load()}`);
    const lags = [hostLag, guestLag].filter(v => v !== null);
    if (lags.length) {
      const worst = Math.max(...lags);
      console.log(`\nVERDICT  cross-machine lag ${Math.round(worst)}ms (worst of the two directions)`);
      console.log(worst < 120
        ? '         that is within a frame or two -- the wire is not the problem.'
        : '         that is visible lag. Compare with the A rows above: both '
          + 'sides keeping up means the wire; a starved A means throughput.');
    } else {
      console.log('\nVERDICT  could not time a move on both screens; see the captures in '
        + path.relative(ROOT, OUT));
    }
    for (const s of sides) {
      if (s.problems.length) console.log(`  ${s.label} page problems: ${s.problems.slice(0, 3).join(' | ')}`);
    }
  } finally {
    // Orphaned Chromium outlives a killed node and then competes with the next
    // run for the same cores, which is its own measurement bug.
    if (!flag('keep')) for (const b of browsers) { try { await b.browser.close(); } catch (_) {} }
    server.close();
  }
})().catch(err => { console.error(String(err && err.stack || err)); process.exit(1); });
