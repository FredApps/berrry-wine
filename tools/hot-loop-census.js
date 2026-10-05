#!/usr/bin/env node
// Which loops are hot in a browser app, ACROSS several profiling windows.
//
//   node tools/hot-loop-census.js <hist1.json> [hist2.json ...]
//        [--gap=256] [--top=20] [--exe-base=0x400000] [--json] [--blocks]
//
// WHY THIS EXISTS: tools/browser-handler-hist.js reports one window, and a
// single window is not evidence about where an app spends its time. SimGolf
// proved it the expensive way -- jgl+0x10017b6f was 9.65% of block entries in
// one sample and absent from the top forty in the next, and a superinstruction
// got built for it that moved the frame rate not at all. What a fold needs is
// a loop that is hot in EVERY window, and nothing printed per-window can say
// that.
//
// So this takes N of those JSONs and prints, per loop, its share in each one
// plus the spread between them. Read the spread column first: a region at 53%
// in one window and 0% in another is a scene, not a fold target.
//
// GROUPING IS BY PROXIMITY, NOT BY CONTROL FLOW. Blocks whose VAs are within
// --gap bytes of each other in the same module are treated as one loop. That
// is right for the shape this is aimed at -- a blit loop's arms are a couple
// of hundred bytes of straight-line code between one backward jump -- and it
// is wrong wherever two unrelated hot loops sit next to each other. It is a
// heuristic and it is printed as one: --blocks lists every member VA so a bad
// grouping is visible rather than silent, and the extent is in every row.
//
// Counts are load-immune, and so is the present count each window carries, so
// "block entries per frame" survives a busy box even though no millisecond
// figure on it does.

'use strict';

const fs = require('fs');
const { readWindows } = require('./hist-blocks');

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const files = argv.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: hot-loop-census.js <hist.json> [hist.json ...] ' +
    '[--gap=256] [--top=20] [--blocks] [--json]');
  process.exit(2);
}
const GAP = Number(opt('gap', 256));
const TOP = Number(opt('top', 20));
const EXE_BASE = Number(opt('exe-base', '0x400000'));
const SHOW_BLOCKS = argv.includes('--blocks');
const AS_JSON = argv.includes('--json');

// ---- one window ------------------------------------------------------------

function loadWindow(file) {
  // One file can be many windows: a tools/ctl-hist-series.js .ndjson holds a
  // whole series, which is exactly the input this tool wants and previously
  // could not take.
  return readWindows(file, EXE_BASE).map(w => finishWindow(file, w));
}

function finishWindow(file, w) {
  const hist = w.hist || {};
  const blocks = w.blocks;
  // The present ring is the whole run; only the presents between the arm and
  // the read belong to these counts.
  let presents = null, spanS = null;
  const times = hist.presentTimes;
  if (Array.isArray(times) && hist.armPerfMs && hist.nowMs) {
    presents = times.filter(t => t >= hist.armPerfMs && t <= hist.nowMs).length;
    spanS = (hist.nowMs - hist.armPerfMs) / 1000;
  }
  return {
    file: w.label || file, blocks,
    ops: w.ops || 0,
    blockHits: w.blockHits || 0,
    distinct: w.distinct || blocks.length,
    folds: hist.folds || null,
    presents, spanS,
    // The probe returns only the top N blocks, so shares here are shares of
    // ALL block entries (the scalar total), not of what was listed. Say so.
    listed: blocks.reduce((s, b) => s + b.hits, 0),
  };
}

const windows = files.flatMap(loadWindow);

// ---- group blocks into loop regions ----------------------------------------
// Regions are built from the union of every window's blocks, so a loop that
// only appears in one window still gets a row (with 0% in the others) instead
// of vanishing into whichever window happened to be read first.

const all = [];
for (let w = 0; w < windows.length; w++) {
  for (const b of windows[w].blocks) all.push({ ...b, w });
}
all.sort((a, b) => a.mod === b.mod ? a.va - b.va : (a.mod < b.mod ? -1 : 1));

const regions = [];
let cur = null;
for (const b of all) {
  if (!cur || b.mod !== cur.mod || b.va - cur.hi > GAP) {
    cur = { mod: b.mod, lo: b.va, hi: b.va, vas: new Set(), hits: windows.map(() => 0) };
    regions.push(cur);
  }
  cur.hi = Math.max(cur.hi, b.va);
  cur.vas.add(b.va);
  cur.hits[b.w] += b.hits;
}

for (const r of regions) {
  r.shares = r.hits.map((h, i) =>
    windows[i].blockHits ? h * 100 / windows[i].blockHits : 0);
  r.perFrame = r.hits.map((h, i) =>
    windows[i].presents ? h / windows[i].presents : null);
  r.mean = r.shares.reduce((a, b) => a + b, 0) / r.shares.length;
  r.min = Math.min(...r.shares);
  r.max = Math.max(...r.shares);
  r.spread = r.max - r.min;
}
regions.sort((a, b) => b.mean - a.mean);

// ---- report ----------------------------------------------------------------

if (AS_JSON) {
  console.log(JSON.stringify({
    windows: windows.map(w => ({
      file: w.file, ops: w.ops, blockHits: w.blockHits,
      presents: w.presents, spanS: w.spanS, folds: w.folds,
    })),
    regions: regions.slice(0, TOP).map(r => ({
      mod: r.mod, lo: r.lo, hi: r.hi, blocks: [...r.vas].sort((a, b) => a - b),
      hits: r.hits, shares: r.shares, perFrame: r.perFrame,
      mean: r.mean, min: r.min, max: r.max, spread: r.spread,
    })),
  }, null, 2));
  process.exit(0);
}

console.log(`${windows.length} window(s), grouped at gap<=${GAP}B\n`);
for (let i = 0; i < windows.length; i++) {
  const w = windows[i];
  const rate = w.presents && w.spanS ? (w.presents / w.spanS).toFixed(2) : '?';
  const opsF = w.presents ? (w.ops / w.presents / 1000).toFixed(0) + 'k' : '?';
  console.log(`  w${i + 1}  ${w.file}`);
  console.log(`      ${w.ops.toLocaleString()} ops   ` +
    `${w.blockHits.toLocaleString()} block entries   ` +
    `${(w.ops / (w.blockHits || 1)).toFixed(2)} ops/block   ` +
    `${w.distinct} distinct blocks`);
  console.log(`      ${w.presents == null ? 'no present ring' :
    `${w.presents} presents in ${w.spanS.toFixed(1)}s = ${rate}/s`}` +
    `   ${opsF} ops/frame` +
    `   listed blocks cover ${(w.listed * 100 / (w.blockHits || 1)).toFixed(1)}%` +
    ` of all entries`);
  if (w.folds && Object.keys(w.folds).length) {
    console.log(`      folds: ` +
      Object.entries(w.folds).map(([k, v]) => `${k}=${v}`).join('  '));
  }
}

console.log('');
console.log('hot loop regions, by mean share of block entries');
console.log('  (spread = max-min across windows; a big spread is a scene, ' +
  'not a fold target)');
console.log('');
const hdr = windows.map((_, i) => `w${i + 1}`.padStart(7)).join('');
console.log(`  ${'region'.padEnd(38)}${hdr}${'mean'.padStart(8)}` +
  `${'spread'.padStart(8)}  blk/frame`);
for (const r of regions.slice(0, TOP)) {
  const name = `${r.mod}+0x${r.lo.toString(16)}` +
    (r.hi !== r.lo ? `..${r.hi.toString(16)}` : '');
  const cells = r.shares.map(s => `${s.toFixed(1)}%`.padStart(7)).join('');
  // The minimum across windows is what a fold can count on; the mean flatters
  // a region that was hot once.
  const pf = r.perFrame.filter(x => x != null);
  const pfs = pf.length
    ? `${(Math.min(...pf) / 1000).toFixed(0)}k-${(Math.max(...pf) / 1000).toFixed(0)}k`
    : '?';
  console.log(`  ${name.padEnd(38)}${cells}${r.mean.toFixed(1).padStart(7)}%` +
    `${r.spread.toFixed(1).padStart(7)}pp  ${pfs.padStart(9)}` +
    `  ${r.vas.size} blk`);
  if (SHOW_BLOCKS) {
    console.log(`      ${[...r.vas].sort((a, b) => a - b)
      .map(v => '0x' + v.toString(16)).join(' ')}`);
  }
}

// The one-line answer the whole tool exists for.
console.log('');
const stable = regions.filter(r => r.min >= 5).slice(0, 6);
if (!stable.length) {
  console.log('NO region holds >=5% of block entries in every window. ' +
    'Nothing here is a safe fold target on this evidence.');
} else {
  console.log('hot in EVERY window (>=5% floor) -- these are the fold targets:');
  for (const r of stable) {
    console.log(`  ${r.mod}+0x${r.lo.toString(16)}..${r.hi.toString(16)}` +
      `   floor ${r.min.toFixed(1)}%   mean ${r.mean.toFixed(1)}%`);
  }
}
