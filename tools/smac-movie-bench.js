#!/usr/bin/env node
'use strict';

// Reproducible browser benchmark for Alpha Centauri's opening WVE/TQI movie.
//
// The benchmark deliberately observes the guest's canonical DirectDraw surface,
// not requestAnimationFrame.  One game present may be coalesced before the
// compositor sees it, and the same decoded frame may be presented more than
// once.  We therefore report both raw presents and adjacent-distinct RGB565
// frame hashes.  An oracle run anchors itself to a hash from the baseline, so
// startup scheduling cannot move the measured scene.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const TOOL_ROOT = path.join(__dirname, '..');
const DEFAULT_ISO = '/Users/vg/Downloads/SidMeierAlphaCentauriClassic-Windows95.iso';
const ISO_BYTES = 503289856;
const ISO_SHA256 = '425f53a7da9b5acd2726a3ff30423f426ea27bf1a3b806e45688f83feada0c96';

function parseArgs(argv) {
  const value = (name, fallback) => {
    const prefix = `--${name}=`;
    const hit = argv.find(arg => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
  };
  const number = (name, fallback) => {
    const n = Number(value(name, fallback));
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
    return n;
  };
  return {
    root: path.resolve(value('root', process.env.SMAC_ROOT || TOOL_ROOT)),
    iso: path.resolve(value('iso', DEFAULT_ISO)),
    oracle: value('oracle', ''),
    out: value('out', ''),
    warmupUnique: Math.floor(number('warmup-unique', 12)),
    measureUnique: Math.floor(number('measure-unique', 60)),
    wallSeconds: number('wall-seconds', 8),
    timeoutSeconds: number('timeout-seconds', 240),
    slice: Math.floor(number('slice', 500000)),
    hist: argv.includes('--handler-hist'),
    headful: argv.includes('--headful'),
  };
}

function usage() {
  return `Usage: node tools/smac-movie-bench.js [options]\n\n` +
    `  --iso=PATH             raw SMAC ISO (default: ${DEFAULT_ISO})\n` +
    `  --root=WORKTREE        checkout/artifact to serve (default: this checkout)\n` +
    `  --oracle=REPORT.json   anchor to and compare with a baseline report\n` +
    `  --out=REPORT.json      write the complete report\n` +
    `  --warmup-unique=N      baseline-only unique frames before anchor (12)\n` +
    `  --measure-unique=N     exact hashed-frame window including anchor (60)\n` +
    `  --wall-seconds=N       simultaneous fixed-wall window (8)\n` +
    `  --handler-hist         collect handler/pair/block counts for fixed frames\n` +
    `  --headful              visible Chrome (required for user-visible FPS claims)\n` +
    `  --slice=N              browser block budget per slice (500000)\n`;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function handlerNames(root = TOOL_ROOT) {
  const source = fs.readFileSync(path.join(root, 'src', '02-thread-table.wat'), 'utf8');
  const names = [];
  for (const line of source.split('\n')) {
    const match = /^\s*\$(\w+)\s*;;\s*(\d+)/.exec(line);
    if (match) names[Number(match[2])] = match[1];
  }
  return names;
}

function compareReports(baseline, candidate) {
  const a = baseline.fixedFrames || {};
  const b = candidate.fixedFrames || {};
  const hashesA = a.hashes || [];
  const hashesB = b.hashes || [];
  let mismatch = -1;
  const n = Math.min(hashesA.length, hashesB.length);
  for (let i = 0; i < n; i++) {
    if (hashesA[i] !== hashesB[i]) { mismatch = i; break; }
  }
  if (mismatch < 0 && hashesA.length !== hashesB.length) mismatch = n;
  return {
    anchorMatch: a.anchorHash === b.anchorHash,
    pixelSequenceMatch: mismatch < 0,
    firstMismatch: mismatch,
    baselineHashes: hashesA.length,
    candidateHashes: hashesB.length,
    fixedFramesSpeedup: a.elapsedMs > 0 && b.elapsedMs > 0 ? a.elapsedMs / b.elapsedMs : null,
    fixedWallUniqueDelta: ((candidate.fixedWall || {}).uniqueFrames || 0) -
      ((baseline.fixedWall || {}).uniqueFrames || 0),
  };
}

function startServer(root) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch (_) { res.writeHead(400); res.end('bad url'); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = path.normalize(path.join(root, pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.stat(file, (statError, stat) => {
      if (statError || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runBenchmark(options) {
  const loadavgStart = os.loadavg();
  if (!fs.existsSync(options.iso)) throw new Error(`ISO not found: ${options.iso}`);
  if (!fs.existsSync(path.join(options.root, 'index.html')) ||
      !fs.existsSync(path.join(options.root, 'build', 'wine-assembly.wasm'))) {
    throw new Error(`--root needs index.html and a built wasm artifact: ${options.root}`);
  }
  const stat = fs.statSync(options.iso);
  const isoSha256 = await sha256File(options.iso);
  if (stat.size !== ISO_BYTES || isoSha256 !== ISO_SHA256) {
    throw new Error(`wrong ISO: got ${stat.size} bytes sha256=${isoSha256}; expected ` +
      `${ISO_BYTES} bytes sha256=${ISO_SHA256}`);
  }
  if (options.measureUnique < 2) throw new Error('--measure-unique must be at least 2');

  const oracle = options.oracle ? JSON.parse(fs.readFileSync(options.oracle, 'utf8')) : null;
  const anchorHash = oracle && oracle.fixedFrames && oracle.fixedFrames.anchorHash;
  if (oracle && !anchorHash) throw new Error('oracle report has no fixedFrames.anchorHash');

  const puppeteer = require('puppeteer');
  const server = await startServer(options.root);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-smac-bench-'));
  const browser = await puppeteer.launch({
    headless: !options.headful,
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: profile,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update'],
  });
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(String(error)));
  page.on('console', message => {
    const text = message.text();
    if (/RuntimeError|unreachable|UNIMPLEMENTED API|region layout MISMATCH/i.test(text)) problems.push(text);
  });
  try {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug&no-log`,
      { waitUntil: 'load', timeout: 90000 });
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
    await page.waitForFunction(() => window.wineMedia && window.wineMedia._fileInput,
      { timeout: 90000 });
    const input = await page.evaluateHandle(() => window.wineMedia._fileInput);
    await input.asElement().uploadFile(options.iso);
    await page.evaluate(() => window.wineMedia._fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForSelector('.wa-media-modal', { timeout: 120000 });
    await page.evaluate(() => {
      const select = document.querySelector('.wa-media-exe');
      const option = [...select.options].find(item => item.value.toLowerCase() === 'd:\\programs\\terran.exe');
      if (!option) throw new Error('D:\\PROGRAMS\\TERRAN.EXE missing from ISO picker');
      select.value = option.value;
      const launch = document.querySelector('.wa-media-modal input[type="checkbox"]');
      if (launch) launch.checked = false;
      [...document.querySelectorAll('.wa-media-modal button')]
        .find(button => button.textContent === 'OK').click();
    });
    await page.waitForFunction(() => window.wineMedia.sessionItems.size > 0, { timeout: 30000 });
    await page.evaluate(() => {
      const [appId] = [...window.wineMedia.sessionItems.keys()];
      return window.wineMedia.launch(appId);
    });
    try {
      await page.waitForFunction(() => typeof runningApps !== 'undefined' && runningApps[0]?.wine?.instance,
        { timeout: Math.min(options.timeoutSeconds, 180) * 1000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        running: typeof runningApps === 'undefined' ? 0 : runningApps.length,
        status: document.getElementById('status')?.textContent || '',
        log: document.getElementById('log')?.textContent?.slice(-3000) || '',
        crash: document.querySelector('#wine-crash-report .wine-crash-text')?.value || '',
      })).catch(() => null);
      throw new Error(`Alpha launch did not create a guest instance: ${JSON.stringify(diagnostic)}; ${error}`);
    }

    await page.evaluate(config => {
      const wine = runningApps[0].wine;
      wine.stepsPerSlice = config.slice;
      wine.spinParkClockMs = 1;
      wine.guestTickPollStride = 1;
      const ex = wine.instance.exports;
      if (ex.set_spin_park_k) ex.set_spin_park_k(8);

      const hashSurface = slot => {
        const memory = wine.memory.buffer;
        const dv = new DataView(memory);
        const entry = RegionMap.BASE.DX_OBJECTS + slot * 32;
        if (dv.getUint32(entry, true) !== 2) return null;
        const width = dv.getUint16(entry + 12, true);
        const height = dv.getUint16(entry + 14, true);
        const bpp = dv.getUint16(entry + 16, true);
        const pitch = dv.getUint16(entry + 18, true);
        const dibWa = dv.getUint32(entry + 20, true);
        const flags = dv.getUint32(entry + 28, true);
        const bytes = pitch * height;
        // The opening player renders a 400x192 movie into Alpha's 640x480
        // RGB565 primary.  Reject auxiliary/offscreen surfaces so a future
        // allocation-order change cannot silently redefine the oracle.
        if (!(flags & 1) || width !== 640 || height !== 480 || bpp !== 16 ||
            pitch < width * 2 || !dibWa || dibWa + bytes > memory.byteLength) return null;
        const words = new Uint32Array(memory, dibWa, bytes >>> 2);
        let h1 = 0x811c9dc5;
        let h2 = 0x9e3779b9;
        for (let i = 0; i < words.length; i++) {
          const word = words[i] >>> 0;
          h1 = Math.imul((h1 ^ word) >>> 0, 0x01000193) >>> 0;
          h2 = (Math.imul((h2 + word + i) >>> 0, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
        }
        return { hash: `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`,
          slot, width, height, bpp, pitch, bytes };
      };

      const readHist = () => {
        if (!config.hist || !ex.get_handler_hist_base) return null;
        const u32 = new Uint32Array(wine.memory.buffer);
        const count = ex.get_handler_hist_count() | 0;
        const slots = ex.get_handler_hist_slots() | 0;
        const hb = ex.get_handler_hist_base() >>> 2;
        const pb = ex.get_handler_pair_hist_base() >>> 2;
        const handlers = [];
        const pairs = [];
        let total = 0;
        let pairTotal = 0;
        for (let id = 0; id < slots; id++) {
          const hits = u32[hb + id] >>> 0;
          total += hits;
          if (hits) handlers.push({ id, hits });
        }
        for (let from = 0; from < count; from++) {
          const row = pb + from * count;
          for (let to = 0; to < count; to++) {
            const hits = u32[row + to] >>> 0;
            pairTotal += hits;
            if (hits) pairs.push({ from, to, hits });
          }
        }
        const bb = ex.get_hot_block_hist_base() >>> 2;
        const blocks = [];
        let blockTotal = 0;
        for (let i = 0; i < ex.get_hot_block_hist_count(); i++) {
          const addr = u32[bb + i * 2] >>> 0;
          const hits = u32[bb + i * 2 + 1] >>> 0;
          blockTotal += hits;
          if (addr && hits) blocks.push({ addr: `0x${addr.toString(16)}`, hits });
        }
        handlers.sort((a, b) => b.hits - a.hits);
        pairs.sort((a, b) => b.hits - a.hits);
        blocks.sort((a, b) => b.hits - a.hits);
        return { total, pairTotal, blockTotal,
          handlers: handlers.slice(0, 40), pairs: pairs.slice(0, 50), blocks: blocks.slice(0, 50),
          blockCollisions: ex.get_hot_block_hist_collisions() >>> 0 };
      };

      const state = window.__smacMovieBench = {
        armed: false, done: false, failed: '', allPresents: 0, allUnique: 0,
        lastSeenHash: null, anchorHash: config.anchorHash || null, surface: null,
        startMs: 0, presents: 0, hashes: [], frameTimesMs: [], fixedWall: null,
        fixedFrames: null, hist: null,
      };
      const previous = wine.onGuestFrame;
      wine.onGuestFrame = event => {
        if (typeof previous === 'function') previous(event);
        // host.js also sends a slot-less compatibility notification.  Count
        // only host-imports' authoritative event or every present is doubled.
        if (!event || event.kind !== 'directdraw' || event.slot === undefined) return;
        const frame = hashSurface(event.slot >>> 0);
        if (!frame) return;
        state.allPresents++;
        if (frame.hash !== state.lastSeenHash) state.allUnique++;
        const distinct = frame.hash !== state.lastSeenHash;
        state.lastSeenHash = frame.hash;

        if (!state.armed) {
          const foundAnchor = config.anchorHash ? frame.hash === config.anchorHash
            : distinct && state.allUnique >= config.warmupUnique;
          if (!foundAnchor) return;
          state.armed = true;
          state.anchorHash = frame.hash;
          state.surface = { slot: frame.slot, width: frame.width, height: frame.height,
            bpp: frame.bpp, pitch: frame.pitch, bytes: frame.bytes };
          state.startMs = performance.now();
          state.hashes.push(frame.hash);
          state.frameTimesMs.push(0);
          if (config.hist) {
            ex.reset_handler_hist();
            ex.set_handler_hist_enabled(1);
          }
          setTimeout(() => {
            if (!state.fixedWall) state.fixedWall = {
              requestedMs: config.wallSeconds * 1000,
              elapsedMs: performance.now() - state.startMs,
              presents: state.presents,
              uniqueFrames: state.hashes.length,
            };
            if (state.fixedFrames) state.done = true;
          }, config.wallSeconds * 1000);
          return;
        }

        state.presents++;
        if (distinct) {
          state.hashes.push(frame.hash);
          state.frameTimesMs.push(performance.now() - state.startMs);
        }
        if (!state.fixedFrames && state.hashes.length >= config.measureUnique) {
          if (config.hist) ex.set_handler_hist_enabled(0);
          state.hist = readHist();
          state.fixedFrames = {
            anchorHash: state.anchorHash,
            frames: state.hashes.length,
            intervals: state.hashes.length - 1,
            elapsedMs: performance.now() - state.startMs,
            presents: state.presents,
            hashes: state.hashes.slice(0, config.measureUnique),
            frameTimesMs: state.frameTimesMs.slice(0, config.measureUnique),
          };
          if (state.fixedWall) state.done = true;
        }
      };
    }, { anchorHash, warmupUnique: options.warmupUnique, measureUnique: options.measureUnique,
      wallSeconds: options.wallSeconds, hist: options.hist, slice: options.slice });

    await page.waitForFunction(() => window.__smacMovieBench?.done ||
      window.__smacMovieBench?.failed || typeof runningApps === 'undefined' || !runningApps.length,
      { timeout: options.timeoutSeconds * 1000, polling: 100 });
    const measured = await page.evaluate(() => window.__smacMovieBench);
    if (!measured || !measured.fixedFrames || !measured.fixedWall) {
      throw new Error(`movie benchmark did not complete: ${JSON.stringify(measured)}`);
    }
    const names = handlerNames(options.root);
    if (measured.hist) {
      measured.hist.handlers.forEach(row => { row.name = names[row.id] || `handler_${row.id}`; });
      measured.hist.pairs.forEach(row => {
        row.fromName = names[row.from] || `handler_${row.from}`;
        row.toName = names[row.to] || `handler_${row.to}`;
      });
    }
    const report = {
      schema: 1,
      sourceVersion: await page.evaluate(() => typeof WineAssembly === 'undefined'
        ? null : WineAssembly.SOURCE_VERSION),
      git: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'],
        { cwd: options.root, encoding: 'utf8' }).trim(),
      iso: { path: options.iso, bytes: stat.size, sha256: isoSha256 },
      config: { root: options.root, headful: options.headful, handlerHist: options.hist, slice: options.slice,
        warmupUnique: options.warmupUnique, measureUnique: options.measureUnique,
        wallSeconds: options.wallSeconds, anchorFromOracle: anchorHash || null },
      loadavg: { start: loadavgStart, end: os.loadavg() },
      surface: measured.surface,
      fixedWall: measured.fixedWall,
      fixedFrames: measured.fixedFrames,
      handlerProfile: measured.hist,
      problems,
    };
    report.fixedWall.uniqueFps = Math.max(0, report.fixedWall.uniqueFrames - 1) /
      (report.fixedWall.elapsedMs / 1000);
    report.fixedWall.presentFps = report.fixedWall.presents / (report.fixedWall.elapsedMs / 1000);
    report.fixedFrames.uniqueFps = (report.fixedFrames.frames - 1) /
      (report.fixedFrames.elapsedMs / 1000);
    report.fixedFrames.presentFps = report.fixedFrames.presents /
      (report.fixedFrames.elapsedMs / 1000);
    if (oracle) report.comparison = compareReports(oracle, report);
    return report;
  } finally {
    await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  if (process.argv.includes('--help')) { console.log(usage()); return; }
  const options = parseArgs(process.argv.slice(2));
  const report = await runBenchmark(options);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.out) fs.writeFileSync(options.out, json);
  console.log(json.trim());
  if (report.problems.length) process.exitCode = 1;
  if (report.comparison && (!report.comparison.anchorMatch || !report.comparison.pixelSequenceMatch)) {
    process.exitCode = 2;
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exit(1); });

module.exports = { ISO_BYTES, ISO_SHA256, compareReports, handlerNames, parseArgs, usage };
