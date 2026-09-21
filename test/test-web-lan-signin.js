#!/usr/bin/env node
// Signed out, online play has to say so and offer a way in.
//
//   node test/test-web-lan-signin.js [--headful]
//
// Berrry's signaling API answers 401 to a browser with no account, and
// until now the page's only reaction was a notice with an OK button. This
// runs the dev server with --require-login (tools/dev-server.js), so the
// signed-out paths are real, and drives four browsers, each its own
// cookie jar:
//
//   host      signs in and opens a room: the room a link can name
//   invited   opens that room link signed out: the sign-in card says it was
//             invited, Sign in goes to the login page, and signing in comes
//             back to the same link, now able to see the room
//   offline   signed out, no link: launching asks nothing; when the game goes
//             online the card appears, and Play offline lets the game go on
//   resumed   a login that returns to the site root instead of the link: the
//             page goes on to the link it left from (sessionStorage)

'use strict';

const fs = require('fs');
const { createServer } = require('../tools/dev-server');
const H = require('./hearts-web-helper');

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (_) {}
const CHROME = H.findChrome();
const flag = name => process.argv.includes(`--${name}`);
const MILESTONE_MS = 90000;

let passed = 0;
let failed = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail && !ok ? ` -- ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

if (!puppeteer || !CHROME) {
  console.log('SKIP  puppeteer or Chrome not available');
  process.exit(0);
}
if (!fs.existsSync(require('path').join(__dirname, '..', 'packages', 'freeware', 'blobby-volley', 'volley.exe'))) {
  console.log('SKIP  volley.exe not found');
  process.exit(0);
}

(async () => {
  const server = createServer({ quiet: true, requireLogin: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    headless: !flag('headful'),
    executablePath: CHROME,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
  });
  const problems = [];
  const context = async () => {
    const ctx = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 760, deviceScaleFactor: 1 });
    page.on('pageerror', e => problems.push(String(e)));
    return page;
  };
  const shellReady = page => page.waitForFunction('typeof launchApp === "function"', { timeout: 60000 });
  const card = page => page.evaluate(() => {
    const c = document.getElementById('wine-lan-signin');
    return c ? c.textContent : null;
  });
  const click = (page, choice) => page.evaluate(c =>
    document.querySelector(`#wine-lan-signin button[data-choice="${c}"]`).click(), choice);

  try {
    // ---- host: signed in, with a room open --------------------------------
    const host = await context();
    await host.goto(`${base}/api/auth/login?return=${encodeURIComponent('/index.html')}`);
    const status = await host.evaluate(async () => (await fetch('/api/auth/user')).status);
    await Promise.all([host.waitForNavigation(), host.click('#dev-sign-in')]);
    await shellReady(host);
    const owner = await host.evaluate(async () => {
      window.__room = await VlanRoom.openRoom({ join: { exe: 'volley.exe' } });
      return { id: window.__room.ownerUserId, role: window.__room.role };
    });
    check(`the host signed in and owns a room (${owner.role})`, owner.role === 'owner' && !!owner.id);
    check('signed out, the API answered 401 before that', status === 401, String(status));

    // ---- invited: a room link, signed out ----------------------------------
    const link = `${base}/index.html?app=blobby_volley&room=${owner.id}`;
    const invited = await context();
    await invited.goto(link, { waitUntil: 'load', timeout: 60000 });
    const asked = await H.until(invited, 'invited: no sign-in card', () =>
      !!document.getElementById('wine-lan-signin'), null, 60000);
    const text = await card(invited);
    check(`the room link asks to sign in, and says why (${text})`,
      !!asked && /invited/.test(text || '') && /Sign in/.test(text || ''));
    check('nothing launched behind the card',
      await invited.evaluate(() => runningApps.length) === 0);
    await Promise.all([invited.waitForNavigation(), click(invited, 'signin')]);
    check(`Sign in went to the login page (${new URL(invited.url()).pathname})`,
      new URL(invited.url()).pathname === '/api/auth/login');
    await Promise.all([invited.waitForNavigation(), invited.click('#dev-sign-in')]);
    check('signing in came back to the same room link', invited.url() === link, invited.url());
    await shellReady(invited);
    const booted = await H.until(invited, 'invited: never launched after signing in',
      () => runningApps.length > 0, null, MILESTONE_MS);
    check('back from signing in, the game launched from the link', !!booted);
    check('and was not asked to sign in again', (await card(invited)) === null);
    const sees = await invited.evaluate(async id => {
      const rooms = await VlanRoom.hostedRooms({ join: { exe: 'volley.exe' }, includeIdle: true });
      return rooms.some(r => r.userId === id);
    }, owner.id);
    check('signed in, it can see the host\'s room', sees);

    // ---- offline: signed out, no link ---------------------------------------
    const offline = await context();
    await offline.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await shellReady(offline);
    await offline.evaluate(() => {
      document.getElementById('app-select').value = 'blobby_volley';
      launchApp();
    });
    await H.until(offline, 'offline: never launched', () => runningApps.length > 0, null, MILESTONE_MS);
    await H.sleep(3000);
    check('launching signed out asks nothing', (await card(offline)) === null);
    // What NETZWERKSPIEL's DirectPlay call does, without walking the menus.
    await offline.evaluate(() => { wine.openLanLink(4); });
    await H.until(offline, 'offline: no sign-in card when the game went online', () =>
      !!document.getElementById('wine-lan-signin'), null, 30000);
    const plain = await card(offline);
    check(`going online signed out shows the sign-in card (${plain})`,
      !!plain && !/invited/.test(plain));
    await click(offline, 'offline');
    const done = await H.until(offline, 'offline: the game\'s call was never answered',
      () => wine._lanAsk && wine._lanAsk.state === 'done', null, 30000);
    check('Play offline answers the game and stays on the page',
      !!done && new URL(offline.url()).pathname === '/index.html');

    // ---- resumed: a login that lands on the site root ----------------------
    const resumed = await context();
    await resumed.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await resumed.evaluate(url => sessionStorage.setItem('wine-lan-signin-return', url), link);
    await resumed.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
    await H.until(resumed, 'resumed: stayed on the root',
      () => /[?&]room=/.test(location.search), null, 30000);
    check('back on the root, the page went on to the room link', resumed.url() === link, resumed.url());
    check('and spent the note', await resumed.evaluate(() =>
      sessionStorage.getItem('wine-lan-signin-return')) === null);

    check('no page reported an error', problems.length === 0, problems.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
