#!/usr/bin/env node
'use strict';

// ?d3dim-gpu puts the D3DIM WebGL executor on whichever thread owns the guest
// instance: the main thread in cooperative mode, the guest-main Worker in
// Threads mode. Either way its fence reads the frame back into the guest DIB,
// so the page presents the same surface it presents for software D3DIM.
//
// Boids draws through Device2::DrawIndexedPrimitive, so a nonzero draw count
// proves the executor is the one rasterizing in a real page. Without the flag
// nothing is constructed and WAT rasterizes as before.

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

async function runBoids(browser, base, { query, threads }) {
  const page = await browser.newPage();
  const problems = [];
  const logs = [];
  page.on('pageerror', error => problems.push(String(error)));
  page.on('console', message => {
    const text = message.text();
    if (/d3dim-gpu/.test(text)) logs.push(text);
    if (/UNIMPLEMENTED API:|RuntimeError|FATAL:|trapped/i.test(text)) problems.push(text);
  });
  await page.goto(`${base}?debug&no-log${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof launchApp === 'function' &&
    document.querySelector('#app-select option[value="dx_boids"]'), { timeout: 30000 });
  await page.evaluate(async wantThreads => {
    const box = document.getElementById('threads-toggle');
    box.checked = wantThreads;
    await setThreads(wantThreads);
    document.getElementById('app-select').value = 'dx_boids';
    launchApp();
  }, threads);

  const observe = () => page.evaluate(() => {
    const app = runningApps.find(item => item && item.name === 'dx_boids');
    const wine = app && app.wine;
    const worker = wine && wine.guestWorker;
    return {
      running: !!(wine && wine.running), worker: !!worker,
      flag: window.WINE_D3DIM_GPU,
      slices: worker && worker.sliceStats ? worker.sliceStats.slices : null,
      d3d: worker ? worker.d3dStats || null
        : (wine && wine.d3dimGpu ? wine.d3dimGpu.snapshot() : null),
    };
  });
  try {
    await page.waitForFunction(() => {
      const app = runningApps.find(item => item && item.name === 'dx_boids');
      const wine = app && app.wine;
      if (!wine) return false;
      const worker = wine.guestWorker;
      const stats = worker ? worker.d3dStats : (wine.d3dimGpu ? wine.d3dimGpu.snapshot() : null);
      return !!(stats && stats.draws > 0);
    }, { timeout: 120000, polling: 250 });
  } catch (error) {
    throw new Error(`${error.message}\nstate ${JSON.stringify(await observe())}\n` +
      `logs ${JSON.stringify(logs)}\nproblems ${JSON.stringify(problems)}`);
  }
  const state = await observe();
  await page.close();
  return { state, logs, problems };
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
    args: ['--no-first-run', '--no-default-browser-check',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    const coop = await runBoids(browser, base, { query: '&d3dim-gpu', threads: false });
    assert.deepStrictEqual(coop.problems, [], 'no page errors on the cooperative executor');
    assert.strictEqual(coop.state.worker, false, 'cooperative mode has no guest Worker');
    assert.ok(coop.state.d3d.draws > 0, `no GL draws: ${JSON.stringify(coop.state.d3d)}`);
    assert.strictEqual(coop.state.d3d.errors, 0, `executor errors: ${JSON.stringify(coop.state.d3d)}`);

    const worker = await runBoids(browser, base, { query: '&d3dim-gpu', threads: true });
    assert.deepStrictEqual(worker.problems, [], 'no page errors on the Worker executor');
    assert.strictEqual(worker.state.worker, true, 'Threads mode runs the guest in a Worker');
    assert.ok(worker.state.d3d.draws > 0, `no GL draws in the Worker: ${JSON.stringify(worker.state.d3d)}`);
    assert.strictEqual(worker.state.d3d.errors, 0, `Worker executor errors: ${JSON.stringify(worker.state.d3d)}`);

    const off = await probeOptOut(browser, base);
    assert.strictEqual(off, null, 'nothing is constructed without the flag');
    console.log(`PASS  ?d3dim-gpu draws D3DIM on WebGL in both thread modes ` +
      `(cooperative ${coop.state.d3d.draws} draws/${coop.state.d3d.fences} fences, ` +
      `worker ${worker.state.d3d.draws} draws/${worker.state.d3d.fences} fences); off by default`);
  } finally {
    await browser.close();
    await closeServer(server);
  }
})().catch(error => { console.error(error); process.exit(1); });

// The opt-out arm only has to prove the executor is not built; it does not need
// the guest to reach a draw, so it runs a short load instead of a full launch.
async function probeOptOut(browser, base) {
  const page = await browser.newPage();
  await page.goto(`${base}?debug&no-log`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof launchApp === 'function' &&
    document.querySelector('#app-select option[value="dx_boids"]'), { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('app-select').value = 'dx_boids';
    launchApp();
  });
  await page.waitForFunction(() => {
    const app = runningApps.find(item => item && item.name === 'dx_boids');
    return !!(app && app.wine && app.wine.running);
  }, { timeout: 60000, polling: 250 });
  const result = await page.evaluate(() => {
    const app = runningApps.find(item => item && item.name === 'dx_boids');
    return app.wine.d3dimGpu || null;
  });
  await page.close();
  return result;
}
