#!/usr/bin/env node
'use strict';

// Eager synchronization only. The full arm changes one served constructor option;
// neither guest files nor shipped renderer sources are modified.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('../test/static-server');
const gameplayRoute = require('./mw3-gameplay-route');
const ROOT = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (process.argv.includes('--help')) {
  console.log('Usage: node tools/bench-mw3-readbacks.js [--full-readbacks] [--seconds=15] [--samples=1]\n' +
    '  [--warmup-ms=15000] [--out=build/mw3-readbacks-bounded] [--wasm=FILE]\n' +
    '  [--swiftshader] [--no-sandbox] [--source-commit=REV]\n' +
    'Headful Chrome (CHROME env), threads and shared WebGL worker required. Creates pilot ACE,\n' +
    'deploys via the existing cockpit route, then measures without image polling. No lazy sync.\n' +
    'SwiftShader requires explicit opt-in; quote its byte counts, not hardware-GPU FPS.');
  process.exit(0);
}
const full = process.argv.includes('--full-readbacks');
const softwareGpu = process.argv.includes('--swiftshader');
const seconds = Number(arg('seconds', '15'));
const samples = Number(arg('samples', '1'));
const warmup = Number(arg('warmup-ms', '15000'));
assert(Number.isFinite(seconds) && seconds > 0);
assert(Number.isInteger(samples) && samples > 0);
assert(Number.isFinite(warmup) && warmup >= 0);
const output = path.resolve(ROOT, arg('out', `build/mw3-readbacks-${full ? 'full' : 'bounded'}`));
assert(!fs.existsSync(path.join(output, 'result.json')), 'Choose a fresh --out directory');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wasmPath = path.resolve(ROOT, arg('wasm', 'build/wine-assembly.wasm'));
const wasm = fs.readFileSync(wasmPath);
const gpu = fs.readFileSync(path.join(ROOT, 'lib/d3dim-gpu.js'), 'utf8');
const anchor = 'this.boundedReadback = options.boundedReadback !== false;';
assert.equal(gpu.split(anchor).length, 2, 'Unique bounded-readback constructor option required');
const servedGpu = full ? gpu.replace(anchor, 'this.boundedReadback = false;') : gpu;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function observe(page) {
  return page.evaluate(() => {
    const wine = runningApps.find(app => app.name === 'mw3')?.wine;
    const owner = wine?.hostCtx?.sharedD3DIM;
    const draw = owner?.stats || wine?.guestWorker?.d3dStats;
    return {
      at: performance.now(), running: !!wine?.running, hidden: document.hidden,
      isolated: crossOriginIsolated, backend: wine?.threadManager?.backend,
      presents: window.__mw3Presents, d3d: draw || null,
      guest: wine?.guestWorker?.d3dStats || null, glRenderer: owner?.glRenderer || draw?.glRenderer || null,
      endpoints: wine?._renderWorkerManager ? [...wine._renderWorkerManager.ports.values()].map(p => p.options) : [],
      display: { width: wine?.instance?.exports.get_display_mode_w?.(), height: wine?.instance?.exports.get_display_mode_h?.() }
    };
  });
}
function validate(state) {
  assert(state.running && !state.hidden && state.isolated && state.backend === 'worker', 'Visible isolated worker gameplay required');
  assert(state.endpoints.some(e => e.api === 'legacy' && e.backend === 'webgl'), 'Actual shared legacy D3DIM WebGL endpoint required');
  assert(state.d3d?.draws > 0 && state.d3d?.syncs > 0, 'Actual GPU draws and eager readbacks required');
  assert.equal(state.d3d.errors || 0, 0, 'GPU errors');
  assert(state.glRenderer, 'Actual GL renderer string required');
  if (!softwareGpu) assert(!/swiftshader|llvmpipe|software|unknown/i.test(state.glRenderer), 'Software GL requires --swiftshader');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), app: 'mw3', route: 'tools/mw3-gameplay-route.js',
    commit: arg('source-commit', null) || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    fullReadbacks: full, boundedReadbacks: !full, lazySync: false, softwareGpu, headful: true,
    seconds, samples, warmup, wasmPath, wasmSha256: digest(wasm),
    gpuSha256: digest(gpu), servedGpuSha256: digest(servedGpu),
    fixtureSha256: digest(fs.readFileSync(path.join(ROOT, 'test/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe'))),
    sourceSha256: Object.fromEntries(['lib/d3dim-render-worker.js', 'lib/render-worker.js', 'lib/d3d-render-worker.js',
      'lib/guest-worker.js', 'lib/region-map.generated.js', 'tools/mw3-gameplay-route.js'].map(file =>
      [file, digest(fs.readFileSync(path.join(ROOT, file)))])),
    machine: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, model: os.cpus()[0].model },
    loadAtLaunch: os.loadavg(), results: [], errors: [],
    note: 'Stationary cockpit still simulates; independent launches are not identical geometry. No image polling or profiling in measured windows. GPU counters arrive at normal game fences.'
  };
  fs.writeFileSync(path.join(output, 'served-d3dim-gpu.js'), servedGpu);
  fs.writeFileSync(path.join(output, 'console.log'), '');
  let browser, page, server;
  try {
    server = await startStaticServer({ root: ROOT, crossOriginIsolated: true,
      rewritePath: pathname => pathname.startsWith('/binaries/') ? '/test' + pathname : pathname,
      allowedRealRoots: [fs.realpathSync(path.join(ROOT, 'test/binaries'))],
      handleRequest(req, res) {
        const url = new URL(req.url, 'http://localhost').pathname;
        const value = url === '/lib/d3dim-gpu.js' ? ['application/javascript', servedGpu]
          : url === '/build/wine-assembly.wasm' ? ['application/wasm', wasm] : null;
        if (!value) return false;
        res.writeHead(200, { 'Content-Type': value[0], 'Cache-Control': 'no-store',
          'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
        res.end(value[1]); return true;
      }
    });
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false, protocolTimeout: 600000,
      args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
        ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []),
        ...(softwareGpu ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])] });
    report.browser = await browser.version();
    report.launchArgs = browser.process().spawnargs;
    const system = await browser.target().createCDPSession();
    report.gpuInfo = (await system.send('SystemInfo.getInfo')).gpu;
    const cpu = async () => (await system.send('SystemInfo.getProcessInfo')).processInfo;
    page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
    const fatal = message => {
      report.errors.push(message);
      page.evaluate(() => { window.__mw3Fatal = true; }).catch(() => {});
    };
    page.on('console', message => {
      const line = message.text();
      fs.appendFileSync(path.join(output, 'console.log'), line + '\n');
      if (/worker thread \d+ trapped|UNIMPLEMENTED API:|host import .* threw|\[launchApp\] failed:|FATAL:/.test(line)) fatal(line);
    });
    page.on('pageerror', error => fatal(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&threads&d3d-renderer=webgl`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.bringToFront();
    await page.evaluate(async () => {
      window.__mw3Presents = 0;
      const original = WineAssembly.prototype.getImports;
      WineAssembly.prototype.getImports = function(...args) {
        const imports = original.apply(this, args), trace = imports.host.dx_trace;
        imports.host.dx_trace = function(kind, ...rest) {
          if (kind === 5) window.__mw3Presents++;
          return trace.call(this, kind, ...rest);
        };
        return imports;
      };
      await setThreads(true);
      document.getElementById('app-select').value = 'mw3';
      if (document.getElementById('app-select').value !== 'mw3') throw new Error('MW3 missing from picker');
      await launchApp();
      setRuntimeLogging(false);
    });
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    await page.waitForFunction(() => window.__mw3Fatal || window.__mw3Presents > 120,
      { timeout: 240000, polling: 500 });
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    await pause(warmup);
    await gameplayRoute(page, output);
    await pause(5000);
    validate(await observe(page));
    for (let i = 0; i < samples; i++) {
      await page.screenshot({ path: path.join(output, `sample-${i + 1}-before.png`) });
      const loadBefore = os.loadavg(), cpuBefore = await cpu(), before = await observe(page);
      // No image reads, input, CDP sampling or stat polling during this window.
      await pause(seconds * 1000);
      const after = await observe(page), cpuAfter = await cpu(), loadAfter = os.loadavg();
      validate(before); validate(after);
      const frames = after.presents - before.presents, wallSeconds = (after.at - before.at) / 1000;
      assert(frames > 0 && after.guest.triangles > before.guest.triangles, 'Cockpit presents and geometry must advance');
      assert.equal(report.errors.length, 0, report.errors.join('\n'));
      const delta = Object.fromEntries(Object.keys(after.d3d).filter(k => typeof after.d3d[k] === 'number' &&
        typeof before.d3d[k] === 'number').map(k => [k, after.d3d[k] - before.d3d[k]]));
      const cpuByType = {};
      for (const p of cpuAfter) {
        const old = cpuBefore.find(q => q.id === p.id);
        if (old) cpuByType[p.type] = (cpuByType[p.type] || 0) + p.cpuTime - old.cpuTime;
      }
      const result = { before, after, delta, frames, counter: 'dx_present', wallSeconds, fps: frames / wallSeconds,
        perFrame: Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, v / frames])),
        cpuByType, cpuMsPerFrame: 1000 * Object.values(cpuByType).reduce((a, b) => a + b, 0) / frames,
        loadBefore, loadAfter };
      report.results.push(result);
      await page.screenshot({ path: path.join(output, `sample-${i + 1}-after.png`) });
      console.log(JSON.stringify({ sample: i + 1, frames, fps: result.fps, perFrame: result.perFrame }));
    }
  } catch (error) {
    report.failure = error.stack || String(error);
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
    console.error(report.failure);
  } finally {
    report.loadAtEnd = os.loadavg();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    if (server) await closeServer(server);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
