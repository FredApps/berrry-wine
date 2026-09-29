#!/usr/bin/env node
'use strict';

// Local original-demo comparison. The benchmark server overrides only the
// NFS III RNG-seeding GetTickCount call; shipped code and guest files stay intact.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('../test/static-server');
const ROOT = path.resolve(__dirname, '..');
if (process.argv.includes('--help')) {
  console.log('Usage: node tools/nfs-renderer-bench.js [--cases=glide,d3d,software,glide-software] [--seconds=30] [--samples=2] [--seed=12345] [--out=build/nfs-renderer-bench]\nRequires the original nfs3_demo fixture and a current build. Runs headful Chrome serially. Saves screenshots, hardware-renderer evidence, frame counters, CPU time, and machine load. Seed instrumentation is specific to this demo.');
  process.exit(0);
}
const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const cases = arg('cases', 'glide,d3d,software,glide-software').split(',');
const seconds = Number(arg('seconds', '30'));
const samples = Number(arg('samples', '2'));
const seed = Number(arg('seed', '12345')) >>> 0;
const profileEnabled = process.argv.includes('--profile');
assert(Number.isFinite(seconds) && seconds > 0, 'seconds must be positive');
assert(Number.isInteger(samples) && samples >= 0, 'samples must be a nonnegative integer');
const output = path.resolve(ROOT, arg('out', 'build/nfs-renderer-bench'));
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const configurations = {
  glide: { driver: 'voodoo', dll: 'voodooa.dll', glide: 'webgl', gpu: false },
  d3d: { driver: 'd3d', dll: 'd3da.dll', glide: 'webgl', gpu: true },
  software: { driver: 'softtri', dll: 'softtria.dll', glide: 'webgl', gpu: false },
  'glide-software': { driver: 'voodoo', dll: 'voodooa.dll', glide: 'software', gpu: false },
};
for (const name of cases) assert(configurations[name], `unknown case ${name}`);
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixtureSha256 = hash(path.join(ROOT, 'test/binaries/candidates/need-for-speed-3-demo/game/nfs3demo.exe'));
assert.equal(fixtureSha256, '0defab3eeb22ee4b6e0007a4d5b26a99d868008ba77e2b9bd3ef770e924548ad',
  'seed instrumentation requires the inspected original NFS III demo');

// The Watcom wrapper pushes three registers before CALL GetTickCount.
// Matching both returns confines the override to the one srand seed read.
const workerFile = path.join(ROOT, 'lib/guest-worker.js');
const needle = '      const result = await WebAssembly.instantiate(msg.module, built.imports);';
const originalWorker = fs.readFileSync(workerFile, 'utf8');
const d3dCensus = `
if (globalThis.D3DIMGpu) {
  const prototype = globalThis.D3DIMGpu.D3DIMGpu.prototype, draw = prototype._draw;
  prototype._draw = function(wa) {
    const before = this.stats.fallbacks, result = draw.call(this, wa);
    if (this.stats.fallbacks !== before) {
      const key = JSON.stringify({primitive:this._u32(wa+4),vertexType:this._u32(wa+8),count:this._u32(wa+16)});
      const census = this.stats.fallbackKinds || (this.stats.fallbackKinds = {});
      census[key] = (census[key] || 0) + 1;
    }
    return result;
  };
}
`;
const rendererProbe = `
if (typeof OffscreenCanvas === 'function') {
  const getContext = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function(...args) {
    const gl = getContext.apply(this, args);
    if (gl && /webgl/.test(args[0])) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      console.log('[nfs-bench-gpu] ' + (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'));
    }
    return gl;
  };
}
`;
assert.equal(originalWorker.split(needle).length, 2, 'worker injection anchor must be unique');
const seededWorker = originalWorker.replace(needle, `
      if ((msg.slot || 0) === 0) {
        const originalTicks = built.imports.host.get_ticks;
        let armed = true, matched = false;
        built.imports.host.get_ticks = () => {
          if (armed && instance) {
            const ex = instance.exports, sp = ex.get_esp() >>> 0;
            if ((ex.guest_read32(sp) >>> 0) === 0x4b3c7c &&
                (ex.guest_read32(sp + 16) >>> 0) === 0x472107) {
              if (!matched) console.log('[nfs-bench] seeded srand=${seed} slot=' + msg.slot);
              matched = true;
              return ${seed};
            }
            if (matched) armed = false;
          }
          return originalTicks();
        };
      }
${needle}`);

async function observe(page) {
  return page.evaluate(() => {
    const wine = runningApps.find(app => app.name === 'nfs3_demo')?.wine;
    const ex = wine?.instance?.exports;
    const glide = wine?.hostCtx?.glideBridge?.device;
    const gl = glide?.backend?.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const draw = wine?.guestWorker?.d3dStats;
    const renderer = wine?.renderer;
    const wins = Object.values(renderer?.windows || {}).filter(w => w.visible && !w.isChild);
    const win = wins[wins.length - 1];
    const surface = win?._dxFrameLayer?.canvas || win?._backCanvas;
    const read = addr => ex?.guest_read32 ? ex.guest_read32(addr) >>> 0 : null;
    return { at: performance.now(), running: !!wine?.running,
      backend: wine?.threadManager?.backend, hidden: document.hidden,
      flips: window.__nfsBenchFlips, presents: window.__nfsBenchPresents, swaps: glide?.stats.swaps,
      glide: glide?.stats, d3d: draw,
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      scene: { mode: read(0x6fb3b8), ai: read(0x6fb4f0),
        weather: read(0x6fb4cc), night: read(0x6fb4c8) },
      surface: surface ? { width: surface.width, height: surface.height } : null,
      display: ex ? { width: ex.get_display_mode_w?.(), height: ex.get_display_mode_h?.() } : null,
      perf: window.WinePerf?.snapshot(),
    };
  });
}

async function runCase(server, name) {
  const config = configurations[name];
  const dir = path.join(output, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'console.log'), '');
  let browser, page;
  const errors = [], dlls = new Set();
  const report = { name, config, samples: [], loadAtLaunch: os.loadavg() };
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: false,
      protocolTimeout: 600000, args: ['--no-first-run', '--no-default-browser-check',
        '--window-size=900,700', '--autoplay-policy=no-user-gesture-required'] });
    report.browser = await browser.version();
    report.launchArgs = browser.process().spawnargs;
    const system = await browser.target().createCDPSession();
    report.gpuInfo = (await system.send('SystemInfo.getInfo')).gpu;
    const cpu = async () => (await system.send('SystemInfo.getProcessInfo')).processInfo;
    page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    page.on('console', message => {
      const line = message.text();
      fs.appendFileSync(path.join(dir, 'console.log'), line + '\n');
      if (/LoadLibrary.*(?:voodoo\w*|d3da|softtria)\.dll loaded/.test(line)) { dlls.add(line); console.log(name, line); }
      if (/\[nfs-bench\]/.test(line)) { report.seedHook = true; console.log(name, line); }
      if (/\[nfs-bench-gpu\]/.test(line)) report.activeGpuRenderer = line;
      if (/worker thread \d+ trapped|UNIMPLEMENTED API:|host import .* threw|\[launchApp\] failed:|FATAL:/.test(line)) errors.push(line);
    });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?threads&perf&glide-renderer=${config.glide}${config.gpu ? '&d3dim-gpu' : ''}`,
      { waitUntil: 'networkidle2', timeout: 90000 });
    await page.bringToFront();
    await page.evaluate(async config => {
      window.__nfsBenchFlips = 0;
      window.__nfsBenchPresents = 0;
      const getImports = WineAssembly.prototype.getImports;
      WineAssembly.prototype.getImports = function(...args) {
        const result = getImports.apply(this, args), trace = result.host.dx_trace;
        result.host.dx_trace = function(kind, ...rest) {
          if (kind === 6) window.__nfsBenchFlips++;
          if (kind === 5) window.__nfsBenchPresents++;
          return trace.call(this, kind, ...rest);
        };
        return result;
      };
      await setThreads(true);
      const app = window.wineApps.APPS.nfs3_demo;
      const keyPath = 'HKLM\\Software\\Electronic Arts\\Need For Speed III Demo';
      app.startupRegistry = [{ keyPath, valueName: 'Thrash Driver', type: 1, data: config.driver },
        { keyPath, valueName: 'D3D Device', type: 4, data: 0 }];
      document.getElementById('app-select').value = 'nfs3_demo';
      await launchApp();
      window.__nfsBenchLaunched = performance.now();
    }, config);
    let lastProgress = 0;
    const launchStart = Date.now();
    while (true) {
      const state = await observe(page);
      if (errors.length) throw new Error(errors[0]);
      const triangles = config.driver === 'voodoo' ? state.glide?.triangles : state.d3d?.triangles;
      const ready = config.driver === 'softtri'
        ? state.presents > 100 && Date.now() - launchStart > 40000
        : triangles > 100000;
      if (ready) break;
      if (Date.now() - lastProgress > 20000) {
        console.log(name, 'loading', JSON.stringify({flips:state.flips,swaps:state.swaps,triangles,scene:state.scene}));
        lastProgress = Date.now();
      }
      assert(Date.now() - launchStart < 600000, 'race readiness timed out');
      await sleep(1000);
    }
    report.ready = await observe(page);
    assert(report.seedHook, 'deterministic seed hook must execute');
    if (seed === 12345) assert.deepStrictEqual(report.ready.scene, {mode:3, ai:0, weather:1, night:0});
    assert([...dlls].some(line => line.includes(config.dll)), 'requested original renderer must load');
    if (config.driver === 'softtri') {
      const base = Number([...dlls].find(line => line.includes(config.dll)).match(/loaded at (0x[0-9a-f]+)/i)[1]);
      report.softwareRaster = await page.evaluate(base => {
        const ex = runningApps.find(app => app.name === 'nfs3_demo').wine.instance.exports;
        const r = off => ex.guest_read32(base + off) >>> 0;
        return {modeWidth:r(0x400c4), modeHeight:r(0x400c8),
          rasterWidth:r(0x3e0f4), rasterHeight:r(0x3e0f8),
          backWidth:r(0x3e10c), backHeight:r(0x3e110), bytePitch:r(0x3e0ec)};
      }, base);
    }
    assert.equal(report.ready.backend, 'worker');
    if (config.gpu || (config.driver === 'voodoo' && config.glide === 'webgl')) {
      const gpu = report.ready.glRenderer || report.activeGpuRenderer;
      assert(gpu && !/swiftshader|llvmpipe|software|unknown/i.test(gpu), 'hardware WebGL renderer required');
    }
    await page.screenshot({ path: path.join(dir, 'ready.png') });
    console.log(name, 'race ready', JSON.stringify(report.ready.scene), 'warming 10s');
    await sleep(10000);
    for (let i = 0; i < samples; i++) {
      await page.bringToFront();
      await page.screenshot({ path: path.join(dir, `sample-${i + 1}-before.png`) });
      const profilers = [];
      if (profileEnabled) {
        const targets = [{label:'page', client:await page.target().createCDPSession()},
          ...page.workers().map((worker, index) => ({label:'worker-' + index, client:worker.client, url:worker.url()}))];
        for (const target of targets) {
          if (!target.client) continue;
          await target.client.send('Profiler.enable');
          await target.client.send('Profiler.setSamplingInterval', {interval:1000});
          await target.client.send('Profiler.start');
          profilers.push(target);
        }
      }
      const loadBefore = os.loadavg(), cpuBefore = await cpu(), before = await observe(page);
      await sleep(seconds * 1000);
      const after = await observe(page), cpuAfter = await cpu(), loadAfter = os.loadavg();
      for (const target of profilers) {
        const { profile } = await target.client.send('Profiler.stop');
        fs.writeFileSync(path.join(dir, 'sample-' + (i+1) + '-' + target.label + '.cpuprofile'), JSON.stringify(profile));
      }
      assert(before.running && after.running && !before.hidden && !after.hidden, 'visible live game required');
      assert.deepStrictEqual(after.scene, before.scene, 'scene configuration must remain fixed');
      if (errors.length) throw new Error(errors[0]);
      assert.equal(after.glide?.errors || after.d3d?.errors || 0, 0);
      const frames = config.driver === 'voodoo' ? after.swaps - before.swaps
        : config.driver === 'softtri' ? after.presents - before.presents : after.flips - before.flips;
      const wallSeconds = (after.at - before.at) / 1000;
      const cpuByType = {};
      for (const p of cpuAfter) {
        const old = cpuBefore.find(q => q.id === p.id);
        if (old) cpuByType[p.type] = (cpuByType[p.type] || 0) + p.cpuTime - old.cpuTime;
      }
      const cpuSeconds = Object.values(cpuByType).reduce((a,b) => a+b,0);
      assert(frames > 0, 'no guest frame swaps in sample');
      const result = { frames, wallSeconds, fps: frames / wallSeconds,
        counter: config.driver === 'voodoo' ? 'grBufferSwap' : config.driver === 'softtri' ? 'dx_present' : 'IDirectDrawSurface::Flip',
        cpuSeconds, cpuMsPerFrame: 1000 * cpuSeconds / frames, cpuByType,
        loadBefore, loadAfter, contended: Math.max(loadBefore[0], loadAfter[0]) > 4,
        before, after };
      report.samples.push(result);
      console.log(name, `sample${i+1}`, JSON.stringify({fps:result.fps,cpuMsPerFrame:result.cpuMsPerFrame,frames,wallSeconds,loadBefore,loadAfter}));
      await page.screenshot({ path: path.join(dir, `sample-${i + 1}-after.png`) });
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
    }
  } catch (error) {
    report.failure = String(error.stack || error);
    console.error(name, report.failure);
  } finally {
    report.errors = errors;
    report.loadedRenderers = [...dlls];
    if (page && !page.isClosed()) {
      report.last = await observe(page).catch(() => null);
      await page.screenshot({path:path.join(dir,'last.png')}).catch(() => {});
    }
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
  }
  return report;
}

(async () => {
  const fixtureRoot = fs.realpathSync(path.join(ROOT, 'test/binaries/candidates'));
  const server = await startStaticServer({ root: ROOT, crossOriginIsolated: true,
    allowedRealRoots: [fixtureRoot, fs.realpathSync(path.join(ROOT, 'fonts'))],
    handleRequest(req, res) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (profileEnabled && pathname === '/lib/d3dim-gpu.js') {
        res.writeHead(200, {'Content-Type':'application/javascript','Cache-Control':'no-store',
          'Cross-Origin-Resource-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
        res.end(fs.readFileSync(path.join(ROOT,'lib/d3dim-gpu.js'),'utf8') + d3dCensus);
        return true;
      }
      if (pathname !== '/lib/guest-worker.js') return false;
      res.writeHead(200, {'Content-Type':'application/javascript','Cache-Control':'no-store',
        'Cross-Origin-Resource-Policy':'same-origin',
        'Cross-Origin-Embedder-Policy':'require-corp'});
      res.end(seededWorker + rendererProbe); return true;
    } });
  const meta = { startedAt: new Date().toISOString(), commit: execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    wasmSha256: hash(path.join(ROOT,'build/wine-assembly.wasm')), headful:true, seed, seconds, samples, profileEnabled,
    machine: { platform:os.platform(), arch:os.arch(), cpus:os.cpus().length, model:os.cpus()[0].model },
    fixtureSha256,
    results: [] };
  try {
    for (const name of cases) {
      meta.results.push(await runCase(server,name));
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(meta,null,2));
    }
  } finally { await closeServer(server); }
  if (meta.results.some(r => r.failure)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
