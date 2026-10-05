#!/usr/bin/env node
'use strict';

// Optional proprietary local fixture. Exercise the original renderer through
// the shipping browser launch path, retaining screenshots for visual review.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('./static-server');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const renderer = process.env.GLIDE_RENDERER || 'webgl';
assert(['webgl', 'software'].includes(renderer), 'GLIDE_RENDERER must be webgl or software');
const fixture = path.join(ROOT, 'test/binaries/candidates/need-for-speed-3-demo/game/voodooa.dll');
if (!fs.existsSync(CHROME) || !fs.existsSync(fixture)) {
  console.log('SKIP Chrome or NFS III local demo missing');
  process.exit(0);
}
const output = path.join(ROOT, 'build/nfs3-glide', renderer);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'live.log'), '');

(async () => {
  const corpus = path.resolve(path.dirname(fs.realpathSync(fixture)), '../../..');
  const server = await startStaticServer({ root: ROOT, crossOriginIsolated: true,
    allowedRealRoots: [corpus, path.join(ROOT, 'fonts')].filter(p => fs.existsSync(p)) });
  let browser, page;
  let reportFailure;
  const failure = new Promise((_, reject) => { reportFailure = reject; });
  failure.catch(() => {});
  const logs = [], errors = [];
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-first-run', '--no-default-browser-check'] });
    page = await browser.newPage();
    page.on('console', message => {
      const line = message.text();
      logs.push(line);
      fs.appendFileSync(path.join(output, 'live.log'), line + '\n');
      if (/host import glide_submit threw|UNIMPLEMENTED API:|\[launchApp\] failed:|worker thread \d+ trapped/.test(line))
        reportFailure(new Error(line));
      if (/Glide|UNIMPLEMENTED|RuntimeError|FATAL|voodooa\.dll loaded/i.test(line)) console.log(line);
    });
    page.on('pageerror', error => { errors.push(String(error)); console.error(String(error)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?threads&glide-renderer=${renderer}`,
      { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(async () => {
      await setThreads(true);
      // Bounded original packet/resource samples make a real-game rendering
      // defect reproducible without guessing from a black screenshot.
      window.__glideSamples = [];
      const draw = GlideBackend.Device.prototype.draw;
      const sampled = new Set();
      GlideBackend.Device.prototype.draw = function(bytes, primitive) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const state = Array.from({ length: 64 }, (_, i) => view.getUint32(i * 4, true));
        const stage = this.stats.triangles > 100000 ? 'race' : 'startup';
        const key = stage + ':' + state.slice(0, 20).join(',');
        if (!sampled.has(key) && sampled.size < 12) {
          sampled.add(key);
          const layout = GlideBackend.textureLayout(state[33], state[34], state[35], state[36], state[37]);
          const base64 = data => {
            let result = '';
            for (let i = 0; i < data.length; i += 8192)
              result += String.fromCharCode(...data.subarray(i, i + 8192));
            return btoa(result);
          };
          window.__glideSamples.push({ stage, primitive, width: this.width, height: this.height,
            colorFormat: this.colorFormat, state, packet: base64(bytes.slice(0, 256 + 60 * 300)),
            texture: base64(this.ram.slice(state[32], state[32] + layout.size)),
            palette: Array.from(this.palette), fogTable: Array.from(this.fogTable || []) });
        }
        return draw.call(this, bytes, primitive);
      };
      // Override this page's launch configuration, never the shared fixture.
      const app = window.wineApps.APPS.nfs3_demo;
      const keyPath = 'HKLM\\Software\\Electronic Arts\\Need For Speed III Demo';
      app.startupRegistry = [
        ...(app.startupRegistry || []).filter(entry => entry.keyPath.toLowerCase() !== keyPath.toLowerCase()),
        { keyPath, valueName: 'Thrash Driver', type: 1, data: 'voodoo' },
        { keyPath, valueName: 'D3D Device', type: 4, data: 0 },
      ];
      document.getElementById('app-select').value = 'nfs3_demo';
      await launchApp();
      if (!runningApps.some(app => app.name === 'nfs3_demo')) throw new Error('NFS III launch failed');
    });
    const observe = () => page.evaluate(async () => {
      const wine = runningApps.find(app => app.name === 'nfs3_demo')?.wine;
      const drawable = wine?.hostCtx?.glideBridge?.layer?.canvas;
      const context = drawable?.getContext('2d');
      const pixels = context?.getImageData(0, 0, drawable.width, drawable.height).data;
      const compositor = wine?.hostCtx?.glideBridge?._renderer();
      const shown = compositor?.ctx?.getImageData(0, 0,
        compositor.canvas.width, compositor.canvas.height).data;
      const colored = data => {
        let count = 0;
        if (data) for (let i = 0; i < data.length; i += 4)
          if (Math.max(data[i], data[i + 1], data[i + 2]) -
              Math.min(data[i], data[i + 1], data[i + 2]) > 20) count++;
        return count;
      };
      let transparentPixels = 0;
      if (pixels) for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] !== 255) transparentPixels++;
      const hash = pixels ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)))
        .map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
      return { isolated: crossOriginIsolated, running: wine?.running,
        drawableHash: hash,
        drawableColoredPixels: colored(pixels), displayedColoredPixels: colored(shown),
        transparentPixels,
        attached: !!wine?.hostCtx?.glideBridge?.win,
        worker: wine?.threadManager?.backend,
        glide: wine?.hostCtx?.glideBridge?.device?.stats,
        bridge: wine?.hostCtx?.glideBridge?.stats };
    });
    // Loading art is not race geometry. Require sustained draws and swaps.
    await Promise.race([failure, page.waitForFunction(() => {
      const stats = runningApps.find(app => app.name === 'nfs3_demo')?.wine?.hostCtx?.glideBridge?.device?.stats;
      return stats?.triangles > 100000 && stats?.presents > 20;
    }, { timeout: 180000, polling: 500 })]);
    const before = await observe();
    await page.screenshot({ path: path.join(output, 'race-before.png') });
    assert(before.drawableColoredPixels > 10000, 'race drawable must contain visible colored geometry');
    assert.strictEqual(before.transparentPixels, 0, 'RGB565 presentation must be opaque');
    assert(before.displayedColoredPixels > 10000, 'the page compositor must display the game');
    const center = await page.evaluate(() => {
      const wine = runningApps.find(app => app.name === 'nfs3_demo').wine;
      const rect = wine.hostCtx.glideBridge._renderer().canvas.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(center.x, center.y);
    await page.keyboard.down('ArrowUp');
    await Promise.race([failure, page.waitForFunction(previous => {
      const stats = runningApps.find(app => app.name === 'nfs3_demo')?.wine?.hostCtx?.glideBridge?.device?.stats;
      return stats?.triangles > previous.triangles + 30000 &&
        stats?.presents > previous.presents + 60 && Date.now() - previous.inputStarted > 6000;
    }, { timeout: 180000, polling: 500 }, { ...before.glide, inputStarted: Date.now() })]);
    await page.keyboard.up('ArrowUp');
    const after = await observe();
    await page.screenshot({ path: path.join(output, 'race-after.png') });
    fs.writeFileSync(path.join(output, 'stats.json'), JSON.stringify({ renderer,
      fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'),
      browser: await browser.version(), before, after }, null, 2));
    assert(after.isolated && after.running, 'isolated game must remain running');
    assert(after.attached, 'presented Glide surface must be attached to its game window');
    assert.strictEqual(after.worker, 'worker');
    assert.strictEqual(after.glide.errors, 0);
    assert.strictEqual(after.transparentPixels, 0, 'RGB565 presentation must stay opaque');
    assert(before.drawableHash && after.drawableHash && before.drawableHash !== after.drawableHash,
      'the Glide drawable itself must advance, independently of desktop clock/cursor changes');
    assert(logs.some(line => /LoadLibrary.*voodooa\.dll loaded/i.test(line)), 'original Glide renderer must load');
    assert(!logs.some(line => /LoadLibrary.*(?:softtria|d3da)\.dll loaded/i.test(line)), 'unexpected game renderer');
    assert.deepStrictEqual(errors, []);
    assert(!logs.some(line => /UNIMPLEMENTED API:|RuntimeError|FATAL:|DllMain did not return|eip-zero/i.test(line)), 'guest failure');
    console.log(`PASS NFS III Glide ${renderer} sustained race geometry and swaps; screenshots require visual HUD/input review`);
  } finally {
    if (page && !page.isClosed()) {
      const samples = await page.evaluate(() => window.__glideSamples || []).catch(() => []);
      fs.writeFileSync(path.join(output, 'draw-samples.json'), JSON.stringify(samples));
      const drawable = await page.evaluate(() => {
        const wine = typeof runningApps !== 'undefined'
          ? runningApps.find(app => app.name === 'nfs3_demo')?.wine : null;
        return wine?.hostCtx?.glideBridge?.layer?.canvas?.toDataURL('image/png').split(',')[1];
      }).catch(() => null);
      if (drawable) fs.writeFileSync(path.join(output, 'drawable-last.png'), Buffer.from(drawable, 'base64'));
      const last = await page.evaluate(() => {
        const wine = typeof runningApps !== 'undefined'
          ? runningApps.find(app => app.name === 'nfs3_demo')?.wine : null;
        const bridge = wine?.hostCtx?.glideBridge;
        const renderer = bridge?._renderer();
        return { running: wine?.running, bridge: bridge?.stats, device: bridge?.device?.stats,
          hwnd: bridge?.device?.hwnd, attachedHwnd: bridge?.win?.hwnd,
          windows: renderer && Object.values(renderer.windows).map(win => ({hwnd:win.hwnd,
            visible:win.visible,isChild:win.isChild,x:win.x,y:win.y,w:win.w,h:win.h,
            layer:!!win._dxFrameLayer,sameLayer:win._dxFrameLayer===bridge.layer,
            back:!!win._backCanvas, parent:win.parent, owner:win.owner})),
          state: bridge?.device?.lastDrawState };
      }).catch(error => ({ error: String(error) }));
      fs.writeFileSync(path.join(output, 'last-stats.json'), JSON.stringify(last, null, 2));
    }
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'last.png') }).catch(() => {});
    fs.writeFileSync(path.join(output, 'console.log'), logs.join('\n'));
    fs.writeFileSync(path.join(output, 'errors.json'), JSON.stringify(errors, null, 2));
    if (browser) await browser.close();
    await closeServer(server);
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
