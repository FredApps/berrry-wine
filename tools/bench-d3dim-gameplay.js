#!/usr/bin/env node
'use strict';

// Real browser gameplay baseline for selective dirty tracking. Server-only
// instrumentation: never skips a comparison or changes the shipped renderer.
// Example: node tools/bench-d3dim-gameplay.js --app=nfs3_demo --label=before
// MW3 cockpit: --app=mw3 --route=gameplay --warmup-ms=15000
// Add --guest-key=53 for 50% throttle (the demo's top-row 5 binding).
// --frame-times --trace-locks records Lock arguments/stacks and up to nine
// readback-to-Unlock byte-difference samples per group. These are write-change
// bounds, NOT CPU-read bounds; diagnostic copies/scans affect timing.
// --renderer=software switches to in-worker WAT rasterization after routing.
// --trace-access adds MW3-specific DIB probes; build with bench-d3dim-access-build.js.
// Repeat with --label=after once a candidate exists. FPS counts guest Flip
// calls (MW3: DirectDraw presents), not rAF callbacks. CPU profiles are optional to separate sampling
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
const route = opt('route', app === 'mw3' ? 'menu' : 'gameplay');
const seconds = Number(opt('seconds', '20'));
const windows = Number(opt('windows', '3'));
const label = opt('label', 'baseline');
const audit = process.argv.includes('--audit');
const frameTimes = process.argv.includes('--frame-times');
const traceYields = process.argv.includes('--trace-yields');
const traceCache = process.argv.includes('--trace-cache');
const traceFences = process.argv.includes('--trace-fences');
const traceLocks = process.argv.includes('--trace-locks');
const traceAccess = process.argv.includes('--trace-access');
assert(!traceAccess || traceLocks, '--trace-access requires --trace-locks and an instrumented WASM');
const renderer = opt('renderer', 'webgl');
assert(['webgl', 'software'].includes(renderer), 'renderer must be webgl or software');
assert(renderer === 'webgl' || frameTimes, 'software measurement requires --frame-times');
assert(!traceAccess || (app === 'mw3' && renderer === 'webgl'), '--trace-access is an MW3 WebGL diagnostic');
const guestKey = Number(opt('guest-key', '0'));
const output = path.resolve(opt('out', path.join(ROOT, 'build/d3dim-gameplay-perf', `${app}-${label}`)));
assert(['nfs3_demo', 'gta2_demo', 'mw3'].includes(app), 'only established game routes are supported');
assert(['menu', 'gameplay'].includes(route) && (app === 'mw3' || route === 'gameplay'));
assert(seconds > 0 && windows > 0 && Number.isInteger(windows));
assert(Number.isInteger(guestKey) && guestKey >= 0 && guestKey <= 255);
assert(!(traceYields || traceCache || traceFences || traceLocks) || frameTimes, 'diagnostic traces require --frame-times');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function replaceOnce(source, from, to) {
  assert(source.includes(from) && source.indexOf(from) === source.lastIndexOf(from), `instrumentation seam changed: ${from}`);
  return source.replace(from, to);
}
function instrumentGpu(source) {
  if (traceLocks) source = replaceOnce(source, '        this.stats.syncs++;', `
        const lock = globalThis.__benchFrameClock?.openLocks?.findLast(l => l.dib === t.dib && !l.before);
        if (lock) { lock.before = t.shadow.slice(); lock.pitch = t.pitch; lock.width = t.width; lock.height = t.height; lock.bpp = t.bpp; }
        this.stats.syncs++;`);
  if (traceFences) source = replaceOnce(source, '        const start = now();\n        const { width, height, pitch } = t,', `        const cause = globalThis.__benchSurfaceOp || [];
        const key = JSON.stringify({ cause, rt: t.rt, dib: t.dib, width: t.width, height: t.height });
        const counts = globalThis.__benchFenceCounts || (globalThis.__benchFenceCounts = {});
        const stacks = globalThis.__benchFenceStacks || (globalThis.__benchFenceStacks = {});
        if (!stacks[key]) stacks[key] = new Error().stack;
        counts[key] = (counts[key] || 0) + 1;
        const start = now();
        const { width, height, pitch } = t,`);
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
    if (gl && this.benchRendererGl !== gl) {
      this.benchRendererGl = gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.benchRendererName = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    }
    return Object.assign({}, this.stats, probe, {
      guestFlips: globalThis.__benchGuestFlips || 0,
      guestPresents: globalThis.__benchGuestPresents || 0,
      experimentalWatchRanges: this.benchWatches.size,
      gpuRenderer: this.benchRendererName || null,
      measuredAt: performance.now(),
    });
  }`);
  return source;
}
function instrumentWorker(source) {
  if (traceYields) source = replaceOnce(source,
    '        sleepMs = (sleepYielded && ex.get_sleep_timeout) ? ex.get_sleep_timeout() >>> 0 : 0;',
    `        sleepMs = (sleepYielded && ex.get_sleep_timeout) ? ex.get_sleep_timeout() >>> 0 : 0;
        const clock = globalThis.__benchFrameClock;
        if (clock?.enabled && performance.now() - (clock.lastSample || 0) >= 100) {
          clock.lastSample = performance.now();
          const counters = {};
          for (const name of Object.keys(ex)) {
            if (/^get_(cache_|page_|decode)/.test(name) && ex[name].length === 0)
              counters[name] = String(ex[name]());
          }
          const stack = [];
          let bp = ex.get_ebp?.() >>> 0;
          const view = new DataView(memory.buffer);
          for (let depth = 0; depth < 8 && bp >= 0x10000 && bp < 0x80000000; depth++) {
            const wa = ex.guest_to_wasm(bp) >>> 0;
            if (!wa || wa + 8 > view.byteLength) break;
            stack.push(view.getUint32(wa + 4, true));
            const next = view.getUint32(wa, true);
            if (next <= bp || next - bp > 0x100000) break;
            bp = next;
          }
          clock.samples.push({ at: clock.lastSample, eip: ex.get_eip?.() >>> 0,
            prevEip: ex.get_dbg_prev_eip?.() >>> 0, stack, counters });
        }
        if (clock?.enabled && (sleepYielded || ex.get_yield_reason?.())) {
          if (clock.yields.length < 20000) clock.yields.push({ at: performance.now(),
            sleepMs, sleepYielded, reason: ex.get_yield_reason?.() >>> 0,
            eip: ex.get_eip?.() >>> 0, prevEip: ex.get_dbg_prev_eip?.() >>> 0,
            waitTimeout: ex.get_wait_timeout?.() >>> 0 });
          else clock.yieldOverflow = true;
        }`);
  return replaceOnce(source, '      const result = await WebAssembly.instantiate(msg.module, built.imports);', `
      const originalDxTrace = built.imports.host.dx_trace;
      globalThis.__benchFrameClock = { enabled: false, count: 0, overflow: false,
        times: new Float64Array(120000) };
      ${traceCache ? `const originalLogI32 = built.imports.host.log_i32;
      built.imports.host.log_i32 = value => {
        const c = globalThis.__benchFrameClock;
        if (c.enabled) {
          if (c.cacheTrace.length < 5000) c.cacheTrace.push({ at: performance.now(), value: value >>> 0 });
          else globalThis.__benchExports.set_code_write_trace(0);
          return;
        }
        return originalLogI32(value);
      };` : ''}
      built.imports.host.dx_trace = (...args) => {
        ${traceAccess ? `if (args[0] >= 90 && args[0] <= 92) {
          const c = globalThis.__benchFrameClock, l = c.accessLock;
          if (l) {
            const key = JSON.stringify(args.slice(0, 1).concat(args.slice(2, 4)));
            const a = l.access[key] || (l.access[key] = {count:0, min:args[4], max:args[4], stack:new Error().stack});
            a.count++; a.min = Math.min(a.min,args[4]); a.max = Math.max(a.max,args[4]);
          }
          return;
        }` : ''}
        ${traceLocks ? `const clock = globalThis.__benchFrameClock;
        if (clock.enabled && args[0] === 1) {
          const ex = globalThis.__benchExports, esp = ex.get_esp() >>> 0;
          const read = a => ex.guest_read32(a) >>> 0;
          const stackArgs = Array.from({length: 6}, (_, i) => read(esp + 4 * i));
          const rect = stackArgs[2] ? Array.from({length: 4}, (_, i) => read(stackArgs[2] + i * 4) | 0) : null;
          const stack = [stackArgs[0]];
          let bp = ex.get_ebp() >>> 0;
          for (let n = 0; n < 8 && bp >= 0x10000 && bp < 0x80000000; n++) {
            stack.push(read(bp + 4)); const next = read(bp);
            if (next <= bp || next - bp > 0x100000) break; bp = next;
          }
          const key = JSON.stringify({slot: args[1], flags: stackArgs[4], rect, stack});
          const group = clock.locks[key] || (clock.locks[key] = {count: 0, samples: []});
          group.count++;
          if (group.samples.length < 9) clock.openLocks.push({key, slot: args[1], dib: args[3], stackArgs,
            stackWords: Array.from({length: 64}, (_, i) => read(esp + i * 4))});
          ${traceAccess ? `if (args[1] === 6 && clock.accessSamples.length < 9) {
            const l = {caller:read(esp+172),dib:args[3],access:{}};
            clock.accessSamples.push(l); clock.accessLock = l;
            ex.bench_access_range(args[3], 640*480*2);
          }` : ''}
        }
        if (clock.enabled && args[0] === 2) {
          ${traceAccess ? `if (args[1] === 6) { globalThis.__benchExports.bench_access_range(0,0); clock.accessLock=null; }` : ''}
          const index = clock.openLocks.findIndex(l => l.slot === args[1]);
          if (index >= 0) {
            const l = clock.openLocks.splice(index, 1)[0];
            if (l.before) {
              const current = new Uint8Array(memory.buffer, l.dib, l.before.length);
              let changed = 0, minX = l.width, minY = l.height, maxX = -1, maxY = -1;
              for (let i = 0; i < current.length; i++) if (current[i] !== l.before[i]) {
                changed++; const x = Math.floor(i % l.pitch / (l.bpp / 8)), y = Math.floor(i / l.pitch);
                minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y);
              }
              clock.locks[l.key].samples.push({dib:l.dib, width:l.width, height:l.height, pitch:l.pitch,
                stackWords:l.stackWords,
                changedBytes:changed, changedRect:changed ? [minX,minY,maxX+1,maxY+1] : null});
            }
          }
        }` : ''}
        ${traceFences ? `if (args[0] === 1 || args[0] === 3) globalThis.__benchSurfaceOp = args;` : ''}
        if (args[0] === 6) globalThis.__benchGuestFlips = (globalThis.__benchGuestFlips || 0) + 1;
        if (args[0] === 5) {
          globalThis.__benchGuestPresents = (globalThis.__benchGuestPresents || 0) + 1;
          const clock = globalThis.__benchFrameClock;
          if (clock.enabled) {
            if (clock.count < clock.times.length) clock.times[clock.count++] = performance.now();
            else clock.overflow = true;
          }
        }
        return originalDxTrace(...args);
      };
      const result = await WebAssembly.instantiate(msg.module, built.imports);
      globalThis.__benchExports = (result.exports ? result : result.instance).exports;
      globalThis.__benchUseSoftware = () => {
        d3dCommands.fence();
        // The legacy worker-draw seam probes the host even with GPU off.
        // Decline that seam too, so it falls through to WAT rasterization.
        d3dCommands.call = () => 0;
        globalThis.__benchExports.d3dim_gpu_enable(0);
      };
      globalThis.__benchCacheSnapshot = () => Object.fromEntries(
        Object.entries(globalThis.__benchExports)
          .filter(([name, fn]) => /^get_(cache_|page_)/.test(name) && fn.length === 0)
          .map(([name, fn]) => [name, String(fn())]));
      ${(audit ? '(result.exports ? result : result.instance).exports.set_page_watch_audit(1);' : '')}`);
}

(async () => {
  assert(!fs.existsSync(path.join(output, 'results.json')), 'output already contains a run; choose a new --label or --out');
  fs.mkdirSync(output, { recursive: true });
  // Pin these artifacts throughout the run even if a shared-tree build lands.
  const wasm = fs.readFileSync(path.resolve(opt('wasm', path.join(ROOT, 'build/wine-assembly.wasm'))));
  const gpuSource = fs.readFileSync(path.resolve(opt('gpu-source', path.join(ROOT, 'lib/d3dim-gpu.js'))), 'utf8');
  const regionSource = fs.readFileSync(path.resolve(opt('region-map', path.join(ROOT, 'lib/region-map.generated.js'))));
  const workerSource = fs.readFileSync(path.join(ROOT, 'lib/guest-worker.js'), 'utf8');
  const overrides = new Map([
    ['/build/wine-assembly.wasm', ['application/wasm', wasm]],
    ['/lib/d3dim-gpu.js', ['application/javascript', instrumentGpu(gpuSource)]],
    ['/lib/guest-worker.js', ['application/javascript', instrumentWorker(workerSource)]],
    ['/lib/region-map.generated.js', ['application/javascript', regionSource]],
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
  const manifest = { app, route, renderer, guestKey, label, seconds, windows, started: new Date().toISOString(),
    platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model,
    loadBefore: os.loadavg(), headless: process.argv.includes('--headless'),
    profiled: process.argv.includes('--profile'), wasmSha256: hash(wasm), gpuSha256: hash(gpuSource),
    regionSha256: hash(regionSource), audit, frameTimes, traceYields, traceCache, traceFences, traceLocks, traceAccess,
    note: 'MW3 counts DirectDraw presents; other games count flips. --route=gameplay deploys MW3 into a verified cockpit. Verify screenshots. --audit checks page versions against pixels.' };
  fs.writeFileSync(path.join(output, 'runtime.wasm'), wasm);
  fs.writeFileSync(path.join(output, 'd3dim-gpu.js'), gpuSource);
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: manifest.headless, args: ['--no-first-run', '--no-default-browser-check',
        ...(process.argv.includes('--swiftshader') ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])], protocolTimeout: 120000,
    });
    manifest.browser = await browser.version();
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    page.on('console', message => {
      logs.push(message.text());
      if (/FATAL|RuntimeError|d3dim-gpu|guest main thread|UNIMPLEMENTED/i.test(message.text())) console.log(message.text());
    });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&threads&d3dim-gpu`, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('page loaded', app);
    await page.evaluate(async app => {
      await setThreads(true);
      document.getElementById('app-select').value = app;
      if (document.getElementById('app-select').value !== app) throw new Error(`App missing from picker: ${app}`);
      await launchApp();
    }, app);
    console.log('launched', app);
    await page.evaluate(() => setRuntimeLogging(false));
    await page.screenshot({ path: path.join(output, 'launched.png') });
    assert(await page.evaluate(() => runningApps[0]?.wine.threadManager?.backend === 'worker'),
      'Worker startup failed; refuse a cooperative fallback measurement');
    if (app === 'gta2_demo') {
      await pause(15000);
      await page.screenshot({ path: path.join(output, 'menu.png') });
      await page.keyboard.down('Enter'); await pause(500); await page.keyboard.up('Enter');
    }
    await page.waitForFunction(app => {
      const d = runningApps[0]?.wine.guestWorker?.d3dStats;
      return app === 'mw3' ? d?.guestPresents > 120 : d?.triangles > 100000;
    }, { timeout: 150000, polling: 500 }, app);
    // MW3's startup fade also presents frames; let it reach the settled menu.
    await pause(Number(opt('warmup-ms', app === 'mw3' ? '60000' : '10000')));
    if (app === 'mw3' && route === 'gameplay') {
      await require('./mw3-gameplay-route')(page, output);
      await pause(5000);
    }
    let frameWorker;
    if (frameTimes) {
      for (const worker of page.workers()) {
        if (await worker.evaluate(() => !!globalThis.__benchFrameClock)) {
          assert(!frameWorker, 'multiple present recorders; refuse ambiguous frame timing');
          frameWorker = worker;
        }
      }
      assert(frameWorker, 'present recorder worker missing');
      if (traceAccess) assert(await frameWorker.evaluate(() => typeof globalThis.__benchExports.bench_access_range === 'function'),
        '--trace-access requires the diagnostic WASM from bench-d3dim-access-build.js');
      manifest.cursor = {
        page: await page.evaluate(() => ({
          count: sharedRenderer.wasm.exports.get_cursor_display_count?.(),
          handle: sharedRenderer.wasm.exports.get_cursor?.(),
        })),
        worker: await frameWorker.evaluate(() => ({
          count: globalThis.__benchExports.get_cursor_display_count?.(),
          handle: globalThis.__benchExports.get_cursor?.(),
        })),
      };
    }
    if (renderer === 'software') {
      // Route with WebGL, then measure the same cockpit with WAT rasterization.
      // Keep the GPU object alive solely for the existing present/stat channel.
      await frameWorker.evaluate(() => globalThis.__benchUseSoftware());
      await pause(5000);
    }
    const observe = () => page.evaluate(() => {
      const wine = runningApps[0]?.wine;
      return { isolated: crossOriginIsolated, backend: wine?.threadManager?.backend,
        running: wine?.running, d3d: wine?.guestWorker?.d3dStats };
    });
    if (guestKey) await page.evaluate(key => sharedRenderer.handleKeyDown(key), guestKey);
    for (let i = 0; i < windows; i++) {
      const profiles = [];
      if (manifest.profiled) for (const w of page.workers()) {
        await w.client.send('Profiler.enable');
        await w.client.send('Profiler.start');
        profiles.push(w);
      }
      if (manifest.profiled) {
        const client = await page.createCDPSession();
        await client.send('Profiler.enable');
        await client.send('Profiler.start');
        profiles.push({ client });
      }
      await page.screenshot({ path: path.join(output, `window-${i}-start.png`) });
      const before = await observe();
      assert(before.isolated && before.backend === 'worker' && before.running, 'Worker gameplay must remain active');
      if (frameWorker) await frameWorker.evaluate(traceCache => {
        const c = globalThis.__benchFrameClock;
        c.count = 0; c.overflow = false; c.yields = []; c.yieldOverflow = false;
        c.samples = []; c.lastSample = 0; c.cacheTrace = [];
        c.locks = {}; c.openLocks = [];
        c.accessSamples = []; c.accessLock = null;
        c.cacheBefore = globalThis.__benchCacheSnapshot();
        c.start = performance.now(); c.enabled = true;
        globalThis.__benchFenceCounts = {};
        globalThis.__benchFenceStacks = {};
        if (traceCache) globalThis.__benchExports.set_code_write_trace(1);
      }, traceCache);
      await pause(seconds * 1000);
      let timing;
      if (frameWorker) {
        const capture = await frameWorker.evaluate(() => {
          const c = globalThis.__benchFrameClock;
          c.enabled = false;
          globalThis.__benchExports.bench_access_range?.(0, 0);
          globalThis.__benchExports.set_code_write_trace?.(0);
          return { start: c.start, end: performance.now(), overflow: c.overflow,
            yields: c.yields, yieldOverflow: c.yieldOverflow, guestSamples: c.samples,
            cacheTrace: c.cacheTrace,
            fenceCounts: globalThis.__benchFenceCounts,
            fenceStacks: globalThis.__benchFenceStacks,
            locks: c.locks,
            accessSamples: c.accessSamples,
            cacheBefore: c.cacheBefore, cacheAfter: globalThis.__benchCacheSnapshot(),
            timestamps: Array.from(c.times.subarray(0, c.count)) };
        });
        assert(!capture.overflow, 'frame timing buffer overflow');
        assert(capture.timestamps.length > 1, 'not enough presents for frame intervals');
        const intervals = capture.timestamps.slice(1).map((t, n) => t - capture.timestamps[n]);
        assert(intervals.every(t => t >= 0), 'non-monotonic frame clock');
        const sorted = [...intervals].sort((a, b) => a - b);
        const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
        const secondsCovered = Math.floor((capture.end - capture.start) / 1000);
        const perSecond = Array(secondsCovered).fill(0);
        for (const t of capture.timestamps) {
          const bin = Math.floor((t - capture.start) / 1000);
          if (bin < perSecond.length) perSecond[bin]++;
        }
        timing = { samples: intervals.length, durationMs: capture.end - capture.start,
          presentsPerSecond: capture.timestamps.length * 1000 / (capture.end - capture.start),
          p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
          maxMs: sorted[sorted.length - 1], over50Ms: intervals.filter(t => t > 50).length,
          over100Ms: intervals.filter(t => t > 100).length,
          over250Ms: intervals.filter(t => t > 250).length, perSecond };
        fs.writeFileSync(path.join(output, `window-${i}-frame-times.json`),
          JSON.stringify({ ...capture, intervals, summary: timing }, null, 2));
      }
      const after = await observe();
      assert(after.running && after.d3d.errors === 0, 'gameplay failed');
      assert.equal(after.d3d.dirtyAuditMisses || 0, 0, 'dirty-page audit missed a write');
      const delta = Object.fromEntries(Object.keys(after.d3d).filter(k => typeof after.d3d[k] === 'number')
        .map(k => [k, after.d3d[k] - (before.d3d[k] || 0)]));
      if (renderer === 'software') assert.equal(delta.draws, 0, 'software run issued GPU draws');
      const elapsed = delta.measuredAt / 1000;
      const frames = app === 'mw3' ? delta.guestPresents : delta.guestFlips;
      const result = { window: i, elapsed, fps: frames / elapsed, timing,
        textureCheckMsPerFrame: delta.textureCheckMs / frames,
        targetCheckMsPerFrame: delta.targetCheckMs / frames, delta, before, after };
      results.push(result);
      console.log(JSON.stringify({ app, label, ...result }));
      await page.screenshot({ path: path.join(output, `window-${i}-end.png`) });
      let n = 0;
      for (const w of profiles) {
        const { profile } = await w.client.send('Profiler.stop');
        fs.writeFileSync(path.join(output, `window-${i}-worker-${n++}.cpuprofile`), JSON.stringify(profile));
      }
    }
    if (guestKey) await page.evaluate(key => sharedRenderer.handleKeyUp(key), guestKey);
    assert(results.every(r => app === 'mw3' ? r.delta.guestPresents > 0 : r.delta.guestFlips > 0 && r.delta.triangles > 0),
      'must measure advancing presents in the intended route');
  } finally {
    manifest.loadAfter = os.loadavg();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ manifest, results, errors }, null, 2));
    fs.writeFileSync(path.join(output, 'console.txt'), logs.join('\n'));
    if (browser) await browser.close();
    await closeServer(server);
  }
  assert.deepStrictEqual(errors, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
