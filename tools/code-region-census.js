#!/usr/bin/env node
// How much of a real app's retired work could an APP-SCALE REGION DESCRIPTOR
// swallow?  A count-only matcher.  Nothing here changes execution.
//
//   node tools/code-region-census.js --dump=FILE --pe=PATH[@0xBASE] [--pe=...]
//        [--dispatches=N] [--why] [--json] [--top=N]
//        [--max-blocks=16] [--max-exits=8] [--max-pages=4]
//   node tools/code-region-census.js --app=ID [--batches=N] [--window=A:B]
//        [--args='...'] [--seconds=N] [--out=DIR] [--why]
//
// WHY THIS EXISTS
//
// docs/region-descriptor-bench-2026-09.md measured the MECHANISM: a fixed
// handler (H454) interpreting a multi-block region descriptor beats threaded
// per-op dispatch by +31..41% at 4-10 blocks, and its fit separates the two
// costs -- threaded ~38 ns per micro-op and ~91 ns per loop iteration, region
// ~22 ns and ~49 ns.  Its own closing line is that the next measurement is
// FREQUENCY, not speed.  This is that measurement.
//
// It is a MATCHER, not an executor.  It applies the rules an app-scale region
// descriptor would have to obey -- taken from `$loop_try_tree_fold`'s accept
// set and `$th_tree_fold`'s descriptor limits in src/07b-loop-match.wat -- to
// the x86 control-flow graph of the blocks a real run actually entered, and
// weights every verdict by RUNTIME hit counts.
//
// NAMING: tools/region-census.js is taken -- it is the build gate over the
// WATX *memory* region odometer, an unrelated meaning of "region".  This file
// is about regions of guest CODE.
//
// THE RULES, and where each comes from
//
//   single entry     no in-set block other than the entry has a predecessor
//                    outside the set.  The descriptor has one entry EIP.
//   closed set       every edge either lands in the set or is one of <= 8
//                    exit slots ($REGION_MAX_EXITS).
//   <= 16 blocks     $REGION_MAX_BLOCKS.
//   micro-op cap     (4096 - 8 - 16 - 52*nblocks - 8*nexits) / 24, the
//                    descriptor's real limit inside $decode_block's 4096-byte
//                    slack (bench doc section 5).  Not $TREE_FOLD_UOPS_LIMIT,
//                    which is the one-block clamp.
//   no call/ret/int/indirect jump inside.  Anything that can trap or yield
//                    mid-block is not allowed inside a region (bench doc
//                    section 3), so those blocks END a region.
//   accepted ops     every instruction must map to a TU_* micro-op kind that
//                    $tree_uop_classify already produces.  The set is listed
//                    in ACCEPT below and mirrors the kind table at
//                    src/07b-loop-match.wat:5325.
//   page count       recorded and capped (--max-pages).  A region spanning N
//                    pages needs N generation counters re-checked at entry
//                    (bench doc section 2); this is the cost that bench did
//                    not model, so the census reports the distribution.
//
// A LEAF CALL is counted apart as class `call1`: a direct `call` whose callee
// is straight-line, ends in `ret`, and whose body is all accepted ops.  The
// bench's `region_call1` shape (+26%) is what that would cost.  It is NOT
// admitted into regions here; it is reported as the size of the prize for
// admitting it.
//
// WHAT THE WEIGHTS ARE, precisely
//
// `--hot-block-dump` writes one line per distinct guest address the profiling
// window entered a compiled block AT, with a hit count.  A hit is one
// INTERPRETER BLOCK TRANSFER: an EIP that had to be looked up before anything
// ran.  Fall-through inside a decode run costs no hit, because `$decode_run`
// fuses a not-taken Jcc into the next op of the same thread stream.  So:
//
//   * transfers are EXACT.  They are the dump, only bucketed.
//   * ops are a LOWER BOUND: hits x the static x86 instruction count of the
//     block.  Blocks reached only by fused fall-through have no hits and
//     their instructions are missing.  Pass --dispatches=N (the
//     `[handler-hist] ... total=` line from the same window) and the coverage
//     ratio is printed, so the size of the blind spot is visible.
//
// The projection is deliberately an UPPER BOUND -- a ceiling, not a forecast:
//
//   threaded  NS_OP_T * ops + NS_XFER_T * transfers
//   region    NS_OP_R * ops + NS_ENTRY_R * entry transfers
//
// with NS_XFER_T = 91/2, because the bench's 91 ns fixed term is per
// ITERATION of a two-block loop and it also absorbs that loop's own dec/jnz.
// Halving it attributes all of it to the two transfers, which OVERSTATES what
// a transfer costs and therefore overstates the win.  Every constant is a
// flag (--ns-op-threaded etc) so the sensitivity is one command away.
//
// Importable:
//   const { censusRegions } = require('./tools/code-region-census');

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildCfg, loadImage, resolver } = require(path.join(__dirname, 'block-regions.js'));
const { disasmAt } = require(path.join(__dirname, 'disasm.js'));

const REPO = path.join(__dirname, '..');
const hex = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// ------------------------------------------------------- descriptor caps ---

// src/07b-loop-match.wat: $REGION_MAX_BLOCKS / $REGION_MAX_EXITS, and the
// slack arithmetic from docs/region-descriptor-bench-2026-09.md section 5.
const DEFAULT_MAX_BLOCKS = 16;
const DEFAULT_MAX_EXITS = 8;
const SLACK_BYTES = 4096;
const HEADER_BYTES = 8 + 16;      // one-block header 8, region header 4 words
const BLOCK_REC_BYTES = 52;       // 13 words
const EXIT_REC_BYTES = 8;         // 2 words
const UOP_BYTES = 24;             // $TREE_UOP_WORDS = 6

function uopBudget(nblocks, nexits) {
  return Math.floor((SLACK_BYTES - HEADER_BYTES -
    BLOCK_REC_BYTES * nblocks - EXIT_REC_BYTES * nexits) / UOP_BYTES);
}

// -------------------------------------------------------- the accept set ---
//
// Mirrors the TU_* kinds $tree_uop_classify produces (src/07b-loop-match.wat
// :5325-5460).  Keyed by disassembler mnemonic, because this census works off
// static x86 rather than off emitted handler indices -- the decoder is not
// running.  That is an approximation in ONE direction only where noted: it
// accepts a shape the classifier might still refuse for an operand reason
// (an addressing mode with two index registers, an x87 stack depth the
// $tree_x87_*_ok gates dislike), so every count here is an UPPER bound on
// what the real matcher would take.

const ALU_RR_RI = new Set(['add', 'sub', 'and', 'or', 'xor', 'adc', 'sbb']);
const UNARY = new Set(['inc', 'dec', 'neg', 'not']);
const SHIFTS = new Set(['shl', 'shr', 'sar', 'sal']);
// TU_X87_MEM / TU_X87_MRO / TU_X87_REG / TU_X87_SW_AX.  H188/H189/H190 behind
// $tree_x87_mem_ok and $tree_x87_reg_ok, which gate on the escape group and
// the reg field; at mnemonic granularity this is the reachable set.
const X87 = new Set([
  'fld', 'fst', 'fstp', 'fild', 'fist', 'fistp', 'fadd', 'faddp', 'fsub',
  'fsubp', 'fsubr', 'fsubrp', 'fmul', 'fmulp', 'fdiv', 'fdivp', 'fdivr',
  'fdivrp', 'fxch', 'fchs', 'fabs', 'fcom', 'fcomp', 'fcompp', 'fnstsw',
  'fstsw', 'fldz', 'fld1',
]);
// Flag producers a Jcc terminator may consume ($loop_try_tree_fold's
// terminator scan: H64/H65 inc/dec, H19 cmp r,r, H10 cmp r,imm, H128 cmp
// r,[base+disp]).  `test` is NOT among them today; it is counted as its own
// decline reason so the doc can say what admitting it would buy.
const TERM_PRODUCER = new Set(['cmp', 'inc', 'dec', 'sub', 'and', 'add', 'or', 'xor']);

// One instruction -> null when accepted, else the reason string.
function opDecline(ins, isTermProducer) {
  const m = ins.mnem;
  const rest = ins.insn.slice(m.length).trim();
  if (m === 'mov') return null;
  if (m === 'lea') return null;
  if (m === 'imul') {
    // one-operand IMUL writes EDX:EAX and has no TU kind.
    return /,/.test(rest) ? null : 'unsupported-op:imul1';
  }
  if (ALU_RR_RI.has(m)) return null;
  if (UNARY.has(m)) return null;
  if (SHIFTS.has(m)) {
    // TU_SHIFT is H53 $th_shift_r, an immediate count.  `shl eax, cl` is a
    // different handler and has no kind.
    return /,\s*cl\b/i.test(rest) ? 'unsupported-op:shift-by-cl' : null;
  }
  if (m === 'rol' || m === 'ror' || m === 'rcl' || m === 'rcr') {
    return 'unsupported-op:rotate';
  }
  if (m === 'movzx' || m === 'movsx') {
    // TU_MOVZX8_RO / TU_MOVSX8_RO / TU_MOVSX8_SIB are byte-source only.
    return /\bword\b/i.test(rest) ? 'unsupported-op:movzx16' : null;
  }
  if (m === 'rep' || m === 'repe' || m === 'repne' || m === 'repz' || m === 'repnz') {
    // TU_REP_STR covers H82..H85 = rep movsb/movsd/stosb/stosd only.
    return /\b(movsb|movsd|stosb|stosd)\b/i.test(rest) ? null
      : 'unsupported-op:rep-other';
  }
  if (X87.has(m)) return null;
  if (m === 'cmp') {
    return isTermProducer ? null : 'unsupported-op:cmp';
  }
  if (m === 'test') {
    // `test r,r` writes only the logic flags and no register, so as a
    // terminator producer it is one arm away from H19/H10 -- but it is NOT in
    // $loop_try_tree_fold's producer list today, so it declines.  Its own
    // reason string, because sizing that one arm is the point of the census.
    if (!isTermProducer) return 'unsupported-op:test-interior';
    return relaxed.has('test') ? null : 'producer:test';
  }
  // A NOP carries no state.  The decoder emits H0 for it and a descriptor
  // simply would not, so it is not a reason to refuse a block.
  if (m === 'nop') return null;
  return `unsupported-op:${m}`;
}

// Relaxations under test.  Mutated by censusRegions before each pass; the
// census is single-threaded and re-entrant per pass, so a module-level set is
// the cheapest way to thread this through opDecline without an extra
// parameter on every call site.
let relaxed = new Set();

// ---------------------------------------------------------- disassembly ----

const RE_LINE = /^([0-9a-f]{8})\s{2}((?:[0-9a-f]{2} )+)\s*(.*)$/;

// Every instruction of one block, as {va, len, insn, mnem}.
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
    const insn = m[3].trim();
    if (!insn || /^\(bad\)/.test(insn)) return null;
    // A segment override disassembles as its own leading token (`ds: mov …`).
    // The prefix is not the instruction; strip it so the mnemonic underneath
    // is what gets classified.  A non-DS/ES override is a real decline and
    // keeps its own name.
    let text = insn;
    const seg = /^(cs|ds|es|ss|fs|gs):\s*/i.exec(text);
    if (seg) {
      if (/^(cs|ds|es|ss)$/i.test(seg[1])) text = text.slice(seg[0].length);
      else text = `segprefix${seg[1].toLowerCase()} ` + text.slice(seg[0].length);
    }
    out.push({ va: parseInt(m[1], 16) >>> 0, insn: text,
               mnem: text.split(/[\s,]/)[0].toLowerCase() });
    if (out.length >= b.insns) break;
  }
  return out;
}

// ------------------------------------------------------------- admission ---

// Why a block cannot be INSIDE a region.  null = admissible.
// `ends` is what its terminator is; the region must stop at everything else.
function blockDecline(b, insns) {
  if (b.bad || !insns) return 'undecodable';
  if (b.end === 'call') return b.indirect ? 'call-indirect' : 'call';
  if (b.end === 'ret') return 'ret';
  if (b.end === 'int') return 'int';
  if (b.end === 'indirect') return 'indirect-jump';
  // Direct jcc / jmp / fall are the only interior terminators.
  const last = insns.length - 1;
  // $loop_try_tree_fold does not require the flag producer to sit immediately
  // before the Jcc -- it scans backwards past ops that neither write nor read
  // flags, because a compiler that spills at the bottom of a loop emits
  // `dec edi / mov [esp+8],edx / jnz`.  So the producer is the LAST
  // flag-writing instruction before the terminator, and only that index may
  // be a `cmp`/`test`.
  let producer = -1;
  if (/^j/.test(insns[last].mnem)) {
    for (let i = last - 1; i >= 0; i--) {
      if (FLAG_WRITERS.has(insns[i].mnem)) { producer = i; break; }
    }
  }
  for (let i = 0; i < insns.length; i++) {
    const ins = insns[i];
    // The terminator itself is the block record's business, not a micro-op.
    if (i === last && /^(j|loop)/.test(ins.mnem)) continue;
    const why = opDecline(ins, i === producer);
    if (why) return why;
  }
  return null;
}

// Mnemonics that write EFLAGS.  Used only to find the terminator's producer.
const FLAG_WRITERS = new Set([
  'add', 'sub', 'and', 'or', 'xor', 'adc', 'sbb', 'inc', 'dec', 'neg',
  'cmp', 'test', 'shl', 'shr', 'sar', 'sal', 'rol', 'ror', 'rcl', 'rcr',
  'imul', 'mul', 'div', 'idiv', 'bt', 'bts', 'btr', 'btc', 'bsf', 'bsr',
]);

// A direct `call` whose callee is one straight-line accepted block ending in
// `ret`.  The bench's region_call1 shape.  Cheap check: decode forward from
// the target, refuse anything that branches.
function isLeafCall1(resolve, target, maxInsns) {
  const probe = buildCfg(resolve, [target >>> 0], { budget: 4096 });
  const b = probe.get(target >>> 0);
  if (!b || b.bad) return false;
  if (b.end !== 'ret') return false;
  if (b.insns > maxInsns) return false;
  const insns = blockInsns(resolve, b);
  if (!insns) return false;
  for (let i = 0; i < insns.length; i++) {
    if (i === insns.length - 1 && /^ret/.test(insns[i].mnem)) continue;
    if (opDecline(insns[i], false)) return false;
  }
  return true;
}

// ----------------------------------------------------------- the census ----

function censusRegions(opts) {
  const {
    dump, images, dispatches = 0,
    maxBlocks = DEFAULT_MAX_BLOCKS,
    maxExits = DEFAULT_MAX_EXITS,
    maxPages = 4,
    call1Insns = 24,
    relax = [],
    ns = {},
  } = opts;
  relaxed = new Set(relax);
  const allowMultiEntry = relaxed.has('multi-entry');
  const NS_OP_T = ns.opThreaded ?? 38;
  const NS_XFER_T = ns.xferThreaded ?? 45.5;   // 91 / 2, see the header
  const NS_OP_R = ns.opRegion ?? 22;
  const NS_ENTRY_R = ns.entryRegion ?? 49;

  const resolve = resolver(images);
  const hits = new Map();
  for (const row of dump) hits.set(row.addr >>> 0, (hits.get(row.addr >>> 0) || 0) + row.hits);

  const mapped = [], unmapped = [];
  for (const [addr] of hits) (resolve(addr) ? mapped : unmapped).push(addr);

  const blocks = buildCfg(resolve, mapped);

  // predecessors over the whole built CFG -- the single-entry test.
  const preds = new Map();
  for (const [va, n] of blocks) {
    for (const t of n.targets) {
      if (!blocks.has(t)) continue;
      if (!preds.has(t)) preds.set(t, []);
      preds.get(t).push(va);
    }
  }

  // memoized per-block admission
  const insnsOf = new Map(), declineOf = new Map();
  const insnsFor = va => {
    if (insnsOf.has(va)) return insnsOf.get(va);
    const v = blockInsns(resolve, blocks.get(va));
    insnsOf.set(va, v);
    return v;
  };
  const declineFor = va => {
    if (declineOf.has(va)) return declineOf.get(va);
    const v = blockDecline(blocks.get(va), insnsFor(va));
    declineOf.set(va, v);
    return v;
  };

  const pagesOf = set => {
    const p = new Set();
    for (const v of set) {
      const b = blocks.get(v);
      for (let a = v & ~0xfff; a < v + Math.max(1, b.len); a += 4096) p.add(a >>> 12);
    }
    return p.size;
  };

  // ---- grow one region from an entry, greedily, BFS by hit count ---------
  //
  // A candidate target is admitted when its block is admissible, every
  // predecessor it has is already in the set (single entry), and the caps
  // still hold with it in.  Otherwise the edge into it becomes an exit and
  // the reason is recorded -- that reason histogram is the work list.
  // `taken` is the claim map: a block already inside another region cannot be
  // inside this one too, or the op shares double-count.  Without this the
  // multi-entry arm reported over 100% of ops in regions.
  function grow(entry, taken) {
    const set = new Set([entry]);
    const exits = new Map();          // target va (or -1 for terminator exits) -> reason
    const exitReasons = new Map();    // reason -> transfers weight
    const noteExit = (t, why) => {
      const key = t === null ? `term:${why}` : String(t);
      if (!exits.has(key)) exits.set(key, why);
      const w = t === null ? 0 : (hits.get(t) || 0);
      exitReasons.set(why, (exitReasons.get(why) || 0) + w);
    };
    let uops = insnsFor(entry).length;
    const frontier = [];
    const push = va => frontier.push(va);
    for (const t of blocks.get(entry).targets) push(t);

    let capHit = null;
    while (frontier.length) {
      // hottest first: a region that must stop somewhere should keep the hot
      // arm, not whichever arm the target list happened to name first.
      frontier.sort((a, b) => (hits.get(b) || 0) - (hits.get(a) || 0));
      const t = frontier.shift() >>> 0;
      if (set.has(t)) continue;
      if (!blocks.has(t)) { noteExit(t, 'unmapped'); continue; }
      if (taken.has(t)) { noteExit(t, 'claimed-by-hotter-region'); continue; }
      const why = declineFor(t);
      if (why) { noteExit(t, why); continue; }
      const outside = (preds.get(t) || []).some(p => !set.has(p));
      if (outside && !allowMultiEntry) { noteExit(t, 'multi-entry'); continue; }
      // caps, with t provisionally in
      const nb = set.size + 1;
      if (nb > maxBlocks) { noteExit(t, 'cap:blocks'); capHit = capHit || 'blocks'; continue; }
      const ti = insnsFor(t);
      const nu = uops + ti.length;
      const budget = uopBudget(nb, Math.max(1, exits.size));
      if (nu > budget) { noteExit(t, 'cap:uops'); capHit = capHit || 'uops'; continue; }
      const trial = new Set(set); trial.add(t);
      if (pagesOf(trial) > maxPages) { noteExit(t, 'cap:pages'); capHit = capHit || 'pages'; continue; }
      set.add(t); uops = nu;
      for (const s of blocks.get(t).targets) if (!set.has(s)) push(s);
    }
    // terminator exits: a block whose own terminator leaves the graph
    for (const v of set) {
      const b = blocks.get(v);
      if (!b.targets.length) noteExit(null, b.end);
    }
    const nexits = exits.size;
    const pages = pagesOf(set);
    let declined = null;
    if (nexits > maxExits) declined = 'too-many-exits';
    else if (uops > uopBudget(set.size, nexits)) declined = 'cap:uops';
    return { set, nexits, uops, pages, exitReasons, declined, capHit };
  }

  // ---- claim regions, hottest entry first -------------------------------
  const order = mapped.slice().sort((a, b) => (hits.get(b) || 0) - (hits.get(a) || 0));
  const claimed = new Map();          // block va -> region
  const regions = [];
  const declines = new Map();         // reason -> {ops, transfers, addrs}
  const bump = (map, key, ops, xfers) => {
    if (!map.has(key)) map.set(key, { ops: 0, transfers: 0, addrs: 0 });
    const e = map.get(key);
    e.ops += ops; e.transfers += xfers; e.addrs++;
  };
  const exitWhy = new Map();          // reason -> transfers, over accepted regions

  const call1Ops = { ops: 0, transfers: 0, addrs: 0 };

  for (const entry of order) {
    if (claimed.has(entry)) continue;
    const b = blocks.get(entry);
    const h = hits.get(entry) || 0;
    const ops = h * b.insns;
    const own = declineFor(entry);
    if (own) {
      bump(declines, own, ops, h);
      if (own === 'call' && b.targets.length) {
        // is the callee a leaf?  Counted apart, not admitted.
        const insns = insnsFor(entry);
        const lastInsn = insns && insns[insns.length - 1];
        const m = lastInsn && /(?:^|\s)(0x[0-9a-f]+)$/i.exec(lastInsn.insn);
        if (m && isLeafCall1(resolve, parseInt(m[1], 16), call1Insns)) {
          call1Ops.ops += ops; call1Ops.transfers += h; call1Ops.addrs++;
        }
      }
      continue;
    }
    const g = grow(entry, claimed);
    if (g.declined) {
      bump(declines, g.declined, ops, h);
      continue;
    }
    const rec = {
      entry, nodes: Array.from(g.set).sort((a, b) => a - b),
      nblocks: g.set.size, nexits: g.nexits, uops: g.uops, pages: g.pages,
      ops: 0, transfers: 0, entryTransfers: hits.get(entry) || 0,
      insns: 0,
    };
    rec.entryTransfers = 0;
    for (const v of g.set) {
      const bb = blocks.get(v);
      const hh = hits.get(v) || 0;
      rec.ops += hh * bb.insns;
      rec.transfers += hh;
      rec.insns += bb.insns;
      // How many of v's transfers came from OUTSIDE the set?  Those are the
      // ones a region still pays; everything else is an interior edge the
      // descriptor turns into a successor index.  Block-entry counts carry no
      // edge attribution, so this splits v's hits between its predecessors in
      // proportion to THEIR hits -- an estimate, and the only one available.
      // A block with no known predecessor is charged entirely as an entry.
      const pl = preds.get(v) || [];
      if (!pl.length) { rec.entryTransfers += hh; }
      else {
        let ext = 0, all = 0;
        for (const p of pl) {
          const ph = (hits.get(p) || 1);
          all += ph;
          if (!g.set.has(p)) ext += ph;
        }
        rec.entryTransfers += all ? hh * ext / all : hh;
      }
      claimed.set(v, rec);
    }
    rec.entries = rec.nodes.filter(v =>
      v === entry || (preds.get(v) || []).some(p => !g.set.has(p))).length;
    for (const [why, w] of g.exitReasons) exitWhy.set(why, (exitWhy.get(why) || 0) + w);
    regions.push(rec);
  }

  // ---- roll up -----------------------------------------------------------
  let totalOps = 0, totalTransfers = 0;
  for (const [addr, h] of hits) {
    totalTransfers += h;
    totalOps += h * (blocks.has(addr) ? blocks.get(addr).insns : 0);
  }
  for (const addr of unmapped) bump(declines, 'unmapped', 0, hits.get(addr));

  const BUCKETS = [
    ['1 block', r => r.nblocks === 1],
    ['2-4 blocks', r => r.nblocks >= 2 && r.nblocks <= 4],
    ['5-16 blocks', r => r.nblocks >= 5],
  ];
  const buckets = BUCKETS.map(([name, pred]) => {
    const rs = regions.filter(pred);
    return {
      name, regions: rs.length,
      ops: rs.reduce((s, r) => s + r.ops, 0),
      transfers: rs.reduce((s, r) => s + r.transfers, 0),
      entryTransfers: rs.reduce((s, r) => s + r.entryTransfers, 0),
    };
  });
  // Today's fold is the SELF-LOOP one-block case, not every one-block region.
  const selfLoop = regions.filter(r => r.nblocks === 1 &&
    blocks.get(r.entry).targets.includes(r.entry));
  buckets[0].selfLoopRegions = selfLoop.length;
  buckets[0].selfLoopOps = selfLoop.reduce((s, r) => s + r.ops, 0);

  const declinedOps = Array.from(declines.values()).reduce((s, d) => s + d.ops, 0);
  const declinedXfer = Array.from(declines.values()).reduce((s, d) => s + d.transfers, 0);

  // ---- projection --------------------------------------------------------
  const threadedNs = NS_OP_T * totalOps + NS_XFER_T * totalTransfers;
  let regionNs = NS_OP_T * declinedOps + NS_XFER_T * declinedXfer;
  let regionNsMulti = regionNs;               // 2+ block regions only
  for (const r of regions) {
    regionNs += NS_OP_R * r.ops + NS_ENTRY_R * r.entryTransfers;
    if (r.nblocks >= 2) regionNsMulti += NS_OP_R * r.ops + NS_ENTRY_R * r.entryTransfers;
    else regionNsMulti += NS_OP_T * r.ops + NS_XFER_T * r.transfers;
  }
  const ceiling = threadedNs ? (1 - regionNs / threadedNs) : 0;
  const ceilingMulti = threadedNs ? (1 - regionNsMulti / threadedNs) : 0;

  return {
    totals: {
      distinctAddrs: hits.size, transfers: totalTransfers, opsLowerBound: totalOps,
      dispatches,
      dispatchesPerInsn: dispatches && totalOps ? dispatches / totalOps : null,
      cfgNodes: blocks.size, unmappedAddrs: unmapped.length,
    },
    caps: { maxBlocks, maxExits, maxPages, uopBudget16: uopBudget(maxBlocks, maxExits) },
    ns: { NS_OP_T, NS_XFER_T, NS_OP_R, NS_ENTRY_R },
    buckets,
    declined: { ops: declinedOps, transfers: declinedXfer },
    declines, exitWhy, call1: call1Ops,
    regions: regions.sort((a, b) => b.ops - a.ops),
    projection: { threadedNs, regionNs, regionNsMulti, ceiling, ceilingMulti },
    blocks,
  };
}

// -------------------------------------------------------------- driving ----

// One app -> a hot-block dump plus the image list, by running the CLI.
// Windows are named here rather than passed in so the doc and the tool agree
// on what "the caesar3 city window" means.
const APPS = {
  quake2_demo: { batches: 4000, window: [2500, 4000],
    args: '+set vid_ref soft +map demo1' },
  caesar3_demo: { batches: 9000, window: [6000, 9000] },
  heroes2_demo: { batches: 6000, window: [3000, 6000] },
  mw3: { batches: 4000, window: [2000, 4000] },
  starcraft_shareware: { batches: 6000, window: [3000, 6000] },
  diablo_shareware: { batches: 6000, window: [3000, 6000] },
};

function runApp(id, o) {
  const spec = APPS[id] || {};
  const batches = o.batches || spec.batches || 4000;
  const win = o.window || spec.window || [Math.floor(batches / 2), batches];
  const outDir = o.out || fs.mkdtempSync(path.join(os.tmpdir(), 'regcensus-'));
  fs.mkdirSync(outDir, { recursive: true });
  const dumpFile = path.join(outDir, `${id}.dump`);
  const logFile = path.join(outDir, `${id}.log`);
  // --reuse re-censuses a window already collected.  Re-running the app to
  // change a matcher rule wastes minutes and, worse, gives a different dump,
  // so the two censuses would not be comparable.
  if (o.reuse && fs.existsSync(dumpFile) && fs.existsSync(logFile)) {
    return { dumpFile, logFile, log: fs.readFileSync(logFile, 'utf8'),
             window: win, batches, reused: true };
  }
  const argv = [
    // --stuck-after is a huge number, not the default 10: an app parked in a
    // blocking API for a few batches is IDLE, not stuck, and the detector
    // ending the run there means the profiling window never opens.
    'test/run.js', `--app=${id}`, '--quiet-api', '--no-close',
    '--stuck-after=1000000',
    `--max-batches=${batches}`, '--handler-hist', '--handler-hist-thread=0',
    `--handler-hist-start=${win[0]}`, `--handler-hist-stop=${win[1]}`,
    `--hot-block-dump=${dumpFile}`,
  ];
  if (o.seconds) argv.push(`--max-seconds=${o.seconds}`);
  const extra = o.args !== undefined ? o.args : spec.args;
  if (extra) argv.push(`--args=${extra}`);
  let log = '';
  try {
    log = execFileSync('node', argv, {
      cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28,
      timeout: (o.timeout || 170) * 1000,
    });
  } catch (e) {
    log = (e.stdout || '') + (e.stderr || '');
  }
  fs.writeFileSync(logFile, log);
  return { dumpFile, logFile, log, window: win, batches };
}

// The run log names every module and where it landed.  `PE loaded.` is the
// exe, whose base is the registry's; the DLL lines carry loadAddr directly.
function imagesFromLog(id, log) {
  const apps = require(path.join(REPO, 'lib', 'apps.js'));
  const reg = Object.assign({}, apps.LOCAL_CANDIDATE_APPS, apps.DEBUG_ONLY_APPS,
    apps.APPS)[id] || {};
  const specs = [];
  const exe = reg.exe;
  if (exe) {
    const p = path.join(REPO, exe.replace(/^binaries\//, 'test/binaries/'));
    if (fs.existsSync(p)) specs.push(p);
  }
  const byName = new Map();
  for (const m of log.matchAll(/^DLL: (\S+) at 0x([0-9a-f]+),.*origBase=0x([0-9a-f]+)/gmi)) {
    byName.set(m[1].toLowerCase(), { load: parseInt(m[2], 16), orig: parseInt(m[3], 16) });
  }
  // The registry already names every DLL's path; matching those by basename
  // against the log's load addresses beats guessing directories, and getting
  // it wrong is expensive -- an unresolved DLL turns its blocks into
  // `unmapped`, which silently shrinks the census to whatever is left.
  const candidates = [];
  const push = p => { if (p && typeof p === 'string') candidates.push(p); };
  for (const d of (reg.dlls || [])) push(typeof d === 'string' ? d : d.url);
  for (const f of (reg.files || [])) push(typeof f === 'string' ? f : f.url);
  const byBase = new Map();
  for (const c of candidates) {
    const abs = path.join(REPO, c.replace(/^binaries\//, 'test/binaries/'));
    byBase.set(path.basename(c).toLowerCase(), abs);
  }
  for (const dir of [exe && path.dirname(path.join(REPO,
      exe.replace(/^binaries\//, 'test/binaries/'))), path.join(REPO, 'test/binaries/dlls')]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!byBase.has(f.toLowerCase())) byBase.set(f.toLowerCase(), path.join(dir, f));
    }
  }
  const missing = [];
  for (const [name, v] of byName) {
    const p = byBase.get(name);
    if (p && fs.existsSync(p)) specs.push(`${p}@0x${v.load.toString(16)}`);
    else missing.push(name);
  }
  if (missing.length) {
    console.error(`[run] WARNING: no file found for loaded module(s) ` +
      `${missing.join(' ')} -- their blocks will count as \`unmapped\``);
  }
  return specs;
}

function dispatchesFromLog(log) {
  const m = /\[handler-hist\][^\n]*total=(\d+)/.exec(log);
  return m ? parseInt(m[1], 10) : 0;
}

function readDump(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map(l => /^(0x[0-9a-f]+)\s+(\d+)/i.exec(l.trim()))
    .filter(Boolean)
    .map(m => ({ addr: parseInt(m[1], 16) >>> 0, hits: parseInt(m[2], 10) }));
}

// ---------------------------------------------------------------- report ---

function pct(a, b) { return b ? (a * 100 / b).toFixed(1) : '0.0'; }

function report(rep, o) {
  const t = rep.totals;
  console.log(`${t.distinctAddrs} distinct block-entry addresses, ` +
    `${t.transfers.toLocaleString()} block transfers, ` +
    `${t.opsLowerBound.toLocaleString()} x86 ops (lower bound)`);
  if (t.dispatches) {
    console.log(`dispatches ${t.dispatches.toLocaleString()}  ` +
      `${(t.dispatches / t.opsLowerBound).toFixed(2)} handler dispatches per x86 insn ` +
      `(< 1 means the decoder already fused; > 1 means fall-through ops this ` +
      `census cannot see)`);
  }
  console.log(`caps: <=${rep.caps.maxBlocks} blocks, <=${rep.caps.maxExits} exits, ` +
    `<=${rep.caps.maxPages} pages, <=${rep.caps.uopBudget16} micro-ops at full size`);
  console.log('');
  console.log('bucket           regions        ops    share      transfers   share');
  for (const b of rep.buckets) {
    console.log(`  ${b.name.padEnd(14)} ${String(b.regions).padStart(6)} ` +
      `${b.ops.toLocaleString().padStart(12)} ${pct(b.ops, t.opsLowerBound).padStart(6)}% ` +
      `${b.transfers.toLocaleString().padStart(13)} ${pct(b.transfers, t.transfers).padStart(6)}%`);
  }
  console.log(`  ${'declined'.padEnd(14)} ${''.padStart(6)} ` +
    `${rep.declined.ops.toLocaleString().padStart(12)} ${pct(rep.declined.ops, t.opsLowerBound).padStart(6)}% ` +
    `${rep.declined.transfers.toLocaleString().padStart(13)} ` +
    `${pct(rep.declined.transfers, t.transfers).padStart(6)}%`);
  console.log(`  (of the 1-block regions, ${rep.buckets[0].selfLoopRegions} are self-loops = ` +
    `today's fold, ${pct(rep.buckets[0].selfLoopOps, t.opsLowerBound)}% of ops)`);
  console.log(`  leaf call+ret ("call1") blocks among the declined: ` +
    `${rep.call1.addrs} addrs, ${rep.call1.ops.toLocaleString()} ops ` +
    `(${pct(rep.call1.ops, t.opsLowerBound)}%)`);

  // Pages spanned.  Every page a region covers is one generation counter to
  // re-check at entry (bench doc section 2), the one cost that bench did not
  // model -- so the distribution is the input to whether that check is cheap.
  const pg = new Map();
  for (const r of rep.regions) pg.set(r.pages, (pg.get(r.pages) || 0) + r.ops);
  console.log(`  pages spanned, weighted by ops: ` +
    Array.from(pg).sort((a, b) => a[0] - b[0])
      .map(([p, o]) => `${p}pg ${pct(o, t.opsLowerBound)}%`).join('  '));

  console.log('');
  console.log('declined, by reason, weighted by ops:');
  const ds = Array.from(rep.declines).sort((a, b) => b[1].ops - a[1].ops);
  for (const [why, d] of ds.slice(0, o.top || 14)) {
    console.log(`  ${why.padEnd(26)} ${String(d.addrs).padStart(5)} addrs ` +
      `${d.ops.toLocaleString().padStart(12)} ops ${pct(d.ops, t.opsLowerBound).padStart(6)}%`);
  }

  if (o.why) {
    console.log('');
    console.log('why accepted regions STOPPED growing (exit edges, weighted by transfers):');
    for (const [why, w] of Array.from(rep.exitWhy).sort((a, b) => b[1] - a[1]).slice(0, 16)) {
      console.log(`  ${why.padEnd(26)} ${w.toLocaleString().padStart(12)} transfers ` +
        `${pct(w, t.transfers).padStart(6)}%`);
    }
  }

  const p = rep.projection;
  console.log('');
  console.log(`projected ceiling (${rep.ns.NS_OP_T}/${rep.ns.NS_XFER_T} ns threaded vs ` +
    `${rep.ns.NS_OP_R}/${rep.ns.NS_ENTRY_R} ns region):`);
  console.log(`  all regions       ${(p.ceiling * 100).toFixed(1)}% off guest CPU`);
  console.log(`  2+ block only     ${(p.ceilingMulti * 100).toFixed(1)}% off guest CPU ` +
    `(what today's fold does not already reach)`);

  console.log('');
  console.log('top regions by ops:');
  for (const r of rep.regions.slice(0, o.top || 12)) {
    console.log(`  ${hex(r.entry)} n=${String(r.nblocks).padStart(2)} ` +
      `exits=${r.nexits} pg=${r.pages} uops=${String(r.uops).padStart(3)} ` +
      `ops=${r.ops.toLocaleString().padStart(12)} (${pct(r.ops, t.opsLowerBound).padStart(5)}%) ` +
      `xfer=${r.transfers.toLocaleString().padStart(11)} entry=${r.entryTransfers.toLocaleString()}`);
  }
}

function main(argv) {
  const arg = (n, d) => {
    const a = argv.find(v => v.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : d;
  };
  const list = n => argv.filter(v => v.startsWith(`--${n}=`)).map(v => v.slice(n.length + 3));
  const app = arg('app', null);
  let dumpPath = arg('dump', null);
  let peSpecs = list('pe');
  let dispatches = parseInt(arg('dispatches', '0'), 10) || 0;

  if (!app && !dumpPath) {
    console.error(fs.readFileSync(__filename, 'utf8').split('\n')
      .filter(l => l.startsWith('//')).slice(0, 30).join('\n'));
    process.exit(2);
  }
  if (app) {
    const w = arg('window', null);
    const r = runApp(app, {
      batches: parseInt(arg('batches', '0'), 10) || 0,
      window: w ? w.split(':').map(Number) : null,
      args: argv.some(v => v.startsWith('--args=')) ? arg('args') : undefined,
      out: arg('out', null),
      seconds: parseInt(arg('seconds', '0'), 10) || 0,
      timeout: parseInt(arg('timeout', '0'), 10) || 0,
      reuse: argv.includes('--reuse'),
    });
    dumpPath = r.dumpFile;
    if (!peSpecs.length) peSpecs = imagesFromLog(app, r.log);
    if (!dispatches) dispatches = dispatchesFromLog(r.log);
    console.error(`[run] ${app} batches ${r.window[0]}..${r.window[1]}  ` +
      `dump ${r.dumpFile}  images ${peSpecs.length}`);
  }

  const base = {
    dump: readDump(dumpPath),
    images: peSpecs.map(loadImage),
    dispatches,
    maxBlocks: parseInt(arg('max-blocks', String(DEFAULT_MAX_BLOCKS)), 10),
    maxExits: parseInt(arg('max-exits', String(DEFAULT_MAX_EXITS)), 10),
    maxPages: parseInt(arg('max-pages', '4'), 10),
    ns: {
      opThreaded: Number(arg('ns-op-threaded', 38)),
      xferThreaded: Number(arg('ns-xfer-threaded', 45.5)),
      opRegion: Number(arg('ns-op-region', 22)),
      entryRegion: Number(arg('ns-entry-region', 49)),
    },
  };
  const relax = (arg('relax', '') || '').split(',').filter(Boolean);
  const rep = censusRegions({ ...base, relax });

  // The relaxation ladder: one census per candidate rule, so "which decline
  // to relax first" is answered with a number instead of a ranking of decline
  // counts.  Each arm relaxes exactly ONE rule against the same dump.
  const LADDER = [
    ['test as terminator producer', ['test']],
    ['multi-entry (entry switch)', ['multi-entry']],
    ['both', ['test', 'multi-entry']],
  ];
  let ladder = null;
  if (!argv.includes('--no-ladder')) {
    ladder = LADDER.map(([name, r]) => {
      const x = censusRegions({ ...base, relax: r });
      return {
        name,
        multiOps: x.buckets[1].ops + x.buckets[2].ops,
        ceiling: x.projection.ceiling,
        ceilingMulti: x.projection.ceilingMulti,
      };
    });
  }

  if (argv.includes('--json')) {
    rep.ladder = ladder;
    const { blocks, ...rest } = rep;
    rest.declines = Object.fromEntries(rest.declines);
    rest.exitWhy = Object.fromEntries(rest.exitWhy);
    rest.regions = rest.regions.slice(0, 200).map(r => ({ ...r, nodes: r.nodes.length }));
    rest.app = app || path.basename(dumpPath);
    console.log(JSON.stringify(rest, null, 2));
    return;
  }
  report(rep, { why: argv.includes('--why'), top: parseInt(arg('top', '12'), 10) });
  if (ladder) {
    const t = rep.totals;
    console.log('');
    console.log('relaxation ladder (one rule each, same dump):');
    console.log(`  ${'baseline'.padEnd(30)} ` +
      `2+blk ops ${pct(rep.buckets[1].ops + rep.buckets[2].ops, t.opsLowerBound).padStart(6)}%  ` +
      `ceiling ${(rep.projection.ceiling * 100).toFixed(1).padStart(5)}%  ` +
      `2+blk-only ${(rep.projection.ceilingMulti * 100).toFixed(1).padStart(5)}%`);
    for (const l of ladder) {
      console.log(`  ${('+ ' + l.name).padEnd(30)} ` +
        `2+blk ops ${pct(l.multiOps, t.opsLowerBound).padStart(6)}%  ` +
        `ceiling ${(l.ceiling * 100).toFixed(1).padStart(5)}%  ` +
        `2+blk-only ${(l.ceilingMulti * 100).toFixed(1).padStart(5)}%`);
    }
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { censusRegions, uopBudget, readDump, runApp, imagesFromLog, APPS };
