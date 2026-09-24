#!/usr/bin/env node
'use strict';

// In browser Threads mode the guest-main Worker hands every D3DIM draw to the
// render Worker by default; with ?no-d3d-worker rasterization stays on the
// guest thread. Boids draws through Device2::DrawIndexedPrimitive, so a nonzero
// queue count proves the indexed path reaches the render Worker in a real page.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('./static-server');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME) ||
    !fs.existsSync(path.join(ROOT, 'test', 'binaries', 'dx-sdk', 'bin', 'boids.exe'))) {
  console.log('SKIP  Chrome or boids.exe unavailable');
  process.exit(0);
}

async function runBoids(browser, base, query) {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(String(error)));
  page.on('console', message => {
    const text = message.text();
    if (/UNIMPLEMENTED API:|RuntimeError|D3D render Worker|FATAL:|trapped/i.test(text)) problems.push(text);
  });
  await page.goto(`${base}?debug&no-log${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof launchApp === 'function' &&
    document.querySelector('#app-select option[value="dx_boids"]'), { timeout: 30000 });
  assert(await page.evaluate(() => crossOriginIsolated), 'server must be cross-origin isolated');
  await page.evaluate(async () => {
    const box = document.getElementById('threads-toggle');
    box.checked = true;
    await setThreads(true);
    document.getElementById('app-select').value = 'dx_boids';
    launchApp();
  });
  // Stats ride back with every guest slice; wait until the flock has drawn.
  const observe = () => page.evaluate(() => {
    const app = runningApps.find(item => item && item.name === 'dx_boids');
    const worker = app && app.wine && app.wine.guestWorker;
    return { apps: runningApps.filter(Boolean).map(item => item.name),
      running: !!(app && app.wine && app.wine.running), worker: !!worker,
      slices: worker && worker.sliceStats ? worker.sliceStats.slices : 0,
      d3d: worker ? worker.d3dStats || null : null,
      flag: window.WINE_D3D_RENDER_WORKER, hostFlag: worker ? worker.d3dRenderWorker : null };
  });
  try {
    await page.waitForFunction(expectWorker => {
      const app = runningApps.find(item => item && item.name === 'dx_boids');
      const worker = app && app.wine && app.wine.guestWorker;
      if (!worker || !worker.sliceStats || worker.sliceStats.slices < 50) return false;
      return expectWorker ? !!(worker.d3dStats && worker.d3dStats.queued > 200) : true;
    }, { timeout: 120000, polling: 250 }, !query.includes('no-d3d-worker'));
  } catch (error) {
    // Which Worker scopes exist, and whether the guest-main one built its encoder.
    const scopes = await Promise.all(page.workers().map(async worker => {
      let probe = null;
      try {
        probe = await worker.evaluate(() => ({
          stream: typeof D3DCommandStream,
          encoder: typeof d3dCommands === 'undefined' ? 'no-binding' : !!d3dCommands,
        }));
      } catch (probeError) { probe = String(probeError.message || probeError); }
      return { url: worker.url().replace(/^.*\/lib\//, ''), probe };
    }));
    throw new Error(`${error.message}\nstate ${JSON.stringify(await observe())}\n` +
      `workers ${JSON.stringify(scopes)}\nproblems ${JSON.stringify(problems)}`);
  }
  const stats = await page.evaluate(() => {
    const worker = runningApps.find(item => item && item.name === 'dx_boids').wine.guestWorker;
    return { threads: window.WINE_THREADS, renderWorker: window.WINE_D3D_RENDER_WORKER,
      d3d: worker.d3dStats || null };
  });
  await page.close();
  return { stats, problems };
}

(async () => {
  const wasm = compileSrcWasm();
  const server = await startStaticServer({ root: ROOT, cacheControl: 'no-cache', crossOriginIsolated: true,
    handleRequest(request, response) {
      if (!request.url.startsWith('/build/wine-assembly.wasm')) return false;
      response.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': wasm.length });
      response.end(wasm);
      return true;
    } });
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME,
    args: ['--no-first-run', '--no-default-browser-check'] });
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    const on = await runBoids(browser, base, '');
    assert.deepStrictEqual(on.problems, [], 'no page errors with the render Worker');
    assert.strictEqual(on.stats.threads, true, 'Threads mode is on');
    assert.strictEqual(on.stats.renderWorker, true, 'the render Worker is on by default in Threads mode');
    assert.ok(on.stats.d3d && on.stats.d3d.ready, `render Worker never became ready: ${JSON.stringify(on.stats.d3d)}`);
    assert.strictEqual(on.stats.d3d.fallbacks, 0, `draws fell back: ${JSON.stringify(on.stats.d3d)}`);
    assert.ok(on.stats.d3d.fences > 0, 'presents fence the render Worker');

    const off = await runBoids(browser, base, '&no-d3d-worker');
    assert.deepStrictEqual(off.problems, [], 'no page errors without the render Worker');
    assert.strictEqual(off.stats.renderWorker, false, '?no-d3d-worker opts out');
    assert.strictEqual(off.stats.d3d, null, 'no encoder is created when opted out');
    console.log(`PASS  Threads mode routes D3DIM to the render Worker by default ` +
      `(${on.stats.d3d.queued} draws, ${on.stats.d3d.fences} fences); ?no-d3d-worker opts out`);
  } finally {
    await browser.close();
    await closeServer(server);
  }
})().catch(error => { console.error(error); process.exit(1); });
