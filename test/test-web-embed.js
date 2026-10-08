#!/usr/bin/env node
// A program inside a tweet: the X player card and the ?embed=1 page it frames.
//
// WHY: an app with `embed: true` in lib/apps.js publishes apps/<id>.html as a
// player card, so X shows its poster and, on a click, an iframe of
// `/?app=<id>&embed=1` on x.com's page. Two things have to hold there that a
// normal visit never tests. The tags: X plays nothing without card=player, an
// HTTPS player URL and its size. And the frame's way out: a direct ?app= link
// builds the Win98 desktop when the program exits, which inside someone
// else's page is a launcher for every other app in a 504x284 box. Embed mode
// shows "Play again" instead, and its links leave in a new tab.
//
// The frame is loaded from 127.0.0.1 into an about:blank parent, so it is a
// third-party, non-isolated frame the way it is on x.com.

'use strict';

const assert = require('assert');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { startStaticServer } = require('./static-server');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = 'winmine_wep';

function checkCardTags() {
  const { generatePages } = require('../tools/gen-site-pages');
  const pages = generatePages();
  const html = name => {
    const page = pages.find(p => p.name === name);
    assert(page, `${name} was not generated`);
    return page.content;
  };
  const meta = (doc, key) => {
    const m = doc.match(new RegExp(`<meta name="${key}" content="([^"]*)">`));
    return m ? m[1].replace(/&amp;/g, '&') : null;
  };
  const card = html(`apps/${APP}.html`);
  assert.strictEqual(meta(card, 'twitter:card'), 'player', 'an embed app page is a player card');
  assert(meta(card, 'twitter:site'), 'X requires twitter:site on a player card');
  const player = new URL(meta(card, 'twitter:player'));
  assert.strictEqual(player.protocol, 'https:', 'X only frames an HTTPS player');
  assert.strictEqual(player.searchParams.get('app'), APP);
  assert.strictEqual(player.searchParams.get('embed'), '1');
  assert.strictEqual(meta(card, 'twitter:player:width'), '1280');
  assert.strictEqual(meta(card, 'twitter:player:height'), '720');
  assert(/-player\.png$/.test(meta(card, 'twitter:image')), 'the poster is the 16:9 player image');
  // An app without the flag keeps the large-image card: a player card for a
  // 60 MB game would start that download inside the tweet.
  assert.strictEqual(meta(html('apps/sol.html'), 'twitter:card'), 'summary_large_image');
  assert(!pages.some(p => p.name === 'play/sol.html'), 'no share link for an app that is not embeddable');
  console.log('PASS  embed app page carries player-card tags; others keep summary_large_image');

  // The share link: same card, and a person goes straight into the program.
  const play = html(`play/${APP}.html`);
  assert.strictEqual(meta(play, 'twitter:card'), 'player');
  assert.strictEqual(meta(play, 'twitter:player'), meta(card, 'twitter:player'));
  assert(play.includes(`location.replace("/?app=${APP}")`), 'the share link sends a visitor into the app');
  assert(!/http-equiv="refresh"/i.test(play), 'no meta refresh: an unfurler following it would describe the desktop');
  assert(/<meta name="robots" content="noindex">/.test(play), 'the redirect page stays out of search');
  console.log('PASS  play/ share link carries the card and redirects into the app');
}

async function checkFrame() {
  if (!fs.existsSync(CHROME)) {
    console.log('SKIP  Chrome not found for embed frame test');
    return;
  }
  const server = await startStaticServer({ root: ROOT });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--no-first-run'],
  });
  try {
    const page = await browser.newPage();
    const consoleTail = [];
    page.on('console', m => { consoleTail.push(m.text().slice(0, 200)); if (consoleTail.length > 40) consoleTail.shift(); });
    // This harness Chrome denies the third-party frame storage, as Safari and
    // Chrome with third-party cookies blocked do on x.com: reading
    // localStorage throws there, and any unguarded read is a page error.
    const pageErrors = [];
    page.on('pageerror', e => {
      pageErrors.push(String(e).slice(0, 300));
      consoleTail.push('pageerror: ' + String(e).slice(0, 300));
    });
    await page.setViewport({ width: 600, height: 400 });
    const src = `http://127.0.0.1:${server.address().port}/index.html?app=${APP}&embed=1`;
    await page.setContent(`<iframe src="${src}" width="504" height="284" style="border:0"></iframe>`);
    const frameHandle = await page.waitForSelector('iframe');
    const frame = await frameHandle.contentFrame();
    await frame.waitForFunction(name => typeof runningApps !== 'undefined' &&
      runningApps.some(item => item && item.name === name), { timeout: 60000 }, APP)
      .catch(async error => {
        const state = await frame.evaluate(() => ({
          url: location.href,
          html: document.documentElement.className,
          body: document.body && document.body.className,
          running: typeof runningApps === 'undefined' ? 'undefined'
            : runningApps.map(item => item && item.name),
        })).catch(e => String(e));
        throw new Error(`${APP} never ran in the frame: ${JSON.stringify(state)}\n` +
          `${consoleTail.join('\n')}\n${error.message}`);
      });

    const running = await frame.evaluate(() => {
      const open = document.getElementById('embed-open');
      return {
        isolated: self.crossOriginIsolated,
        singleApp: document.body.classList.contains('single-app'),
        openDisplay: getComputedStyle(open).display,
        openHref: open.href,
        openTarget: open.target,
        swControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      };
    });
    assert.strictEqual(running.isolated, false, 'the frame is meant to be non-isolated, as on x.com');
    assert(running.singleApp, 'embed implies single-app');
    assert.notStrictEqual(running.openDisplay, 'none', 'the way out to the full site is on screen');
    assert.strictEqual(running.openTarget, '_blank', 'the full site opens in a new tab, not inside the tweet');
    assert.strictEqual(new URL(running.openHref).searchParams.get('app'), APP);
    assert.strictEqual(new URL(running.openHref).searchParams.get('embed'), null);
    console.log('PASS  embed frame runs the program single-app with an open-full link');

    await frame.evaluate(() => { for (const app of runningApps.slice()) app.wine.stop({ repaint: false }); });
    await frame.waitForFunction(() => !document.getElementById('embed-ended').hidden, { timeout: 15000 });
    const ended = await frame.evaluate(() => ({
      text: document.getElementById('embed-ended-text').textContent,
      desktopIcons: document.querySelectorAll('.desktop-icon').length,
      url: location.search,
    }));
    assert(/Minesweeper/.test(ended.text), `the ended panel names the program, got "${ended.text}"`);
    assert.strictEqual(ended.desktopIcons, 0, 'exiting must not build the desktop inside the frame');
    assert(ended.url.includes(`app=${APP}`), 'the frame keeps its ?app= so Play again has a program');
    console.log('PASS  exiting shows the ended panel, not the desktop');

    await frame.click('#embed-again');
    await frame.waitForFunction(name => runningApps.some(item => item && item.name === name),
      { timeout: 30000 }, APP);
    assert(await frame.evaluate(() => document.getElementById('embed-ended').hidden),
      'Play again hides the panel');
    console.log('PASS  Play again starts the program again');
    assert.deepStrictEqual(pageErrors, [], 'the embed frame raised uncaught errors');
    console.log('PASS  no uncaught errors in a storage-denied third-party frame');

    // The storage fix is not embed-specific: an ordinary direct link in a
    // storage-denied frame (or a browser that blocks site data) must boot too.
    const plain = await browser.newPage();
    const plainErrors = [];
    plain.on('pageerror', e => plainErrors.push(String(e).slice(0, 300)));
    await plain.setContent(`<iframe src="http://127.0.0.1:${server.address().port}/index.html?app=sol" ` +
      'width="640" height="480" style="border:0"></iframe>');
    const plainFrame = await (await plain.waitForSelector('iframe')).contentFrame();
    await plainFrame.waitForFunction(() => typeof runningApps !== 'undefined' &&
      runningApps.some(item => item && item.name === 'sol'), { timeout: 60000 });
    assert.deepStrictEqual(plainErrors, [], 'a normal app in a storage-denied frame raised errors');
    console.log('PASS  a normal app boots with storage denied');

    // Following the share link itself, as a tap on the tweet does.
    const { generatePages, writePages } = require('../tools/gen-site-pages');
    writePages(generatePages().filter(p => p.name === `play/${APP}.html`));
    const visit = await browser.newPage();
    await visit.goto(`http://127.0.0.1:${server.address().port}/play/${APP}.html`);
    await visit.waitForFunction(name => typeof runningApps !== 'undefined' &&
      runningApps.some(item => item && item.name === name), { timeout: 60000 }, APP);
    const landed = new URL(visit.url());
    assert.strictEqual(landed.pathname, '/', 'the share link lands on the app, not a page about it');
    assert.strictEqual(landed.searchParams.get('app'), APP);
    console.log('PASS  following the share link drops the visitor straight into the program');
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  checkCardTags();
  await checkFrame();
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
