#!/usr/bin/env node
// Name and attribute a handler/hot-block histogram that was read out of the
// BROWSER instead of test/run.js.
//
//   node tools/browser-handler-hist.js <hist.json> [--top=20] [--blocks=25]
//                                      [--exe-base=0x400000] [--dump=FILE]
//
// WHY THIS EXISTS: `--handler-hist` only exists in test/run.js, and an app
// whose gameplay only runs in a browser (anything on the OpenGL path —
// lib/gl-compat.js needs a `document`, and wglCreateContext returns 0 without
// one) can never be profiled with it. The same numbers are plain wasm exports,
// so a page can read them; what it cannot do is name handler 64 or say which
// DLL block 0x00a98462 is in. That is this file.
//
// The input is whatever JSON a page probe produced from these exports:
//   get_handler_hist_base/_slots/_count   -> { handlers: [[id, hits], ...] }
//   get_hot_block_hist_base/_count        -> { blocks:   [["hexaddr", hits], ...] }
//   wine.moduleBases                      -> { mods: { name: [base, origBase] } }
// plus the scalar totals `ops` and `blockHits`. Extra fields are ignored, so
// the probe is free to carry a WinePerf snapshot along in the same object.
//
// Handler names come from the `(elem ...)` list in src/02-thread-table.wat —
// the same source test/run.js reads — so a renumber cannot desync them.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const file = argv.find(a => !a.startsWith('--'));
if (!file) {
  console.error('usage: browser-handler-hist.js <hist.json> [--top=N] [--blocks=N]');
  process.exit(2);
}
const TOP = Number(opt('top', 20));
const BLOCKS = Number(opt('blocks', 25));
const EXE_BASE = Number(opt('exe-base', '0x400000'));
const DUMP = opt('dump', '');

const { makeAttributor, readHist, handlerNames } = require('./hist-blocks');

const hist = readHist(file);
const names = handlerNames();

const attribute = makeAttributor(hist, EXE_BASE);

const ops = hist.ops || 0;
const blockHits = hist.blockHits || 0;
console.log(`ops ${ops.toLocaleString()}   block entries ${blockHits.toLocaleString()}` +
  (blockHits ? `   ${(ops / blockHits).toFixed(2)} ops/block` : '') +
  `   distinct blocks ${hist.distinct || (hist.blocks || []).length}`);

console.log('');
console.log('top handlers:');
for (const [id, hits] of (hist.handlers || []).slice(0, TOP)) {
  const pct = ops ? (hits * 100 / ops).toFixed(2) : '0.00';
  console.log(`  H${String(id).padStart(3)} ${(names[id] || '$handler_' + id).padEnd(46)}` +
    ` ${String(hits).padStart(10)} (${pct}%)`);
}

console.log('');
console.log('top blocks:');
const perModule = new Map();
for (const [hex, hits] of (hist.blocks || [])) {
  const addr = parseInt(hex, 16) >>> 0;
  const a = attribute(addr);
  perModule.set(a.name, (perModule.get(a.name) || 0) + hits);
}
for (const [hex, hits] of (hist.blocks || []).slice(0, BLOCKS)) {
  const addr = parseInt(hex, 16) >>> 0;
  const a = attribute(addr);
  const pct = blockHits ? (hits * 100 / blockHits).toFixed(2) : '0.00';
  console.log(`  0x${addr.toString(16).padStart(8, '0')}  ${a.name}+0x${a.va.toString(16)}`.padEnd(44) +
    ` ${String(hits).padStart(9)} (${pct}%)`);
}

console.log('');
console.log('listed block hits by module:');
for (const [name, hits] of [...perModule].sort((a, b) => b[1] - a[1])) {
  const pct = blockHits ? (hits * 100 / blockHits).toFixed(1) : '0.0';
  console.log(`  ${name.padEnd(14)} ${String(hits).padStart(10)} (${pct}% of all block entries)`);
}

// The histogram window, in frames. Counts are load-immune and a present count
// is load-immune too, so block-entries-per-present survives a busy box even
// though every millisecond figure on it does not. Divide by the blocks/pixel
// that tools/bench-loops.js measures for the same loop shape and the result is
// pixels blitted per frame — the number that says whether a per-pixel fold can
// reach a target frame rate, with no timing in it anywhere.
// Decode-time fold counters, when the probe carried them. A fold that matched
// but never ran, or never matched at all, is the difference between "it is
// broken" and "this scene does not execute that loop" -- and a hot-block table
// alone cannot tell those apart, because in both cases the unfolded blocks are
// simply absent from the top of it.
if (hist.folds && Object.keys(hist.folds).length) {
  console.log('');
  console.log('decode-time folds:');
  for (const [name, value] of Object.entries(hist.folds)) {
    console.log(`  ${name.padEnd(24)} ${String(value).padStart(12)}`);
  }
}

const times = hist.presentTimes;
if (Array.isArray(times) && times.length && hist.armPerfMs && hist.nowMs) {
  const from = hist.armPerfMs, to = hist.nowMs;
  const inWindow = times.filter(t => t >= from && t <= to);
  const spanS = (to - from) / 1000;
  console.log('');
  console.log(`histogram window: ${spanS.toFixed(1)}s, ${inWindow.length} guest presents` +
    ` => ${(inWindow.length / spanS).toFixed(2)} present/s` +
    ` (ring holds ${times.length}; snapshot's 2s guestFps was ` +
    `${hist.perf && hist.perf.guestFps != null ? hist.perf.guestFps.toFixed(2) : '?'})`);
  if (inWindow.length) {
    console.log(`  ${(blockHits / inWindow.length / 1000).toFixed(1)}k block entries per present` +
      `   ${(ops / inWindow.length / 1000).toFixed(1)}k ops per present`);
    for (const [name, hits] of [...perModule].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      const perFrame = hits / inWindow.length;
      console.log(`  ${name.padEnd(14)} ${(perFrame / 1000).toFixed(1)}k block entries/frame` +
        `  => ${(perFrame / 3.75 / 1000).toFixed(1)}k px/frame at 3.75 blocks/px` +
        ` (${(perFrame / 3.0 / 1000).toFixed(1)}k at 3.00)`);
    }
  }
}

if (DUMP) {
  fs.writeFileSync(DUMP, (hist.blocks || [])
    .map(([hex, hits]) => {
      const addr = parseInt(hex, 16) >>> 0;
      const a = attribute(addr);
      return `0x${addr.toString(16)} ${hits} ${a.name}+0x${a.va.toString(16)}`;
    }).join('\n') + '\n');
  console.log(`\nwrote ${(hist.blocks || []).length} blocks to ${DUMP}`);
}
