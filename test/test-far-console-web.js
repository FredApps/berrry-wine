#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { compileSrcWasm } = require('./compile-src');
const { startStaticServer, closeServer } = require('./static-server');
const root = path.join(__dirname, '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(chrome) || !fs.existsSync(path.join(root,
    'test/binaries/candidates/far-manager-170/FarManager170/Far.exe'))) {
    console.log('SKIP Far browser regression: Chrome or local Far candidate missing');
    return;
  }
  // Read-only probe; production handlers and browser input routing are unchanged.
  const wasm = compileSrcWasm((file, source) => file === '09a2-handlers-console.wat'
    ? source + '\n(func (export "test_console_record") (result i32)\n' +
      ' (call $console_buffer_record (i32.load (global.get $CONSOLE_BUFFER_ACTIVE))))\n'
    : source);
  const server = await startStaticServer({ root, crossOriginIsolated: true,
    handleRequest(req, res) {
      if (!req.url.startsWith('/build/wine-assembly.wasm')) return false;
      res.writeHead(200, { 'Content-Type': 'application/wasm' });
      res.end(wasm);
      return true;
    } });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true,
      args: ['--no-first-run', '--no-default-browser-check'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (/UNIMPLEMENTED API:|RuntimeError|LinkError|MISMATCH|worker start failed/i.test(m.text())) {
        errors.push(m.text());
        console.error(m.text());
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug`,
      { waitUntil: 'load', timeout: 90000 });
    assert(await page.evaluate(() => crossOriginIsolated));
    await page.evaluate(async () => {
      document.getElementById('threads-toggle').checked = true;
      await setThreads(true);
    });
    await page.select('#app-select', 'far_manager_170');
    await page.evaluate(() => { launchApp(); });
    await page.waitForFunction(() => window.wineShell?.runningApps?.some(
      a => a.name === 'far_manager_170' && a.wine?.guestWorker), { timeout: 90000 });
    await page.evaluate(() => {
      window.farSnapshot = () => {
        const w = window.wineShell.runningApps.find(a => a.name === 'far_manager_170').wine;
        const record = w.instance.exports.test_console_record();
        if (!record) return '';
        const v = new DataView(w.memory.buffer);
        const p = v.getUint32(record + 8, true);
        const width = v.getUint32(record + 16, true);
        const height = v.getUint32(record + 20, true);
        if (!p || !width || width * height > 6144) return '';
        return Array.from({ length: height }, (_, y) => String.fromCharCode(
          ...Array.from({ length: width }, (_, x) => v.getUint16(p + 2 * (y * width + x), true)))).join('\n');
      };
      // Fail immediately on a broken probe instead of hiding its exception
      // inside waitForFunction retries until the panel timeout.
      window.farSnapshot();
    });
    await page.waitForFunction(() => /far\.exe/i.test(window.farSnapshot()), { timeout: 90000 });
    console.log('Far root panels:\n' + await page.evaluate(() => window.farSnapshot()));
    await page.evaluate(() => {
      window.farCellPoint = (column, row) => {
        const renderer = window.sharedRenderer;
        const win = Object.values(renderer.windows).find(w => w.visible && !w.isChild && / - Far/.test(w.title || ''));
        if (!win) throw new Error('Far console window missing');
        const origin = renderer._mouseMsgOriginScreen(win.hwnd);
        const canvas = document.getElementById('screen');
        const rect = canvas.getBoundingClientRect();
        const gx = origin.x + column * 8, gy = origin.y + row * 12;
        return { gx, gy, x: rect.left + gx * rect.width / canvas.width,
          y: rect.top + gy * rect.height / canvas.height };
      };
      window.farPixelCount = (row, rgb) => {
        const { gx, gy } = window.farCellPoint(1, row);
        const canvas = document.getElementById('screen');
        const data = canvas.getContext('2d').getImageData(gx, gy, 18 * 8, 12).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2]) count++;
        return count;
      };
    });
    const appRow = await page.evaluate(() => window.farSnapshot().split('\n').findIndex(r => /app\.exe/.test(r)));
    assert(appRow > 1, 'app.exe appears in a selectable file row');
    await page.waitForFunction(row => window.farPixelCount(row, [0, 0, 128]) > 500,
      { timeout: 15000 }, appRow);
    const point = await page.evaluate(row => window.farCellPoint(8, row + 0.5), appRow);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(row => window.farPixelCount(row, [0, 128, 128]) > 500,
      { timeout: 15000 }, appRow);
    assert(/app\.exe/.test(await page.evaluate(() => window.farSnapshot().split('\n')[21])),
      'mouse selects app.exe in the left panel status row');
    console.log('PASS Far browser mouse selected app.exe and repainted blue row teal');
    await page.keyboard.press('Home');
    await page.keyboard.press('F9');
    await page.waitForFunction(() => /Left\s+Files\s+Commands\s+Options\s+Right/.test(window.farSnapshot()),
      { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Object.values(window.sharedRenderer.windows).some(
      w => /\{C:\\[^}\\]+\} - Far/i.test(w.title || '')), { timeout: 30000 });
    assert((await page.evaluate(() => window.farSnapshot())).includes('..'),
      'child directory displays its parent entry');
    assert.deepStrictEqual(errors, []);
    console.log('PASS Far browser Worker: file panels, F9 menu, child-directory parent entry');
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
