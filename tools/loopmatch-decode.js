#!/usr/bin/env node
// Decode the --trace-loopmatch stream from a test/run.js log into readable
// blocks: one entry per self-loop block the decoder emitted, with each op as
// (handler index, handler name, operand).
//
// The raw trace is a flat sequence of [i32] host-log words, because that is
// the only channel a decode-time WAT function has. This turns it back into
// structure and names the handlers from src/02-thread-table.wat, so a decline
// can be read directly instead of cross-referenced by hand.
//
//   node tools/loopmatch-decode.js <run.js log> [--eip=0x4c755d] [--uniq]
//
// --tree-why reports TREE_FOLD's terminator declines as the MATCHER reported
// them -- the reason code travels in the trace stream, so this tool holds no
// copy of those gates and cannot disagree with them. Pair it with the run's
// --hot-block-dump to weight each declined loop by how often it was entered:
//
//   node test/run.js --app=ID ... --tree-fold --trace-loopmatch \
//        --handler-hist --handler-hist-thread=0 --hot-block-dump=HOT > LOG
//   node tools/loopmatch-decode.js LOG --tree-why --hot=HOT [--top=20]
//
// --why replaces the per-block dump with a decline histogram: each block is
// run through the same staged gates $loop_try_lut applies, and charged to the
// FIRST gate it fails. This is the runtime counterpart of
// `tools/match-loops.js --why`, which sees a linear disassembly of the PE;
// this one sees the ops the decoder actually emitted, fusions and all, for
// blocks that actually executed. Add --why-list to name the blocks per bucket.
const fs = require('fs');
const path = require('path');

const MARKER = 0x100b0000;

// handler index -> name, straight from the (elem ...) block. The table is the
// source of truth; parsing it means this tool cannot drift from a renumber.
function handlerNames() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '02-thread-table.wat'), 'utf8');
  const names = new Map();
  for (const line of src.split('\n')) {
    const m = /^\s*\$(\w+)\s*;;\s*(\d+)/.exec(line);
    if (m) names.set(parseInt(m[2], 10), m[1]);
  }
  return names;
}

// Roles, mirroring $loop_role in src/07b-loop-match.wat. Keep in step with it:
// a role added there and not here makes this tool over-report declines.
const ROLE = { UNKNOWN: 0, LOAD8: 1, LOAD8S: 2, STORE8: 3, ADDI: 4, ZERO: 5, MIRROR: 6, JCC: 7, MEMCTR: 8 };
const isJcc = fn => fn === 44 || (fn >= 307 && fn <= 322);

function roleOf(fn, op) {
  if (fn === 28) return ROLE.LOAD8;
  if (fn === 149) return (op & 0x100) ? ROLE.LOAD8S : ROLE.UNKNOWN;
  if (fn === 29) return ROLE.STORE8;
  if (fn === 64 || fn === 65) return ROLE.ADDI;
  if (fn === 18 || fn === 17) return ((op >>> 4) === (op & 0xF)) ? ROLE.ZERO : ROLE.UNKNOWN;
  if (fn === 21) return ROLE.MIRROR;
  if (fn === 135) return (((op >>> 4) & 0xF) <= 1) ? ROLE.MEMCTR : ROLE.UNKNOWN;
  if (isJcc(fn)) return ROLE.JCC;
  return ROLE.UNKNOWN;
}

// The gates of $loop_try_lut, in the order it applies them. Returns the name
// of the first one that fails, or null for a block that reaches the emit.
// The register-identity gates past the counting stage are approximated: the
// operand encodings this reads (reg<<4|base for the byte accesses, reg for
// inc/dec) are the ones the matcher reads too, but the displacement folding
// and mirror bookkeeping are not replayed here.
// COPY_RUN's gates, in $loop_try_copy's order. A block is only declined
// outright when BOTH predicates decline it, so this is consulted first for any
// shape that looks like a copy at all -- otherwise every copy loop would be
// charged to whichever LUT_RUN gate it happened to trip.
function copyDeclineReason(ops, names) {
  const n = ops.length;
  if (n < 5) return 'op-count<5';
  if (n > 12) return 'op-count>12';

  const roles = ops.map(([fn, op]) => roleOf(fn, op));
  const bad = roles.findIndex(r =>
    r !== ROLE.LOAD8 && r !== ROLE.STORE8 && r !== ROLE.ADDI &&
    r !== ROLE.MEMCTR && r !== ROLE.JCC);
  if (bad >= 0) return `copy:unknown-op:${names.get(ops[bad][0]) || ops[bad][0]}`;

  const count = r => roles.filter(x => x === r).length;
  if (count(ROLE.LOAD8) !== 1) return `copy:load-count=${count(ROLE.LOAD8)}`;
  if (count(ROLE.STORE8) !== 1) return `copy:store-count=${count(ROLE.STORE8)}`;
  const ldIdx = roles.indexOf(ROLE.LOAD8), stIdx = roles.indexOf(ROLE.STORE8);
  const ld = ops[ldIdx], st = ops[stIdx];
  if ((ld[1] >>> 4) !== (st[1] >>> 4)) return 'copy:byte-reg-differs';
  if (ldIdx >= stIdx) return 'copy:store-before-load';
  const ldBase = ld[1] & 0xF, stBase = st[1] & 0xF;
  if (ldBase === stBase) return 'copy:one-cursor';

  const addi = ops.filter((_, i) => roles[i] === ROLE.ADDI).map(o => o[1] & 0xF);
  if (addi.filter(r => r === ldBase).length !== 1) return 'copy:src-not-stepped';
  if (addi.filter(r => r === stBase).length !== 1) return 'copy:dst-not-stepped';
  const ctrRegs = addi.filter(r => r !== ldBase && r !== stBase).length;
  if (ctrRegs + count(ROLE.MEMCTR) !== 1) return `copy:counters=${ctrRegs + count(ROLE.MEMCTR)}`;

  if (ops[n - 1][0] !== 312) return `copy:jcc-kind:${names.get(ops[n - 1][0]) || ops[n - 1][0]}`;
  const ctrIdx = roles.findIndex((r, i) =>
    (r === ROLE.MEMCTR) || (r === ROLE.ADDI && (ops[i][1] & 0xF) !== ldBase && (ops[i][1] & 0xF) !== stBase));
  if (ctrIdx !== n - 2) return 'copy:counter-not-last';
  return null;
}

function declineReason(ops, names) {
  const roles = ops.map(([fn, op]) => roleOf(fn, op));
  // A copy loop has a plain byte load and a byte store and none of LUT_RUN's
  // machinery; judge those by COPY_RUN's gates.
  if (roles.includes(ROLE.LOAD8) && roles.includes(ROLE.STORE8) &&
      !roles.includes(ROLE.LOAD8S) && !roles.includes(ROLE.ZERO)) {
    return copyDeclineReason(ops, names);
  }
  const n = ops.length;
  if (n < 7) return 'op-count<7';
  if (n > 16) return 'op-count>16';

  const unknown = roles.indexOf(ROLE.UNKNOWN);
  if (unknown >= 0) return `unknown-op:${names.get(ops[unknown][0]) || ops[unknown][0]}`;

  const count = r => roles.filter(x => x === r).length;
  const loads = count(ROLE.LOAD8) + count(ROLE.LOAD8S);
  if (count(ROLE.ADDI) !== 2) return `addi-count=${count(ROLE.ADDI)}`;
  if (count(ROLE.ZERO) !== 1) return `zero-count=${count(ROLE.ZERO)}`;
  if (count(ROLE.STORE8) !== 1) return `store-count=${count(ROLE.STORE8)}`;
  if (loads !== 2) return `load-count=${loads}`;
  if (count(ROLE.LOAD8S) < 1) return 'no-indexed-load';

  const term = ops[n - 1][0];
  if (term !== 312) return `jcc-kind:${names.get(term) || term}`;

  // iv/ctr split: one inc/dec drives the cursor the byte accesses share, the
  // other is the trip counter the jnz reads.
  const st = ops[roles.indexOf(ROLE.STORE8)];
  const ld = ops[roles.indexOf(ROLE.LOAD8)];
  if (!ld) return 'no-plain-load';
  const stBase = st[1] & 0xF, ldBase = ld[1] & 0xF;
  if (stBase !== ldBase) return 'load/store-base-differ';
  const addiRegs = ops.filter((_, i) => roles[i] === ROLE.ADDI).map(o => o[1] & 0x7);
  if (!addiRegs.includes(stBase)) return 'cursor-not-stepped';
  if (addiRegs[0] === addiRegs[1]) return 'no-separate-counter';
  return null;
}

function whyReport(blocks, names, list) {
  const buckets = new Map();
  for (const b of blocks) {
    const why = declineReason(b.ops, names) || 'MATCH';
    if (!buckets.has(why)) buckets.set(why, []);
    buckets.get(why).push(b.eip);
  }
  const rows = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  const total = blocks.length;
  console.log(`${total} unique self-loop block shapes\n`);
  for (const [why, eips] of rows) {
    const pct = (eips.length * 100 / total).toFixed(1);
    console.log(`${String(eips.length).padStart(5)}  ${pct.padStart(5)}%  ${why}`);
    if (list) {
      const shown = eips.slice(0, 8).map(e => '0x' + e.toString(16)).join(' ');
      console.log(`                ${shown}${eips.length > 8 ? ` (+${eips.length - 8} more)` : ''}`);
    }
  }
}

// Pull the [i32] host-log words out of a run.js log and reassemble the
// self-loop block records. Exported so a sweep over many logs does not need a
// second copy of the framing.
function parseBlocks(file) {
  const words = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\[i32\] (0x[0-9a-f]+)/.exec(line);
    if (m) words.push(parseInt(m[1], 16) >>> 0);
  }
  const blocks = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== MARKER) continue;
    const eip = words[i + 1], n = words[i + 2];
    if (n === undefined || n > 2048) continue;
    if (i + 3 + n * 2 > words.length) continue;
    const ops = [];
    for (let k = 0; k < n; k++) ops.push([words[i + 3 + k * 2], words[i + 4 + k * 2]]);
    blocks.push({ eip, ops });
    i += 2 + n * 2;
  }
  return blocks;
}

// TREE_FOLD terminator declines, as the MATCHER reported them.
//
// Everything above re-derives a verdict host-side from the op list, which is
// fine for the byte-idiom families whose gates are small. TREE_FOLD's
// terminator gate is not small, and a second copy of it here would drift from
// src/07b-loop-match.wat the first time either moved. So the matcher emits the
// verdict itself: marker 0x100C0001, entry, reason, detail. This only reads
// it.
const DECL_MARKER = 0x100c0001;
const DECL_WHY = {
  1: 'last-op-not-jcc',
  2: 'back-edge-elsewhere',
  3: 'walkback-hit-non-microop',
  4: 'walkback-hit-flag-op',
  5: 'no-flag-producer',
  6: 'producer-not-dec-inc-cmp',
};

function parseTermDeclines(file) {
  const words = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\[i32\] (0x[0-9a-f]+)/.exec(line);
    if (m) words.push(parseInt(m[1], 16) >>> 0);
  }
  const out = [];
  for (let i = 0; i + 3 < words.length; i++) {
    if (words[i] !== DECL_MARKER) continue;
    out.push({ eip: words[i + 1], why: words[i + 2], detail: words[i + 3] });
    i += 3;
  }
  return out;
}

// `--hot-block-dump` rows: "0xVA  hits". A declined block is NOT folded, so a
// hit here is one ENTRY to the block, i.e. one loop ITERATION -- unlike the
// folded case tools/tree-shape-census.js warns about, where a hit is a whole
// run. So this weighting is directly comparable to retired-op share.
function parseHotBlocks(file) {
  const hits = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^(0x[0-9a-f]+)\s+(\d+)/.exec(line.trim());
    if (m) hits.set(parseInt(m[1], 16) >>> 0, Number(m[2]));
  }
  return hits;
}

function termDeclineReport(file, hotFile, names, top) {
  const declines = parseTermDeclines(file);
  const blocks = new Map();
  for (const b of parseBlocks(file)) if (!blocks.has(b.eip)) blocks.set(b.eip, b);
  const hot = hotFile ? parseHotBlocks(hotFile) : new Map();

  // One row per entry EIP: a block decoded twice declines twice for the same
  // reason and would otherwise be counted twice.
  const byEip = new Map();
  for (const d of declines) if (!byEip.has(d.eip)) byEip.set(d.eip, d);
  const rows = [...byEip.values()].map(d => ({
    ...d,
    hits: hot.get(d.eip) || 0,
    ops: (blocks.get(d.eip) || { ops: [] }).ops,
  }));

  const totalHot = [...hot.values()].reduce((a, b) => a + b, 0);
  const buckets = new Map();
  for (const r of rows) {
    const key = DECL_WHY[r.why] || `why${r.why}`;
    const e = buckets.get(key) || { n: 0, hits: 0, detail: new Map() };
    e.n++; e.hits += r.hits;
    const dn = r.why === 2 ? 'target' : (names.get(r.detail) || String(r.detail));
    e.detail.set(dn, (e.detail.get(dn) || 0) + r.hits);
    buckets.set(key, e);
  }

  console.log(`TREE_FOLD terminator declines: ${rows.length} distinct blocks` +
    (hotFile ? `, ${totalHot.toLocaleString()} total block entries in the hot dump` : ''));
  const order = [...buckets.entries()].sort((a, b) => b[1].hits - a[1].hits || b[1].n - a[1].n);
  for (const [k, e] of order) {
    const share = totalHot ? ` ${(100 * e.hits / totalHot).toFixed(2)}% of entries` : '';
    console.log(`  ${k.padEnd(26)} ${String(e.n).padStart(4)} blocks  ${String(e.hits).padStart(10)} entries${share}`);
    const dd = [...e.detail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [dn, dh] of dd) console.log(`      ${String(dh).padStart(10)}  ${dn}`);
  }

  console.log(`\ntop ${top} declined self-loops by block entries:`);
  for (const r of rows.sort((a, b) => b.hits - a.hits).slice(0, top)) {
    console.log(`  0x${r.eip.toString(16).padStart(8, '0')}  ${String(r.hits).padStart(10)} entries  ` +
      `${(DECL_WHY[r.why] || r.why)}  detail=${r.why === 2 ? '0x' + r.detail.toString(16) : (names.get(r.detail) || r.detail)}  ` +
      `${r.ops.length} ops`);
    for (const [fn, op] of r.ops) {
      console.log(`       ${String(fn).padStart(4)}  ${(names.get(fn) || '?').padEnd(24)} op=0x${op.toString(16)}`);
    }
  }
}

// ============================================================ x87 census
// Which x87 instructions sit INSIDE otherwise-integer self-loops.
//
// This is the question TREE_FOLD's `unfoldable-op` bucket cannot answer on its
// own: `lastFn 188` says "an x87 memory op stopped it" and nothing about WHICH
// one, so a work list ordered by population needs the (group, reg, rm) fields
// out of the operand words. The three x87 handlers encode those differently
// and each is a discriminated union keyed by its handler index, so the
// decoding lives here rather than in a regex over the printed dump:
//
//   H188 $th_fpu_mem     op = (group<<4)|reg,           next word = addr
//   H189 $th_fpu_reg     op = (group<<8)|(reg<<4)|rm
//   H190 $th_fpu_mem_ro  op = (group<<8)|(reg<<4)|base, next word = disp
//
// A block is weighted by its `--hot-block-dump` entry count when one is given.
// For a block that did NOT fold, one hot hit is one loop ITERATION, so the
// weight is directly comparable to a retired-op share; without --hot every
// block counts once and the answer is about distinct code, not about work.
const X87_MEM = new Map(Object.entries({
  // group/reg -> mnemonic. Group 0/4 are the f32/f64 arithmetic forms and
  // 2/6 the integer ones, so one row covers reg 0..7 for each pair.
  '0/0': 'fadd m32', '0/1': 'fmul m32', '0/2': 'fcom m32', '0/3': 'fcomp m32',
  '0/4': 'fsub m32', '0/5': 'fsubr m32', '0/6': 'fdiv m32', '0/7': 'fdivr m32',
  '4/0': 'fadd m64', '4/1': 'fmul m64', '4/2': 'fcom m64', '4/3': 'fcomp m64',
  '4/4': 'fsub m64', '4/5': 'fsubr m64', '4/6': 'fdiv m64', '4/7': 'fdivr m64',
  '2/0': 'fiadd m32', '2/1': 'fimul m32', '2/2': 'ficom m32', '2/3': 'ficomp m32',
  '2/4': 'fisub m32', '2/5': 'fisubr m32', '2/6': 'fidiv m32', '2/7': 'fidivr m32',
  '6/0': 'fiadd m16', '6/1': 'fimul m16', '6/2': 'ficom m16', '6/3': 'ficomp m16',
  '6/4': 'fisub m16', '6/5': 'fisubr m16', '6/6': 'fidiv m16', '6/7': 'fidivr m16',
  '1/0': 'fld m32', '1/2': 'fst m32', '1/3': 'fstp m32', '1/4': 'fldenv',
  '1/5': 'fldcw', '1/6': 'fnstenv', '1/7': 'fnstcw',
  '5/0': 'fld m64', '5/2': 'fst m64', '5/3': 'fstp m64', '5/4': 'frstor',
  '5/6': 'fnsave', '5/7': 'fnstsw m16',
  '3/0': 'fild m32', '3/2': 'fist m32', '3/3': 'fistp m32', '3/5': 'fld m80',
  '3/7': 'fstp m80',
  '7/0': 'fild m16', '7/2': 'fist m16', '7/3': 'fistp m16', '7/4': 'fbld',
  '7/5': 'fild m64', '7/6': 'fbstp', '7/7': 'fistp m64',
}));

const X87_ST = ['fld1', 'fldl2t', 'fldl2e', 'fldpi', 'fldlg2', 'fldln2', 'fldz'];
const X87_D9_E = { 0: 'fchs', 1: 'fabs', 4: 'ftst', 5: 'fxam' };
const X87_D9_F = ['f2xm1', 'fyl2x', 'fptan', 'fpatan', 'fxtract', 'fprem1', 'fdecstp', 'fincstp'];
const X87_D9_FX = ['fprem', 'fyl2xp1', 'fsqrt', 'fsincos', 'frndint', 'fscale', 'fsin', 'fcos'];
const X87_ARITH = ['fadd', 'fmul', 'fcom', 'fcomp', 'fsub', 'fsubr', 'fdiv', 'fdivr'];

function x87RegName(group, reg, rm) {
  if (group === 0) return `${X87_ARITH[reg]} st,st(${rm})`;
  if (group === 4) return `${X87_ARITH[reg]} st(${rm}),st`;
  if (group === 6) return reg === 3 ? 'fcompp' : `${X87_ARITH[reg]}p st(${rm}),st`;
  if (group === 1) {
    if (reg === 0) return `fld st(${rm})`;
    if (reg === 1) return `fxch st(${rm})`;
    if (reg === 2) return 'fnop';
    if (reg === 4) return X87_D9_E[rm] || `d9/4 rm${rm}`;
    if (reg === 5) return X87_ST[rm] || `d9/5 rm${rm}`;
    if (reg === 6) return X87_D9_F[rm];
    if (reg === 7) return X87_D9_FX[rm];
  }
  if (group === 2) return reg === 5 ? 'fucompp' : `fcmov da/${reg} st(${rm})`;
  if (group === 3) {
    if (reg === 4) return ['fneni', 'fndisi', 'fnclex', 'fninit'][rm] || `db/4 rm${rm}`;
    if (reg === 5) return `fucomi st(${rm})`;
    if (reg === 6) return `fcomi st(${rm})`;
    return `fcmovn db/${reg} st(${rm})`;
  }
  if (group === 5) {
    return { 0: `ffree st(${rm})`, 2: `fst st(${rm})`, 3: `fstp st(${rm})`,
             4: `fucom st(${rm})`, 5: `fucomp st(${rm})` }[reg] || `dd/${reg} rm${rm}`;
  }
  if (group === 7) {
    if (reg === 4 && rm === 0) return 'fnstsw ax';
    if (reg === 5) return `fucomip st(${rm})`;
    if (reg === 6) return `fcomip st(${rm})`;
  }
  return `x87 g${group}/r${reg}/rm${rm}`;
}

// (handler, operand) -> a mnemonic and the (group, reg, rm) it decoded from,
// or null when the op is not one of the three x87 handlers.
function x87Decode(fn, op) {
  if (fn === 188) {
    const group = (op >>> 4) & 0xF, reg = op & 0xF;
    return { group, reg, rm: -1, form: 'mem',
             name: X87_MEM.get(`${group}/${reg}`) || `x87 mem g${group}/r${reg}` };
  }
  if (fn === 190) {
    const group = (op >>> 8) & 0xF, reg = (op >>> 4) & 0xF;
    return { group, reg, rm: -1, form: 'mem_ro',
             name: (X87_MEM.get(`${group}/${reg}`) || `x87 mem g${group}/r${reg}`) + ' [r+d]' };
  }
  if (fn === 189) {
    const group = (op >>> 8) & 0xF, reg = (op >>> 4) & 0xF, rm = op & 0xF;
    return { group, reg, rm, form: 'reg', name: x87RegName(group, reg, rm) };
  }
  return null;
}

function x87CensusReport(file, hotFile, names, top) {
  const blocks = uniqueShapes(parseBlocks(file));
  const hot = hotFile ? parseHotBlocks(hotFile) : new Map();
  const pop = new Map();       // mnemonic -> { n, weight, form }
  let mixedBlocks = 0, mixedWeight = 0, pureX87 = 0, x87Blocks = 0;
  const perBlock = [];

  for (const b of blocks) {
    const x = b.ops.map(([fn, op]) => x87Decode(fn, op)).filter(Boolean);
    if (!x.length) continue;
    x87Blocks++;
    const w = hot.get(b.eip) || 0;
    // "Mixed" = the body has integer work in it as well, which is the
    // population this widening is for. A block that is nothing but x87 plus
    // its Jcc belongs to the x87 semantic families, not to TREE_FOLD.
    const intOps = b.ops.length - x.length - 1;   // -1 for the closing Jcc
    if (intOps > 0) { mixedBlocks++; mixedWeight += w; } else { pureX87++; continue; }
    perBlock.push({ eip: b.eip, w, nx: x.length, nint: intOps, ops: b.ops });
    for (const e of x) {
      const k = pop.get(e.name) || { n: 0, weight: 0, form: e.form };
      k.n++; k.weight += w;
      pop.set(e.name, k);
    }
  }

  console.log(`${blocks.length} distinct self-loop shapes; ${x87Blocks} contain x87, ` +
    `${mixedBlocks} of those are MIXED (integer + x87)` +
    (hotFile ? `, ${mixedWeight.toLocaleString()} block entries` : ''));
  console.log(`${pureX87} are x87-only (the x87 semantic families' territory, not TREE_FOLD's)\n`);
  console.log('x87 ops inside mixed self-loops, by ' + (hotFile ? 'block entries' : 'static count') + ':');
  const rows = [...pop.entries()].sort((a, b) =>
    (b[1].weight - a[1].weight) || (b[1].n - a[1].n));
  for (const [name, e] of rows) {
    console.log(`  ${name.padEnd(20)} ${e.form.padEnd(7)} ${String(e.n).padStart(4)} sites  ` +
      `${String(e.weight).padStart(12)} entries`);
  }
  console.log(`\ntop ${top} mixed blocks by entries:`);
  for (const r of perBlock.sort((a, b) => b.w - a.w).slice(0, top)) {
    console.log(`  0x${r.eip.toString(16).padStart(8, '0')}  ${String(r.w).padStart(10)} entries  ` +
      `${r.nint} int + ${r.nx} x87 ops`);
  }
}

// One entry per distinct op sequence. Counting raw records instead would
// measure how often a block was decoded, which after the block-cache fix is
// mostly 1 and before it was thousands -- neither says anything about the
// matcher.
function uniqueShapes(blocks) {
  const byShape = new Map();
  for (const b of blocks) {
    const key = b.ops.map(o => `${o[0]}:${o[1]}`).join(',');
    if (!byShape.has(key)) byShape.set(key, b);
  }
  return [...byShape.values()];
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: loopmatch-decode.js <log> [--eip=0xVA] [--uniq]'); process.exit(1); }
  const opt = n => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
  const wantEip = opt('eip') ? parseInt(opt('eip'), 16) >>> 0 : null;
  const uniq = args.includes('--uniq');

  const names = handlerNames();
  const blocks = parseBlocks(file);

  if (args.includes('--x87-census')) {
    x87CensusReport(file, opt('hot'), names, opt('top') ? Number(opt('top')) : 20);
    return;
  }

  if (args.includes('--tree-why')) {
    termDeclineReport(file, opt('hot'), names, opt('top') ? Number(opt('top')) : 20);
    return;
  }

  if (args.includes('--why')) {
    // A decline histogram over repeated copies of one block says more about
    // how often that block was decoded than about the matcher, so dedupe by
    // shape first regardless of --uniq.
    const scoped = wantEip === null ? blocks : blocks.filter(b => b.eip === wantEip);
    whyReport(uniqueShapes(scoped), names, args.includes('--why-list'));
    return;
  }

  const seen = new Set();
  let shown = 0;
  for (const b of blocks) {
    if (wantEip !== null && b.eip !== wantEip) continue;
    const key = b.ops.map(o => o[0]).join(',');
    if (uniq) { if (seen.has(key)) continue; seen.add(key); }
    console.log(`block 0x${b.eip.toString(16)}  ${b.ops.length} ops`);
    for (const [fn, op] of b.ops) {
      console.log(`   ${String(fn).padStart(4)}  ${(names.get(fn) || '?').padEnd(22)} op=0x${op.toString(16)}`);
    }
    shown++;
  }
  console.log(`\n${blocks.length} self-loop block records, ${shown} shown`);
}

if (require.main === module) main();

module.exports = { parseBlocks, uniqueShapes, declineReason, copyDeclineReason, handlerNames, roleOf, ROLE,
                   parseTermDeclines, parseHotBlocks, termDeclineReport, DECL_WHY,
                   x87Decode, x87RegName, x87CensusReport };
