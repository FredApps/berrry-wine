#!/usr/bin/env node
'use strict';

// Original NFS II software demo versus SE Glide demo: editions differ.
// No guest clock/RNG overrides. Run cases serially, with screenshot checkpoints.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('../test/static-server');
const ROOT = path.resolve(__dirname, '..');
const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
if (process.argv.includes('--help')) {
  console.log(`Usage: node tools/nfs2-renderer-bench.js [options]
  --cases=originalsoftware,seglide[,seglidesoftware]
  --se-fixture=/absolute/path/to/extracted/demo
  --stage=menu|race|measure  --continue-file=/tmp/menu-reviewed
  --seconds=30 --samples=2 --accelerate (default: stationary)
  --trace-api=LoadLibraryA,GetProcAddress (diagnostics only, not timing)
  --menu-click=130,310 --menu-wait=35 --race-wait=25 --out=build/nfs2-renderer-bench

Prepare the original public SE 3Dfx demo (no full-game assets required):
  curl -L --fail -o /private/tmp/nfs2sea-demo.zip https://www.classicdosgames.com/files/games/electronicarts/nfs2sea.zip
  unzip -n /private/tmp/nfs2sea-demo.zip -d /private/tmp/nfs2sea-demo
  node tools/nfs2-renderer-bench.js --se-fixture=/private/tmp/nfs2sea-demo --stage=menu
Archive SHA256: 614875b33de12565fa395bc05070c0bb83b5905acf4eb8b39f7bed060d0b4d2e
Without --se-fixture, build/nfs2se-config.json is used for SE cases.
Inspect menu.png and ready.png before reporting a race measurement.
The original and SE demos use different editions/tracks; this is not a renderer-only A/B.`);
  process.exit(0);
}
const cases = arg('cases', 'originalsoftware,seglide').split(',');
const seconds = Number(arg('seconds', '30'));
const samples = Number(arg('samples', '2'));
// Default measurement leaves the car stationary; --accelerate opts into driving.
const accelerate = process.argv.includes('--accelerate');
const stage = arg('stage', 'measure');
assert(['menu', 'race', 'measure'].includes(stage));
const continueFile = arg('continue-file', '');
const traceApiNames = arg('trace-api', '').split(',').filter(Boolean);
const menuClick = arg('menu-click', '130,310').split(',').map(Number);
const raceWait = Number(arg('race-wait', '25'));
const menuWait = Number(arg('menu-wait', '35'));
const output = path.resolve(ROOT, arg('out', 'build/nfs2-renderer-bench'));
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const configurations = {
  originalsoftware: { app: 'nfs2_demo', edition: 'Original May 1997 demo', glide: 'webgl', accelerated: false },
  seglide: { app: 'nfs2se_demo', edition: 'SE 3Dfx demo', glide: 'webgl', accelerated: true },
  seglidesoftware: { app: 'nfs2se_demo', edition: 'SE 3Dfx demo', glide: 'software', accelerated: true },
};
for (const name of cases) assert(configurations[name], `unknown case ${name}`);
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Exact URL-to-file map: external fixtures need no checkout symlink, and a
// request cannot traverse outside the caller-selected fixture directory.
const fixtureFiles = new Map();
let seConfig = null, seExe = null, seRoot = null;
if (cases.some(name => configurations[name].accelerated)) {
  const requestedRoot = arg('se-fixture', '');
  if (requestedRoot) {
    seRoot = fs.realpathSync(path.resolve(requestedRoot));
    const files = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        const rel = path.relative(seRoot, file).split(path.sep).join('/');
        if (rel.split('/')[0].toLowerCase() === '3dfx') continue;
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) {
          const url = '/__nfs2se__/' + rel.split('/').map(encodeURIComponent).join('/');
          fixtureFiles.set(url, file);
          files.push({ url, vfsPath: 'c:\\' + rel.replaceAll('/', '\\') });
          if (rel.toLowerCase() === 'nfs2sea.exe') seExe = file;
        }
      }
    };
    walk(seRoot);
    assert(seExe, '--se-fixture must contain NFS2SEA.EXE');
    seConfig = { exe: files.find(item => item.vfsPath.toLowerCase() === 'c:\\nfs2sea.exe').url,
      files, requiredFiles: true, fileConcurrency: 10, startupRegistry: [] };
  } else {
    seConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/nfs2se-config.json'), 'utf8'));
    seExe = fs.realpathSync(path.resolve(ROOT, seConfig.exe));
    seRoot = path.dirname(seExe);
  }
  // The original game's decimal driver override selects
  // Glide directly; automatic probing otherwise prefers an unavailable SGL.
  seConfig.environment = { ...seConfig.environment, THRASH_DRIVER: '1' };
}

// Diagnostics run inside the actual guest Worker, never the host's shadow
// register instance. This response override is enabled only for --trace-api.
function installWorkerApiTrace(host, names, getInstance, memory) {
  const canonical = name => name.replace(/^_/, '').replace(/@[0-9]+$/, '');
  const selected = new Set(names.map(canonical));
  const log = host.log, exit = host.log_api_exit;
  const globals = ex => Object.fromEntries(
    [0x4d4fc8, 0x5553f8, 0x4d4978, 0x4d4930, 0x555a14, 0x560a04]
      .map(address => ['0x' + address.toString(16), ex.guest_read32(address) >>> 0]));
  let current = null;
  const guestString = (ex, ptr) => {
    if (!ptr || ptr < 65536) return null;
    let text = '';
    for (let i = 0; i < 384; i++) {
      const byte = ex.guest_read8((ptr + i) >>> 0);
      if (!byte) break;
      text += String.fromCharCode(byte);
    }
    return text;
  };
  host.log = (ptr, len) => {
    current = null;
    try {
      const bytes = new Uint8Array(memory.buffer, ptr >>> 0, Math.min(len >>> 0, 128));
      let name = '';
      for (const byte of bytes) { if (!byte) break; name += String.fromCharCode(byte); }
      if (selected.has(canonical(name))) {
        const ex = getInstance()?.exports;
        if (ex) {
          const esp = ex.get_esp() >>> 0;
          const args = Array.from({length: 8}, (_, i) => ex.guest_read32((esp + 4 + i * 4) >>> 0) >>> 0);
          const data = { name, esp, ret: ex.guest_read32(esp) >>> 0, args, globals: globals(ex) };
          const base = canonical(name);
          if (base === 'GetProcAddress') data.procName = guestString(ex, args[1]);
          if (/^(LoadLibraryA|LoadLibraryExA|CreateFileA)$/.test(base)) data.path = guestString(ex, args[0]);
          if (base === 'MessageBoxA') data.text = guestString(ex, args[1]);
          current = data;
          console.log('[nfs2-worker-api-enter] ' + JSON.stringify(data));
        }
      }
    } catch (error) { console.log('[nfs2-worker-trace-error] ' + String(error)); }
    return log(ptr, len);
  };
  host.log_api_exit = (...args) => {
    if (current) {
      try {
        const ex = getInstance().exports;
        console.log('[nfs2-worker-api-exit] ' + JSON.stringify({name:current.name,
          eax:ex.get_eax() >>> 0, esp:ex.get_esp() >>> 0, globals:globals(ex)}));
      } catch (_) { /* diagnostics must not trap guest */ }
      current = null;
    }
    return exit(...args);
  };
}
let tracedWorker = null;
if (traceApiNames.length) {
  const source = fs.readFileSync(path.join(ROOT, 'lib/guest-worker.js'), 'utf8');
  const anchor = '      const result = await WebAssembly.instantiate(msg.module, built.imports);';
  assert.equal(source.split(anchor).length, 2, 'worker trace injection anchor must be unique');
  tracedWorker = source.replace(anchor,
    '(' + installWorkerApiTrace.toString() + ')(built.imports.host,' + JSON.stringify(traceApiNames)
    + ',()=>instance,memory);\n' + anchor);
}

async function observe(page) {
  return page.evaluate(() => {
    const wine = runningApps.find(app => app.name === window.__nfs2App)?.wine;
    const ex = wine?.instance?.exports;
    const glide = wine?.hostCtx?.glideBridge?.device;
    const gl = glide?.backend?.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const draw = wine?.guestWorker?.d3dStats;
    const renderer = wine?.renderer;
    const wins = Object.values(renderer?.windows || {}).filter(w => w.visible && !w.isChild);
    const win = wins[wins.length - 1];
    const surface = win?._dxFrameLayer?.canvas || win?._backCanvas;
    return { at: performance.now(), running: !!wine?.running,
      backend: wine?.threadManager?.backend, hidden: document.hidden,
      flips: window.__nfsBenchFlips, primaryPresents: window.__nfsBenchPrimaryPresents, swaps: glide?.stats.swaps,
      glide: glide?.stats, d3d: draw,
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      surface: surface ? { width: surface.width, height: surface.height } : null,
      display: ex ? { width: ex.get_display_mode_w?.(), height: ex.get_display_mode_h?.() } : null,
      seGlobals: window.__nfs2App === 'nfs2se_demo' && ex ? Object.fromEntries(
        [0x4d4fc8, 0x5553f8, 0x4d4978, 0x4d4930, 0x555a14, 0x560a04]
          .map(address => ['0x' + address.toString(16), ex.guest_read32(address) >>> 0])) : null,
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
      if (/\[nfs-bench-gpu\]/.test(line)) report.activeGpuRenderer = line;
      if (/worker thread \d+ trapped|UNIMPLEMENTED API:|host import .* threw|\[launchApp\] failed:|FATAL:/.test(line)) errors.push(line);
    });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?threads&perf&glide-renderer=${config.glide}`,
      { waitUntil: 'networkidle2', timeout: 90000 });
    await page.bringToFront();
    await page.evaluate(async config => {
      if (config.traceApiNames.length) window.__waTraceApiNames = new Set(config.traceApiNames);
      window.__nfsBenchFlips = 0;
      window.__nfsBenchPrimaryPresents = 0;
      const getImports = WineAssembly.prototype.getImports;
      WineAssembly.prototype.getImports = function(...args) {
        const result = getImports.apply(this, args), trace = result.host.dx_trace;
        result.host.dx_trace = function(kind, ...rest) {
          if (kind === 6) window.__nfsBenchFlips++;
          if (kind === 5) window.__nfsBenchPrimaryPresents++;
          return trace.call(this, kind, ...rest);
        };
        return result;
      };
      await setThreads(true);
      if (config.app === 'nfs2se_demo') {
        window.wineApps.APPS.nfs2se_demo = config.runtimeApp;
        const option = document.createElement('option');
        option.value = config.app; option.textContent = 'NFS II SE 3Dfx demo';
        document.getElementById('app-select').appendChild(option);
      }
      window.__nfs2App = config.app;
      document.getElementById('app-select').value = config.app;
      await launchApp();
      window.__nfsBenchLaunched = performance.now();
    }, { ...config, runtimeApp: seConfig, traceApiNames });
    const waitFrames = async (minimum, timeout = 600000) => {
      const started = Date.now();
      let lastCheckpoint = 0;
      while (true) {
        const state = await observe(page);
        if (errors.length) throw new Error(errors[0]);
        if (Date.now() - lastCheckpoint >= 15000) {
          await page.screenshot({ path: path.join(dir, 'loading.png') });
          fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(state, null, 2));
          console.log(name, 'loading', JSON.stringify({ flips: state.flips, primaryPresents: state.primaryPresents, swaps: state.swaps }));
          lastCheckpoint = Date.now();
        }
        if (!state.running && Date.now() - started > 15000)
          throw new Error('guest stopped before frame readiness; inspect loading.png and console.log');
        const count = config.accelerated ? state.swaps || 0 : Math.max(state.flips || 0, state.primaryPresents || 0);
        if (count >= minimum) return state;
        assert(Date.now() - started < timeout, 'guest frame readiness timed out');
        await sleep(1000);
      }
    };
    await waitFrames(config.accelerated ? 20 : 3);
    if (!config.accelerated) await sleep(menuWait * 1000);
    report.menu = await observe(page);
    await page.screenshot({ path: path.join(dir, 'menu.png') });
    console.log(name, 'checkpoint', path.join(dir, 'menu.png'));
    if (stage === 'menu') { report.checkpoint = 'menu'; return report; }
    if (continueFile) {
      console.log('Inspect menu.png, then create', continueFile);
      const start = Date.now();
      while (!fs.existsSync(continueFile)) {
        assert(Date.now() - start < 600000, 'menu approval file timed out');
        if (errors.length) throw new Error(errors[0]);
        await sleep(1000);
      }
    }
    if (!config.accelerated) {
      assert(menuClick.length === 2 && menuClick.every(Number.isFinite));
      // Verified original demo menu RACE item; coordinates are guest-local.
      for (const which of ['move', 'down', 'up']) {
        await page.evaluate(({ x, y, which }) => {
          const renderer = sharedRenderer, t = renderer._exclusiveTransform;
          const cx = t?.srcW ? Math.round((t.dstX || 0) + (x - (t.srcX || 0)) * t.dstW / t.srcW) : x;
          const cy = t?.srcH ? Math.round((t.dstY || 0) + (y - (t.srcY || 0)) * t.dstH / t.srcH) : y;
          if (which === 'move') renderer.handleMouseMove(cx, cy);
          else if (which === 'down') renderer.handleMouseDown(cx, cy, 1);
          else renderer.handleMouseUp(cx, cy, 1);
        }, { x: menuClick[0], y: menuClick[1], which });
        await sleep(300);
      }
      await sleep(5000);
      await page.keyboard.press('Enter');
    }
    await sleep(raceWait * 1000);
    report.ready = await observe(page);
    assert.equal(report.ready.backend, 'worker');
    assert(report.ready.running && !report.ready.hidden, 'visible live guest required');
    if (config.accelerated) {
      assert.equal(report.ready.seGlobals['0x4d4fc8'], 1, 'original game must select Glide');
      assert(report.ready.glide?.triangles > 0, 'race geometry required');
      if (config.glide === 'webgl') assert(report.ready.glRenderer &&
        !/swiftshader|llvmpipe|software/i.test(report.ready.glRenderer), 'hardware WebGL required');
    }
    await page.screenshot({ path: path.join(dir, 'ready.png') });
    console.log(name, 'race checkpoint', path.join(dir, 'ready.png'));
    if (stage === 'race') { report.checkpoint = 'race'; return report; }
    // Visual review of ready.png is required when reporting a race benchmark:
    // counters alone cannot distinguish a rendered menu from active gameplay.
    report.raceVisualReviewRequired = true;
    if (accelerate) await page.keyboard.down('ArrowUp');
    await sleep(10000);
    for (let i = 0; i < samples; i++) {
      await page.bringToFront();
      await page.screenshot({ path: path.join(dir, `sample-${i + 1}-before.png`) });
      const loadBefore = os.loadavg(), cpuBefore = await cpu(), before = await observe(page);
      await sleep(seconds * 1000);
      const after = await observe(page), cpuAfter = await cpu(), loadAfter = os.loadavg();
      assert(before.running && after.running && !before.hidden && !after.hidden, 'visible live game required');
      if (errors.length) throw new Error(errors[0]);
      assert.equal(after.glide?.errors || after.d3d?.errors || 0, 0);
      const flipDelta = after.flips - before.flips;
      const primaryDelta = after.primaryPresents - before.primaryPresents;
      const counterLabel = config.accelerated ? 'Glide buffer swaps'
        : flipDelta > 0 ? 'DirectDraw Flip (dx_trace kind 6)'
        : 'DirectDraw primary presents (dx_trace kind 5)';
      const frames = config.accelerated ? after.swaps - before.swaps
        : flipDelta > 0 ? flipDelta : primaryDelta;
      const wallSeconds = (after.at - before.at) / 1000;
      const cpuByType = {};
      for (const p of cpuAfter) {
        const old = cpuBefore.find(q => q.id === p.id);
        if (old) cpuByType[p.type] = (cpuByType[p.type] || 0) + p.cpuTime - old.cpuTime;
      }
      const cpuSeconds = Object.values(cpuByType).reduce((a,b) => a+b,0);
      assert(frames > 0, 'no guest frame swaps in sample');
      const result = { frames, counterLabel, flipDelta, primaryDelta, wallSeconds, fps: frames / wallSeconds,
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
    allowedRealRoots: [fixtureRoot, seRoot, fs.realpathSync(path.join(ROOT, 'fonts'))].filter(Boolean),
    handleRequest(req, res) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (tracedWorker && pathname === '/lib/guest-worker.js') {
        res.writeHead(200, {'Content-Type':'application/javascript', 'Cache-Control':'no-store',
          'Cross-Origin-Resource-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp'});
        res.end(tracedWorker);
        return true;
      }
      const file = fixtureFiles.get(pathname);
      if (!file) return false;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Length': fs.statSync(file).size, 'Cross-Origin-Resource-Policy': 'same-origin' });
      fs.createReadStream(file).pipe(res);
      return true;
    } });
  const meta = { startedAt: new Date().toISOString(), commit: execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    wasmSha256: hash(path.join(ROOT,'build/wine-assembly.wasm')), headful:true, stage, seconds, samples, accelerate, traceApiNames,
    comparisonCaveat: "Original software versus SE Glide uses different editions and supplied tracks (TR03 versus TR04); this is not a renderer-only or same-scene A/B.",
    machine: { platform:os.platform(), arch:os.arch(), cpus:os.cpus().length, model:os.cpus()[0].model },
    fixtureSha256: { original: hash(path.join(ROOT,'test/binaries/candidates/need-for-speed-2-demo/game/nfsw.exe')),
      se: seExe ? hash(seExe) : null },
    results: [] };
  try {
    for (const name of cases) {
      meta.results.push(await runCase(server,name));
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(meta,null,2));
    }
  } finally { await closeServer(server); }
  if (meta.results.some(r => r.failure)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
