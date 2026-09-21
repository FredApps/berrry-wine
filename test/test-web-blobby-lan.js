#!/usr/bin/env node

// Two copies of Blobby Volley in one browser tab, on the tab's own virtual LAN.
//
//   node test/test-web-blobby-lan.js [--timeout=300] [--headful] [--keep]
//
// test-blobby-vlan.js plays the match between two OS processes. This is the
// page: the room card's "Both players here", the tab's LoopbackSegment, and a
// DirectPlay thread that in a browser runs in a Worker and reaches the wire
// through the per-thread RPC block rather than a direct call.
//
// Both instances sit at the same coordinates, so each one is brought to the
// front through the taskbar before it is given keys, and every picture is read
// off the window's own back-canvas.
//
// The menu walk is the one test-blobby-vlan.js uses, driven by keyboard:
//   host:  Down Enter (NETZWERKSPIEL), Enter (EIN SPIEL HOSTEN...),
//          Down Down Enter (SPIEL BEGINNEN!)
//   guest: Down Enter, Down Enter (ALS GAST SPIELEN...),
//          Down Down Enter (SPIELE SUCHEN), then Up Enter on the session found.
//
// The evidence is the wire: frames crossing the tab segment in both directions
// once the guest has searched, and a steady stream afterwards, which only the
// game loop sends.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer } = require('./static-server');
const H = require('./hearts-web-helper');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'packages', 'freeware', 'blobby-volley', 'volley.exe');
const OUT = path.join(ROOT, 'test', 'output', 'web-blobby-lan');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const flag = name => process.argv.includes(`--${name}`);
const MILESTONE_MS = arg('milestone-timeout', 90) * 1000;
// How long the title and intro take before the main menu takes keys.
const MENU_MS = arg('menu-wait', 12) * 1000;

let passed = 0;
let failed = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail && !ok ? ` -- ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

const CHROME = H.findChrome();
if (!fs.existsSync(EXE)) {
  console.log('SKIP  volley.exe not found');
  process.exit(0);
}
if (!CHROME) {
  console.log('SKIP  no Chrome (set CHROME=)');
  process.exit(0);
}
H.budget(arg('timeout', 300) * 1000);
fs.mkdirSync(OUT, { recursive: true });
H.clearPngs(OUT);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.wat': 'text/plain', '.watx': 'text/plain', '.exe': 'application/octet-stream',
};

const DOWN = 40, UP = 38, ENTER = 13;

// The largest visible top-level window of one instance, read off its own
// back-canvas: a PNG, and the share of pixels that are not near-black (the
// menus are text on a dark beach, the match is sand and sky).
const snapWindow = (index) => {
  const app = runningApps[index];
  if (!app) return null;
  const base = (app.wine._hwndBase >>> 0) & 0xFFFF0000;
  const win = Object.values(sharedRenderer.windows || {})
    .filter(w => w && w.visible && !w.isChild && ((w.hwnd >>> 0) & 0xFFFF0000) === base)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!win) return null;
  const surface = sharedRenderer.getWindowCanvas(win.hwnd);
  if (!surface || !surface.canvas) return null;
  const c = surface.canvas;
  const d = surface.ctx.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  return { hwnd: win.hwnd >>> 0, w: c.width, h: c.height, lit: lit / (d.length / 4),
    png: copy.toDataURL('image/png') };
};

async function keys(page, list) {
  for (const vk of list) {
    await page.evaluate(k => sharedRenderer.handleKeyDown(k), vk);
    await H.sleep(150);
    await page.evaluate(k => sharedRenderer.handleKeyUp(k), vk);
    await H.sleep(900);
  }
}

async function snap(page, index, name) {
  const s = await page.evaluate(i => snapWindow(i), index);
  H.savePng(OUT, name, s && s.png);
  return s;
}

// The room card the game's own DirectPlay call opens (lib/browser-shell.js
// pickRoom); "Both players here" is its local choice.
const lobbyUp = page => page.evaluate(() =>
  !!document.querySelector('#wine-lan-card button[data-choice="local"]'));

// Wait for an instance at `index` to exist and put a window up.
async function awaitInstance(page, index, label) {
  const started = await H.until(page, `${label}: instance never started`,
    i => runningApps.length > i, index, MILESTONE_MS);
  if (!started) return false;
  return !!(await H.until(page, `${label}: no window`,
    i => !!snapWindow(i), index, MILESTONE_MS));
}

(async () => {
  const server = await startStaticServer({ root: ROOT, mimeTypes: MIME });
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web-blobby-lan-'));
  const browser = await puppeteer.launch({
    headless: !flag('headful'),
    executablePath: CHROME,
    userDataDir: profile,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
  });
  const problems = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', e => problems.push(String(e)));
    page.on('console', m => {
      const t = m.text();
      if (/UNIMPLEMENTED API:|RuntimeError|LinkError|crashed|FATAL:/i.test(t)) {
        problems.push(t.slice(0, 300));
      }
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('typeof launchApp === "function"', { timeout: 60000 });
    await H.installHelpers(page);
    await page.evaluate(`window.snapWindow = ${snapWindow.toString()};`);

    // ---- the host --------------------------------------------------------
    //
    // Launching is just launching now: somebody playing a two-player game on
    // one keyboard must never be asked who to connect to.
    const host = 0;
    await page.evaluate(() => {
      document.getElementById('app-select').value = 'blobby_volley';
      launchApp();
    });
    check('the host launched', await awaitInstance(page, host, 'host'));
    await H.sleep(MENU_MS);
    await snap(page, host, 'host-menu');
    check('no lobby before the guest asked for the network', !(await lobbyUp(page)));

    // SPIEL BEGINNEN! is the app's own DirectPlay Open, and that is what the
    // lobby waits for.
    await keys(page, [DOWN, ENTER, ENTER, DOWN, DOWN, ENTER]);
    const asked = await H.until(page, 'picking network play did not open the room card', () =>
      !!document.querySelector('#wine-lan-card button[data-choice="local"]'), null, MILESTONE_MS);
    check('picking network play opened the room card, with "Both players here"', !!asked);
    await page.evaluate(() => {
      document.querySelector('#wine-lan-card button[data-choice="local"]').click();
    });

    // The guest is the second copy the lobby starts on the same segment. It
    // is never asked anything, because it is launched already wired.
    const guest = 1;
    check('a second Blobby started without stopping the first',
      await awaitInstance(page, guest, 'guest')
      && await page.evaluate(() => runningApps.length) === 2);

    // The host's own Open was parked while the lobby was up; once it has a
    // wire the call returns and the app reaches "WARTE AUF EINEN GAST".
    await H.sleep(3000);
    await snap(page, host, 'host-waiting');

    const addresses = await page.evaluate(() => wireStats());
    check(`the two instances hold different room addresses (${addresses.map(a =>
      [24, 16, 8, 0].map(s => (a.ip >>> s) & 255).join('.')).join(', ')})`,
      addresses.length === 2 && addresses[0].ip !== addresses[1].ip
      && addresses[0].ip !== 0 && addresses[1].ip !== 0,
      JSON.stringify(addresses));

    await H.sleep(MENU_MS);
    await snap(page, guest, 'guest-menu');
    await keys(page, [DOWN, ENTER, DOWN, ENTER, DOWN, DOWN, ENTER]);

    // The search: ENUM_REQ out, ENUM_REPLY back -- the first frames on the
    // segment at all, since a host waiting alone sends nothing.
    const found = await H.until(page, 'no frames crossed the tab segment', () => {
      const s = runningApps.map(a => a.wine.vlanWire);
      return s.length === 2 && s.every(w => w && w.sentFrames > 0 && w.recvFrames > 0);
    }, null, MILESTONE_MS);
    check('the search crossed the tab segment both ways', !!found,
      JSON.stringify(await page.evaluate(() => wireStats())));
    await H.sleep(3000);
    await snap(page, guest, 'guest-found');
    await keys(page, [UP, ENTER]);

    // Joining is a handful of frames; a match is a stream of game records in
    // both directions. Take two readings apart and require both counters to
    // keep climbing on both sides.
    await H.sleep(8000);
    const a = await page.evaluate(() => wireStats());
    await H.sleep(5000);
    const b = await page.evaluate(() => wireStats());
    const flowing = a.length === 2 && b.length === 2
      && [0, 1].every(i => b[i].sent - a[i].sent > 10 && b[i].recv - a[i].recv > 10);
    check('game records stream both ways (the match is running)', flowing,
      JSON.stringify({ a, b }));

    const hostPic = await snap(page, host, 'host-match');
    const guestPic = await snap(page, guest, 'guest-match');
    check(`both windows show the court (${hostPic ? (hostPic.lit * 100).toFixed(0) : 0}% / ${
      guestPic ? (guestPic.lit * 100).toFixed(0) : 0}% lit)`,
      !!hostPic && !!guestPic && hostPic.lit > 0.5 && guestPic.lit > 0.5);

    await page.screenshot({ path: path.join(OUT, 'page.png') });
    check('the page reported no errors', problems.length === 0, problems.join(' | '));
    console.log(`\nfinal: ${JSON.stringify(await page.evaluate(() => wireStats()))}`);
    console.log(`Screenshots: ${OUT}`);
  } finally {
    if (!flag('keep')) await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error.stack || error);
  console.log(`\n${passed} passed, ${failed + 1} failed`);
  process.exit(1);
});
