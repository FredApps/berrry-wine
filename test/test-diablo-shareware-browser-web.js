#!/usr/bin/env node
// Drive the shipping browser shell through Diablo's full single-player path.
// Keep screenshots of each transition: the CLI art/gameplay tests cannot see
// browser palette uploads, fullscreen composition, or trusted pointer input.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
const { createServer } = require('../tools/dev-server');

const ROOT = path.join(__dirname, '..');
const MPQ = path.join(ROOT, 'test/binaries/candidates/diablo-shareware/installed/spawn.mpq');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.WA_DIABLO_BROWSER_OUT || path.join(ROOT, 'build/diablo-shareware-browser');
const BASE_URL = process.env.BASE_URL || '';
// WA_QUERY='?uop-trace-heads': the same route with page switches on.
const QUERY = process.env.WA_QUERY || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// spawn.mpq streams by HTTP range (lib/apps.js preloadRanges). Opt-in knobs
// for the lazy-loading evidence, each recorded in OUT/receipt.json:
//   WA_DIABLO_THROTTLE=KBPS:LATENCY_MS  CDP network throttling for the run
//   WA_DIABLO_FAIL=N    after character selection, answer the next N
//                       spawn.mpq range requests with 503 (the in-game wait
//                       window must offer Retry; the test presses it)
//   WA_DIABLO_PROFILE=DIR  persistent Chrome profile (a second run is warm)
const THROTTLE = process.env.WA_DIABLO_THROTTLE || '';
const FAIL_COUNT = Number(process.env.WA_DIABLO_FAIL || 0);
// WA_DIABLO_DELAY_MS=N: after character selection, hold every spawn.mpq range
// response N ms in the page (CDP throttling does not reach the page's service
// worker fetches, so it cannot produce an in-game wait on its own).
const DELAY_MS = Number(process.env.WA_DIABLO_DELAY_MS || 0);
const PROFILE = process.env.WA_DIABLO_PROFILE || '';
const failState = { armed: false, left: FAIL_COUNT, failed: 0, retries: 0, dialogs: 0 };

// The in-game wait window, when showing its error body: capture it once and
// press Retry, as a player would.
async function serviceWaitWindow(page) {
  const state = await page.evaluate(() => {
    const el = document.querySelector('.wa-game-wait');
    if (!el || el.hidden) return null;
    const retry = el.querySelector('.wa-game-wait-retry');
    return { error: !!(retry && !retry.hidden), text: el.innerText };
  });
  if (state && !state.error && !failState.loadingShot) {
    failState.loadingShot = true;
    await page.screenshot({ path: path.join(OUT, '05w-wait-loading.png') });
    console.log(`captured 05w-wait-loading: ${state.text.replace(/\s+/g, ' ')}`);
  }
  if (!state || !state.error) return false;
  if (!failState.dialogs++) {
    await page.screenshot({ path: path.join(OUT, '05x-wait-error.png') });
    fs.writeFileSync(path.join(OUT, '05x-wait-error.json'), JSON.stringify(state, null, 2));
    console.log(`captured 05x-wait-error: ${state.text.replace(/\s+/g, ' ')}`);
  }
  await page.click('.wa-game-wait-retry');
  failState.retries++;
  return true;
}

if (!fs.existsSync(CHROME) || !fs.existsSync(MPQ)) {
  console.log('SKIP  Chrome or Diablo Shareware install missing');
  process.exit(0);
}

async function guestPoint(page, x, y) {
  return page.evaluate(([gx, gy]) => {
    const canvas = document.getElementById('screen');
    const box = canvas.getBoundingClientRect();
    const v = sharedRenderer._exclusivePresentationViewport;
    let cx = gx + 0.5, cy = gy + 0.5;
    if (v && v.nativeW > 0 && v.nativeH > 0 && v.outputW > 0 && v.outputH > 0) {
      cx = (v.dstX + (gx + 0.5 - v.nativeX) * v.dstW / v.nativeW) * canvas.width / v.outputW;
      cy = (v.dstY + (gy + 0.5 - v.nativeY) * v.dstH / v.nativeH) * canvas.height / v.outputH;
    }
    return { x: box.left + cx * box.width / canvas.width,
      y: box.top + cy * box.height / canvas.height };
  }, [x, y]);
}

async function clickGuest(page, x, y) {
  const p = await guestPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await wait(120);
  await page.mouse.up();
}

async function titles(page) {
  return page.evaluate(() => Object.values(sharedRenderer.windows)
    .filter(w => w && w.visible).map(w => w.title || '').filter(Boolean));
}

async function waitDialogs(page, count, timeout = 120000) {
  await page.waitForFunction(want => Object.values(sharedRenderer.windows)
    .filter(w => w && w.visible && w.className === 'SDlgDialog').length >= want,
  { timeout }, count);
}

async function waitNoDialogs(page, timeout = 120000) {
  const state = await page.waitForFunction(() => {
    const app = runningApps.find(a => a && a.name === 'diablo_shareware');
    if (!app || !app.wine || !app.wine.running) return 'closed';
    const visible = Object.values(sharedRenderer.windows).filter(w => w && w.visible);
    return visible.some(w => w.className === 'DIABLO') &&
      !visible.some(w => w.className === 'SDlgDialog') ? 'loading' : false;
  }, { timeout, polling: 50 });
  assert.strictEqual(await state.jsonValue(), 'loading', 'Diablo closed before loading');
}

async function capture(page, name, bytes) {
  const file = path.join(OUT, `${name}.png`);
  if (bytes) fs.writeFileSync(file, bytes);
  else await page.screenshot({ path: file });
  const info = { name, titles: await titles(page), file,
    windows: await page.evaluate(() => Object.values(sharedRenderer.windows)
      .filter(w => w && w.visible).map(w => w.className)) };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 2));
  console.log(`captured ${name}: ${info.titles.join(', ')}`);
  return PNG.sync.read(fs.readFileSync(file));
}

function changedPixels(a, b) {
  assert(a.width === b.width && a.height === b.height, 'screenshot size changed');
  let changed = 0, sampled = 0;
  for (let y = 40; y < a.height; y += 4) {
    for (let x = 0; x < a.width; x += 4) {
      const i = (y * a.width + x) * 4;
      const delta = Math.abs(a.data[i] - b.data[i])
        + Math.abs(a.data[i + 1] - b.data[i + 1])
        + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (delta > 60) changed++;
      sampled++;
    }
  }
  return changed / sampled;
}

function assertSceneChanged(before, after, label) {
  const changed = changedPixels(before, after);
  assert(changed > 0.02, `${label} did not visibly change scene (${changed.toFixed(3)})`);
}

function loadingBorderPixels(png, y) {
  let count = 0;
  for (let x = 150; x < 1128; x++) {
    const i = (y * png.width + x) * 4;
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r > 15 && g > 12 && b < 85) count++;
  }
  return count;
}

async function waitForPortrait(page, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const png = PNG.sync.read(await page.screenshot());
    let lit = 0;
    for (let y = 410; y < 555; y += 2) {
      for (let x = 114; x < 442; x += 2) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 120) lit++;
      }
    }
    if (lit > 2000) return;
    await wait(500);
  }
  throw new Error('Choose Class portrait did not render');
}

async function orbColour(page, png, gx, gy, channel) {
  const p = await guestPoint(page, gx, gy);
  let count = 0;
  const cx = Math.round(p.x), cy = Math.round(p.y);
  for (let y = Math.max(0, cy - 24); y < Math.min(png.height, cy + 24); y++) {
    for (let x = Math.max(0, cx - 24); x < Math.min(png.width, cx + 24); x++) {
      const i = (y * png.width + x) * 4;
      const c = [png.data[i], png.data[i + 1], png.data[i + 2]];
      const main = c[channel];
      if (main > 55 && main > c[(channel + 1) % 3] * 1.35 &&
          main > c[(channel + 2) % 3] * 1.35) count++;
    }
  }
  return count;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server;
  if (!BASE_URL) {
    server = createServer({ quiet: true, noAgentInject: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  }
  const base = BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 240000,
    args: ['--no-sandbox', '--no-first-run', '--disable-gpu'],
    ...(PROFILE ? { userDataDir: PROFILE } : {}),
  });
  const startedAt = Date.now();
  const stageAt = {};
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.stack || String(e)));
    // Keep every spawn.mpq range request in the receipt (default buffer: 250).
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(100000));
    if (THROTTLE) {
      const [kbps, latency] = THROTTLE.split(':').map(Number);
      const cdp = await page.target().createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: latency || 0,
        downloadThroughput: kbps * 1024 / 8, uploadThroughput: kbps * 1024 / 8,
      });
    }
    if (FAIL_COUNT || DELAY_MS) {
      // In the page, not through request interception: the page's service
      // worker (sw-coi.js) issues the network request, which the page-level
      // interceptor never sees.
      await page.evaluateOnNewDocument(() => {
        const real = window.fetch.bind(window);
        window.__spawnFail = { left: 0, failed: 0, delayMs: 0 };
        window.fetch = (input, init) => {
          const url = String(input && input.url || input);
          const headers = init && init.headers;
          const range = headers && (headers.Range || headers.range);
          if (window.__spawnFail.left > 0 && /spawn\.mpq/.test(url) && range) {
            window.__spawnFail.left--;
            window.__spawnFail.failed++;
            return Promise.resolve(new Response('injected failure', { status: 503 }));
          }
          if (window.__spawnFail.delayMs > 0 && /spawn\.mpq/.test(url) && range) {
            return new Promise(resolve => setTimeout(resolve, window.__spawnFail.delayMs))
              .then(() => real(input, init));
          }
          return real(input, init);
        };
      });
    }
    await page.goto(`${base}/index.html${QUERY}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof launchApp === 'function' &&
      document.querySelector('.desktop-icon[data-app="diablo_shareware"]'), { timeout: 60000 });
    await page.evaluate(() => {
      if (typeof closeReadme === 'function') closeReadme();
      document.querySelector('.desktop-icon[data-app="diablo_shareware"]')
        .scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    const icon = await page.$('.desktop-icon[data-app="diablo_shareware"]');
    const box = await icon.boundingBox();
    assert(box, 'Diablo desktop icon is missing');
    const ix = box.x + box.width / 2, iy = box.y + box.height / 2;
    await page.mouse.click(ix, iy);
    await wait(80);
    await page.mouse.click(ix, iy);
    await page.waitForFunction(() => runningApps.some(a => a && a.name === 'diablo_shareware' &&
      a.wine && a.wine.running), { timeout: 150000 });

    await wait(3000);
    assert(!(await titles(page)).includes('Single Player'), 'intro was skipped before capture');
    const intro = await capture(page, '01-intro-video');

    await page.keyboard.press('Escape');
    // The title advances automatically. Observe its red face instead of
    // sleeping past it on a faster host and mislabelling the main menu.
    let titleBytes;
    const titleDeadline = Date.now() + 20000;
    while (Date.now() < titleDeadline) {
      await wait(200);
      const bytes = await page.screenshot();
      const png = PNG.sync.read(bytes);
      if (await orbColour(page, png, 320, 180, 0) > 150) {
        titleBytes = bytes;
        break;
      }
    }
    assert(titleBytes, 'post-skip title did not render with its red palette');
    const title = await capture(page, '02-post-skip-title', titleBytes);
    assertSceneChanged(intro, title, 'intro skip');
    assert(await orbColour(page, title, 320, 180, 0) > 150,
      'post-skip title is missing its red palette');

    // Dismiss the title away from the menu rows. Enter can also activate
    // Single Player if the title transition completes before key-up.
    await clickGuest(page, 320, 100);
    await waitDialogs(page, 1);
    await wait(1500);
    const menu = await capture(page, '03-main-menu');
    assert.strictEqual(await page.evaluate(() => Object.values(sharedRenderer.windows)
      .filter(w => w && w.visible && w.className === 'SDlgDialog').length), 1,
    'main-menu capture advanced into character selection');
    assert(menu.width === 1280 && menu.height === 900, 'unexpected screenshot size');
    assertSceneChanged(title, menu, 'title to main menu');
    assert(await orbColour(page, menu, 86, 213, 0) > 30 &&
      await orbColour(page, menu, 554, 213, 0) > 30,
    'main menu is missing its red selection markers');

    await clickGuest(page, 320, 299); // Replay Intro shareware notice
    await waitDialogs(page, 2);
    await wait(500);
    assert.strictEqual(await page.evaluate(() => Object.values(sharedRenderer.windows)
      .filter(w => w && w.visible && w.className === 'SDlgDialog').length), 2,
    'Replay Intro opened duplicate dialogs');
    const replay = await capture(page, '03b-replay-intro');
    assert(await orbColour(page, replay, 250, 427, 0) > 30 &&
      await orbColour(page, replay, 388, 427, 0) > 30,
    'Replay Intro is missing its OK selection markers');
    // The notice starts at y=162. Its primary-backed popup must preserve
    // screen coordinates or the visible OK button at y=427 is cropped away.
    const ok = await guestPoint(page, 320, 427);
    let gold = 0;
    for (let y = Math.round(ok.y) - 15; y < Math.round(ok.y) + 15; y++) {
      for (let x = Math.round(ok.x) - 30; x < Math.round(ok.x) + 30; x++) {
        const i = (y * replay.width + x) * 4;
        if (replay.data[i] > 90 && replay.data[i + 1] > 70 &&
            replay.data[i + 2] < replay.data[i + 1] * 0.8) gold++;
      }
    }
    assert(gold > 30, 'Replay Intro OK label did not render');
    await clickGuest(page, 320, 427);
    await page.waitForFunction(() => Object.values(sharedRenderer.windows)
      .filter(w => w && w.visible && w.className === 'SDlgDialog').length === 1,
    { timeout: 15000 });

    await clickGuest(page, 320, 299);
    await waitDialogs(page, 2);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => Object.values(sharedRenderer.windows)
      .filter(w => w && w.visible && w.className === 'SDlgDialog').length === 1,
    { timeout: 15000 });

    await clickGuest(page, 320, 213);
    await waitDialogs(page, 2);
    await wait(1500);
    await clickGuest(page, 420, 298); // Warrior
    await waitForPortrait(page);
    const character = await capture(page, '04-character-selection');
    stageAt.character = Date.now() - startedAt;
    if (FAIL_COUNT || DELAY_MS) {
      failState.armed = true;
      await page.evaluate((n, ms) => {
        window.__spawnFail.left = n;
        window.__spawnFail.delayMs = ms;
      }, FAIL_COUNT, DELAY_MS);
    }
    assertSceneChanged(menu, character, 'main menu to character selection');

    await clickGuest(page, 348, 446); // OK
    await page.waitForFunction(() => Object.values(sharedRenderer.windows)
      .some(w => w && w.visible && w.className === 'DIABLOEDIT'),
    { timeout: 120000 });
    await clickGuest(page, 425, 331);
    await page.keyboard.type('GAL');
    await clickGuest(page, 348, 446);
    if (FAIL_COUNT || DELAY_MS) {
      const until = Date.now() + 120000;
      while (Date.now() < until && !(await page.evaluate(() => {
        const visible = Object.values(sharedRenderer.windows).filter(w => w && w.visible);
        return visible.some(w => w.className === 'DIABLO') &&
          !visible.some(w => w.className === 'SDlgDialog');
      }))) {
        await serviceWaitWindow(page);
        await wait(100);
      }
    }
    await waitNoDialogs(page);
    let loadingBytes;
    let loadingSeenAt = 0, loadingBrightness = -1;
    const loadingDeadline = Date.now() + 30000;
    while (Date.now() < loadingDeadline) {
      if (await serviceWaitWindow(page)) continue;
      const bytes = await page.screenshot();
      const png = PNG.sync.read(bytes);
      if (loadingBorderPixels(png, 785) > 450 && loadingBorderPixels(png, 839) > 350) {
        // Keep the brightest loading frame during fade-in instead of saving
        // the first barely visible border. Never replace it with gameplay.
        if (!loadingSeenAt) loadingSeenAt = Date.now();
        if (await orbColour(page, png, 148, 400, 0) < 80) {
          let brightness = 0;
          for (let i = png.width * 40 * 4; i < png.data.length; i += 16) {
            brightness += png.data[i] + png.data[i + 1] + png.data[i + 2];
          }
          if (brightness > loadingBrightness) {
            loadingBrightness = brightness;
            loadingBytes = bytes;
          }
        }
      }
      if (loadingBytes && Date.now() - loadingSeenAt >= 1000) break;
      await wait(100);
    }
    assert(loadingBytes, 'Diablo loading progress bar did not render');
    const loading = await capture(page, '05-loading', loadingBytes);
    assertSceneChanged(character, loading, 'character selection to loading');
    assert(loadingBorderPixels(loading, 785) > 450 &&
      loadingBorderPixels(loading, 839) > 350,
    'loading screenshot does not show Diablo progress bar');
    assert(await orbColour(page, loading, 148, 400, 0) < 80,
      'loading capture is already gameplay');

    let gameplay;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await wait(2000);
      if (await serviceWaitWindow(page)) continue;
      const png = await capture(page, '06-gameplay');
      const red = await orbColour(page, png, 148, 400, 0);
      const blue = await orbColour(page, png, 492, 400, 2);
      if (red > 80 && blue > 80) {
        assertSceneChanged(loading, png, 'loading to gameplay');
        gameplay = { red, blue }; break;
      }
    }
    assert(gameplay, 'Diablo did not reach gameplay with both HUD orbs');
    stageAt.gameplay = Date.now() - startedAt;
    const receipt = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource')
        .filter(e => /spawn\.mpq/.test(e.name));
      const app = runningApps.find(a => a && a.name === 'diablo_shareware');
      const wine = app && app.wine;
      const entry = wine && wine._helpCtx && wine._helpCtx.vfs.files.get('c:\\spawn.mpq');
      const cache = entry && entry._provider;
      return {
        // transferSize reads 0 whenever the page's service worker (sw-coi.js)
        // answers, so it is a network figure only on an --isolate server.
        mpqRequests: entries.length,
        mpqTransferBytes: entries.reduce((n, e) => n + (e.transferSize || 0), 0),
        mpqBodyBytes: entries.reduce((n, e) => n + (e.encodedBodySize || 0), 0),
        mounted: cache ? 'provider-backed (lazy)' : (entry && entry.data ? 'resident (eager)' : 'missing'),
        cacheStats: cache && cache.stats ? { ...cache.stats } : null,
        gameWait: wine && wine._gameWait ? { ...wine._gameWait.stats } : null,
        threads: !!(wine && wine.threadManager && wine.threadManager.backend === 'worker'),
      };
    });
    if (FAIL_COUNT) failState.failed = await page.evaluate(() => window.__spawnFail.failed);
    Object.assign(receipt, { throttle: THROTTLE || null, injectedDelayMs: DELAY_MS || null, injectedFailures: failState.failed,
      retriesPressed: failState.retries, warmProfile: !!PROFILE, query: QUERY || null, stageMs: stageAt });
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(`receipt: ${JSON.stringify(receipt)}`);
    if (FAIL_COUNT) assert(failState.failed > 0 && failState.retries > 0,
      'injected range failures never reached the in-game Retry');
    assert(!errors.length, `browser page error: ${errors[0]}`);
    console.log(`PASS  Diablo browser flow: six stages captured; orbs ${JSON.stringify(gameplay)}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
