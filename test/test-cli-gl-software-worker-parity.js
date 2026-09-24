#!/usr/bin/env node
'use strict';

// With a render worker attached, the WAT software OpenGL rasterizer queues
// each draw there with a snapshot of the state it draws by, and fences before
// every clear, swap, surface resize and texture change. So a run with
// --gl-renderer=software --d3d-worker must capture the same pixels as one that
// rasterizes on the guest thread, and the worker must actually have drawn
// them. Quake II's ref_gl loading demo1 draws lightmapped world passes, the
// the HUD and the view weapon, and re-uploads dynamic lightmaps mid-frame.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { diffPng, readPng } = require('../tools/png-diff');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'candidates', 'quake-2-demo-installer',
  'installed-extracted', 'Install', 'Data', 'quake2.exe');
const WASM = process.env.WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');

if (!fs.existsSync(EXE) || !fs.existsSync(WASM)) {
  console.log('SKIP: the Quake II demo or the built WASM is unavailable');
  process.exit(0);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-sw-worker-parity-'));

function capture(name, extra) {
  const png = path.join(outDir, `${name}.png`);
  const result = spawnSync('node', [
    RUN, '--app=quake2_demo', '--no-build', `--wasm=${WASM}`, '--no-close',
    '--gl-renderer=software', '--args=+set vid_ref gl +map demo1',
    '--quiet-api', '--quiet-blocks', '--stuck-after=100000000', '--batch-size=100000',
    '--max-batches=1100', '--max-seconds=150', '--gl-census', `--png=${png}`, ...extra,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, `${name} exited ${result.status}\n${output.slice(-3000)}`);
  assert.ok(fs.existsSync(png), `${name} wrote no capture\n${output.slice(-3000)}`);
  const census = /\[gl-census\] software raster: triangles=(\d+)/.exec(output);
  assert.ok(census, `${name}: no software-raster census\n${output.slice(-3000)}`);
  const tex = /worker-tex-uploads=(\d+)/.exec(output);
  return { png, output, triangles: +census[1], texQueued: tex ? +tex[1] : 0 };
}

const sync = capture('sync', []);
const worker = capture('worker', ['--d3d-worker']);

const stats = /\[d3d-worker\] ready=(\w+) queued=(\d+) fallbacks=(\d+) fences=(\d+)/.exec(worker.output);
assert.ok(stats, `no [d3d-worker] summary\n${worker.output.slice(-3000)}`);
const [, ready, queued, fallbacks, fences] = stats;
assert.strictEqual(ready, 'true', 'render worker never became ready');
assert.ok(+queued > 1000, `only ${queued} GL draws reached the render worker`);
assert.strictEqual(+fallbacks, 0, `${fallbacks} draws fell back to the guest thread`);
assert.ok(+fences > 5, `only ${fences} fences; swaps are not waiting for queued draws`);
assert.ok(sync.triangles > 1000, `the guest-thread run drew only ${sync.triangles} triangles`);
// Dynamic lightmaps: upload, draw, upload the same texture again. Each
// upload must land after the draws queued ahead of it, not stall on them.
assert.ok(worker.texQueued > 50, `only ${worker.texQueued} glTexSubImage2D uploads were queued`);
assert.strictEqual(worker.triangles, sync.triangles,
  'the worker run\'s census (worker counts added back) disagrees with the guest-thread run');

const frame = readPng(sync.png);
const colours = new Set();
for (let i = 0; i < frame.data.length; i += 4)
  colours.add((frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2]);
assert.ok(colours.size >= 16, 'the guest-thread capture is near-blank, so parity would prove nothing');
const diff = diffPng(sync.png, worker.png);
assert.strictEqual(diff.changed, 0,
  `worker capture differs from the guest-thread capture: ${JSON.stringify(diff)}`);
console.log(`PASS  software GL on the render worker is pixel-identical on Quake II ` +
  `(${queued} draws, ${worker.texQueued} queued uploads, ${fences} fences, ${sync.triangles} triangles)`);
