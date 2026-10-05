#!/usr/bin/env node
'use strict';

// Which loop CLASS does an app actually spend its block entries in?
//
// tools/find-diamonds.js answers a static question -- how many loops of each
// class a PE contains -- and the corpus answer (59% of loops invisible to
// $loop_match_block) is not the answer to the question that decides whether a
// fold is worth building. Static reach is not hotness: RLE_RUN matched 1 of 287
// PEs and was worth +7% on the one app that ran it, while SimGolf's H455 fold
// matched a loop that was 9.65% of one window and absent from the next, and
// moved the frame rate not at all.
//
// So this joins the two: hot blocks and their entry counts from a handler-hist
// window (test/run.js --hist-json=F, or the browser page probe), against every
// loop cycle find-diamonds found in the same binaries.
//
//   hist JSON (mod+VA, hits) x PE cycles [headVa..tailVa] -> share by class
//
// Read the SELFEXIT and DIAMOND rows: those are the entries the current
// single-block matcher cannot reach at all. A `none` share near 100% is itself
// a finding and the common one -- it means the app's hot code is not a short
// backward-branch loop, which is what four of five profiled apps turned out to
// be.
//
// usage:
//   node tools/loop-class-share.js <hist.json> [<hist2.json> ...] \
//     --exe=PATH [--pe=NAME=PATH ...] [--max-span=N] [--top=N] [--json]

const path = require('path');
// find-diamonds reads its limits off process.argv at require time, and this
// file appends to process.argv below -- so it is required lazily, after those
// appends. Requiring it at the top silently ran the scan with the DEFAULT
// limits and no --keep-nomemory, which put 79% of Caesar III's block entries
// into a `nomemory` bucket that hid the structural answer.
const { readWindows } = require('./hist-blocks');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flags = (name) => argv.filter(a => a.startsWith(`--${name}=`))
  .map(a => a.slice(name.length + 3));
const has = (name) => argv.includes(`--${name}`);

const files = argv.filter(a => !a.startsWith('--'));
const EXE = flag('exe', null);
const MAX_SPAN = flag('max-span', '160');
const TOP = parseInt(flag('top', '8'), 10);
const JSON_OUT = has('json');

if (!files.length || !EXE) {
  console.error('usage: loop-class-share.js <hist.json> [...] --exe=PATH '
    + '[--pe=NAME=PATH ...] [--max-span=N] [--top=N] [--json]');
  process.exit(2);
}

// Module name -> PE on disk. `exe` is the executable; a DLL is named the way
// the histogram attributes it (`storm.dll`), case-insensitively, because
// moduleBases and the filesystem disagree about case constantly.
const peByMod = new Map([['exe', EXE]]);
for (const spec of flags('pe')) {
  const eq = spec.indexOf('=');
  if (eq < 0) { console.error(`--pe wants NAME=PATH, got ${spec}`); process.exit(2); }
  peByMod.set(spec.slice(0, eq).toLowerCase(), spec.slice(eq + 1));
}

// find-diamonds reads its own limits off process.argv, so --max-span has to be
// visible to it. Setting it here rather than re-implementing the scan keeps one
// classifier in the tree.
if (!argv.some(a => a.startsWith('--max-span='))) process.argv.push(`--max-span=${MAX_SPAN}`);
if (!argv.some(a => a === '--detail')) process.argv.push('--detail');
// The structural question, not the blit-candidate question -- see cyclesFor.
if (!argv.some(a => a === '--keep-nomemory')) process.argv.push('--keep-nomemory');

// One sorted cycle list per module, so a hot block finds its containing loop by
// binary search rather than a scan per block.
const cyclesByMod = new Map();
function cyclesFor(mod) {
  const key = mod.toLowerCase();
  if (cyclesByMod.has(key)) return cyclesByMod.get(key);
  const pe = peByMod.get(key) || peByMod.get(key.replace(/\.dll$/, ''));
  let cycles = null;
  if (pe) {
    const r = require('./find-diamonds').scanFile(pe);
    if (r.error) {
      console.error(`  ! ${mod}: ${r.error}`);
    } else {
      cycles = [];
      // `~` marks a cycle that failed the blit heuristic: structurally a loop
      // of that class, but without the load/store/advance shape a memory fold
      // would want. Kept visible rather than merged, so "hot SELFEXIT" and
      // "hot SELFEXIT that is a counting loop" stay distinguishable.
      for (const h of r.hits) {
        cycles.push({ lo: h.headVa, hi: h.tailVa, cls: h.memory === false ? `${h.cls}~` : h.cls });
      }
      for (const d of r.declines) cycles.push({ lo: d.headVa, hi: d.tailVa, cls: `declined:${d.why}` });
      cycles.sort((a, b) => a.lo - b.lo);
    }
  }
  cyclesByMod.set(key, cycles);
  return cycles;
}

// The innermost cycle containing va, or null. Cycles nest (a diamond sits
// inside an outer loop), and the innermost one is the one a matcher would fold,
// so ties go to the tightest span rather than the first hit.
function classOf(mod, va) {
  const cycles = cyclesFor(mod);
  if (!cycles) return null;
  let best = null;
  for (const c of cycles) {
    if (c.lo > va) break;
    if (va <= c.hi && (!best || (c.hi - c.lo) < (best.hi - best.lo))) best = c;
  }
  return best;
}

const windows = [];
for (const f of files) {
  for (const w of readWindows(f, 0x400000)) windows.push({ file: path.basename(f), ...w });
}

const report = [];
for (const w of windows) {
  const byClass = new Map();
  const byLoop = new Map();
  let total = 0, unknownMod = 0;
  for (const b of w.blocks) {
    total += b.hits;
    const cyc = classOf(b.mod, b.va);
    if (cyc === null && !cyclesFor(b.mod)) unknownMod += b.hits;
    // A class of `none` is a real answer -- the block is not inside any cycle
    // this classifier recognizes -- and is kept distinct from a module whose PE
    // was never supplied, which is a gap in the invocation, not a measurement.
    const key = cyc === null ? (cyclesFor(b.mod) ? 'none' : 'NO-PE') : cyc.cls;
    byClass.set(key, (byClass.get(key) || 0) + b.hits);
    if (cyc) {
      // Key on the CYCLE HEAD, not the block. Several hot blocks share one
      // loop, and keying on the block prints that loop once per block at an
      // identical share -- which reads as several separate hot loops.
      const lk = `${b.mod}+0x${cyc.lo.toString(16)} ${cyc.cls}`;
      byLoop.set(lk, (byLoop.get(lk) || 0) + b.hits);
    }
  }
  report.push({ window: w.label, file: w.file, total, unknownMod,
    byClass: Object.fromEntries(byClass), byLoop: Object.fromEntries(byLoop) });
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const ORDER = ['SELF', 'SELFEXIT', 'COMPLEX', 'none', 'NO-PE'];
  const rank = (k) => {
    const i = ORDER.indexOf(k);
    return i >= 0 ? i : (k.startsWith('DIAMOND') ? 1.5 : 3.5);
  };
  for (const r of report) {
    console.log(`\n=== ${r.file} ${r.window}   ${r.total.toLocaleString()} block entries ===`);
    const rows = Object.entries(r.byClass).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
    for (const [cls, hits] of rows) {
      const pct = r.total ? (100 * hits / r.total) : 0;
      // `~` is the blit-heuristic tag, not part of the class: SELFEXIT~ is
      // just as invisible to the matcher as SELFEXIT.
      const bare = cls.replace(/~$/, '');
      const mark = (bare === 'SELFEXIT' || bare.startsWith('DIAMOND')) ? '  <- INVISIBLE' : '';
      console.log(`  ${cls.padEnd(18)} ${pct.toFixed(2).padStart(6)}%  ${hits.toLocaleString().padStart(14)}${mark}`);
    }
    const loops = Object.entries(r.byLoop).sort((a, b) => b[1] - a[1]).slice(0, TOP);
    if (loops.length) {
      console.log(`  top loops:`);
      for (const [k, hits] of loops) {
        console.log(`    ${(100 * hits / r.total).toFixed(2).padStart(6)}%  ${k}`);
      }
    }
  }
  console.log('\nSELFEXIT + DIAMOND is what $loop_match_block cannot see.'
    + ' A large `none` means the hot code is not a short backward-branch loop at all.');
}
