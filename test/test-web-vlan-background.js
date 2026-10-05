#!/usr/bin/env node

// A networked guest keeps running when its window is not in front.
//
//   node test/test-web-vlan-background.js [--headful] [--keep]
//
// host.js pauses a hidden tab's guest to save a phone's battery, which is
// right for a solitaire nobody is looking at and wrong for a game somebody
// else is playing against you: the peer's clock never stopped, it is waiting
// for records this side is no longer producing, and a lockstep game does not
// recover by itself. Two people testing on two devices always have one window
// out of the front, so this is the ordinary case, not an edge one -- and the
// resume path makes it worse by sliding the guest clock forward to hide the
// pause, which is precisely what must not happen when the other machine's
// clock kept going.
//
// What this pins is OUR decision, not the browser's throttling: the test sets
// document.hidden and fires visibilitychange, so timers here keep running at
// full speed. A real background tab is still clamped to about 1Hz whatever we
// decide, and what keeps a backgrounded match playable is the audio scheduler.
// "Does not pause" is the part we control, and the part that was broken.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer } = require('./static-server');
const H = require('./hearts-web-helper');

const ROOT = path.join(__dirname, '..');
const flag = name => process.argv.includes(`--${name}`);

let passed = 0;
let failed = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail && !ok ? ` -- ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

const CHROME = H.findChrome();
if (!CHROME) {
  console.log('SKIP  no Chrome (set CHROME=)');
  process.exit(0);
}
H.budget(180000);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.wat': 'text/plain', '.watx': 'text/plain', '.exe': 'application/octet-stream',
};

// document.hidden is read-only, so the test defines it over the top and fires
// the event our listener is registered for -- the same two things the browser
// does, minus the throttling it would also apply.
const setHidden = (hidden) => {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  Object.defineProperty(document, 'visibilityState',
    { value: hidden ? 'hidden' : 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

(async () => {
  const server = await startStaticServer({ root: ROOT, mimeTypes: MIME });
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web-vlan-bg-'));
  const browser = await puppeteer.launch({
    headless: !flag('headful'),
    executablePath: CHROME,
    userDataDir: profile,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 760, deviceScaleFactor: 1 });
    await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('typeof launchApp === "function"', { timeout: 60000 });
    await page.evaluate(`window.setHidden = ${setHidden.toString()};`);

    await page.evaluate(() => {
      document.getElementById('app-select').value = 'sol';
      launchApp();
    });
    const up = await H.until(page, 'the app never started',
      () => runningApps.length > 0 && !!runningApps[0].wine.running, null, 90000);
    check('an app is running', !!up);

    // Before anything is hidden: how fast does this app step when nobody has
    // touched it? An idle guest parks its own loop on purpose, so this is the
    // scale every later reading is judged against.
    const baseline = await page.evaluate(async () => {
      const wine = runningApps[0].wine;
      const from = wine._stepTicks | 0;
      await new Promise(r => setTimeout(r, 2000));
      return { slices: (wine._stepTicks | 0) - from, ticks: wine._stepTicks | 0 };
    });
    console.log(`  baseline in front: ${baseline.slices} slices/2s`);

    // Alone in its own room, a hidden guest should still pause: a phone in
    // somebody's pocket must not keep an emulator warm for nobody.
    const lonePause = await page.evaluate(() => {
      setHidden(true);
      const paused = !!runningApps[0].wine._hiddenPaused;
      setHidden(false);
      return { paused, resumed: !runningApps[0].wine._hiddenPaused };
    });
    check('an unnetworked guest still pauses when hidden', lonePause.paused);
    check('and resumes when the window comes back', lonePause.resumed);

    // The flag coming back is not the app coming back. An idle guest is
    // parked in its own poll timer, and that timer -- not a saved closure --
    // was the only reference to the loop; cancelling it on hide left nothing
    // to resume, so the app ran again never while still reporting running.
    const afterShow = await page.evaluate(async () => {
      const wine = runningApps[0].wine;
      const from = wine._stepTicks | 0;
      await new Promise(r => setTimeout(r, 2000));
      return (wine._stepTicks | 0) - from;
    });
    check(`an app hidden while idle really runs again (${afterShow} slices/2s)`,
      afterShow >= baseline.slices * 0.5, `baseline ${baseline.slices}`);

    // Joined to a room, it must not.
    const networked = await page.evaluate(() => {
      // The page keeps the shell object itself; joinPageSegment is on it,
      // not on window, because nothing in the UI needs a bare global.
      const link = shell.joinPageSegment();
      runningApps[0].wine.joinVlan(link.wire, link.address);
      setHidden(true);
      return { paused: !!runningApps[0].wine._hiddenPaused };
    });
    check('a guest in a virtual LAN room does NOT pause when hidden',
      !networked.paused);

    // And it is still stepping, not merely un-flagged. _stepTicks is the
    // counter to read: EIP is not, because an app idling in its message pump
    // sits at one address however hard the loop is running, which reads as a
    // dead emulator and is not one.
    // Compared against the same app in front, because an idle guest parks
    // its loop on purpose: an absolute slice rate would be measuring how
    // busy Solitaire is, not whether being hidden stopped it.
    const ran = await page.evaluate(async () => {
      const wine = runningApps[0].wine;
      const count = async () => {
        const from = wine._stepTicks | 0;
        await new Promise(r => setTimeout(r, 2000));
        return (wine._stepTicks | 0) - from;
      };
      setHidden(false);
      const visible = await count();
      setHidden(true);
      const hidden = await count();
      return { visible, hidden, stillHidden: document.hidden,
        running: !!wine.running, paused: !!wine._hiddenPaused,
        frozen: !!wine._frozen, parked: wine._pausedStep === null ? 'none' : 'held',
        ticks: wine._stepTicks | 0, worker: !!wine.guestWorker };
    });
    check(`hidden keeps the same pace as in front (${ran.hidden} vs ${ran.visible} slices/2s)`,
      ran.stillHidden === true && ran.visible > 0 && ran.hidden >= ran.visible * 0.5,
      JSON.stringify(ran));

    await page.evaluate(() => setHidden(false));
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
