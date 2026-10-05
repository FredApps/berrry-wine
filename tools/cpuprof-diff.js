#!/usr/bin/env node
// Two-point CPU profile: self time per function in profile B minus profile A.
//
//   node tools/cpuprof-diff.js <boot.cpuprofile> <end.cpuprofile> [top=40] [--names] [--wasm-only]
//
// Why subtraction: `node --cpu-prof` covers the whole process, and on an app
// whose boot is minutes long the gameplay window is a rounding error inside
// it. Run the same route twice, once to the batch where gameplay starts (A)
// and once past it (B); every function's self time in A is boot cost that B
// also paid, so B - A is the gameplay window's profile. Same axis as the
// two-point CPU harness (gameplay-ab.js): fixed work, USER time, boot
// cancels. A negative delta is sampling noise or boot that ran differently
// (an input landing on another batch); it is printed, not hidden.
//
// Labels and wasm-name resolution are the same as tools/cpuprof-top.js, so a
// row here can be looked up there with --callers=.
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
if (files.length !== 2) {
  console.error('usage: node tools/cpuprof-diff.js <boot.cpuprofile> <end.cpuprofile> [top] [--names] [--wasm-only]');
  process.exit(1);
}
const top = parseInt(process.argv.find(a => /^\d+$/.test(a)) || '40', 10);
const withNames = process.argv.includes('--names');
const wasmOnly = process.argv.includes('--wasm-only');

const wasmNames = (() => {
  if (!withNames) return null;
  const { execFileSync } = require('child_process');
  const out = execFileSync('node',
    [path.join(__dirname, 'wasm-func-name.js'), '--dump'], { encoding: 'utf8' });
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^\[(\d+)\] (.+?) \(/);
    if (m) map.set(Number(m[1]), m[2]);
  }
  return map;
})();

const wasmLabels = new Set();
function label(n) {
  const f = n.callFrame;
  const name = f.functionName || '(anonymous)';
  const wasmIdx = name.match(/^wasm-function\[(\d+)\]$/);
  if (wasmIdx) {
    const resolved = (wasmNames && wasmNames.get(Number(wasmIdx[1]))) || name;
    wasmLabels.add(resolved);
    return resolved;
  }
  const url = (f.url || '').replace(/^file:\/\//, '').split('/').slice(-1)[0];
  return url ? `${name} @ ${url}:${f.lineNumber + 1}` : name;
}

function selfByLabel(file) {
  const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const n of prof.nodes) byId.set(n.id, n);
  const agg = new Map();
  let total = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    total += dt;
    const n = byId.get(prof.samples[i]);
    if (!n) continue;
    const k = label(n);
    agg.set(k, (agg.get(k) || 0) + dt);
  }
  return { agg, total };
}

const A = selfByLabel(files[0]);
const B = selfByLabel(files[1]);
const isWasm = k => wasmLabels.has(k) || k.startsWith('wasm-function[');

const delta = new Map();
for (const k of new Set([...A.agg.keys(), ...B.agg.keys()])) {
  delta.set(k, (B.agg.get(k) || 0) - (A.agg.get(k) || 0));
}
const window = B.total - A.total;
let wasmMs = 0;
for (const [k, ms] of delta) if (isWasm(k)) wasmMs += ms;
console.log(`boot profile: ${A.total.toFixed(0)} ms   end profile: ${B.total.toFixed(0)} ms   window (end - boot): ${window.toFixed(0)} ms`);
console.log(`window wasm: ${wasmMs.toFixed(0)} ms (${(100 * wasmMs / window).toFixed(1)}%), other: ${(window - wasmMs).toFixed(0)} ms`);
const denom = wasmOnly ? wasmMs : window;
console.log(`--- self time in the window${wasmOnly ? ', wasm only' : ''} (B - A) ---`);
const rows = [...delta].filter(([k]) => !wasmOnly || isWasm(k)).sort((a, b) => b[1] - a[1]);
for (const [k, ms] of rows.slice(0, top)) {
  console.log(`${ms.toFixed(1).padStart(9)} ms  ${(100 * ms / denom).toFixed(1).padStart(5)}%  ${k}`);
}
const neg = rows.filter(([, ms]) => ms < -50);
if (neg.length) {
  console.log('--- negative deltas (boot ran differently, or noise) ---');
  for (const [k, ms] of neg.slice(-10)) console.log(`${ms.toFixed(1).padStart(9)} ms  ${k}`);
}
