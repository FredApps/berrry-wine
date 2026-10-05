#!/usr/bin/env node
// Census of multi-block loop CYCLES ("diamonds") in a PE.
//
//   node tools/find-diamonds.js <pe> [<pe>...] [--max-span=N] [--max-blocks=N]
//                               [--detail] [--skeletons=N] [--json]
//
// WHY THIS EXISTS
//
// Every loop fold in the tree is a hand-written special case for one app --
// RLE_RUN matches 1 of 287 PEs, CK_LUT puts 297 of its 613 hits in a single
// DLL -- while the regions the profiles actually name as hot are a shape no
// recognizer can see:
//
//   StarCraft  storm.dll #437/#432 span machinery   35.8% of block entries
//   Diablo     signed-RLE + clipped-row clusters    8.2% + 7.2%
//   Caesar III the RLE token ladder at 0x40f71c     (why RLE_RUN exists)
//
// `$loop_match_block` in src/07b-loop-match.wat only ever runs on a block that
// branches to ITSELF. One conditional store, sentinel test or transparent-pixel
// skip splits the body into two blocks and the loop drops off every recognizer
// we own. find-loops.js and match-loops.js classify a single self-loop block;
// find-rle-nests.js and find-ck-lut-nests.js each hand-code one specific
// multi-block shape. None of them answers the general question.
//
// This tool answers exactly one question and nothing else:
//
//   How common is the multi-block loop cycle, across the whole corpus?
//
// It is the census step of docs/diamond-loop-matcher-design.md, and it is meant
// to be able to KILL that proposal cheaply: if diamonds turn out to cluster in
// one app the way RLE_RUN did, the matcher is not worth building and we have
// spent a census instead of an implementation.
//
// WHAT IT DOES NOT TELL YOU
//
// Nothing about hotness. A shape that occurs 500 times statically and never
// runs is worth zero, and this has already cost two sessions (H455 on SimGolf;
// the 0x004c7a68 retraction in docs/re-notes/starcraft-shareware.md). Pair
// every answer here with tools/hot-loop-census.js over SEVERAL windows and
// build only against the "hot in EVERY window" list.
//
// It is also a linear sweep, so data decoded as code produces junk. A skeleton
// seen once is a lead; one seen across unrelated binaries is signal.

const fs = require('fs');
const path = require('path');
const { readPE } = require(path.join(__dirname, '..', 'lib', 'pe.js'));
const { disasmAt } = require(path.join(__dirname, 'disasm.js'));

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const flag = (n, d) => {
  const hit = args.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
// A loop body longer than this is not a candidate for a single super-op, and
// the linear decode gets less trustworthy the further it runs.
const MAX_SPAN = parseInt(flag('max-span', '160'), 10);
// The proposal's admission limit. Past this it is a region, not a diamond.
const MAX_BLOCKS = parseInt(flag('max-blocks', '4'), 10);
const DETAIL = args.includes('--detail');
const JSON_OUT = args.includes('--json');
const SKELETONS = parseInt(flag('skeletons', '0'), 10);
// Keep cycles that fail the load/store/advance heuristic, classified and
// tagged `memory:false`, rather than declining them. See the call site.
const KEEP_NOMEMORY = args.includes('--keep-nomemory');

// Importers (tools/loop-class-share.js) get scanFile without the CLI running:
// a require() with no PE arguments must not print usage and exit the caller.
if (!files.length && require.main === module) {
  console.error('usage: find-diamonds.js <pe> [<pe>...] [--max-span=N] '
    + '[--max-blocks=N] [--detail] [--skeletons=N] [--json]');
  process.exit(2);
}

// One decoded line: "0040f71c  8a 06   mov al, [esi]"
function parseLine(line) {
  return { va: parseInt(line.slice(0, 8), 16), text: line.slice(38).trim() };
}

// Backward conditional jumps: where a loop body ends. Same encodings as
// find-ck-lut-nests.js, plus the unconditional rel8/rel32 `jmp` that a latch
// block uses to get back to the head.
function backEdges(buf, sec) {
  const out = [];
  const start = sec.rawOff, end = sec.rawOff + sec.rawSize;
  for (let p = start; p < end; p++) {
    const b = buf[p];
    let rel = null, len = 0, mnem = null;
    if (b >= 0x70 && b <= 0x7f && p + 1 < end) {          // jcc rel8
      rel = (buf[p + 1] << 24) >> 24; len = 2; mnem = 'jcc';
    } else if (b === 0xeb && p + 1 < end) {               // jmp rel8
      rel = (buf[p + 1] << 24) >> 24; len = 2; mnem = 'jmp';
    } else if (b === 0xe9 && p + 4 < end) {               // jmp rel32
      rel = buf.readInt32LE(p + 1); len = 5; mnem = 'jmp';
    } else if (b === 0x0f && p + 5 < end
               && buf[p + 1] >= 0x80 && buf[p + 1] <= 0x8f) {   // jcc rel32
      rel = buf.readInt32LE(p + 2); len = 6; mnem = 'jcc';
    }
    if (rel === null || rel >= 0 || rel < -MAX_SPAN) continue;
    const tailVa = sec.va + (p - sec.rawOff);
    out.push({ tailVa, headVa: tailVa + len + rel, mnem, len });
  }
  return out;
}

// Anything that makes a cycle unfoldable. Rejecting on an unknown is the rule
// find-rle-nests.js already follows: a decoder that guesses reports shapes that
// are not there, which is worse than under-reporting.
const REJECT = [
  [/^call\b/, 'call'],
  [/^(jmp|call)\s+(dword|word)?\s*\[/, 'indirect'],
  [/^(jmp|call)\s+e[a-z]{2}$/, 'indirect'],
  [/^(ret|retn|retf|iret)\b/, 'ret'],
  [/^(rep|repne|repe)\b/, 'rep'],
  [/^(int|into|hlt|ud2|in|out)\b/, 'priv'],
  [/^\(bad\)|^\?\?/, 'baddecode'],
];

// A branch's target VA, or null when it is not a direct relative branch.
// The `short` keyword is part of the disassembler's rel8 syntax
// (`jbe short 0x15024f46`); leaving it out of this pattern makes every
// internal edge unparseable and silently reports every diamond as a self-loop.
function branchTarget(text) {
  const m = text.match(/^(?:j[a-z]{1,3}|jmp)\s+(?:short\s+)?0x([0-9a-f]+)$/);
  return m ? parseInt(m[1], 16) : null;
}
const isBranch = t => /^(j[a-z]{1,3}|jmp)\s/.test(t);

// Classify one candidate cycle: the instructions from the loop head through
// the back edge, inclusive.
function classify(insns, headVa, tailVa) {
  for (const { text } of insns) {
    for (const [re, why] of REJECT) if (re.test(text)) return { reject: why };
  }

  // Branches strictly inside the cycle. A target in (head, tail] is an INTERNAL
  // edge -- the "skip" that splits the body and hides it from Design A. A
  // target outside is a loop EXIT, which is normal and allowed.
  const internal = new Set();
  let exits = 0, indirectBr = 0;
  for (let i = 0; i < insns.length - 1; i++) {      // -1: the back edge itself
    const { text } = insns[i];
    if (!isBranch(text)) continue;
    const t = branchTarget(text);
    if (t === null) { indirectBr++; continue; }
    if (t > headVa && t <= tailVa) internal.add(t);
    else exits++;
  }
  if (indirectBr) return { reject: 'indirect' };

  // Blocks in the cycle = the head, plus one per distinct internal target.
  const blocks = 1 + internal.size;

  // Rough role hints, enough to say whether a cycle looks like a memory loop at
  // all. This is deliberately NOT the design's real role analysis -- that runs
  // on the emitted ops, not on text -- it only keeps the census from counting
  // pure control-flow cycles as blit candidates.
  const body = insns.slice(0, -1).map(i => i.text);
  const loads = body.filter(t => /^(mov|movzx|movsx|cmp|add|or|xor|and|sub)\s+[a-z]{2,3},\s*(byte|word|dword)?\s*\[/.test(t)).length;
  const stores = body.filter(t => /^mov\s+(byte|word|dword)?\s*\[/.test(t)).length;
  const advances = body.filter(t => /^(inc|dec|add|sub|lea)\s+e[a-z]{2}/.test(t)).length;

  return {
    blocks, internal: internal.size, exits, loads, stores, advances,
    insns: insns.length,
    // Three populations, and conflating the first two is a real error -- it is
    // what made COMI's 11.6%-hot blend loop at 0x40340e look like something
    // Design A already covers.
    //
    //   SELF      one block, no early exit      -- Design A CAN see this
    //   SELFEXIT  one block + a conditional exit -- Design A CANNOT: the
    //             decoder splits the block at that branch, so the head no
    //             longer branches to itself and $loop_match_block never runs
    //   DIAMOND   an internal branch splits the body
    //
    // So the population invisible to the current matcher is SELFEXIT+DIAMOND,
    // not DIAMOND alone.
    cls: blocks === 1 ? (exits ? 'SELFEXIT' : 'SELF')
      : blocks <= MAX_BLOCKS ? `DIAMOND${blocks}`
        : 'COMPLEX',
    memory: loads > 0 && stores > 0 && advances > 0,
  };
}

// A register-normalized shape string, so the same loop over different registers
// collapses to one entry across binaries.
function skeleton(insns) {
  return insns.slice(0, -1)
    .map(i => i.text
      .replace(/0x[0-9a-f]+/g, 'K')
      .replace(/\be(ax|bx|cx|dx|si|di|bp)\b/g, 'R')
      .replace(/\b(al|bl|cl|dl|ah|bh|ch|dh)\b/g, 'r8')
      .replace(/\s+/g, ' '))
    .join(' ; ');
}

function scanFile(file) {
  let pe;
  try { pe = readPE(file); } catch (e) { return { file, error: String(e.message || e) }; }
  const { buf, sections } = pe;
  const counts = {}, rejects = {}, skels = new Map(), declines = [];
  // One loop HEAD is one loop. A head is commonly reached by several back
  // edges (a nested cycle, or a second `continue` path), and counting each as
  // its own hit inflates the census several-fold -- Storm's 0x150251cb alone
  // produced three. Keep the richest cycle per head.
  const byHead = new Map();

  for (const sec of sections) {
    if (!sec.isCode || !sec.rawSize) continue;
    for (const be of backEdges(buf, sec)) {
      const off = sec.rawOff + (be.headVa - sec.va);
      if (off < sec.rawOff || off >= sec.rawOff + sec.rawSize) continue;
      let lines;
      try {
        // Decode generously, then cut at the back edge we started from.
        lines = disasmAt(buf, off, be.headVa, 64).map(parseLine);
      } catch (_) { continue; }
      const end = lines.findIndex(l => l.va === be.tailVa);
      if (end < 0) continue;                 // decode desynced past the tail
      const insns = lines.slice(0, end + 1);
      if (!insns.length) continue;

      const r = classify(insns, be.headVa, be.tailVa);
      // Declines are recorded per HEAD, not just tallied. "The hot loop is
      // absent from the listing" and "the hot loop was declined for `rep`" look
      // identical in a histogram, and only the second is actionable.
      if (r.reject) {
        rejects[r.reject] = (rejects[r.reject] || 0) + 1;
        declines.push({ headVa: be.headVa, tailVa: be.tailVa, why: r.reject });
        continue;
      }
      // The memory heuristic (a load, a store and a pointer advance) keeps the
      // STATIC census from counting pure control-flow cycles as blit
      // candidates. It is the wrong filter for the runtime join, which asks
      // whether a hot loop is structurally SELF or not -- there, a cycle
      // dropped here lands in one giant `nomemory` bucket that hides the
      // answer (79% of Caesar III's block entries, measured). --keep-nomemory
      // keeps the structural class and tags it instead.
      if (!r.memory && !KEEP_NOMEMORY) {
        rejects.nomemory = (rejects.nomemory || 0) + 1;
        declines.push({ headVa: be.headVa, tailVa: be.tailVa, why: 'nomemory' });
        continue;
      }
      const prev = byHead.get(be.headVa);
      if (!prev || r.blocks > prev.blocks) {
        byHead.set(be.headVa, { headVa: be.headVa, tailVa: be.tailVa, ...r, insnsRef: insns });
      }
    }
  }

  const hits = [];
  for (const h of byHead.values()) {
    counts[h.cls] = (counts[h.cls] || 0) + 1;
    const invisible = h.cls.startsWith('DIAMOND') || h.cls === 'SELFEXIT';
    if (invisible) {
      const s = skeleton(h.insnsRef);
      skels.set(s, (skels.get(s) || 0) + 1);
    }
    // Every class goes into --detail, not just the invisible ones. The question
    // this census has to answer is what class the HOT blocks are, and a listing
    // that omits SELF cannot tell "the hot loop is already foldable" from "the
    // hot loop is not a loop this tool recognizes at all".
    const { insnsRef, ...rest } = h;
    hits.push(rest);
  }
  hits.sort((a, b) => a.headVa - b.headVa);
  declines.sort((a, b) => a.headVa - b.headVa);
  return { file, counts, rejects, hits, skels, declines };
}

const results = require.main === module ? files.map(scanFile) : [];

if (require.main !== module) {
  // imported for scanFile; print nothing
} else if (JSON_OUT) {
  console.log(JSON.stringify(results.map(r => ({
    file: r.file, error: r.error, counts: r.counts, rejects: r.rejects,
    hits: DETAIL ? r.hits : undefined,
    declines: DETAIL ? r.declines : undefined,
    // Skeletons travel in the JSON because the question the census exists to
    // answer is cross-BINARY recurrence, and a corpus scan is several xargs
    // batches -- so the aggregation has to happen outside this process.
    skels: r.skels ? Object.fromEntries(r.skels) : undefined,
  })), null, 2));
} else {
  const W = Math.min(46, Math.max(20, ...results.map(r => path.basename(r.file).length)));
  console.log(path.basename('binary').padEnd(W)
    + '  SELF  SELFEXIT  DIAMOND  COMPLEX     INVISIBLE');
  console.log('-'.repeat(W + 46));
  let tSelf = 0, tSx = 0, tDia = 0, tCx = 0, withDia = 0;
  for (const r of results) {
    if (r.error) { console.log(path.basename(r.file).padEnd(W) + '  ' + r.error); continue; }
    const self = r.counts.SELF || 0;
    const sx = r.counts.SELFEXIT || 0;
    const dia = Object.entries(r.counts).filter(([k]) => k.startsWith('DIAMOND'))
      .reduce((a, [, v]) => a + v, 0);
    const cx = r.counts.COMPLEX || 0;
    tSelf += self; tSx += sx; tDia += dia; tCx += cx; if (dia + sx) withDia++;
    if (self + sx + dia + cx === 0) continue;
    const inv = sx + dia, tot = self + sx + dia;
    console.log(path.basename(r.file).padEnd(W)
      + String(self).padStart(6) + String(sx).padStart(10) + String(dia).padStart(9)
      + String(cx).padStart(9)
      + `     ${inv}/${tot} (${tot ? (100 * inv / tot).toFixed(0) : 0}%)`.padStart(14));
    if (DETAIL) {
      for (const h of r.hits.slice(0, 12)) {
        console.log(`    ${h.cls} 0x${h.headVa.toString(16)}..0x${h.tailVa.toString(16)}`
          + ` blocks=${h.blocks} exits=${h.exits} ld=${h.loads} st=${h.stores} adv=${h.advances}`);
      }
    }
  }
  console.log('-'.repeat(W + 46));
  const tInv = tSx + tDia, tAll = tSelf + tSx + tDia;
  console.log('total'.padEnd(W) + String(tSelf).padStart(6)
    + String(tSx).padStart(10) + String(tDia).padStart(9) + String(tCx).padStart(9)
    + `     ${tInv}/${tAll} (${tAll ? (100 * tInv / tAll).toFixed(0) : 0}%)`.padStart(14));
  console.log(`files scanned ${results.length}, carrying an invisible loop: ${withDia}`);
  console.log('INVISIBLE = SELFEXIT + DIAMOND: loops the current self-loop'
    + ' matcher cannot see, because the decoder splits the block at the branch.');
  console.log('Static reach only. A shape that never RUNS is worth zero --'
    + ' pair with tools/hot-loop-census.js over several windows.');

  if (SKELETONS) {
    const all = new Map();
    for (const r of results) for (const [s, n] of (r.skels || new Map())) {
      const e = all.get(s) || { n: 0, files: new Set() };
      e.n += n; e.files.add(path.basename(r.file)); all.set(s, e);
    }
    console.log(`\nTop diamond skeletons (a shape in MANY binaries is the signal):`);
    [...all.entries()].sort((a, b) => b[1].files.size - a[1].files.size || b[1].n - a[1].n)
      .slice(0, SKELETONS)
      .forEach(([s, e]) => console.log(`  ${e.files.size} files, ${e.n}x  ${s.slice(0, 110)}`));
  }
}

module.exports = { scanFile, classify, skeleton };
