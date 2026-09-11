#!/usr/bin/env node
// tree-shape-census.js — how many FUSED MICRO-OP handlers would cover most of
// the TREE_FOLD mass?
//
// tl;dr of what this script does, and why it exists
// ------------------------------------------------
// Handler 454 (`$th_tree_fold`, src/07b-loop-match.wat) folds a whole self-loop
// into ONE generic descriptor interpreter: per micro-op it pays five descriptor
// loads, a kind br_table and two register br_tables. Measured, that wins
// +23-33% on 6-11-op bodies and LOSES 12-18% on mw3's 42-op alpha blend — the
// per-micro-op interpretation tax eventually exceeds the one-block-transfer
// saving. The alternative is a fixed vocabulary of hand-written
// superinstructions, each covering one recurring SUBTREE shape
// (`load16 -> and imm -> shr imm -> add`, `lea -> load32 -> store32`, ...),
// matched at decode time, each a specialized wasm function with no descriptor
// decode at all.
//
// Whether that is worth building is one number: how much of the executed
// micro-op mass a SMALL vocabulary covers. This tool measures it.
//
//   1. Input is the emulator's own classification, not a disassembly. Run:
//        node test/run.js --app=ID ... --tree-fold --trace-tree-fold \
//             --handler-hist --handler-hist-thread=0 --hot-block-dump=HOT
//      `--trace-tree-fold` dumps, per LOWERED block, its entry EIP, terminator
//      and the six descriptor words of every micro-op, through the same
//      log_i32 channel `--trace-loopmatch` uses. The micro-op classification
//      exists nowhere else — a static disassembly cannot reproduce it.
//   2. Every block is weighted by its hit count from the hot-block dump, joined
//      by entry EIP, exactly as tools/expr-fold-census.js weights its blocks.
//      CAVEAT, and it is a real one: with the fold armed, a hot-block hit is
//      one ENTRY to the folded block, i.e. one whole loop RUN, not one
//      iteration. Trip counts differ between blocks, so a long-running loop is
//      under-weighted relative to a short one. The shares below are therefore
//      per-run-weighted; --static reports the unweighted shape census as the
//      other bracket.
//   3. Each tree is normalized to a dataflow graph: registers renamed by first
//      appearance (r0, r1, ...), immediates abstracted to `i` EXCEPT shift
//      counts (kept: `shr#8`) and AND masks (kept as classes: m8, m16, mhi8,
//      mlo<n>, ...), displacements abstracted to present/absent.
//   4. Candidate shapes are connected runs of 2..K consecutive micro-ops
//      (`--k`). Consecutive, because a fused handler executes its ops in
//      source order — fusing non-adjacent ops is a reordering and would need
//      an alias/flag argument this census does not get to assume.
//      `--allow-gaps` drops that and reports the looser bound.
//   5. Coverage: shapes are ranked by the hit-weighted ops each one alone would
//      tile, the top N are taken (N = --n), and every tree is then tiled
//      greedily largest-shape-first, non-overlapping. Reported per N: covered
//      share of matched-tree ops, residual left per-op, and mean fused ops per
//      tree after tiling vs micro-ops before — that ratio IS the dispatch
//      reduction a fixed vocabulary buys.
//
// Usage:
//   node tools/tree-shape-census.js \
//        --app=mw3:/tmp/mw3-run.log:/tmp/mw3-hot.txt \
//        --app=quake2:/tmp/q2-run.log:/tmp/q2-hot.txt \
//        [--k=2,3,4,6] [--n=4,8,16,32] [--top=32] [--allow-gaps] [--json=OUT]
//
// Importable: require('./tree-shape-census') gives { parseTrace, buildTree,
// enumerateShapes, censusApp, censusApps }.

'use strict';

const fs = require('fs');
const readline = require('readline');

// ----------------------------------------------------------------- micro-ops
// Mirrors the $TU_* constants in src/07b-loop-match.wat. A kind added there and
// not here shows up as `kind<N>` in a skeleton rather than as a silent wrong
// answer, which is why the fallback is explicit.
const KINDS = {
  0: 'mov', 1: 'movi', 2: 'lea', 3: 'add', 4: 'addi', 5: 'sub', 6: 'subi',
  7: 'and', 8: 'andi', 9: 'or', 10: 'ori', 11: 'xor', 12: 'xori',
  13: 'inc', 14: 'dec', 15: 'neg', 16: 'not', 17: 'shift',
  18: 'imul', 19: 'imuli', 20: 'ld32', 21: 'st32', 22: 'ld32abs', 23: 'st32abs',
  24: 'movsub', 25: 'movsubi', 26: 'alusub', 27: 'alusubi',
  28: 'ld8', 29: 'st8', 30: 'ld8abs', 31: 'st8abs',
  32: 'movzx8', 33: 'movsx8',
  34: 'lea_sib', 35: 'ld32_sib', 36: 'st32_sib', 37: 'movsx8_sib',
  38: 'st8_sib', 39: 'movi8_sib', 40: 'ld16abs', 41: 'ld16', 42: 'st16',
};
const MAX_KIND = 42;

// $TU_B_* bit layout.
const B_LANE_D = 0x40, B_LANE_A = 0x80, B_ALU_SHIFT = 8;
const B_WORD = 0x1000, B_NOFLAGS = 0x2000;

// x86 group-1 ALU sub-op numbering, as $do_alu_sized reads it.
const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
// The shift/rotate type field of handler 53.
const SHIFT = { 0: 'rol', 1: 'ror', 4: 'shl', 5: 'shr', 6: 'sal', 7: 'sar' };

// Which kinds write flags at all (the rest are flag-blind by construction:
// mov/lea/not/loads/stores). Used only to decide whether a skeleton carries the
// `!f` marker, which is load-bearing for a fused handler: an op whose flags are
// live must still publish them, and that is most of what a fused arm costs.
const FLAG_KINDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 26, 27]);

// ------------------------------------------------------------- trace parsing
const MARKER = 0x100c0000;

// Turn a run.js log into tree records. The channel is a flat [i32] word stream
// (a decode-time WAT function has no other), so a record is found by its marker
// and then read by length: 7 header words, then 6 per micro-op.
async function parseTrace(logPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath), crlfDelay: Infinity,
  });
  const trees = [];
  let pending = null;   // { words: [], need: n } while a record is being read
  for await (const line of rl) {
    const m = /^\[i32\] (0x[0-9a-f]+)/.exec(line);
    if (!m) continue;
    const w = parseInt(m[1], 16) >>> 0;
    if (pending === null) {
      if (w === MARKER) pending = { words: [], need: 7, header: false };
      continue;
    }
    pending.words.push(w);
    if (pending.words.length < pending.need) continue;
    if (!pending.header) {
      const nuops = pending.words[1] | 0;
      if (nuops < 1 || nuops > 64) { pending = null; continue; }  // not ours
      pending.header = true;
      pending.need = 7 + nuops * 6;
      if (pending.words.length < pending.need) continue;
    }
    const t = recordToTree(pending.words);
    if (t) trees.push(t);
    pending = null;
  }
  return trees;
}

function recordToTree(w) {
  const eip = w[0] >>> 0, nuops = w[1] | 0;
  const uops = [];
  for (let i = 0; i < nuops; i++) {
    const o = 7 + i * 6;
    const kind = w[o] | 0;
    if (kind < 0 || kind > MAX_KIND) return null;   // a foreign log_i32 word
    uops.push({
      kind, d: w[o + 1] | 0, a: w[o + 2] | 0, imm: w[o + 3] | 0,
      fn: w[o + 4] | 0, b: w[o + 5] | 0,
    });
  }
  return {
    eip, nuops, termPos: w[2] | 0, termKind: w[3] | 0,
    termA: w[4] | 0, termB: w[5] | 0, termCc: w[6] | 0, uops,
  };
}

// ------------------------------------------------------------- normalization
function maskClass(imm) {
  const v = imm >>> 0;
  if (v === 0xff) return 'm8';
  if (v === 0xffff) return 'm16';
  if (v === 0xff00) return 'mhi8';
  if (v === 0xffff0000) return 'mhi16';
  if (v === 0xffffff00) return 'mnot8';
  if (v === 0xffff00ff) return 'mnot8hi';
  // A low-bit mask (2^n - 1) is the table-index idiom and worth its own class.
  if (v !== 0 && ((v + 1) & v) === 0) return `mlo${(32 - Math.clz32(v))}`;
  return 'm';
}

// Which value sources a micro-op reads, and whether it defines a register.
// `d` appears among the reads of every read-modify-write and of every PARTIAL
// write, because the untouched lanes of the destination are a genuine input.
function uopInfo(u) {
  const k = u.kind;
  const idx = (u.b & 0xF) === 0xF ? null : (u.b & 0xF);   // SIB index register
  const R = [];                                            // register reads
  let def = null;                                          // register defined
  let mem = 0;                                             // 1 load, 2 store
  switch (k) {
    case 0: R.push(u.a); def = u.d; break;                       // mov r,r
    case 1: def = u.d; break;                                    // mov r,imm
    case 2: R.push(u.a); def = u.d; break;                       // lea r,[r+d]
    case 3: case 5: case 7: case 9: case 11: case 18:            // alu r,r
      R.push(u.d, u.a); def = u.d; break;
    case 4: case 6: case 8: case 10: case 12:                    // alu r,imm
    case 13: case 14: case 15: case 16: case 17:                 // inc/dec/neg/not/shift
      R.push(u.d); def = u.d; break;
    case 19: R.push(u.a); def = u.d; break;                      // imul r,r,imm
    case 20: R.push(u.a); def = u.d; mem = 1; break;             // load32 [r+d]
    case 21: R.push(u.a, u.d); mem = 2; break;                   // store32
    case 22: def = u.d; mem = 1; break;                          // load32 [abs]
    case 23: R.push(u.d); mem = 2; break;                        // store32 [abs]
    case 24: R.push(u.d, u.a); def = u.d; break;                 // mov sub,sub
    case 25: R.push(u.d); def = u.d; break;                      // mov sub,imm
    case 26: R.push(u.d, u.a); def = u.d; break;                 // alu sub,sub
    case 27: R.push(u.d); def = u.d; break;                      // alu sub,imm
    case 28: R.push(u.a, u.d); def = u.d; mem = 1; break;        // load8 -> lane
    case 29: R.push(u.a, u.d); mem = 2; break;                   // store8
    case 30: R.push(u.d); def = u.d; mem = 1; break;             // load8 [abs]
    case 31: R.push(u.d); mem = 2; break;                        // store8 [abs]
    case 32: case 33: R.push(u.a); def = u.d; mem = 1; break;    // movzx/movsx8
    case 34: R.push(u.a); if (idx !== null) R.push(idx); def = u.d; break;
    case 35: R.push(u.a); if (idx !== null) R.push(idx); def = u.d; mem = 1; break;
    case 36: R.push(u.a); if (idx !== null) R.push(idx); R.push(u.d); mem = 2; break;
    case 37: R.push(u.a); if (idx !== null) R.push(idx); def = u.d; mem = 1; break;
    case 38: R.push(u.a); if (idx !== null) R.push(idx); R.push(u.d); mem = 2; break;
    case 39: R.push(u.a); if (idx !== null) R.push(idx); mem = 2; break;
    case 40: R.push(u.d); def = u.d; mem = 1; break;             // load16 [abs]
    case 41: R.push(u.a, u.d); def = u.d; mem = 1; break;        // load16 [r+d]
    case 42: R.push(u.a, u.d); mem = 2; break;                   // store16
    default: break;
  }
  return { reads: R, def, mem };
}

// The op's label, in x86 terms, with the immediate classes the brief keeps.
function uopLabel(u) {
  const k = u.kind;
  let s = KINDS[k] || `kind${k}`;
  if (k === 17) s = `${SHIFT[u.a] || 'sh' + u.a}#${u.imm}`;
  if (k === 8 || k === 7) s = k === 8 ? `andi#${maskClass(u.imm)}` : 'and';
  if (k === 26 || k === 27) {
    const w = (u.b & B_WORD) ? 'w' : 'b';
    s = `${ALU[(u.b >>> B_ALU_SHIFT) & 0xF] || 'alu'}${k === 27 ? 'i' : ''}.${w}`;
    if (k === 27 && ((u.b >>> B_ALU_SHIFT) & 0xF) === 4) s += `#${maskClass(u.imm)}`;
  }
  if (k === 24 || k === 25) s += (u.b & B_WORD) ? '.w' : '.b';
  if (k === 28 || k === 29) s += (u.b & (B_LANE_D | B_LANE_A)) ? '.hi' : '';
  // Displacement present or absent is a real difference in a fused arm's
  // address arithmetic; its VALUE is not.
  if ([2, 20, 21, 28, 29, 32, 33, 41, 42].includes(k)) s += u.imm ? '+d' : '';
  if (FLAG_KINDS.has(k) && !(u.b & B_NOFLAGS)) s += '!f';
  return s;
}

// Build the block's dataflow graph: per micro-op, its operand sources as either
// {t:'node', i} (produced earlier in this block) or {t:'reg', r} (live in, or
// produced too far back for the shape under test).
function buildTree(tree) {
  const defOf = new Map();     // reg -> node index of its last def
  const nodes = [];
  for (let i = 0; i < tree.uops.length; i++) {
    const u = tree.uops[i];
    const info = uopInfo(u);
    const srcs = info.reads.map(r =>
      defOf.has(r) ? { t: 'node', i: defOf.get(r), r } : { t: 'reg', r });
    nodes.push({ i, u, label: uopLabel(u), srcs, def: info.def, mem: info.mem });
    if (info.def !== null) defOf.set(info.def, i);
  }
  // Consumer count per node, so a shape can tell an intermediate that dies
  // inside it from one somebody else still reads.
  for (const n of nodes) n.uses = 0;
  for (const n of nodes) for (const s of n.srcs) if (s.t === 'node') nodes[s.i].uses++;
  return { ...tree, nodes };
}

// -------------------------------------------------------------- skeletonizer
// Canonical string for a run of consecutive nodes [lo, hi). Registers are
// renamed by first appearance inside the run, values produced inside it are
// %relative-index, so the same shape over different registers collapses to one
// string. Returns null when the run is not dataflow-connected (no value flows
// between its ops) unless allowGaps.
function skeletonOf(nodes, lo, hi, allowGaps) {
  const regName = new Map();
  const nameReg = r => {
    if (!regName.has(r)) regName.set(r, `r${regName.size}`);
    return regName.get(r);
  };
  let internalEdges = 0;
  const parts = [];
  for (let i = lo; i < hi; i++) {
    const n = nodes[i];
    const ops = n.srcs.map(s => {
      if (s.t === 'node' && s.i >= lo && s.i < hi) { internalEdges++; return `%${s.i - lo}`; }
      return nameReg(s.r);
    });
    parts.push(`${n.label}(${ops.join(',')})`);
  }
  if (!allowGaps && internalEdges === 0 && hi - lo > 1) return null;
  return parts.join(';');
}

// Every candidate shape in a tree: each connected run of 2..K consecutive ops.
function enumerateShapes(tree, K, allowGaps) {
  const out = [];   // { lo, size, skel }
  const n = tree.nodes.length;
  for (let lo = 0; lo < n; lo++) {
    for (let size = 2; size <= K && lo + size <= n; size++) {
      const skel = skeletonOf(tree.nodes, lo, lo + size, allowGaps);
      if (skel === null) continue;
      out.push({ lo, size, skel });
    }
  }
  return out;
}

// Greedy non-overlapping tiling of one tree by a set of skeletons, largest
// shape first. Returns { covered, tiles }.
function tileTree(tree, shapes, chosen) {
  const n = tree.nodes.length;
  const claimed = new Array(n).fill(false);
  let covered = 0, tiles = 0;
  // Callers pass an already size-sorted list (see censusApp) to keep the
  // ranking pass, which tiles every tree once per distinct skeleton, linear.
  const bySize = shapes.sorted ? shapes
    : shapes.slice().sort((a, b) => b.size - a.size || a.lo - b.lo);
  for (const s of bySize) {
    if (!chosen.has(s.skel)) continue;
    let free = true;
    for (let i = s.lo; i < s.lo + s.size; i++) if (claimed[i]) { free = false; break; }
    if (!free) continue;
    for (let i = s.lo; i < s.lo + s.size; i++) claimed[i] = true;
    covered += s.size; tiles++;
  }
  return { covered, tiles };
}

// ------------------------------------------------------------------- census
function readHotDump(p) {
  const hits = new Map();
  if (!p) return hits;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^(0x[0-9a-fA-F]+)\s+(\d+)/.exec(line.trim());
    if (m) hits.set(parseInt(m[1], 16) >>> 0, (hits.get(parseInt(m[1], 16) >>> 0) || 0) + Number(m[2]));
  }
  return hits;
}

// One app: trees (deduped by entry EIP), weights, and the coverage curve for
// each K in Ks and each N in Ns.
function censusApp(label, rawTrees, hits, opts) {
  const { Ks, Ns, top, allowGaps } = opts;
  const byEip = new Map();
  let lowerings = 0;
  for (const t of rawTrees) {
    lowerings++;
    if (!byEip.has(t.eip)) byEip.set(t.eip, buildTree(t));
  }
  const trees = [...byEip.values()].map(t => ({ ...t, w: hits.get(t.eip) || 0 }));
  const weighted = trees.filter(t => t.w > 0);
  const totalOpsW = weighted.reduce((s, t) => s + t.w * t.nodes.length, 0);
  const totalOpsS = trees.reduce((s, t) => s + t.nodes.length, 0);

  const perK = [];
  for (const K of Ks) {
    const shapesPer = new Map();       // tree -> shapes
    const score = new Map();           // skel -> weighted ops it alone tiles
    const scoreS = new Map();          // same, unweighted
    const appsOf = new Map();          // skel -> set of apps it occurs in
    for (const t of trees) {
      const sh = enumerateShapes(t, K, allowGaps);
      sh.sort((a, b) => b.size - a.size || a.lo - b.lo);
      sh.sorted = true;
      shapesPer.set(t, sh);
      const skels = new Set(sh.map(s => s.skel));
      for (const sk of skels) {
        // Which apps a shape occurs in AT ALL. This is the question a fixed
        // vocabulary lives or dies on: a shape that earns its weight in one
        // app only is a transcription of that app's loop, not a primitive.
        if (t.app) {
          if (!appsOf.has(sk)) appsOf.set(sk, new Set());
          appsOf.get(sk).add(t.app);
        }
        const { covered } = tileTree(t, sh, new Set([sk]));
        if (!covered) continue;
        score.set(sk, (score.get(sk) || 0) + covered * t.w);
        scoreS.set(sk, (scoreS.get(sk) || 0) + covered);
      }
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
    const rankedS = [...scoreS.entries()].sort((a, b) => b[1] - a[1]);

    // Vocabulary selection is MARGINAL-gain greedy, not top-N-by-own-weight.
    // The two differ a lot here and the difference is not a detail: the
    // candidate shapes are overlapping windows of the same hot loop, so the
    // top few by standalone weight are near-duplicates that tile the same ops
    // and the second slot buys almost nothing. Greedy picks the shape that
    // covers the most ops the already-chosen vocabulary does NOT.
    const cands = ranked.slice(0, opts.cand).map(e => e[0]);
    const candsS = rankedS.slice(0, opts.cand).map(e => e[0]);
    const maxN = Math.max(...Ns);
    const tileAll = (chosen, useW) => {
      let cov = 0, after = 0;
      for (const t of trees) {
        const w = useW ? t.w : 1;
        if (useW && !w) continue;
        const r = tileTree(t, shapesPer.get(t), chosen);
        cov += r.covered * w;
        after += (r.tiles + (t.nodes.length - r.covered)) * w;
      }
      return { cov, after };
    };
    const greedy = (pool, useW) => {
      const chosen = new Set();
      const order = [];
      let best = tileAll(chosen, useW);
      while (order.length < maxN) {
        let bestSk = null, bestRes = null;
        for (const sk of pool) {
          if (chosen.has(sk)) continue;
          chosen.add(sk);
          const r = tileAll(chosen, useW);
          chosen.delete(sk);
          if (r.cov > (bestRes ? bestRes.cov : best.cov)) { bestSk = sk; bestRes = r; }
        }
        if (!bestSk) break;
        chosen.add(bestSk); order.push({ skel: bestSk, ...bestRes });
        best = bestRes;
      }
      return order;
    };
    const orderW = greedy(cands, true);
    const orderS = greedy(candsS, false);

    const curve = [];
    for (const N of Ns) {
      const w = orderW[Math.min(N, orderW.length) - 1] || { cov: 0, after: totalOpsW };
      const s = orderS[Math.min(N, orderS.length) - 1] || { cov: 0, after: totalOpsS };
      curve.push({
        n: N,
        coverW: totalOpsW ? w.cov / totalOpsW : 0,
        coverS: totalOpsS ? s.cov / totalOpsS : 0,
        opsBeforeW: totalOpsW, opsAfterW: w.after,
        opsBeforeS: totalOpsS, opsAfterS: s.after,
        dispatchRatioW: w.after ? totalOpsW / w.after : 0,
        dispatchRatioS: s.after ? totalOpsS / s.after : 0,
        vocabulary: orderW.slice(0, N).map(e => e.skel),
      });
    }
    perK.push({
      k: K, curve,
      greedy: orderW.map((e, i) => ({
        skel: e.skel,
        cumCover: totalOpsW ? e.cov / totalOpsW : 0,
        gain: totalOpsW
          ? (e.cov - (i ? orderW[i - 1].cov : 0)) / totalOpsW : 0,
        apps: appsOf.has(e.skel) ? [...appsOf.get(e.skel)] : [],
      })),
      pooled: appsOf.size > 0,
      shared: [...appsOf.entries()].filter(([, s]) => s.size > 1)
        .map(([skel, s]) => ({ skel, apps: [...s] })),
      distinctShapes: score.size,
      top: ranked.slice(0, top).map(([skel, w]) => ({
        skel, weight: w, share: totalOpsW ? w / totalOpsW : 0,
        staticWeight: scoreS.get(skel) || 0,
      })),
    });
  }

  return {
    label, lowerings, trees: trees.length, weightedTrees: weighted.length,
    totalOpsW, totalOpsS,
    meanUopsW: totalOpsW && weighted.length
      ? totalOpsW / weighted.reduce((s, t) => s + t.w, 0) : 0,
    meanUopsS: trees.length ? totalOpsS / trees.length : 0,
    perK,
  };
}

// Pooled census: all apps' trees in one bag, each app's weights as given. An
// app whose blocks run a hundred times more often dominates, which is honest —
// a shared vocabulary is paid for once and spent where the work is.
function censusApps(apps, opts) {
  const all = [];
  const hits = new Map();
  for (const a of apps) {
    for (const t of a.rawTrees) {
      // EIPs collide across apps (same image bases), so namespace them.
      const key = `${a.label}:${t.eip}`;
      all.push({ ...t, eip: key, app: a.label });
      if (!hits.has(key)) hits.set(key, a.hits.get(t.eip) || 0);
    }
  }
  return censusApp('POOLED', all, hits, opts);
}

// ------------------------------------------------------------------ reporting
function pct(x) { return (x * 100).toFixed(1) + '%'; }

function report(c, opts, out) {
  out.push('');
  out.push(`## ${c.label}`);
  out.push(`trees ${c.trees} (${c.weightedTrees} with hits), lowerings ${c.lowerings}, ` +
           `micro-ops static ${c.totalOpsS}, hit-weighted ${c.totalOpsW}`);
  out.push(`mean micro-ops/tree: static ${c.meanUopsS.toFixed(1)}, weighted ${c.meanUopsW.toFixed(1)}`);
  for (const k of c.perK) {
    out.push('');
    out.push(`### K=${k.k}`);
    out.push('| N shapes | covered (weighted) | covered (static) | fused ops/tree after | dispatch ratio |');
    out.push('|---|---|---|---|---|');
    for (const p of k.curve) {
      const after = c.weightedTrees && p.opsAfterW
        ? (p.opsAfterW / c.totalOpsW * c.meanUopsW) : 0;
      out.push(`| ${p.n} | ${pct(p.coverW)} | ${pct(p.coverS)} | ` +
               `${after.toFixed(2)} of ${c.meanUopsW.toFixed(2)} | ` +
               `${p.dispatchRatioW.toFixed(2)}x |`);
    }
    out.push('');
    out.push(`distinct skeletons: ${k.distinctShapes}` +
      (k.pooled ? `, shared by >1 app: ${k.shared.length}` : ''));
    for (const s of (k.pooled ? k.shared.slice(0, 5) : [])) {
      out.push(`  shared [${s.apps.join('+')}] ${s.skel}`);
    }
    out.push(`greedy vocabulary (pick order; cumulative / marginal coverage):`);
    k.greedy.slice(0, opts.top).forEach((s, i) => out.push(
      `  ${String(i + 1).padStart(2)}. ${pct(s.cumCover).padStart(6)} ` +
      `(+${pct(s.gain).padStart(5)})  ${s.apps.length ? '[' + s.apps.join('+') + '] ' : ''}${s.skel}`));
    out.push('');
    out.push(`top ${Math.min(opts.top, k.top.length)} skeletons by standalone weight:`);
    k.top.forEach((s, i) => out.push(
      `  ${String(i + 1).padStart(2)}. ${pct(s.share).padStart(6)}  ${s.skel}`));
  }
}

// ---------------------------------------------------------------------- main
async function main() {
  const argv = process.argv.slice(2);
  const getAll = n => argv.filter(a => a.startsWith(`--${n}=`)).map(a => a.slice(n.length + 3));
  const getArg = (n, d) => { const v = getAll(n); return v.length ? v[v.length - 1] : d; };
  const specs = getAll('app');
  if (!specs.length) {
    console.error('usage: node tools/tree-shape-census.js --app=LABEL:TRACELOG:HOTDUMP [--app=...]');
    console.error('       [--k=2,3,4,6] [--n=4,8,16,32] [--top=32] [--allow-gaps] [--json=OUT]');
    process.exit(2);
  }
  const opts = {
    Ks: getArg('k', '2,3,4,6').split(',').map(Number),
    Ns: getArg('n', '4,8,16,32').split(',').map(Number),
    top: parseInt(getArg('top', '32'), 10),
    // How many candidate skeletons the greedy vocabulary search considers, by
    // standalone weight. The search is O(rounds x candidates x trees), so this
    // is the only knob between "exhaustive" and "finishes".
    cand: parseInt(getArg('cand', '300'), 10),
    allowGaps: argv.includes('--allow-gaps'),
  };

  const apps = [];
  for (const spec of specs) {
    const parts = spec.split(':');
    const label = parts[0], log = parts[1], dump = parts[2];
    const rawTrees = await parseTrace(log);
    apps.push({ label, rawTrees, hits: readHotDump(dump) });
    console.error(`[${label}] ${rawTrees.length} lowering records from ${log}`);
  }

  const out = [];
  out.push(`# tree-shape census (K=${opts.Ks.join(',')}, ` +
           `N=${opts.Ns.join(',')}, ${opts.allowGaps ? 'gaps allowed' : 'consecutive runs only'})`);
  const results = [];
  for (const a of apps) {
    const c = censusApp(a.label, a.rawTrees, a.hits, opts);
    results.push(c); report(c, opts, out);
  }
  if (apps.length > 1) {
    const c = censusApps(apps, opts);
    results.push(c); report(c, opts, out);
  }
  console.log(out.join('\n'));
  const jsonOut = getArg('json', null);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
}

module.exports = {
  parseTrace, buildTree, enumerateShapes, skeletonOf, tileTree,
  censusApp, censusApps, uopLabel, uopInfo,
};

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
