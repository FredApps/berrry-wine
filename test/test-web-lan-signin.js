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
//   listed    signed out, no link, while the host's game is serving: the
//             server list still shows it (rooms are public records), Join
//             goes to the login page, and signing in comes back to that
//             room's link and joins it
//   resumed   a login that returns to the site root instead of the link: the
//             page goes on to the link it left from (sessionStorage)
//   copy      the share card's Copy link on plain http from another host,
//             where navigator.clipboard does not exist: it still copies

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
    // lan.test is this server under a name that is not localhost, so the
    // page is not a secure context -- a phone on the LAN dev server.
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP lan.test 127.0.0.1'],
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
    const loginAt = new URL(invited.url());
    check(`Sign in went to the login page, asking to come back to the whole link (${loginAt.pathname})`,
      loginAt.pathname === '/api/auth/login' && loginAt.searchParams.get('return') === link,
      loginAt.searchParams.get('return'));
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

    // ---- popup: going online signs in without restarting the game ---------
    const popup = await context();
    await popup.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await shellReady(popup);
    await popup.evaluate(() => {
      document.getElementById('app-select').value = 'blobby_volley';
      launchApp();
    });
    await H.until(popup, 'popup: never launched', () => runningApps.length > 0, null, MILESTONE_MS);
    await popup.evaluate(() => { window.__wineBefore = wine; wine.openLanLink(2); });
    await H.until(popup, 'popup: no sign-in card', () =>
      !!document.getElementById('wine-lan-signin'), null, 30000);
    const opened = new Promise(resolve => popup.once('popup', resolve));
    await click(popup, 'signin');
    const login = await Promise.race([opened, H.sleep(10000).then(() => null)]);
    check('Sign in opened the login in a popup', !!login);
    if (login) {
      await login.waitForSelector('#dev-sign-in', { timeout: 30000 });
      const waiting = await popup.evaluate(() => !!document.getElementById('wine-lan-signin-wait'));
      check('the game waits with a "finish signing in" card', waiting);
      await Promise.all([login.waitForNavigation().catch(() => {}), login.click('#dev-sign-in')]);
      const online = await H.until(popup, 'popup: the game never went online',
        () => wine._lanAsk && wine._lanAsk.state === 'done' && !!wine._lanRoom, null, 60000);
      const same = await popup.evaluate(() => ({
        wine: window.__wineBefore === wine, apps: runningApps.length, path: location.pathname,
      }));
      check(`signed in from the popup, the same running game went online (${JSON.stringify(same)})`,
        !!online && same.wine && same.apps === 1 && same.path === '/index.html',
        await popup.evaluate(() => document.getElementById('log').textContent.slice(-400)));
    }

    // ---- blocked: no popup, the login comes back to the same game ----------
    const blocked = await context();
    await blocked.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await shellReady(blocked);
    await blocked.evaluate(() => {
      window.open = () => null;
      document.getElementById('app-select').value = 'blobby_volley';
      launchApp();
    });
    await H.until(blocked, 'blocked: never launched', () => runningApps.length > 0, null, MILESTONE_MS);
    await blocked.evaluate(() => { wine.openLanLink(2); });
    await H.until(blocked, 'blocked: no sign-in card', () =>
      !!document.getElementById('wine-lan-signin'), null, 30000);
    await Promise.all([blocked.waitForNavigation(), click(blocked, 'signin')]);
    const blockedLogin = new URL(blocked.url());
    const blockedBack = new URL(blockedLogin.searchParams.get('return') || 'http://x/');
    check(`popup blocked, Sign in went to the login, coming back to the game (${blockedBack.search})`,
      blockedLogin.pathname === '/api/auth/login' && blockedBack.searchParams.get('app') === 'blobby_volley');
    await Promise.all([blocked.waitForNavigation(), blocked.click('#dev-sign-in')]);
    await shellReady(blocked);
    const relaunched = await H.until(blocked, 'blocked: the game did not start after signing in',
      () => runningApps.length > 0 && /[?&]app=blobby_volley/.test(location.search), null, MILESTONE_MS);
    check('back from the login, the same game started again', !!relaunched, blocked.url());

    // ---- listed: the server list, read signed out ---------------------------
    await host.evaluate(() => window.__room.net.setHosting({ label: 'test match' }));
    const listed = await context();
    await listed.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await shellReady(listed);
    await listed.evaluate(() => {
      document.getElementById('app-select').value = 'blobby_volley';
      launchApp();
    });
    const row = await H.until(listed, 'listed: no server list signed out',
      id => !!document.querySelector(`#wine-lan-card .wine-lan-room[data-user-id="${id}"]`),
      owner.id, 30000);
    const note = await listed.evaluate(() => {
      const n = document.querySelector('#wine-lan-card .wine-lan-signin-note');
      return n ? n.textContent : null;
    });
    check(`signed out, the server list shows the host's room (${note})`,
      !!row && /sign in/i.test(note || ''));
    check('no Start my own room while signed out', await listed.evaluate(() =>
      !document.querySelector('#wine-lan-card button[data-choice="own"]')));
    await Promise.all([listed.waitForNavigation(), listed.evaluate(id =>
      document.querySelector(`#wine-lan-card .wine-lan-room[data-user-id="${id}"] button`).click(),
    owner.id)]);
    const listedLogin = new URL(listed.url());
    const back = new URL(listedLogin.searchParams.get('return') || 'http://x/');
    check(`Join went to the login page, coming back to that room (${back.search})`,
      listedLogin.pathname === '/api/auth/login' && back.searchParams.get('room') === owner.id
        && back.searchParams.get('app') === 'blobby_volley');
    await Promise.all([listed.waitForNavigation(), listed.click('#dev-sign-in')]);
    await shellReady(listed);
    const joined = await H.until(listed, 'listed: never joined after signing in',
      () => / room/.test(document.getElementById('log').textContent)
        && /you are 10\.0\.0\.[2-9]/.test(document.getElementById('log').textContent),
      null, MILESTONE_MS);
    check('signed in, it joined the room it picked', !!joined,
      await listed.evaluate(() => document.getElementById('log').textContent.slice(-400)));

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

    // ---- copy: Copy link where navigator.clipboard is missing -------------
    const copyPage = await context();
    const lanBase = base.replace('127.0.0.1', 'lan.test');
    await copyPage.goto(`${lanBase}/index.html?app=blobby_volley&room=${owner.id}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await copyPage.waitForFunction('window.browserShell && document.body', { timeout: 60000 });
    const insecure = await copyPage.evaluate(() => {
      // A desktop Chrome may offer navigator.share; a LAN phone test is the
      // copy path, so take it away.
      try { delete Navigator.prototype.share; } catch (_) {}
      window.__copied = null;
      document.addEventListener('copy', () => { window.__copied = String(document.getSelection()); });
      document.getElementById('wine-lan-signin')?.remove();
      window.browserShell.showShareCard({ lan: { label: 'Blobby Volley' } });
      return { secure: window.isSecureContext, clipboard: !!navigator.clipboard };
    });
    await copyPage.click('#wine-lan-share button:last-child');
    const copied = await copyPage.evaluate(() => ({
      text: document.querySelector('#wine-lan-share button:last-child').textContent,
      copied: window.__copied, href: location.href,
    }));
    check(`insecure page (secure=${insecure.secure}, clipboard=${insecure.clipboard}): Copy link copies the page link (${copied.text})`,
      !insecure.secure && copied.text === 'Copied' && copied.copied === copied.href,
      JSON.stringify(copied));

    check('no page reported an error', problems.length === 0, problems.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
