#!/usr/bin/env node
// The LAN session chip (a globe) (lib/browser-shell.js over lib/session-chips.js),
// driven with a stand-in room so it needs no game and no second browser:
//
//   node test/test-web-lan-chip.js
//
//   - an event is held in the chip's text, then it settles to a summary
//   - the element keeps the old toast's id (#wine-lan-chip) and text, which
//     test-web-blobby-rtc.js and test-web-quake2-room.js read
//   - an owner's chip counts players and its menu lists them, with recent events
//   - Copy invite link copies ?app=…&room=<owner id>
//   - Leave room closes the room, stops the join offers and removes the chip
//   - a member's chip names the host
//   - the chip floats left of the round exit-fullscreen button, never over it
//
// Real rooms are the two-browser tests' job; this pins the chip itself.
// Screenshots go to build/lan-chip/.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(ROOT, 'build', 'lan-chip');
// A free port, not a fixed one: other sessions on this box run dev-servers.
const PORT = Number(execFileSync(process.execPath, ['-e',
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());

if (!fs.existsSync(CHROME)) { console.log('SKIP  Chrome not found'); process.exit(0); }
let puppeteer;
try { puppeteer = require('puppeteer'); } catch (_) { console.log('SKIP  puppeteer not installed'); process.exit(0); }

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failed = true;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(what, fn, ms) {
  const deadline = Date.now() + (ms || 10000);
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const server = spawn('node', [path.join(ROOT, 'tools', 'dev-server.js'), `--port=${PORT}`, '--quiet'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', d => { serverOut += d; });
server.stderr.on('data', d => { serverOut += d; });
let browser = null;

(async () => {
  await until('dev-server', () => serverOut.includes('dev server:') || server.exitCode !== null, 60000);
  if (!serverOut.includes('dev server:')) throw new Error(`dev-server did not start:\n${serverOut}`);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(`http://127.0.0.1:${PORT}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 700 });
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.browserShell && window.browserShell.lanSessionChip, { timeout: 20000 });

  const chip = () => page.evaluate(() => {
    const el = document.getElementById('wine-lan-chip');
    const icon = el && el.querySelector('[data-icon]');
    return el ? { text: el.textContent, placement: window.wineSession.placement(), data: el.dataset.chip,
      icon: icon && icon.dataset.icon } : null;
  });
  const menuText = async () => {
    await page.click('#wine-lan-chip');
    const t = await until('LAN menu', () => page.evaluate(() => {
      const m = document.querySelector('.wa-chip-menu[data-chip=lan]');
      return m ? m.innerText : null;
    }), 3000);
    return t;
  };
  const clickItem = text => page.evaluate((t) => {
    const it = [...document.querySelectorAll('.wa-chip-menu[data-chip=lan] .it')].find(el => el.textContent.includes(t));
    if (it) it.click();
    return !!it;
  }, text);

  // ---- an owner's room ------------------------------------------------------
  await page.evaluate(() => {
    const members = new Map();
    window.__room = {
      role: 'owner', address: '10.0.0.1', ownerUserId: 'owner-uid-1', members, closed: false,
      close() { this.closed = true; return Promise.resolve(); },
    };
    window.__wine = { _lanRoom: window.__room, _lanOffers: setInterval(() => {}, 100000) };
    const lan = window.browserShell.lanSessionChip;
    lan.show('◌ LAN · Blobby Volley room open — waiting for players', 0);
    lan.attach(window.__wine, window.__room, { lan: { label: 'Blobby Volley' } }, 'blobby_volley');
  });
  const open = await until('owner chip', async () => { const c = await chip(); return c && /room open/.test(c.text) ? c : null; });
  check('a room open shows the globe in the tray with the old toast\'s id and text',
    open.data === 'lan' && open.placement === 'tray' && open.icon === 'lan' && /waiting for players/.test(open.text)
      && !/LAN ·/.test(open.text), JSON.stringify(open));

  await page.evaluate(() => {
    window.__room.members.set('u2', { seat: '10.0.0.2', peer: { name: 'alex' } });
    window.browserShell.lanSessionChip.show('● LAN · alex joined (2 here)', 400);
  });
  const joined = await chip();
  check('an event is held in the chip\'s text', /alex joined/.test(joined.text), JSON.stringify(joined));
  // In the tray the summary is short: the globe and the head count.
  const settled = await until('summary', async () => { const c = await chip(); return c.text.trim() === '2' ? c : null; }, 3000).catch(() => null);
  check('then it settles to a short summary that counts players', !!settled, JSON.stringify(await chip()));

  await page.evaluate(() => document.body.classList.add('single-app', 'app-running'));
  const floated = await until('float', async () => { const c = await chip(); return c.placement === 'float' ? c : null; }, 3000).catch(() => null);
  check('without a taskbar it floats and spells the summary out',
    !!floated && /Blobby Volley · 2 players/.test(floated.text), JSON.stringify(floated));

  // The icons are RetroDiffusion pixel art from the deployed site, not emoji:
  // this needs the network, and a fallback emoji here means the image failed.
  const icons = await until('icons decoded', () => page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#wa-chips img.wa-icon')];
    return imgs.length && imgs.every(i => i.complete && i.naturalWidth === 32)
      ? imgs.map(i => i.src.replace(/\?.*/, '')).join(' ') : null;
  }), 15000).catch(() => null);
  check('chip icons are RetroDiffusion images from wine-assembly.berrry.app',
    !!icons && /^https:\/\/wine-assembly\.berrry\.app\/api\/retrodiffusion\//.test(icons), String(icons));

  const ownerMenu = await menuText();
  check('the owner\'s menu says whose room, lists the players and recent events',
    /your room/.test(ownerMenu) && /10\.0\.0\.1 \(host\)/.test(ownerMenu) && /alex · 10\.0\.0\.2/.test(ownerMenu)
      && /alex joined/.test(ownerMenu) && /Copy invite link/.test(ownerMenu) && /Close room, keep playing/.test(ownerMenu), ownerMenu);
  await shot('1-owner-menu');

  await clickItem('Copy invite link');
  const copied = await until('clipboard', () => page.evaluate(() => navigator.clipboard.readText().catch(() => '')), 3000).catch(() => '');
  check('Copy invite link copies ?app=…&room=<owner id>',
    /[?&]app=blobby_volley/.test(copied) && /[?&]room=owner-uid-1/.test(copied), copied);

  // Clear of the exit-fullscreen button when the page is in its full-screen look.
  await page.evaluate(() => document.body.classList.add('page-fullscreen'));
  const overlap = await page.evaluate(() => {
    const a = document.getElementById('wa-chips').getBoundingClientRect();
    const b = document.getElementById('page-fullscreen-exit');
    if (!b) return 'no exit button';
    const r = b.getBoundingClientRect();
    if (!r.width) return 'exit button not shown';
    return a.right <= r.left || a.left >= r.right || a.bottom <= r.top || a.top >= r.bottom ? '' : `${JSON.stringify(a)} over ${JSON.stringify(r)}`;
  });
  check('the strip never covers the exit-fullscreen button', overlap === '', overlap);
  await shot('2-fullscreen');
  await page.evaluate(() => document.body.classList.remove('page-fullscreen'));

  await menuText();
  await clickItem('Close room');
  const left = await page.evaluate(() => ({
    closed: window.__room.closed, wineRoom: window.__wine._lanRoom, offers: window.__wine._lanOffers,
    chip: !!document.getElementById('wine-lan-chip'),
  }));
  check('Close room closes it, stops the join offers and removes the chip',
    left.closed && left.wineRoom === null && left.offers === null && !left.chip, JSON.stringify(left));

  // ---- a member's view ------------------------------------------------------
  await page.evaluate(() => {
    window.__room2 = { role: 'member', address: '10.0.0.3', ownerUserId: 'owner-uid-9', members: new Map(),
      owner: { name: 'sam', address: '10.0.0.1', userId: 'owner-uid-9' }, close() { this.closed = true; } };
    const lan = window.browserShell.lanSessionChip;
    lan.attach({ _lanRoom: window.__room2 }, window.__room2, { lan: { label: 'Quake II' } }, 'quake2');
  });
  const member = await until('member chip', async () => { const c = await chip(); return c && /sam's room/.test(c.text) ? c : null; }, 3000).catch(() => null);
  check('a member\'s chip names the host', !!member, JSON.stringify(await chip()));
  const memberMenu = await menuText();
  check('a member\'s menu offers Leave room', /sam's room/.test(memberMenu) && /sam · 10\.0\.0\.1 \(host\)/.test(memberMenu)
    && /Leave room, keep playing/.test(memberMenu), memberMenu);
  await shot('3-member-menu');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.browserShell.lanSessionChip.clear());
  check('clearing the room\'s notices removes the chip', !(await chip()), 'still there');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
})().catch((err) => {
  failed = true;
  console.log(`FAIL  ${err && err.message || err}`);
}).finally(async () => {
  try { if (browser) await browser.close(); } catch (_) {}
  server.kill();
  console.log(failed ? '\nFAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
});
