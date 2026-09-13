#!/usr/bin/env node
// Turn a --trace-block-exec log back into readable descriptors.
//
// tl;dr: H458 logs each installed block as the marker 0xBE000000, the entry
// EIP, the micro-op count, then one (kind, original handler index) pair per
// micro-op. This reads those `[i32]` lines out of a run.js log and prints one
// block per entry with both columns named — the kind from
// src/07c-block-exec.wat's own $BX_* globals and the handler from the (elem
// ...) list in src/02-thread-table.wat, so neither name can drift from a
// renumber.
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

// Micro-op kind names, straight out of the executor's own globals.
function kindNames() {
  const src = fs.readFileSync(path.join(ROOT, 'src', '07c-block-exec.wat'), 'utf8');
  const out = [];
  const re = /\(global \$BX_([A-Z0-9_]+)\s+i32 \(i32\.const (\d+)\)\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (['HANDLER', 'RESUME_HANDLER', 'UOP_WORDS', 'HEADER_WORDS',
         'FIRST_SIB', 'MAX_KIND'].includes(m[1])) continue;
    if (out[Number(m[2])] === undefined) out[Number(m[2])] = m[1];
  }
  return out;
}

const HANDLERS = handlerNames();
const KINDS = kindNames();
const hname = i => HANDLERS[i] ? `${HANDLERS[i]} (${i})` : `H${i}`;
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
  for (let k = 0; k < nuops && j + 1 < words.length; k++, j += 2) {
    if (words[j] === MARKER) break;   // truncated by the crash we are chasing
    uops.push({ kind: words[j], fn: words[j + 1] });
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

for (const b of shown) {
  const fb = b.uops.filter(u => kname(u.kind) === 'FALLBACK').length;
  console.log(`block 0x${b.eip.toString(16).padStart(8, '0')}  ${b.nuops} micro-ops` +
    (fb ? `  (${fb} fallback)` : '  (all native)') +
    (b.uops.length < b.nuops ? `  [log truncated at ${b.uops.length}]` : ''));
  b.uops.forEach((u, k) => {
    console.log(`  ${String(k).padStart(3)}  ${kname(u.kind).padEnd(14)} <- ${hname(u.fn)}`);
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
  console.log(`\n${shown.length} installs over ${perEip.size} distinct entries`);
  if (fbFns.size) {
    console.log('fallbacks by handler (the migration work list):');
    [...fbFns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([fn, n]) => console.log(`  ${String(n).padStart(6)}  ${hname(fn)}`));
  }
}
