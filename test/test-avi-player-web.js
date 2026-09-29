#!/usr/bin/env node
// The standalone game-movie player (tools/avi-player/) in a real browser.
//
// It lists every corpus movie from catalog.json, compiles
// src/09a7e-video-codecs.wat in the page with the vendored WATX compiler, and
// decodes with that — the same WAT the emulator runs. This drives the page
// the way a person does: the list must be the catalog (disabled rows for
// formats with no decoder), picking Dark Colony's Cinepak intro must load it,
// and seeking past its black opening must put picture on the canvas.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('./static-server');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MOVIE = 'test/binaries/win98-games-a-d/DarkColony-MagDemo-SW/AVI/intro.avi';
const SHOT = path.join(ROOT, 'build', 'avi-player-web.png');

(async () => {
  if (!fs.existsSync(path.join(ROOT, MOVIE))) {
    console.log(`SKIP  ${MOVIE} is not in this checkout`);
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/avi-player/catalog.json'), 'utf8'));
  const movies = catalog.games.flatMap(g => g.movies);
  const playable = movies.filter(m => m.playable).length;

  const server = await startStaticServer({ root: ROOT, cacheControl: false });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 800, height: 900 });
    await page.goto(`${base}/tools/avi-player/index.html`, { waitUntil: 'load' });

    // The list is the catalog: one option per movie, unplayable ones disabled.
    await page.waitForFunction(() => document.querySelectorAll('#pick optgroup').length > 0, { timeout: 10000 })
      .catch(async (e) => {
        const shown = await page.$eval('#pick', el => el.textContent).catch(() => '(no #pick)');
        throw new Error(`catalog never listed: #pick="${shown.trim()}" errors=${JSON.stringify(errors)}`);
      });
    const list = await page.evaluate(() => ({
      options: document.querySelectorAll('#pick optgroup option').length,
      enabled: document.querySelectorAll('#pick optgroup option:not([disabled])').length,
      head: document.querySelector('#pick option').textContent,
    }));
    assert.strictEqual(list.options, movies.length, 'one option per catalog movie');
    assert.strictEqual(list.enabled, playable, 'exactly the playable movies are selectable');
    assert(list.head.includes(`${playable} of ${movies.length}`), `summary row: ${list.head}`);

    await page.select('#pick', MOVIE);
    await page.waitForFunction(() => !document.getElementById('play').disabled, { timeout: 60000 });
    const info = await page.$eval('#info', el => el.textContent);
    assert(/Cinepak/.test(info) && /320×180/.test(info), `stream info: ${info}`);

    // Frames 0-35 fade in from black; frame 150 is well lit (ffmpeg YMAX 234).
    await page.$eval('#seek', el => { el.value = 150; el.dispatchEvent(new Event('input')); });
    await page.waitForFunction(() => /frame151\//.test(document.getElementById('info').textContent.replace(/\s/g, '')),
      { timeout: 30000 });
    const lit = await page.evaluate(() => {
      const cv = document.getElementById('cv');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) bright++;
      return { w: cv.width, h: cv.height, bright };
    });
    assert.deepStrictEqual([lit.w, lit.h], [320, 180], 'canvas takes the movie size');
    assert(lit.bright > 2000, `frame 151 should have picture, ${lit.bright} bright pixels`);
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT });
    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log(`PASS  AVI player: ${movies.length} catalog movies (${playable} playable), ` +
      `Dark Colony intro frame 151 decoded in-page (${lit.bright} bright px) — ${path.relative(ROOT, SHOT)}`);
  } finally {
    await browser.close();
    await closeServer(server);
  }
})().catch(e => { console.error('FAIL ', e.message); process.exit(1); });
