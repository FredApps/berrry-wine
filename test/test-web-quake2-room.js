#!/usr/bin/env node

// Quake II's star room, between two browsers: one hosts, the next is shown the
// server list and joins from it.
//
//   node test/test-web-quake2-room.js [--timeout=540] [--headful]
//
// Everything lib/vlan-room.js and lib/vlan-star.js do is covered in Node by
// test-vlan-star.js, and the probe against the real game by
// test-quake2-host-probe.js. What neither can see is the page: that the
// host's first socket() opens a room without asking anything, that its probe
// marks the room hosting in presence, that a second browser opening the game
// is shown the card before its game starts, and that Join launches it with
// +connect to the owner's seat over WebRTC. Each browser context is its own
// cookie, so its own signaling user, as two people are.
//
// A third browser says "Play offline", starts at the game's menu, and joins from
// the toast the shell shows it later. That join reaches a game already past
// its command line, so it goes through lan.join.inGame typing into Quake's
// console. It is also the three-player room where an unread UDP socket used
// to stall the wire. A fourth opens the host's page address, which names its
// room (?app=quake2_demo&room=USERID), and must land at the owner with no card.

'use strict';

const fs = require('fs');
const path = require('path');
const { createServer } = require('../tools/dev-server');
const H = require('./hearts-web-helper');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'test', 'binaries', 'candidates', 'quake-2-demo-installer',
  'installed-extracted', 'Install', 'Data', 'quake2.exe');
const OUT = path.join(ROOT, 'test', 'output', 'web-quake2-room');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const flag = name => process.argv.includes(`--${name}`);

const STARTED = Date.now();
let passed = 0;
let failed = 0;
function check(what, ok, detail) {
  const at = ((Date.now() - STARTED) / 1000).toFixed(0).padStart(4);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${at}s  ${what}${detail && !ok ? ` -- ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (_) {}
const CHROME = H.findChrome();
if (!fs.existsSync(EXE)) {
  console.log('SKIP  Quake II demo not installed at', EXE);
  process.exit(0);
}
if (!puppeteer || !CHROME) {
  console.log('SKIP  no Chrome or no puppeteer (set CHROME=)');
  process.exit(0);
}
H.budget(arg('timeout', 540) * 1000);
fs.mkdirSync(OUT, { recursive: true });
H.clearPngs(OUT);

// The software renderer: headless Chrome's WebGL is not what this is about,
// and ref_soft is the renderer the CLI gameplay gate uses.
const HOST_ARGS = '+set vid_ref soft +set deathmatch 1 +set maxclients 4 +map demo1';
const JOIN_ARGS = '+set vid_ref soft +menu_main';

const chipText = () => {
  const chip = document.getElementById('wine-lan-chip');
  return chip ? chip.textContent : '';
};
const cardText = () => {
  const card = document.getElementById('wine-lan-card');
  return card ? card.textContent : '';
};
const wireOf = () => {
  const w = runningApps[0] && runningApps[0].wine.vlanWire;
  return w ? {
    address: w.address, sent: w.sentFrames, recv: w.recvFrames,
    members: w.memberCount === undefined ? null : w.memberCount,
    forwarded: w.forwardedFrames === undefined ? null : w.forwardedFrames,
  } : null;
};
const snapWindow = () => {
  const win = Object.values(sharedRenderer.windows || {})
    .filter(w => w && w.visible && !w.isChild)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!win) return null;
  const surface = sharedRenderer.getWindowCanvas(win.hwnd);
  if (!surface || !surface.canvas) return null;
  const c = surface.canvas;
  const d = surface.ctx.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  const colours = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    if ((i & 0xfc) === 0) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  // The back-canvas may be an OffscreenCanvas, which has no toDataURL.
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  return { lit: lit / (d.length / 4), colours: colours.size, png: copy.toDataURL('image/png') };
};

(async () => {
  const server = createServer({ quiet: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    headless: !flag('headful'),
    executablePath: CHROME,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
  });

  const open = async (label, args, link, setup) => {
    const ctx = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 760, deviceScaleFactor: 1 });
    const problems = [];
    const lanLog = [];
    page.on('pageerror', e => problems.push(String(e)));
    page.on('console', m => {
      const t = m.text();
      if (/UNIMPLEMENTED API:|RuntimeError|LinkError|crashed|FATAL:/i.test(t)) {
        problems.push(t.slice(0, 300));
      }
    });
    if (link) {
      // A link launches the app from the page's own ?app= handler at load,
      // before anything here could run, so the arguments are swapped as the
      // registry is defined, and every card the page ever shows is counted.
      await page.evaluateOnNewDocument(a => {
        let apps;
        Object.defineProperty(window, 'wineApps', {
          configurable: true,
          get() { return apps; },
          set(v) {
            apps = v;
            if (v && v.APPS && v.APPS.quake2_demo) v.APPS.quake2_demo.args = a;
          },
        });
        // Cards other than the "Joining <host>'s game" progress card (be94aa32),
        // which a room link shows on purpose while it connects.
        window.__cards = 0;
        new MutationObserver(() => {
          const card = document.getElementById('wine-lan-card');
          if (card && !/^Joining /.test(card.textContent)) window.__cards++;
        }).observe(document, { childList: true, subtree: true });
      }, args);
      await page.goto(link, { waitUntil: 'load', timeout: 60000 });
      return { label, page, problems, lanLog, ctx };
    }
    await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('typeof launchApp === "function"', { timeout: 60000 });
    if (setup) await page.evaluate(setup);
    await page.evaluate(a => {
      window.wineApps.APPS.quake2_demo.args = a;
      document.getElementById('app-select').value = 'quake2_demo';
      window.__launching = launchApp();
    }, args);
    return { label, page, problems, lanLog, ctx };
  };
  const snap = async (side, name) => {
    const s = await side.page.evaluate(snapWindow);
    H.savePng(OUT, name, s && s.png);
    return s;
  };
  const debugLog = side => side.page.evaluate(() => {
    const pane = document.getElementById('log') || document.getElementById('debug-log');
    return pane ? pane.textContent.split('\n').filter(l => /LAN/.test(l)).join('\n') : '';
  });

  try {
    // ---- the host: a server, which goes online by itself ------------------
    const host = await open('host', HOST_ARGS);
    const hostChip = await H.until(host.page, 'host: never showed it was hosting',
      () => {
        const chip = document.getElementById('wine-lan-chip');
        const t = chip ? chip.textContent : '';
        return /hosting/.test(t) ? t : null;
      }, null, 300000);
    check('the host went online without being asked anything, and its room says it is hosting',
      !!hostChip, `chip: ${await host.page.evaluate(chipText)}`);
    if (hostChip) console.log(`  host chip: ${hostChip}`);
    check('the host is the room owner at 10.0.0.1',
      (await host.page.evaluate(wireOf) || {}).address === '10.0.0.1',
      JSON.stringify(await host.page.evaluate(wireOf)));
    if (!hostChip) {
      console.log(await debugLog(host));
      await snap(host, 'host-not-hosting');
      throw new Error('no hosting room to offer');
    }

    // ---- the joiner: offered the match before its game starts -------------
    // A second server that starts while the list is open, so the list has to
    // grow by itself. It is a presence record only -- nobody answers it --
    // which is also why the test then joins the real one by name.
    const guest = await open('guest', JOIN_ARGS, null, () => {
      const real = VlanRoom.hostedRooms;
      let calls = 0;
      VlanRoom.hostedRooms = async opts => {
        const rooms = await real(opts);
        if (++calls < 2) return rooms;
        return rooms.concat([{ userId: 'ghost-server', name: 'ghost', role: 'owner',
          address: '10.0.0.1', hosting: { label: 'ghost q2dm1 0/8' }, updatedAt: 1 }]);
      };
    });
    const card = await H.until(guest.page, 'guest: no server list',
      () => {
        const rows = document.querySelectorAll('#wine-lan-card .wine-lan-room');
        return rows.length ? Array.from(rows, r => r.textContent) : null;
      }, null, 60000);
    check(`the second browser was shown the server list before launching (${card ? JSON.stringify(card) : 'no list'})`,
      !!card && card.length === 1 && /demo1/.test(card[0]));
    check('with a way to continue offline', await guest.page.evaluate(() =>
      Array.from(document.querySelectorAll('#wine-lan-card button'))
        .some(x => x.textContent === 'Play offline')));
    check('and its game was not started behind the list',
      await guest.page.evaluate(() => runningApps.length === 0));
    const grown = await H.until(guest.page, 'guest: the list never refreshed',
      () => {
        const rows = document.querySelectorAll('#wine-lan-card .wine-lan-room');
        return rows.length === 2 ? Array.from(rows, r => r.textContent) : null;
      }, null, 15000);
    check(`a server that starts while the list is open appears in it (${grown ? JSON.stringify(grown) : 'no'})`,
      !!grown && grown.some(t => /ghost q2dm1/.test(t)) && grown.some(t => /demo1/.test(t)));
    await guest.page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#wine-lan-card .wine-lan-room'))
        .find(r => /demo1/.test(r.textContent) && !/ghost/.test(r.textContent));
      row.querySelector('button').click();
    });

    const joined = await H.until(guest.page, 'guest: never wired',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w ? w.address : null; },
      null, 60000);
    check(`Join put the guest in the room at a member seat (${joined})`, joined === '10.0.0.2');
    const args = await guest.page.evaluate(() => runningApps[0] && runningApps[0].wine._extraArgs);
    check(`Join launched straight at the owner, with no menu over the match (${args})`,
      /\+connect 10\.0\.0\.1\b/.test(args || '') && !/\+menu_main/.test(args || ''));

    // The client is in the game once usercmds flow both ways for a while.
    const flowing = await H.until(guest.page, 'guest: no traffic from the server',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w && w.recvFrames > 300 ? w.recvFrames : null; },
      null, 240000);
    const hw = await host.page.evaluate(wireOf);
    const gw = await guest.page.evaluate(wireOf);
    console.log(`  host wire ${JSON.stringify(hw)}\n  guest wire ${JSON.stringify(gw)}`);
    check(`the server's frames reach the joiner (${flowing || 0} received)`, !!flowing);
    check('the owner counts one member', hw && hw.members === 1);
    check('the joiner talks to the server too', gw && gw.sent > 50);

    await H.sleep(8000);
    const hp = await snap(host, 'host-match');
    const gp = await snap(guest, 'guest-match');
    const pct = s => (s ? `${(s.lit * 100).toFixed(0)}% lit, ${s.colours} colours` : 'no picture');
    check(`the joiner is in the level (${pct(gp)})`, !!gp && gp.lit > 0.3 && gp.colours > 40);
    console.log(`  host picture: ${pct(hp)}`);

    // ---- a third player, already playing when they take the offer --------
    //
    // "Play offline" on the list, so the game starts at its own menu with no room.
    // The shell keeps looking, offers the same host again as a toast, and a
    // Join there has to reach a game that is past its command line: the
    // recipe types `connect 10.0.0.1 into its console. Three players is also
    // the room the unread-UDP stall used to freeze.
    const third = await open('third', JOIN_ARGS);
    const offered = await H.until(third.page, 'third: no server list',
      () => !!document.getElementById('wine-lan-card'), null, 60000);
    if (offered) {
      await third.page.evaluate(() => {
        Array.from(document.querySelectorAll('#wine-lan-card button'))
          .find(x => x.textContent === 'Play offline').click();
      });
    }
    const running = await H.until(third.page, 'third: game never started',
      () => runningApps.length > 0 && !runningApps[0].wine.vlanWire, null, 60000);
    check('"Play offline" starts the game with no room', !!running);
    const toast = await H.until(third.page, 'third: no toast',
      () => { const c = document.getElementById('wine-lan-card'); return c ? c.textContent : null; },
      null, 90000);
    check(`the running game was offered the host as a toast (${toast ? JSON.stringify(toast) : 'none'})`,
      !!toast && /is hosting Quake II/.test(toast));
    if (toast) {
      await third.page.evaluate(() => {
        Array.from(document.querySelectorAll('#wine-lan-card button'))
          .find(x => /^Join /.test(x.textContent)).click();
      });
    }
    const thirdSeat = await H.until(third.page, 'third: never wired',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w ? w.address : null; },
      null, 60000);
    check(`the toast put the third player at the next seat (${thirdSeat})`, thirdSeat === '10.0.0.3');
    const thirdIn = await H.until(third.page, 'third: no traffic from the server',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w && w.recvFrames > 300 ? w.recvFrames : null; },
      null, 240000);
    check(`the typed connect reached the server (${thirdIn || 0} frames received)`, !!thirdIn);
    const threeUp = await H.until(host.page, 'host: never counted three',
      () => {
        const pane = document.getElementById('log');
        return pane && /hosting noname demo1 3\/4/.test(pane.textContent);
      }, null, 60000);
    check('the server counts three players', !!threeUp);
    const before = await guest.page.evaluate(wireOf);
    await H.sleep(6000);
    const after = await guest.page.evaluate(wireOf);
    check(`the first joiner kept receiving with three in the room (${before && after ? after.recv - before.recv : 0} frames in 6s)`,
      !!before && !!after && after.recv - before.recv > 20);
    const hw3 = await host.page.evaluate(wireOf);
    check('the owner counts two members', hw3 && hw3.members === 2, JSON.stringify(hw3));
    await H.sleep(4000);
    const tp = await snap(third, 'third-match');
    check(`the third player is in the level (${pct(tp)})`, !!tp && tp.lit > 0.3 && tp.colours > 40);

    // ---- a fourth, from a link naming the host's room ---------------------
    //
    // The link names the owner, so it is the person's answer already: the
    // game launches straight at the owner with no list at all. Nothing on
    // screen hands these out; the test builds one from the host's room.
    const ownerId = await host.page.evaluate(() => {
      const r = runningApps[0] && runningApps[0].wine._lanRoom;
      return r ? r.ownerUserId : null;
    });
    check(`the host's room names its owner (${ownerId})`, !!ownerId);
    // Sharing the page is the invite: its address names the room.
    const link = await host.page.evaluate(() => location.href);
    check(`the host's page address is the room's link (${link})`,
      !!ownerId && /[?&]app=quake2_demo\b/.test(link) && link.includes(`room=${ownerId}`));
    const guestLink = await guest.page.evaluate(() => location.href);
    check('and a member\'s page address names the same room',
      !!ownerId && guestLink.includes(`room=${ownerId}`), guestLink);
    check('and puts no invite button over the game',
      await host.page.evaluate(() => !document.getElementById('wine-lan-invite')));
    const fourth = link ? await open('fourth', JOIN_ARGS, link) : null;
    const fourthSeat = fourth && await H.until(fourth.page, 'fourth: never wired',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w ? w.address : null; },
      null, 60000);
    check(`the invite put the fourth player at the next seat (${fourthSeat})`, fourthSeat === '10.0.0.4');
    const fourthArgs = fourth && await fourth.page.evaluate(() => runningApps[0] && runningApps[0].wine._extraArgs);
    check(`and launched it straight at the owner (${fourthArgs})`,
      /\+connect 10\.0\.0\.1\b/.test(fourthArgs || '') && !/\+menu_main/.test(fourthArgs || ''));
    check('without showing a card', !!fourth && await fourth.page.evaluate(() => window.__cards === 0));
    const fourthIn = fourth && await H.until(fourth.page, 'fourth: no traffic from the server',
      () => { const w = runningApps[0] && runningApps[0].wine.vlanWire; return w && w.recvFrames > 300 ? w.recvFrames : null; },
      null, 240000);
    check(`the fourth player reached the server (${fourthIn || 0} frames received)`, !!fourthIn);

    const sides = [host, guest, third].concat(fourth ? [fourth] : []);
    for (const side of sides) {
      check(`${side.label}: no page errors`, side.problems.length === 0, side.problems.slice(0, 3).join(' | '));
    }
    for (const side of sides) console.log(`--- ${side.label} LAN log\n${await debugLog(side)}`);
  } catch (e) {
    check('the run completed', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`test-web-quake2-room: ${passed} passed, ${failed} failed (captures in ${OUT})`);
  process.exit(failed ? 1 : 0);
})();
