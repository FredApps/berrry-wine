#!/usr/bin/env node
'use strict';

// Every D3DIM draw path queues to the render worker when one is attached, and
// each surface read, clear and present fences first. So a run with
// --d3d-worker must capture the same pixels as one that rasterizes on the
// guest thread, and the worker must actually have drawn them. Flip3DTL draws
// through Device3::DrawPrimitive and flips every frame, which must fence; the
// indexed expansion is covered in-process by test-d3dim-worker-parity.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { diffPng, readPng } = require('../tools/png-diff');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'dx-sdk', 'bin', 'flip3dtl.exe');
const WASM = process.env.WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');

if (!fs.existsSync(EXE) || !fs.existsSync(WASM)) {
  console.log('SKIP: flip3dtl.exe or the built WASM is unavailable');
  process.exit(0);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd3d-worker-parity-'));

function capture(name, extra) {
  const png = path.join(outDir, `${name}.png`);
  const result = spawnSync('node', [
    RUN, '--app=dx_flip3dtl', '--no-build', `--wasm=${WASM}`, '--no-close',
    '--quiet-api', '--quiet-blocks', '--max-batches=3000', '--max-seconds=90',
    `--input=2800:png:${png}`, ...extra,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, `${name} exited ${result.status}\n${output.slice(-3000)}`);
  assert.ok(fs.existsSync(png), `${name} wrote no capture\n${output.slice(-3000)}`);
  return { png, output };
}

const sync = capture('sync', []);
const worker = capture('worker', ['--d3d-worker']);

const stats = /\[d3d-worker\] ready=(\w+) queued=(\d+) fallbacks=(\d+) fences=(\d+)/.exec(worker.output);
assert.ok(stats, `no [d3d-worker] summary\n${worker.output.slice(-3000)}`);
const [, ready, queued, fallbacks, fences] = stats;
assert.strictEqual(ready, 'true', 'render worker never became ready');
assert.ok(+queued > 500, `only ${queued} draws reached the render worker`);
assert.strictEqual(+fallbacks, 0, `${fallbacks} draws fell back to the guest thread`);
assert.ok(+fences > 100, `only ${fences} fences reached the worker; presents are not waiting for queued draws`);

const frame = readPng(sync.png);
const colours = new Set();
for (let i = 0; i < frame.data.length; i += 4)
  colours.add((frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2]);
assert.ok(colours.size >= 2, 'the guest-thread capture is blank, so parity would prove nothing');
const diff = diffPng(sync.png, worker.png);
assert.strictEqual(diff.changed, 0,
  `worker capture differs from the guest-thread capture: ${JSON.stringify(diff)}`);
console.log(`PASS  --d3d-worker is pixel-identical on Flip3DTL (${queued} draws, ${fences} fences)`);
