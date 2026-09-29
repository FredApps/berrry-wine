#!/usr/bin/env node
'use strict';

// The ?debug toolbar's D3D select picks the renderer for BOTH Direct3D
// generations for the next launch: the page default and ?d3d9-renderer seed
// it, and the bridge a new instance creates must carry whatever it says at
// launch time.
//
// It carries DX2-7 immediate mode too, which is the part worth pinning: the
// default must keep D3DIM on the WAT rasterizer (docs/d3dim-gl-sweep-2026-09-19.md
// left eleven of sixteen apps without a single triangle drawn, so the executor
// has coverage rather than evidence), "WebGL +DX7" is the only option that
// turns it on, and a URL that sets the two halves to a combination the
// dropdown has no option for must say so instead of misreporting one it has.

const assert = require('assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('./static-server');
const { compileSrcWasm } = require('./compile-src');

const root = path.join(__dirname, '..');

(async () => {
  const wasm = compileSrcWasm();
  const server = await startStaticServer({ root, cacheControl: 'no-cache',
    handleRequest(request, response) {
      if (!request.url.startsWith('/build/wine-assembly.wasm')) return false;
      response.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': wasm.length });
      response.end(wasm);
      return true;
    } });
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-first-run', '--no-default-browser-check'] });
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const open = async query => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(base + query, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('typeof launchApp === "function"');
    return { page, errors };
  };
  const selected = page => page.evaluate(() => ({
    select: document.getElementById('d3d-renderer-select').value,
    renderer: window.WineD3D.renderer,
  }));
  const bothHalves = page => page.evaluate(() => ({
    select: document.getElementById('d3d-renderer-select').value,
    renderer: window.WineD3D.renderer,
    d3dim: window.WINE_D3DIM_GPU === true,
    options: Array.from(document.getElementById('d3d-renderer-select').options).map(o => o.value),
  }));
  try {
    const plain = await open('?debug');
    assert.strictEqual(await plain.page.$eval('#d3d-renderer-select', s => s.parentElement.childNodes[0].textContent.trim()), 'GPU:');
    assert.deepStrictEqual(await selected(plain.page), { select: 'webgl', renderer: 'webgl' },
      'the toolbar defaults to the WebGL backend');
    assert.deepStrictEqual(await bothHalves(plain.page), {
      select: 'webgl', renderer: 'webgl', d3dim: false,
      options: ['webgl', 'webgl-all', 'software'],
    }, 'the default leaves DX2-7 on the WAT rasterizer, and offers no fourth option');

    // One control, both generations: picking WebGL +DX7 moves immediate mode
    // as well, and going back to plain WebGL puts it back.
    await plain.page.evaluate(() => setD3DRenderer('webgl-all'));
    assert.deepStrictEqual(await bothHalves(plain.page), {
      select: 'webgl-all', renderer: 'webgl', d3dim: true,
      options: ['webgl', 'webgl-all', 'software'],
    }, 'WebGL +DX7 turns the D3DIM executor on without touching the D3D8/9 half');
    await plain.page.evaluate(() => setD3DRenderer('webgl'));
    assert.strictEqual((await bothHalves(plain.page)).d3dim, false,
      'going back to WebGL turns the D3DIM executor off again');

    await plain.page.evaluate(() => {
      setD3DRenderer('software');
      document.getElementById('app-select').value = 'calc';
      launchApp();
    });
    await plain.page.waitForFunction(() => typeof runningApps !== 'undefined' &&
      runningApps[0] && runningApps[0].wine.running && runningApps[0].wine.hostCtx &&
      runningApps[0].wine.hostCtx.d3d9Bridge, { timeout: 120000 });
    const bridge = await plain.page.evaluate(() => {
      const b = runningApps[0].wine.hostCtx.d3d9Bridge;
      const ctx = runningApps[0].wine.hostCtx;
      if (ctx.glideBackend !== 'software') throw new Error('Glide ignored shared GPU choice');
      if (ctx.glideBridge && ctx.glideBridge.options.backend !== 'software') throw new Error('Glide bridge ignored shared GPU choice');
      return { backend: b.backend, asyncSoftware: b.asyncSoftware };
    });
    assert.deepStrictEqual(bridge, { backend: 'software', asyncSoftware: true },
      'a launch after choosing Software gets the software bridge on the render Worker');
    assert.deepStrictEqual(plain.errors, [], 'no page errors');
    await plain.page.close();

    const seeded = await open('?debug&d3d9-renderer=software');
    assert.deepStrictEqual(await selected(seeded.page), { select: 'software', renderer: 'software' },
      '?d3d9-renderer seeds the select');
    await seeded.page.close();

    // The two parameters still set each half on their own, and the select
    // reports whatever they left rather than its own idea of a default.
    const gpu = await open('?debug&d3dim-gpu');
    assert.deepStrictEqual(await bothHalves(gpu.page), {
      select: 'webgl-all', renderer: 'webgl', d3dim: true,
      options: ['webgl', 'webgl-all', 'software'],
    }, '?d3dim-gpu alone reads back as WebGL +DX7');
    assert.deepStrictEqual(gpu.errors, [], 'no page errors');
    await gpu.page.close();

    // Software D3D8/9 with the D3DIM executor on is a real combination the
    // three options cannot express. It has to be visible, not rounded to a
    // neighbour: reporting it as "software" would claim the executor is off.
    const mixed = await open('?debug&d3d9-renderer=software&d3dim-gpu');
    assert.deepStrictEqual(await bothHalves(mixed.page), {
      select: 'mixed', renderer: 'software', d3dim: true,
      options: ['webgl', 'webgl-all', 'software', 'mixed'],
    }, 'a combination the dropdown has no option for gets one rather than being misreported');
    assert.deepStrictEqual(mixed.errors, [], 'no page errors');
    await mixed.page.close();

    console.log('PASS  one D3D select steers both Direct3D generations for the next launch');
  } finally {
    await browser.close();
    await closeServer(server);
  }
})().catch(error => { console.error(error); process.exit(1); });
