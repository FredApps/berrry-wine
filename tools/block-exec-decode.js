#!/usr/bin/env node
// Turn a --trace-block-exec log back into readable descriptors.
//
// tl;dr: H458 logs each installed block as the marker 0xBE000000, the entry
// EIP, the micro-op count, then one (kind, original handler index, d, b)
// quadruple per micro-op. This reads those `[i32]` lines out of a run.js log
// and prints one block per entry with every column named — the kind from the
// $TU_* globals in src/07b-loop-match.wat and the handler from the (elem ...)
// list in src/02-thread-table.wat, so neither name can drift from a renumber.
//
// Round 11's decode-time split is why `d`/`b` are in the stream at all. A
// memory-form op is rewritten into a load into one of seven temp lanes
// (register indices 8..14, printed L0..L6) followed by the register-form op
// reading that lane through the TU_B_SRC0 field of `b`. The load half carries
// handler index -1, since no x86 handler corresponds to it. Read a block with
// `L` names in it as the split form; a block without them was left alone.
//
// This is the block-executor twin of tools/loopmatch-decode.js, and it exists
// for the same reason: the numbers alone answer "how many", and the question
// is always "which one".
//
//   node tools/block-exec-decode.js <run.js log> [--eip=0xVA] [--uniq]
//                                   [--kind=NAME] [--fallbacks]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const getArg = (n, d) => {
  const m = args.find(a => a.startsWith(`--${n}=`));
  return m === undefined ? d : m.slice(n.length + 3);
};
const has = n => args.includes(`--${n}`);
if (!file) {
  console.error('usage: node tools/block-exec-decode.js <run.js log> ' +
    '[--eip=0xVA] [--uniq] [--kind=NAME] [--fallbacks]');
  process.exit(2);
}

// Handler names, straight out of the thread table's elem list.
function handlerNames() {
  const src = fs.readFileSync(path.join(ROOT, 'src', '02-thread-table.wat'), 'utf8');
  const names = [];
  const elem = src.slice(src.indexOf('(elem'));
  for (const line of elem.split('\n')) {
    const m = line.match(/^\s*\$([A-Za-z0-9_]+)\s*(?:;;\s*(\d+))?/);
    if (!m) continue;
    if (m[2] !== undefined) names[Number(m[2])] = m[1];
    else names.push(m[1]);
  }
  return names;
}

// Micro-op kind names, straight out of the vocabulary's own globals. The
// vocabulary is SPLIT ACROSS TWO FILES and reading only one of them silently
// prints `kind57` for FALLBACK: 07b holds the kinds the loop matcher's
// classifier produces, 07c holds the ones only the executor knows (PUSH/POP,
// FALLBACK). Both are scanned. The $TU_B_* names are operand bit fields rather
// than kinds, so they are filtered by the pattern and not by a list that could
// go stale; MAX_KIND is a bound, not a kind.
function kindNames() {
  const out = [];
  const re = /\(global \$TU_([A-Z0-9_]+)\s+i32 \(i32\.const (\d+)\)\)/g;
  for (const f of ['07b-loop-match.wat', '07c-block-exec.wat']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    let m;
    while ((m = re.exec(src))) {
      if (m[1].startsWith('B_') || m[1] === 'MAX_KIND') continue;
      if (out[Number(m[2])] === undefined) out[Number(m[2])] = m[1];
    }
  }
  return out;
}

// The seven temp lanes the split writes into. Register indices 8..14 -- 15 has
// to stay "absent", which is why there are seven and not eight.
const LANE0 = 8;
const LANE_N = 7;
const B_SRC0 = 0x8000;
const B_SRC0_SHIFT = 24;
const REGS = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const rname = i => (i >= LANE0 && i < LANE0 + LANE_N ? `L${i - LANE0}`
  : (REGS[i] !== undefined ? REGS[i] : (i === 15 ? '-' : `r${i}`)));

const HANDLERS = handlerNames();
const KINDS = kindNames();
const hname = i => (i === -1 || i === 0xFFFFFFFF ? 'split-load'
  : (HANDLERS[i] ? `${HANDLERS[i]} (${i})` : `H${i}`));
const kname = i => KINDS[i] ? KINDS[i] : `kind${i}`;

// The log interleaves these with every other $host_log_i32 caller, which is
// why the marker exists. Anything between blocks is somebody else's.
const words = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const m = line.match(/^\[i32\] 0x([0-9a-f]{8})$/);
  if (m) words.push(parseInt(m[1], 16) >>> 0);
}

const MARKER = 0xBE000000;
const blocks = [];
for (let i = 0; i < words.length; i++) {
  if (words[i] !== MARKER) continue;
  const eip = words[i + 1], nuops = words[i + 2];
  if (eip === undefined || nuops === undefined || nuops === 0 || nuops > 4096) continue;
  const uops = [];
  let j = i + 3;
  for (let k = 0; k < nuops && j + 3 < words.length; k++, j += 4) {
    if (words[j] === MARKER) break;   // truncated by the crash we are chasing
    uops.push({ kind: words[j], fn: words[j + 1], d: words[j + 2], b: words[j + 3] });
  }
  blocks.push({ eip, nuops, uops });
  i = j - 1;
}

const wantEip = getArg('eip', null);
const wantKind = getArg('kind', null);
let shown = blocks;
if (wantEip !== null) {
  const v = parseInt(wantEip, 16) >>> 0;
  shown = shown.filter(b => b.eip === v);
}
if (wantKind !== null) {
  shown = shown.filter(b => b.uops.some(u => kname(u.kind) === wantKind.toUpperCase()));
}
if (has('fallbacks')) {
  shown = shown.filter(b => b.uops.some(u => kname(u.kind) === 'FALLBACK'));
}
if (has('uniq')) {
  const seen = new Set();
  shown = shown.filter(b => (seen.has(b.eip) ? false : (seen.add(b.eip), true)));
}

const isSplitLoad = u => (u.fn >>> 0) === 0xFFFFFFFF;
// A lane appears either as the destination of the load half or in the SRC0
// field of the op that consumes it. Printing both is what makes the pairing
// visible: `-> L0` on one line and `src0=L0` on the next is one split op.
const laneNote = (u) => {
  const parts = [];
  if (u.d >= LANE0 && u.d < LANE0 + LANE_N) parts.push(`-> ${rname(u.d)}`);
  if (u.b & B_SRC0) parts.push(`src0=${rname((u.b >>> B_SRC0_SHIFT) & 0xF)}`);
  return parts.length ? `  ${parts.join(' ')}` : '';
};

for (const b of shown) {
  const fb = b.uops.filter(u => kname(u.kind) === 'FALLBACK').length;
  const sp = b.uops.filter(isSplitLoad).length;
  console.log(`block 0x${b.eip.toString(16).padStart(8, '0')}  ${b.nuops} micro-ops` +
    (fb ? `  (${fb} fallback)` : '  (all native)') +
    (sp ? `  (${sp} split)` : '') +
    (b.uops.length < b.nuops ? `  [log truncated at ${b.uops.length}]` : ''));
  b.uops.forEach((u, k) => {
    console.log(`  ${String(k).padStart(3)}  ${kname(u.kind).padEnd(14)} <- ` +
      `${hname(u.fn).padEnd(24)}${laneNote(u)}`);
  });
}

// The census is the point when the log is large: one line per distinct entry.
if (shown.length > 1) {
  const perEip = new Map();
  for (const b of shown) perEip.set(b.eip, (perEip.get(b.eip) || 0) + 1);
  const fbFns = new Map();
  for (const b of shown) {
    for (const u of b.uops) {
      if (kname(u.kind) !== 'FALLBACK') continue;
      fbFns.set(u.fn, (fbFns.get(u.fn) || 0) + 1);
    }
  }
  let splitLoads = 0; let splitBlocks = 0; let uopTotal = 0;
  for (const b of shown) {
    const n = b.uops.filter(isSplitLoad).length;
    splitLoads += n; uopTotal += b.uops.length;
    if (n) splitBlocks += 1;
  }
  console.log(`\n${shown.length} installs over ${perEip.size} distinct entries`);
  // The split's own census. `split loads` is one per memory op the pass took
  // apart, so it is also the number of extra micro-ops the descriptor carries
  // -- compare it with the deletions on run.js's `block-exec-split:` line
  // before reading a uop count as a win or a loss.
  console.log(`split: ${splitLoads} split loads in ${splitBlocks} blocks ` +
    `(${uopTotal} micro-ops logged)`);
  if (fbFns.size) {
    console.log('fallbacks by handler (the migration work list):');
    [...fbFns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([fn, n]) => console.log(`  ${String(n).padStart(6)}  ${hname(fn)}`));
  }
}
