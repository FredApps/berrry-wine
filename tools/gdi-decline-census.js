#!/usr/bin/env node
'use strict';

// Why did this app's blits go through the slow per-pixel raster path?
//
//   node tools/gdi-decline-census.js --app=simgolf --batches=4000
//   node tools/gdi-decline-census.js --exe=path/to.exe --batches=2000 -- --screen=1024x768
//
// $gdi_raster_bitblt_fast32 either takes a blit or hands it back to the
// generic loop, and the generic loop re-resolves the clip and the DC state for
// every pixel of the blit -- on Diablo's Choose Class that loop plus its clip
// lookups was about three quarters of all CPU. So "which gate declined, and
// how often" is the work list for widening the fast path, and it is the only
// thing that separates "this app never takes the fast blit" from "it takes it
// and that is not where the time goes". Both look like a slow app.
//
// The counters are plain wasm exports ($GDI_BITBLT_DECLINE, written by
// $gdi_bitblt_decline in src/10g-gdi-raster.wat). This drives run.js over
// --control-stdin and reads them with an `eval` command rather than adding
// another print to run.js, so it works against a working tree somebody else is
// in the middle of editing.
//
// READ THE PIXELS, NOT THE COUNT. A count is per BLIT, and blits differ in
// area by orders of magnitude -- one declined full-screen present is 307200
// pixels while a thousand declined 8x8 cursor blits are 64000. "declined
// pixels" below is the number that says whether a gate costs anything.
//
// The span-raster block is a DIFFERENT subsystem and is printed only as
// context: a declined BitBlt goes to the generic blit loop, which is not the
// span rasterizer, so a "slow span" share of 0.0% says nothing at all about
// these declines. Reading it as though it did is the mistake this note exists
// to prevent -- it was in an earlier version of this tool's own output.

const path = require('path');
const { startControlSession } = require('../test/control-session');

const ROOT = path.join(__dirname, '..');

// Index -> what that gate means. Must match $gdi_bitblt_decline's comment in
// src/10g-gdi-raster.wat; test/test-wat-gdi-bitblt-declines.js pins the
// numbering so this cannot drift silently.
const REASONS = [
  'destination is not 32bpp',
  'clip region has more than one rect',
  'blit geometry outside the safe range',
  'source coordinates outside the safe range',
  'source bpp is not 32/16/8/4/1',
  'palette absent or shorter than the source depth needs',
  'degenerate 16bpp channel mask',
  'source and destination are one surface (overlap)',
  'ROP3 reads no source and is not one of the four pattern ops',
  'PATCOPY brush is not a single colour',
  'SRCINVERT from an indexed source (generic evaluates it in index space)',
];

// Slots 11-14 are a second dimension, not more reasons: when reason 4 fires,
// $gdi_bitblt_decline_src_bpp also buckets the depth it actually saw, because
// a bare "bpp not supported" names several different unpackers and does not
// say which one the app wants. These are counted IN ADDITION to reason 4, so
// they sum to it. They sit ABOVE the reasons, so adding a reason moves them --
// test/test-wat-gdi-bitblt-declines.js pins the numbering both tools read.
const SRC_BPP_BUCKETS = [
  [11, '1bpp source (monochrome mask)'],
  [12, '4bpp source'],
  [13, '24bpp source'],
  [14, 'source of some other depth'],
];

// test_gdi_fast_count's indices, from src/10g-gdi-raster.wat.
const SPAN = {
  fastSpans: 0, fastBitblts: 1, fastStretches: 2, slowSpans: 3,
  fastPx: 4, slowPx: 5, slowByClip: 6, slowByRop: 7, bandSpans: 8,
  declinedPx: 9,
};

function parseArgs(argv) {
  const out = { batches: 2000, passthrough: [] };
  const rest = [];
  let afterDashDash = false;
  for (const arg of argv) {
    if (afterDashDash) { out.passthrough.push(arg); continue; }
    if (arg === '--') { afterDashDash = true; continue; }
    let m;
    if ((m = arg.match(/^--app=(.+)$/))) out.app = m[1];
    else if ((m = arg.match(/^--exe=(.+)$/))) out.exe = m[1];
    else if ((m = arg.match(/^--batches=(\d+)$/))) out.batches = Number(m[1]);
    else if ((m = arg.match(/^--step=(\d+)$/))) out.step = Number(m[1]);
    else if (arg === '--json') out.json = true;
    else rest.push(arg);
  }
  if (rest.length) {
    console.error(`unrecognized argument(s): ${rest.join(' ')}`);
    process.exit(2);
  }
  if (!out.app && !out.exe) {
    console.error('need --app=ID or --exe=PATH');
    process.exit(2);
  }
  return out;
}

// One eval round trip reads everything, so the two families of counters
// describe the same instant rather than two moments a few batches apart.
const READ_COUNTERS = `
  (function () {
    var e = instance.exports;
    var declines = [];
    for (var i = 0; i < 16; i++) {
      declines.push(e.test_gdi_bitblt_decline_count
        ? e.test_gdi_bitblt_decline_count(i) >>> 0 : -1);
    }
    var spans = [];
    for (var j = 0; j < 10; j++) {
      spans.push(e.test_gdi_fast_count ? e.test_gdi_fast_count(j) >>> 0 : -1);
    }
    return { declines: declines, spans: spans, batch: tickState.batch | 0 };
  })()
`;

function bar(share, width = 28) {
  const filled = Math.round(share * width);
  return '#'.repeat(filled) + '.'.repeat(width - filled);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const args = [
    path.join(ROOT, 'test', 'run.js'),
    opts.app ? `--app=${opts.app}` : `--exe=${opts.exe}`,
    '--control-stdin', '--frozen', '--quiet-api',
    `--max-batches=${opts.batches + 1000}`,
    ...opts.passthrough,
  ];
  const session = startControlSession(args, { cwd: ROOT });
  let result;
  try {
    // A run.js that dies before the first reply is almost never a bad app id
    // -- on a shared working tree it is usually somebody's half-finished WAT
    // edit failing the WATX compile. Say which, instead of reporting the
    // framing error and letting the app take the blame.
    try {
      await session.send({ action: 'ping' });
    } catch (error) {
      const out = session.output();
      const compile = out.match(/^.*(?:WATX compile failed|Compilation failed).*$/m);
      if (compile) throw new Error(`run.js never started: ${compile[0].trim()}`);
      throw new Error(`${error.message}\n--- run.js output ---\n${out.slice(-2000)}`);
    }
    // --frozen parks before the first batch, so the run advances only here and
    // the counters describe exactly this many batches of this app.
    const step = opts.step || opts.batches;
    let done = 0;
    while (done < opts.batches) {
      const n = Math.min(step, opts.batches - done);
      await session.send({ action: 'step', n });
      done += n;
    }
    result = await session.send({ action: 'eval', code: READ_COUNTERS });
  } finally {
    try { await session.send({ action: 'quit' }); } catch (_) { /* exiting */ }
    await session.exited;
  }

  if (!result || !Array.isArray(result.declines)) {
    console.error('no counters came back; is this build older than 981e5c25?');
    process.exit(1);
  }
  if (result.declines[0] === -1) {
    console.error('test_gdi_bitblt_decline_count is missing from this build');
    process.exit(1);
  }

  const declines = result.declines;
  const spans = result.spans;
  // Only slots 0..9 are reasons; 10..15 are the source-depth breakdown of
  // reason 4 and would double-count if they were summed into the total.
  const total = declines.slice(0, REASONS.length).reduce((a, b) => a + b, 0);
  const fastPx = spans[SPAN.fastPx];
  const slowPx = spans[SPAN.slowPx];
  const px = fastPx + slowPx;

  if (opts.json) {
    console.log(JSON.stringify({
      app: opts.app || opts.exe, batches: result.batch,
      declines: REASONS.map((name, i) => ({ reason: i, name, count: declines[i] })),
      byDepth: SRC_BPP_BUCKETS.map(([slot, name]) => ({ slot, name, count: declines[slot] || 0 })),
      total, declinedPx: spans[SPAN.declinedPx],
      fastBitblts: spans[SPAN.fastBitblts], spans,
    }, null, 2));
    return;
  }

  const declinedPx = spans[SPAN.declinedPx];
  const fastBlits = spans[SPAN.fastBitblts];

  console.log(`\n${opts.app || opts.exe}: ${result.batch} batches`);
  console.log(`\nfast-path bitblt declines: ${total} blit(s), ` +
    `${declinedPx} px, against ${fastBlits} blit(s) taken fast`);
  if (!total) {
    console.log('  none — every blit this run took the fast 32bpp path.');
  } else {
    const order = REASONS
      .map((name, i) => ({ name, i, count: declines[i] }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
    for (const r of order) {
      const share = r.count / total;
      console.log(`  ${bar(share)} ${String(r.count).padStart(8)} ` +
        `${(100 * share).toFixed(1).padStart(5)}%  [${r.i}] ${r.name}`);
    }
  }

  const byDepth = SRC_BPP_BUCKETS
    .map(([slot, name]) => ({ name, count: declines[slot] || 0 }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.count - a.count);
  if (byDepth.length) {
    console.log(`\n  of those, reason 4 by source depth:`);
    for (const b of byDepth) {
      console.log(`    ${String(b.count).padStart(8)}  ${b.name}`);
    }
  }

  // A DIFFERENT subsystem, printed as context only. A declined BitBlt runs the
  // generic blit loop, not the span rasterizer, so nothing here prices the
  // histogram above -- "declined px" on the first line does that.
  console.log(`\nspan raster (a separate path; does NOT price the declines above):`);
  console.log(`  ${spans[SPAN.fastBitblts]} fast bitblts, ` +
    `${spans[SPAN.fastStretches]} fast stretches`);
  console.log(`  ${spans[SPAN.fastSpans]} fast spans (${fastPx} px), ` +
    `${spans[SPAN.slowSpans]} slow spans (${slowPx} px)`);
  console.log(`  slow-path pixel share ` +
    `${px ? (100 * slowPx / px).toFixed(1) : '0.0'}%` +
    `  (slow spans by cause: ${spans[SPAN.slowByClip]} clip/bounds, ` +
    `${spans[SPAN.slowByRop]} surface-or-ROP)`);
  console.log('');
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
