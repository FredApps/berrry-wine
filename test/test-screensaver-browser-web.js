#!/usr/bin/env node

'use strict';

// The Screen Savers applet in the real page, not the render harness.
//
// The applet is the first thing this emulator runs with no PE behind it, so
// the browser path is where the interesting failures are: the launch code is
// PE-shaped from end to end, and the run loop's "eip is zero, the program
// exited" test would stop an applet on its first step. This drives
// index.html: launch it from the app registry, let the run loop tick, check
// it is still alive and drawing, click a row and Preview, and confirm the
// shell resolved the .SCR and booted it as a second, real guest.

const assert = require('assert');
const fs = require('fs');
const { startStaticServer: startSharedStaticServer } = require('./static-server');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(ROOT, 'test', 'output', 'screensaver-browser-web');

if (!fs.existsSync(CHROME)) {
  console.log('SKIP  Chrome not found for the Screen Savers browser test');
  process.exit(0);
}

function startStaticServer() {
  return startSharedStaticServer({ root: ROOT });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startStaticServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--no-first-run'],
  }).catch(error => { server.close(); throw error; });
  const failures = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => failures.push(`page error: ${error.message}`));
    await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/index.html?debug&scrsave-web=${Date.now()}`,
      { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => typeof launchApp === 'function' && !!window.wineApps,
      { timeout: 20000 });

    // The applet has to be reachable the same way every other app is.
    const listed = await page.evaluate(() => ({
      registered: !!(window.wineApps.APPS.screensavers || {}).watApp,
      onDesktop: window.wineApps.DESKTOP_APPS.some(entry => entry[0] === 'screensavers'),
    }));
    assert.ok(listed.registered, 'screensavers is a watApp entry in the registry');
    assert.ok(listed.onDesktop, 'screensavers has a desktop icon');

    await page.evaluate(async () => {
      stopAllApps();
      window.scrsaveStartupMark = performance.now();
      document.getElementById('app-select').value = 'screensavers';
      await shell.launchApp('screensavers');
      window.scrsaveStartupMs = performance.now() - window.scrsaveStartupMark;
    });

    // Alive after enough steps that the eip==0 exit test would have fired.
    try {
      await page.waitForFunction(() => {
        const app = runningApps.find(item => item && item.name === 'screensavers');
        return !!(app && app.wine.running && app.wine.instance &&
          (app.wine.instance.exports.scrsave_window() | 0) !== 0);
      }, { timeout: 20000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        apps: runningApps.map(item => item && item.name),
        status: document.getElementById('status').textContent,
        log: document.getElementById('log').textContent.slice(-3000),
      }));
      throw new Error(`${error.message}\nstate: ${JSON.stringify(state, null, 2)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));

    const open = await page.evaluate(() => {
      const app = runningApps.find(item => item && item.name === 'screensavers');
      const e = app.wine.instance.exports;
      const hwnd = e.scrsave_window() >>> 0;
      const win = Object.values(sharedRenderer.windows).find(w => w && w.hwnd === hwnd);
      sharedRenderer.repaint();
      const screen = document.getElementById('screen');
      const ctx = screen.getContext('2d');
      const px = ctx.getImageData(win.x, win.y, win.w, win.h).data;
      const colors = new Set();
      for (let i = 0; i < px.length; i += 4) {
        colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      }
      return {
        running: app.wine.running,
        bootState: app.wine._fontBootState,
        stockStates: Array.from({length: 5}, (_, i) => e.stock_font_state(i)),
        fontCatalogReady: e.font_catalog_ready(),
        title: win.title,
        rect: [win.x, win.y, win.w, win.h],
        colors: colors.size,
        rows: e.send_message(e.scrsave_list_hwnd(), 0x018b, 0, 0) | 0,
        catalogue: e.scrsave_count() | 0,
        resource: {
          startupMs: window.scrsaveStartupMs,
          wasmMemoryBytes: app.wine.memory.buffer.byteLength,
          guestWorker: !!app.wine.guestWorker,
          eip: e.get_eip(),
          executableRequests: performance.getEntriesByType('resource')
            .filter(r => r.startTime >= window.scrsaveStartupMark && /\.(exe|dll|scr)(?:\?|$)/i.test(r.name)).length,
        },
        png: screen.toDataURL('image/png'),
      };
    });
    fs.writeFileSync(path.join(OUT, 'applet.png'),
      Buffer.from(open.png.split(',')[1], 'base64'));
    assert.ok(open.running, 'the applet is still running after 1.5s of steps');
    assert.strictEqual(open.bootState, 'ready');
    assert.deepStrictEqual(open.stockStates, [2, 2, 2, 2, 2], 'fresh no-PE instance owns all stock fonts');
    assert.strictEqual(open.fontCatalogReady, 1, 'cold font catalog committed before opening controls');
    assert.strictEqual(open.title, 'Screen Savers', 'the window is captioned');
    assert.strictEqual(open.rows, open.catalogue,
      'the list holds one row per catalogue entry');
    assert.ok(open.colors >= 8,
      `the window is drawn, not blank (${open.colors} colors in its rect)`);
    assert.strictEqual(open.resource.guestWorker, false, 'no idle shadow/Worker pair for a native applet');
    assert.strictEqual(open.resource.eip, 0, 'the browser requires no guest program');
    assert.strictEqual(open.resource.executableRequests, 0, 'listing savers fetches no EXE/DLL/SCR payload');
    console.log('STARTUP RESOURCE SAMPLE (headless functional, not FPS/RSS): ' + JSON.stringify(open.resource));
    console.log(`PASS  applet runs in the page: "${open.title}" ${open.rect.join(',')}, ` +
      `${open.rows} rows, ${open.colors} colors`);

    // Pick a row by clicking it, the way a visitor does, and start it.
    const preview = await page.evaluate(async () => {
      const app = runningApps.find(item => item && item.name === 'screensavers');
      const e = app.wine.instance.exports;
      const hwnd = e.scrsave_window() >>> 0;
      const list = e.scrsave_list_hwnd() >>> 0;
      // Second row. lParam is (y << 16) | x, and the listbox draws 16px rows,
      // so y=20 is inside row 1.
      const lp = ((20 & 0xffff) << 16) | (40 & 0xffff);
      e.send_message(list, 0x0201, 1, lp);   // WM_LBUTTONDOWN
      e.send_message(list, 0x0202, 0, lp);   // WM_LBUTTONUP
      e.wat_app_pump();
      const selected = e.send_message(list, 0x0188, 0, 0) | 0;
      e.send_message(hwnd, 0x0111, 1, 0);    // Preview
      e.wat_app_pump();
      await new Promise(r => setTimeout(r, 4000));
      return {
        selected,
        launched: e.scrsave_last_launched() | 0,
        apps: runningApps.map(item => item && item.name),
      };
    });
    assert.strictEqual(preview.selected, 1, 'clicking the second row selects it');
    assert.strictEqual(preview.launched, 2,
      'Preview started the entry that was selected');
    assert.ok(preview.apps.includes('scr_oasaver'),
      `the shell booted the saver as a real app (running: ${preview.apps.join(', ')})`);
    console.log(`PASS  Preview booted ${preview.apps.filter(n => n !== 'screensavers').join(', ')}`);

    // Closing the applet ends its process without touching the saver it
    // started.
    const closed = await page.evaluate(async () => {
      const app = runningApps.find(item => item && item.name === 'screensavers');
      const e = app.wine.instance.exports;
      e.send_message(e.scrsave_window() >>> 0, 0x0111, 2, 0);   // Close
      await new Promise(r => setTimeout(r, 1500));
      return {
        running: app.wine.running,
        apps: runningApps.map(item => item && item.name),
      };
    });
    assert.strictEqual(closed.running, false, 'Close stops the applet process');
    assert.ok(!closed.apps.includes('screensavers'),
      'the applet is off the running list');
    assert.ok(closed.apps.includes('scr_oasaver'),
      'the saver it started keeps running');
    console.log('PASS  Close ends the applet and leaves the saver running');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
