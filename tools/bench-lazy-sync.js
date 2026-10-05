#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('../test/static-server');
const ROOT = path.resolve(__dirname, '..');
const opt = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  const output = path.resolve(opt('out', 'build/lazy-sync-synthetic/run-' + Date.now()));
  assert(!fs.existsSync(path.join(output, 'results.json')), 'choose an unused output directory');
  fs.mkdirSync(output, { recursive: true });
  const fixture = fs.readFileSync(path.join(__dirname, 'bench-lazy-sync.wat'), 'utf8');
  let wasm;
  if (opt('wasm')) wasm = fs.readFileSync(path.resolve(opt('wasm')));
  else {
    console.log('Compiling canonical runtime with benchmark-only exports...');
    wasm = require('../test/compile-src').compileSrcWasm((file, source) =>
      file === '13-exports.wat' ? source + '\n' + fixture : source);
  }
  const module = new WebAssembly.Module(wasm);
  assert(WebAssembly.Module.exports(module).some(e => e.name === 'bl_free'), 'WASM lacks latest benchmark exports');
  fs.writeFileSync(path.join(output, 'runtime.wasm'), wasm);
  fs.writeFileSync(path.join(output, 'fixture.wat'), fixture);
  if (process.argv.includes('--compile-only')) { console.log(output); return; }
  const config = { width: +opt('width', '640'), height: +opt('height', '480'),
    frames: +opt('frames', '120'), warmup: +opt('warmup', '20'), rounds: +opt('rounds', '2'),
    cases: opt('cases', '').split(',').filter(Boolean) };
  assert([config.frames, config.rounds].every(n => Number.isInteger(n) && n > 0));
  assert(Number.isInteger(config.warmup) && config.warmup >= 0);
  assert(config.width >= 320 && config.height >= 16 && config.width <= 2048 && config.height <= 2048);
  const sources = new Map([
    ['/tools/bench-lazy-sync-worker.js', fs.readFileSync(path.join(__dirname, 'bench-lazy-sync-worker.js'))],
    ['/lib/d3dim-gpu.js', fs.readFileSync(path.join(ROOT, 'lib/d3dim-gpu.js'))],
  ]);
  const manifest = { started: new Date().toISOString(), config, wasm: hash(wasm),
    fixture: hash(fixture), files: Object.fromEntries([...sources].map(([p, b]) => [p, hash(b)])),
    cpu: os.cpus()[0]?.model, platform: process.platform, loadBefore: os.loadavg() };
  for (const [file, bytes] of sources) fs.writeFileSync(path.join(output, path.basename(file)), bytes);
  const server = await startStaticServer({ root: ROOT, crossOriginIsolated: true,
    handleRequest(req, res) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
      if (pathname === '/fixture') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Lazy sync synthetic benchmark</title>'); return true;
      }
      const bytes = pathname === '/fixture.wasm' ? wasm : sources.get(pathname);
      if (!bytes) return false;
      res.writeHead(200, { ...headers, 'Content-Type': pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
      res.end(bytes); return true;
    } });
  let browser;
  const progress = [], errors = [];
  try {
    browser = await puppeteer.launch({ headless: !process.argv.includes('--headful'),
      executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      protocolTimeout: 600000, args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox'] });
    manifest.browser = await browser.version();
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.exposeFunction('benchProgress', row => {
      progress.push(row);
      console.log(`${row.name} ${row.arm} ${row.status} ${row.error || row.msPerFrame.toFixed(3) + ' ms/work unit'}`);
      fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(progress, null, 2));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    const result = await page.evaluate(async config => {
      if (!crossOriginIsolated) throw Error('shared-memory isolation missing');
      const module = await WebAssembly.compile(await (await fetch('/fixture.wasm')).arrayBuffer());
      return new Promise((resolve, reject) => {
        const worker = new Worker('/tools/bench-lazy-sync-worker.js');
        const timer = setTimeout(() => { worker.terminate(); reject(Error('benchmark timeout')); }, 540000);
        worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
        worker.onmessage = ({ data }) => {
          if (data.t === 'progress') window.benchProgress(data.row);
          if (data.t === 'done' || data.t === 'error') {
            clearTimeout(timer); worker.terminate();
            data.t === 'done' ? resolve(data.result) : reject(Error(data.error));
          }
        };
        worker.postMessage({ t: 'run', module, config });
      });
    }, config);
    manifest.loadAfter = os.loadavg();
    const softwareGPU = /swiftshader|llvmpipe|software rasterizer/i.test(result.renderer);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ manifest, ...result, softwareGPU, errors }, null, 2));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(!softwareGPU || process.argv.includes('--allow-software-gl'), 'hardware benchmark used software GL');
    assert(result.rows.filter(r => r.arm === 'eager').every(r => r.status === 'PASS'), 'an eager correctness control failed');
    console.log(`Results: ${output}\nGPU: ${result.renderer}`);
    // Current lazy failures are audit findings, not a harness failure. CI for a
    // corrected runtime must opt into the strict promotion gate.
    if (process.argv.includes('--require-correct')) assert(result.rows.every(r => r.status === 'PASS'), 'candidate correctness gate failed');
  } finally {
    await browser?.close(); await closeServer(server);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
