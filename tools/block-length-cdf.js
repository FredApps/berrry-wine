#!/usr/bin/env node
// How much of a real app's retired work could the ONE-BLOCK executor
// (src/07c-block-exec.wat) ever see?  A block-length CDF, weighted by runtime
// hits.  Nothing here runs the emulator; it reads hot-block dumps that already
// exist and disassembles the blocks out of the PE.
//
//   node tools/block-length-cdf.js --dump=FILE --log=RUN.log --app=ID
//        [--window=NAME] [--regions] [--json] [--dispatches=N]
//   node tools/block-length-cdf.js --dir=DIR [--windows=a,b] [--regions] [--json]
//   node tools/block-length-cdf.js --index=index.json [--json]
//
// Importable:
//   const { cdfFromDump, cdfFromIndex, LEN_MARKS } = require('./tools/block-length-cdf');
//
// WHY THIS EXISTS
//
// docs/block-executor-review-2026-09-15.md §2 #1 says the executor's ceiling is
// not its per-op speed but its COVERAGE, and names the experiment: bucket
// dynamic x86 ops by the static length of the block they were in, and read the
// share at the shipped breakeven.  The cost model in src/07c-block-exec.wat
// (`$BX_C_ENTRY` 190 / `$BX_C_UOP` 16, lines 315-318) breaks even at 12 native
// micro-ops, so everything shorter than that is unreachable BY CONSTRUCTION,
// however fast the executor gets.
//
// WHAT "LENGTH" MEANS HERE
//
// A one-block descriptor covers the block's BODY and leaves the terminator
// threaded (design section 1.1), so the executor's micro-op count for a block
// is its static x86 instruction count MINUS ONE.  That is the unit bucketed,
// and it is the unit `$BX_C_UOP` is priced in.
//
// WHAT THE WEIGHTS ARE
//
// `--hot-block-dump` writes one line per distinct guest address the window
// entered a compiled block at, with a hit count.  A hit is one interpreter
// block transfer.  ops = hits x static instruction count, exactly the census's
// convention (tools/code-region-census.js header): a LOWER bound, because a
// block reached only by fused fall-through has no hits of its own.  Pass
// --dispatches=N (the `[handler-hist] ... total=` line of the same run) and the
// coverage ratio is printed so the blind spot is visible.  Shares WITHIN a
// window are what this tool is for; they are unaffected by that.
//
// THE THREE SHARES REPORTED, from weakest to strongest assumption
//
//   share>=N        ops in blocks of >= N micro-ops.  Pure geometry, no model.
//   reachable       ops in blocks the shipped installer's COST MODEL would
//                   accept, applied statically:
//                     benefit = 16 * nat
//                     cost    = 190 + 20 * nfb        (x87 excluded, see below)
//                     accept iff benefit > cost
//                   with `nat` the body instructions that map to a TU_* kind
//                   and `nfb` the rest (each a TU_FALLBACK micro-op).  A body
//                   carrying ANY x87 instruction is a hard decline: handlers
//                   188-190 are in `$bx_op_unsafe` whenever `$block_exec_x87`
//                   is 0, which is the shipped default (design section 17.5).
//                   This is an UPPER bound -- the static mnemonic test accepts
//                   operand shapes `$tree_uop_classify` would still refuse.
//   regionReach     ops in blocks the N<=16 multi-block matcher could admit,
//                   from tools/code-region-census.js's own `tight` class.
//                   Also an upper bound, and only computed with --regions.
//
'use strict';

const fs = require('fs');
const path = require('path');
const { buildCfg, resolver, loadImage } = require(path.join(__dirname, 'block-regions.js'));
const { disasmAt } = require(path.join(__dirname, 'disasm.js'));
const census = require(path.join(__dirname, 'code-region-census.js'));

// The length marks the review asks for.
const LEN_MARKS = [4, 8, 12, 16];

// ---- the shipped cost model, src/07c-block-exec.wat:315-318 ----------------
const BX_C_ENTRY = 190;
const BX_C_UOP = 16;
const BX_C_FALLBACK = 20;

// ---- the 13 windows of docs/hot-loop-vocabulary-2026-09.md section 4b ------
// window name -> the --app= id collect-win98-gameplay.sh launched it with.
const WINDOWS = {
  'quake2-gameplay': 'quake2_demo',
  'mw3-gameplay': 'mw3',
  'gta2-gameplay': 'gta2_demo',
  'rct-gameplay': 'rct',
  'heroes2-gameplay': 'heroes2_demo',
  'quake2-loading': 'quake2_demo',
  'mw3-loading': 'mw3',
  'gta2-loading': 'gta2_demo',
  'rct-loading': 'rct',
  'heroes2-loading': 'heroes2_demo',
  'caesar3-loading': 'caesar3_demo',
  'starcraft-loading': 'starcraft_shareware',
  'diablo-loading': 'diablo_shareware',
};
const GAMEPLAY = new Set(Object.keys(WINDOWS).filter(w => w.endsWith('-gameplay')));

// ---- static classification of one body instruction -------------------------
//
// Mirrors the TU_* kinds $tree_uop_classify produces plus the three kinds the
// one-block installer recognises itself (PUSH r32 / POP r32 / PUSH imm32,
// src/07c-block-exec.wat:3145-3190).  Anything else becomes a TU_FALLBACK
// micro-op, which still installs -- it just costs $BX_C_FALLBACK.

const ALU = new Set(['add', 'sub', 'and', 'or', 'xor', 'adc', 'sbb']);
const UNARY = new Set(['inc', 'dec', 'neg', 'not']);
const SHIFTS = new Set(['shl', 'shr', 'sar', 'sal']);
const X87 = new Set([
  'fld', 'fst', 'fstp', 'fild', 'fist', 'fistp', 'fadd', 'faddp', 'fsub',
  'fsubp', 'fsubr', 'fsubrp', 'fmul', 'fmulp', 'fdiv', 'fdivp', 'fdivr',
  'fdivrp', 'fxch', 'fchs', 'fabs', 'fcom', 'fcomp', 'fcompp', 'fnstsw',
  'fstsw', 'fldz', 'fld1', 'fldcw', 'fnstcw', 'fstcw', 'frndint', 'fsqrt',
  'fprem', 'fprem1', 'fpatan', 'fptan', 'fsin', 'fcos', 'fsincos', 'f2xm1',
  'fscale', 'fyl2x', 'fyl2xp1', 'fnclex', 'fclex', 'fninit', 'finit',
  'fnsave', 'frstor', 'ffree', 'fucom', 'fucomp', 'fucompp', 'fldl2e',
  'fldl2t', 'fldlg2', 'fldln2', 'fldpi', 'fincstp', 'fdecstp', 'fiadd',
  'fisub', 'fisubr', 'fimul', 'fidiv', 'fidivr', 'ficom', 'ficomp', 'fbld',
  'fbstp', 'fwait', 'wait', 'fxam', 'ftst', 'fnop', 'fldenv', 'fnstenv',
  'fstenv',
]);

// 'native' | 'fallback' | 'x87'
function classifyInsn(ins) {
  const m = ins.mnem;
  const rest = ins.insn.slice(m.length).trim();
  if (X87.has(m)) return 'x87';
  if (m === 'mov' || m === 'lea' || m === 'nop') return 'native';
  if (m === 'push' || m === 'pop') return 'native';
  // cmp/test are the terminator's flag producers and have TU kinds for the
  // forms the matcher takes; counted native, which is the optimistic arm of
  // this being an upper bound.
  if (m === 'cmp' || m === 'test') return 'native';
  if (ALU.has(m) || UNARY.has(m)) return 'native';
  if (SHIFTS.has(m)) return /,\s*cl\b/i.test(rest) ? 'fallback' : 'native';
  if (m === 'imul') return /,/.test(rest) ? 'native' : 'fallback';
  if (m === 'movzx' || m === 'movsx') {
    return /\bword\b/i.test(rest) ? 'fallback' : 'native';
  }
  if (/^rep/.test(m)) {
    return /\b(movsb|movsd|stosb|stosd)\b/i.test(rest) ? 'native' : 'fallback';
  }
  return 'fallback';
}

const RE_LINE = /^([0-9a-f]{8})\s{2}((?:[0-9a-f]{2} )+)\s*(.*)$/;

// Every instruction of one block as {va, insn, mnem}, or null.
function blockInsns(resolve, b) {
  const hit = resolve(b.va);
  if (!hit) return null;
  let lines;
  try { lines = disasmAt(hit.buf, hit.off, b.va, b.insns, null, { linear: true }); }
  catch (e) { return null; }
  if (!lines) return null;
  const out = [];
  for (const l of lines) {
    const m = RE_LINE.exec(l);
    if (!m) return null;
    let text = m[3].trim();
    if (!text || /^\(bad\)/.test(text)) return null;
    const seg = /^(cs|ds|es|ss|fs|gs):\s*/i.exec(text);
    if (seg) text = text.slice(seg[0].length);
    out.push({ va: parseInt(m[1], 16) >>> 0, insn: text,
               mnem: text.split(/[\s,]/)[0].toLowerCase() });
    if (out.length >= b.insns) break;
  }
  return out;
}

// Would the shipped one-block installer accept this body?
// Returns { accept, nat, nfb, x87 }.
function costModel(insns) {
  let nat = 0, nfb = 0, x87 = 0;
  for (const ins of insns) {
    const c = classifyInsn(ins);
    if (c === 'x87') x87++;
    else if (c === 'native') nat++;
    else nfb++;
  }
  // Hard decline: handlers 188-190 are $bx_op_unsafe with $block_exec_x87 = 0.
  if (x87) return { accept: false, nat, nfb, x87 };
  const benefit = nat * BX_C_UOP;
  const cost = BX_C_ENTRY + nfb * BX_C_FALLBACK;
  return { accept: benefit > cost, nat, nfb, x87 };
}

// ---------------------------------------------------------------- the CDF ---

// rows: [{ len, ops, accept }]  ->  summary
function summarize(rows, totals) {
  const byLen = new Map();
  let ops = 0, reach = 0;
  for (const r of rows) {
    ops += r.ops;
    if (r.accept) reach += r.ops;
    byLen.set(r.len, (byLen.get(r.len) || 0) + r.ops);
  }
  const lens = [...byLen.keys()].sort((a, b) => a - b);
  // ops-weighted median block length, and the CDF at each mark.
  let run = 0, p50 = 0;
  const cdf = {};
  for (const L of lens) {
    run += byLen.get(L);
    if (!p50 && run * 2 >= ops) p50 = L;
  }
  for (const mark of LEN_MARKS) {
    let at = 0;
    for (const L of lens) if (L >= mark) at += byLen.get(L);
    cdf[mark] = ops ? at / ops : 0;
  }
  return Object.assign({
    blocks: rows.length,
    ops,
    p50,
    atLeast: cdf,
    reachable: ops ? reach / ops : 0,
    hist: lens.map(L => ({ len: L, ops: byLen.get(L) })),
  }, totals || {});
}

// Full path: a hot-block dump plus the run log that names its module bases.
function cdfFromDump(opts) {
  const { dumpFile, logFile, app, window: win, dispatches = 0,
          regions = false } = opts;
  const dump = opts.dump || census.readDump(dumpFile);
  const log = logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  // `imagesFromLog` returns "path@0xBASE" specs; `resolver`/`censusRegions`
  // both want them already loaded.
  const images = opts.images ||
    (opts.specs || census.imagesFromLog(app, log)).map(loadImage);
  const resolve = resolver(images);

  const hits = new Map();
  for (const r of dump) hits.set(r.addr >>> 0, (hits.get(r.addr >>> 0) || 0) + r.hits);

  const mapped = [], unmapped = [];
  for (const [a] of hits) (resolve(a) ? mapped : unmapped).push(a);
  const blocks = buildCfg(resolve, mapped);

  const rows = [];
  let undecodable = 0, unmappedTransfers = 0;
  for (const a of unmapped) unmappedTransfers += hits.get(a);
  for (const a of mapped) {
    const b = blocks.get(a >>> 0);
    const h = hits.get(a);
    if (!b || b.bad) { undecodable += h; continue; }
    const insns = blockInsns(resolve, b);
    if (!insns || insns.length < 1) { undecodable += h; continue; }
    // The terminator stays threaded (design section 1.1); the body is what the
    // descriptor covers and what $BX_C_UOP prices.
    const body = insns.slice(0, insns.length - 1);
    const cm = costModel(body);
    rows.push({ va: a, hits: h, len: body.length, ops: h * insns.length,
                accept: cm.accept, nat: cm.nat, nfb: cm.nfb, x87: cm.x87 });
  }

  const out = summarize(rows, {
    window: win || path.basename(dumpFile),
    app,
    transfers: [...hits.values()].reduce((s, v) => s + v, 0),
    dispatches,
    unmappedBlocks: unmapped.length,
    unmappedTransfers,
    undecodableTransfers: undecodable,
    images: images.length,
  });
  out.opsInX87Blocks = rows.filter(r => r.x87 > 0).reduce((s, r) => s + r.ops, 0);

  if (regions) {
    const rep = census.censusRegions({ dump, images, dispatches });
    // "2+ block eligible": the census's own 2-4 and 5-16 buckets, which is the
    // number design section 15.5 quotes beside the matcher's opsMulti%.
    const multi = rep.buckets.filter(b => b.name !== '1 block')
      .reduce((s, b) => s + b.ops, 0);
    const denom = rep.totals.opsLowerBound;
    out.regionReach = denom ? multi / denom : 0;
    out.regionOps = multi;
    out.censusOps = denom;
  }
  return out;
}

// Cheap path: the committed per-window index.json, which already carries an
// `ops` (static instruction count) and a `retired` per block -- but only for
// the top 25, so its shares are over that prefix, not the whole window.
function cdfFromIndex(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = j.blocks.map(b => ({
    va: parseInt(b.addr, 16) >>> 0,
    hits: b.entries,
    len: Math.max(0, b.ops - 1),
    ops: b.retired,
    accept: false,
  }));
  const s = summarize(rows, {
    window: j.app, app: j.app,
    transfers: rows.reduce((a, r) => a + r.hits, 0),
    totalRetired: j.totalRetired,
    distinct: j.distinct,
    partial: true,
  });
  delete s.reachable;                 // index.json cannot answer the model
  return s;
}

// ------------------------------------------------------------------ report --

function pct(x) { return (100 * x).toFixed(1) + '%'; }

function report(rows) {
  const w = Math.max(10, ...rows.map(r => String(r.window).length));
  const head = ['window'.padEnd(w), 'ops'.padStart(15), 'p50'.padStart(5),
    ...LEN_MARKS.map(m => `>=${m}`.padStart(7)),
    'reach'.padStart(7), 'region'.padStart(7), 'cov'.padStart(7)];
  console.log(head.join(' '));
  console.log('-'.repeat(head.join(' ').length));
  for (const r of rows) {
    const cov = r.dispatches ? pct(r.ops / r.dispatches) : '-';
    console.log([
      String(r.window).padEnd(w),
      r.ops.toLocaleString().padStart(15),
      String(r.p50).padStart(5),
      ...LEN_MARKS.map(m => pct(r.atLeast[m]).padStart(7)),
      (r.reachable === undefined ? '-' : pct(r.reachable)).padStart(7),
      (r.regionReach === undefined ? '-' : pct(r.regionReach)).padStart(7),
      String(cov).padStart(7),
    ].join(' '));
  }
}

function main(argv) {
  const arg = (n, d) => {
    const a = argv.find(v => v.startsWith(`--${n}=`));
    return a === undefined ? d : a.slice(n.length + 3);
  };
  const json = argv.includes('--json');
  const regions = argv.includes('--regions');

  if (arg('index')) {
    const r = cdfFromIndex(arg('index'));
    if (json) console.log(JSON.stringify(r, null, 1)); else report([r]);
    return;
  }

  const dir = arg('dir');
  const rows = [];
  if (dir) {
    const only = arg('windows') ? new Set(arg('windows').split(',')) : null;
    for (const win of Object.keys(WINDOWS)) {
      if (only && !only.has(win)) continue;
      const dumpFile = path.join(dir, `${win}-hot.txt`);
      const logFile = path.join(dir, `${win}-run.log`);
      if (!fs.existsSync(dumpFile)) { console.error(`skip ${win}: no dump`); continue; }
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      const m = /\[handler-hist\][^\n]*total=(\d+)/.exec(log);
      rows.push(cdfFromDump({
        dumpFile, logFile, app: WINDOWS[win], window: win,
        dispatches: m ? parseInt(m[1], 10) : 0, regions,
      }));
    }
  } else {
    const dumpFile = arg('dump');
    if (!dumpFile) { console.log('need --dump= or --dir= or --index='); process.exit(2); }
    const logFile = arg('log');
    const log = logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const m = /\[handler-hist\][^\n]*total=(\d+)/.exec(log);
    rows.push(cdfFromDump({
      dumpFile, logFile, app: arg('app'), window: arg('window'),
      dispatches: parseInt(arg('dispatches', m ? m[1] : '0'), 10), regions,
    }));
  }

  if (json) { console.log(JSON.stringify(rows, null, 1)); return; }
  report(rows);

  const gp = rows.filter(r => GAMEPLAY.has(r.window));
  if (gp.length) {
    const worst = Math.max(...gp.map(
      r => (r.reachable === undefined ? r.atLeast[12] : r.reachable)));
    console.log(`\ngameplay windows: ${gp.length}; ` +
      `highest reachable share ${pct(worst)}`);
    console.log(worst < 0.15
      ? 'KILL RULE MET: reachable share < 15% in EVERY gameplay window.'
      : 'kill rule NOT met on this axis.');
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { cdfFromDump, cdfFromIndex, summarize, costModel, classifyInsn,
                   blockInsns, LEN_MARKS, WINDOWS, GAMEPLAY,
                   BX_C_ENTRY, BX_C_UOP, BX_C_FALLBACK };
