#!/usr/bin/env node
'use strict';

// Real browser gameplay baseline for selective dirty tracking. Server-only
// instrumentation: never skips a comparison or changes the shipped renderer.
// Example: node tools/bench-d3dim-gameplay.js --app=nfs3_demo --label=before
// Repeat with --label=after once a candidate exists. FPS counts guest Flip
// calls, not rAF callbacks. CPU profiles are optional to separate sampling
// overhead from the primary measurements. Captures require visual review.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('../test/static-server');
const ROOT = path.resolve(__dirname, '..');
const opt = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (process.argv.includes('--watch-cost-matrix')) {
  const { spawnSync } = require('child_process');
  const matrixOut = path.resolve(opt('out', path.join(ROOT, 'build/d3dim-gameplay-perf',
    'watch-cost-' + new Date().toISOString().replace(/[:.]/g, '-'))));
  const maxLoad = Number(opt('max-load', String(os.cpus().length * 2)));
  for (const game of ['nfs3_demo', 'gta2_demo']) {
    for (const [i, arm] of ['control', 'candidate', 'candidate', 'control'].entries()) {
      if (maxLoad > 0 && os.loadavg()[0] > maxLoad) {
        console.error(`Timing run stopped: load ${os.loadavg()[0].toFixed(1)} exceeds --max-load=${maxLoad}. Rerun when quieter.`);
        process.exit(2);
      }
      const result = spawnSync(process.execPath, [__filename, `--app=${game}`,
        `--seconds=${opt('seconds', '15')}`, '--windows=2', `--label=watch-${i}-${arm}`,
        `--out=${path.join(matrixOut, `${game}-${i}-${arm}`)}`,
        `--wasm=${path.join(ROOT, 'build/d3dim-watch-cost', arm + '.wasm')}`],
      { stdio: 'inherit', timeout: 300000 });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
  process.exit(0);
}
const app = opt('app', 'nfs3_demo');
const seconds = Number(opt('seconds', '20'));
const windows = Number(opt('windows', '3'));
const label = opt('label', 'baseline');
const audit = process.argv.includes('--audit');
const output = path.resolve(opt('out', path.join(ROOT, 'build/d3dim-gameplay-perf', `${app}-${label}`)));
assert(['nfs3_demo', 'gta2_demo'].includes(app), 'only established gameplay routes are supported');
assert(seconds > 0 && windows > 0 && Number.isInteger(windows));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function replaceOnce(source, from, to) {
  assert(source.includes(from) && source.indexOf(from) === source.lastIndexOf(from), `instrumentation seam changed: ${from}`);
  return source.replace(from, to);
}
function instrumentGpu(source) {
  source = replaceOnce(source, '      this.textureSerial = 0;', `      this.textureSerial = 0;
      this.benchWatches = new Set();`);
  source = replaceOnce(source, '    _texture(t, d) {', `    _texture(t, d) {
      this._benchWatch(d.texDib, d.texPitch * d.texHeight);`);
  source = replaceOnce(source, '    _prepare(t, d, overwritesAll) {', `    _benchWatch(address, length) {
      const watch = this.getExports().bench_watch_range;
      if (!watch) return;
      const key = address + ':' + length;
      if (this.benchWatches.has(key)) return;
      watch(address, length);
      this.benchWatches.add(key);
    }
    _prepare(t, d, overwritesAll) {
      this._benchWatch(d.dib, d.pitch * d.height);`);
  source = replaceOnce(source, '  const bytesEqual = (a, b) => {', '  const rawBytesEqual = (a, b) => {');
  source = replaceOnce(source, '  class D3DIMGpu {', `
  const probe = { textureChecks: 0, textureCheckMs: 0, textureEqualBytes: 0,
    auditChecks: 0, auditCheckMs: 0, auditEqualBytes: 0,
    targetChecks: 0, targetCheckMs: 0, targetEqualBytes: 0 };
  const bytesEqual = (a, b, kind = 'target') => {
    const start = now();
    const same = rawBytesEqual(a, b);
    probe[kind + 'CheckMs'] += now() - start;
    probe[kind + 'Checks']++;
    if (same) probe[kind + 'EqualBytes'] += a.length;
    return same;
  };
  class D3DIMGpu {`);
  source = replaceOnce(source, 'bytesEqual(raw, cached.raw)', "bytesEqual(raw, cached.raw, 'texture')");
  if (source.includes('bytesEqual(bytes.subarray(a, b), shadow.subarray(a, b))'))
    source = replaceOnce(source, 'bytesEqual(bytes.subarray(a, b), shadow.subarray(a, b))',
      "bytesEqual(bytes.subarray(a, b), shadow.subarray(a, b), 'audit')");
  source = replaceOnce(source, 'snapshot() { return Object.assign({}, this.stats); }', `snapshot() {
    const gl = this.targets.values().next().value?.device.gpu.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return Object.assign({}, this.stats, probe, {
      guestFlips: globalThis.__benchGuestFlips || 0,
      experimentalWatchRanges: this.benchWatches.size,
      gpuRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      measuredAt: performance.now(),
    });
  }`);
  return source;
}
function instrumentWorker(source) {
  return replaceOnce(source, '      const result = await WebAssembly.instantiate(msg.module, built.imports);', `
      const originalDxTrace = built.imports.host.dx_trace;
      built.imports.host.dx_trace = (...args) => {
        if (args[0] === 6) globalThis.__benchGuestFlips = (globalThis.__benchGuestFlips || 0) + 1;
        return originalDxTrace(...args);
      };
      const result = await WebAssembly.instantiate(msg.module, built.imports);
      ${(audit ? '(result.exports ? result : result.instance).exports.set_page_watch_audit(1);' : '')}`);
}

(async () => {
  assert(!fs.existsSync(path.join(output, 'results.json')), 'output already contains a run; choose a new --label or --out');
  fs.mkdirSync(output, { recursive: true });
  // Pin these artifacts throughout the run even if a shared-tree build lands.
  const wasm = fs.readFileSync(path.resolve(opt('wasm', path.join(ROOT, 'build/wine-assembly.wasm'))));
  const gpuSource = fs.readFileSync(path.join(ROOT, 'lib/d3dim-gpu.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(ROOT, 'lib/guest-worker.js'), 'utf8');
  const overrides = new Map([
    ['/build/wine-assembly.wasm', ['application/wasm', wasm]],
    ['/lib/d3dim-gpu.js', ['application/javascript', instrumentGpu(gpuSource)]],
    ['/lib/guest-worker.js', ['application/javascript', instrumentWorker(workerSource)]],
  ]);
  const server = await startStaticServer({ root: ROOT, crossOriginIsolated: true,
    handleRequest(req, res) {
      const entry = overrides.get(new URL(req.url, 'http://localhost').pathname);
      if (!entry) return false;
      res.writeHead(200, { 'Content-Type': entry[0], 'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      res.end(entry[1]);
      return true;
    },
  });
  let browser;
  const logs = [], errors = [], results = [];
  const manifest = { app, label, seconds, windows, started: new Date().toISOString(),
    platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model,
    loadBefore: os.loadavg(), headless: process.argv.includes('--headless'),
    profiled: process.argv.includes('--profile'), wasmSha256: hash(wasm), gpuSha256: hash(gpuSource),
    audit, note: 'Guest Flip FPS; verify gameplay screenshots. --audit compares unchanged pages against pixel shadows and fails closed on missed writes.' };
  fs.writeFileSync(path.join(output, 'runtime.wasm'), wasm);
  fs.writeFileSync(path.join(output, 'd3dim-gpu.js'), gpuSource);
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: manifest.headless, args: ['--no-first-run', '--no-default-browser-check'], protocolTimeout: 120000,
    });
    manifest.browser = await browser.version();
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    page.on('console', message => {
      logs.push(message.text());
      if (/FATAL|RuntimeError|d3dim-gpu|guest main thread|UNIMPLEMENTED/i.test(message.text())) console.log(message.text());
    });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?threads`, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('page loaded', app);
    await page.evaluate(async app => {
      await setThreads(true);
      document.getElementById('app-select').value = app;
      await launchApp();
    }, app);
    console.log('launched', app);
    await page.screenshot({ path: path.join(output, 'launched.png') });
    assert(await page.evaluate(() => runningApps[0]?.wine.threadManager?.backend === 'worker'),
      'Worker startup failed; refuse a cooperative fallback measurement');
    if (app === 'gta2_demo') {
      await pause(15000);
      await page.screenshot({ path: path.join(output, 'menu.png') });
      await page.keyboard.down('Enter'); await pause(500); await page.keyboard.up('Enter');
    }
    await page.waitForFunction(() => runningApps[0]?.wine.guestWorker?.d3dStats?.triangles > 100000,
      { timeout: 150000, polling: 500 });
    await pause(10000);
    const observe = () => page.evaluate(() => {
      const wine = runningApps[0]?.wine;
      return { isolated: crossOriginIsolated, backend: wine?.threadManager?.backend,
        running: wine?.running, d3d: wine?.guestWorker?.d3dStats };
    });
    for (let i = 0; i < windows; i++) {
      const profiles = [];
      if (manifest.profiled) for (const w of page.workers()) {
        await w.client.send('Profiler.enable');
        await w.client.send('Profiler.start');
        profiles.push(w);
      }
      await page.screenshot({ path: path.join(output, `window-${i}-start.png`) });
      const before = await observe();
      assert(before.isolated && before.backend === 'worker' && before.running, 'Worker gameplay must remain active');
      await pause(seconds * 1000);
      const after = await observe();
      assert(after.running && after.d3d.errors === 0, 'gameplay failed');
      assert.equal(after.d3d.dirtyAuditMisses || 0, 0, 'dirty-page audit missed a write');
      const delta = Object.fromEntries(Object.keys(after.d3d).filter(k => typeof after.d3d[k] === 'number')
        .map(k => [k, after.d3d[k] - (before.d3d[k] || 0)]));
      const elapsed = delta.measuredAt / 1000;
      const result = { window: i, elapsed, fps: delta.guestFlips / elapsed,
        textureCheckMsPerFrame: delta.textureCheckMs / delta.guestFlips,
        targetCheckMsPerFrame: delta.targetCheckMs / delta.guestFlips, delta, before, after };
      results.push(result);
      console.log(JSON.stringify({ app, label, ...result }));
      await page.screenshot({ path: path.join(output, `window-${i}-end.png`) });
      let n = 0;
      for (const w of profiles) {
        const { profile } = await w.client.send('Profiler.stop');
        fs.writeFileSync(path.join(output, `window-${i}-worker-${n++}.cpuprofile`), JSON.stringify(profile));
      }
    }
    assert(results.every(r => r.delta.guestFlips > 0 && r.delta.triangles > 0), 'must measure advancing 3D gameplay');
  } finally {
    manifest.loadAfter = os.loadavg();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ manifest, results, errors }, null, 2));
    fs.writeFileSync(path.join(output, 'console.txt'), logs.join('\n'));
    if (browser) await browser.close();
    await closeServer(server);
  }
  assert.deepStrictEqual(errors, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
