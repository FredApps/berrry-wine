#!/usr/bin/env node
'use strict';

// Section 4c: for every hot block of a window, decide which of its x87
// instructions the semantic x87 fold (H449-H453, src/07b-loop-match.wat) can
// take and — for the ones it cannot — WHICH RULE stops it.
//
//   node docs/hot-loop-vocabulary-2026-09/x87-classify.js <corpusDir> [--top=N]
//
// where <corpusDir> is a directory written by
// `tools/hot-loop-corpus.js win98 --out=DIR --app=WINDOW`, i.e. one .asm per
// hot block plus index.json with each block's entry count.
//
// WHY STATIC, WHEN THE A/B ALREADY MEASURES THE SHARE. The two --x87-fusion
// arms say how many x87 dispatches the fold absorbed; they cannot say why the
// rest stayed, because the decline happens inside the decoder and nothing is
// counted there per reason. This applies the same grammar to a disassembly of
// the blocks that actually ran, weighted by their entry counts, so the answer
// is a ranked work list rather than a residue.
//
// THE GRAMMAR, AS src/07-decoder.wat EMITS IT AND src/07b-loop-match.wat READS
// IT. An x87 instruction becomes exactly one of three handlers:
//   mod==3 (register form)            -> H189
//   [base(+disp)] , base any reg      -> H190   ($mr_simple_base)
//   [disp32] absolute                 -> H188
//   [base+index*s(+disp)]             -> H149 (compute SIB EA) THEN H188
// and FNSTSW AX is either folded with its TEST AH/Jcc into H439 (which ends
// the block) or emitted separately — never one of the three.
//
// H451 (the island, the only general family) takes a maximal run of >= 3
// CONSECUTIVE H188/H189/H190, and rejects an H188 whose address came from a
// SIB EA unless it is the first op of the run. So an x87 op is declined when
// its run is shorter than three, and the reason is whatever broke the run:
// an integer instruction, a SIB-addressed x87, an FNSTSW, or the block end.
//
// H449/H450/H452/H453 are shape-specific prefixes of that same op stream and
// are counted here only as "would also have matched", because they run first;
// the caught/declined verdict is the island's, which is the general case.

const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const dir = ARGV.find(a => !a.startsWith('--'));
const arg = (k, d) => {
  const hit = ARGV.find(a => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
if (!dir) {
  console.error('usage: x87-classify.js <corpusDir> [--top=N] [--json=FILE]');
  process.exit(2);
}
const TOP = Number(arg('top', 20));

// Every x87 mnemonic our disassembler prints. FWAIT emits no threaded op at
// all, so it neither counts nor breaks a run; everything else here does.
const X87 = /^f(abs|add|addp|bld|bstp|chs|clex|com|comp|compp|cos|decstp|div|divp|divr|divrp|free|iadd|icom|icomp|idiv|idivr|ild|imul|incstp|init|ist|istp|isub|isubr|ld|ld1|ldcw|ldenv|ldl2e|ldl2t|ldlg2|ldln2|ldpi|ldz|mul|mulp|nclex|ninit|nop|nsave|nstcw|nstenv|nstsw|patan|prem|prem1|ptan|rndint|restore|rstor|save|scale|sin|sincos|sqrt|st|stcw|stenv|stp|stsw|sub|subp|subr|subrp|tst|ucom|ucomp|ucompp|xam|xch|xtract|yl2x|yl2xp1|2xm1)$/;

function classifyOperand(text) {
  const mem = /\[([^\]]+)\]/.exec(text);
  if (!mem) return 'H189';                       // register form
  const inner = mem[1];
  if (/\*/.test(inner)) return 'SIB';            // index register present
  if (/^0x[0-9a-f]+$/i.test(inner.trim())) return 'H188';  // absolute
  return 'H190';                                 // base (+disp)
}

// One parsed instruction: { va, mnem, text, kind }
// kind: 'x87' (with handler), 'fnstsw', 'int', 'fwait'
function parseAsm(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line.startsWith(';')) continue;
    const m = /^([0-9a-f]{8})\s+((?:[0-9a-f]{2} )+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[3].trim();
    const mnem = text.split(/\s+/)[0];
    // 0x9B is FWAIT. tools/disasm.js prints it as `db 0x9b`, and the decoder
    // emits NOTHING for it (src/07-decoder.wat: "FWAIT -- NOP"), so counting
    // it as an integer instruction would charge a false decline to every
    // MSVC _ftol helper in the corpus -- 182,194 entries of quake2's alone.
    if (mnem === 'fwait' || mnem === 'wait' || /^db 0x9b$/.test(text)) {
      out.push({ va: m[1], mnem: 'fwait', text, kind: 'fwait' });
      continue;
    }
    if (mnem === 'fnstsw' || mnem === 'fstsw') {
      const h = classifyOperand(text);
      // FNSTSW AX is the register form and is NOT H189 -- it is H439 or its
      // own handler. FNSTSW to memory is an ordinary H188/H190.
      if (h === 'H189') { out.push({ va: m[1], mnem, text, kind: 'fnstsw' }); continue; }
      out.push({ va: m[1], mnem, text, kind: 'x87', handler: h }); continue;
    }
    if (X87.test(mnem)) {
      out.push({ va: m[1], mnem, text, kind: 'x87', handler: classifyOperand(text) });
      continue;
    }
    out.push({ va: m[1], mnem, text, kind: 'int' });
  }
  return out;
}

// Apply the island's run rule to one block's instruction list. Returns
// { caught, declined: {reason: count}, runs: [len...] } in INSTRUCTIONS.
function classifyBlock(ins, breakers) {
  const declined = {};
  let caught = 0;
  const runs = [];
  const note = (m, n) => { if (breakers) breakers[m] = (breakers[m] || 0) + n; };
  let i = 0;
  const bump = (r, n) => { declined[r] = (declined[r] || 0) + n; };
  while (i < ins.length) {
    if (ins[i].kind !== 'x87') { i++; continue; }
    // Grow a run under the island's rules.
    const start = i;
    let j = i;
    let breaker = null;
    let breakMnem = null;
    while (j < ins.length) {
      const op = ins[j];
      if (op.kind === 'fwait') { j++; continue; }
      if (op.kind !== 'x87') {
        breaker = op.kind === 'fnstsw' ? 'fnstsw-ax' : 'integer-op';
        breakMnem = op.mnem;
        break;
      }
      if (op.handler === 'SIB') {
        if (j === start) { j++; continue; }   // allowed as the first op only
        breaker = 'sib-operand';
        breakMnem = op.mnem + ' [sib]';
        break;
      }
      j++;
    }
    const len = ins.slice(start, j).filter(o => o.kind === 'x87').length;
    runs.push(len);
    if (len >= 3) {
      caught += len;
    } else {
      // A run of one or two: charged to whatever ended it. A run that reached
      // the end of the block was ended by the block's terminator.
      bump(breaker || 'block-end', len);
      note(breakMnem || '(block end)', len);
    }
    i = Math.max(j, start + 1);
  }
  return { caught, declined, runs };
}

const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const rows = [];
const totals = { entries: 0, x87Entries: 0, caught: 0, declined: {}, blocks: 0,
  x87Blocks: 0, x87BlockRetired: 0, rankedRetired: 0, breakers: {}, sibX87: 0 };
for (const b of index.blocks) {
  const file = path.join(dir, b.id + '.asm');
  if (!fs.existsSync(file)) continue;
  const ins = parseAsm(file);
  const n = ins.filter(o => o.kind === 'x87').length;
  totals.blocks++;
  totals.entries += b.entries;
  totals.rankedRetired += b.retired;
  if (!n) continue;
  totals.x87Blocks++;
  totals.x87Entries += b.entries;
  // Everything a block containing x87 retires -- integer ops included. The
  // per-block executor stands down on any block carrying H188/189/190
  // (src/07c-block-exec.wat, OPEN-6), so this is the guest work in these
  // windows that no integer fold can reach either.
  totals.x87BlockRetired += b.retired;
  const perBlockBreakers = {};
  const c = classifyBlock(ins, perBlockBreakers);
  for (const [m, v] of Object.entries(perBlockBreakers)) {
    totals.breakers[m] = (totals.breakers[m] || 0) + v * b.entries;
  }
  totals.sibX87 += ins.filter(o => o.kind === 'x87' && o.handler === 'SIB').length * b.entries;
  // Weight by block entries: one entry runs the whole body once.
  totals.caught += c.caught * b.entries;
  for (const [r, v] of Object.entries(c.declined)) {
    totals.declined[r] = (totals.declined[r] || 0) + v * b.entries;
  }
  rows.push({
    rank: b.rank, id: b.id, module: b.module, origVa: b.origVa,
    entries: b.entries, ops: b.ops, x87: n,
    caught: c.caught, declinedOps: Object.values(c.declined).reduce((a, v) => a + v, 0),
    declined: c.declined, runs: c.runs,
    x87Dispatches: n * b.entries,
  });
}

rows.sort((a, b) => b.x87Dispatches - a.x87Dispatches);
const dispTotal = totals.caught + Object.values(totals.declined).reduce((a, v) => a + v, 0);
console.log(`${path.basename(dir)}: ${totals.x87Blocks}/${totals.blocks} ranked blocks carry x87`);
console.log(`x87 instruction-dispatches in them: ${dispTotal}`);
console.log(`  caught by the island rule (run >= 3): ${totals.caught}`
  + ` (${(totals.caught * 100 / dispTotal).toFixed(1)}%)`);
console.log('  declined, by the rule that stopped the run:');
for (const [r, v] of Object.entries(totals.declined).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${r.padEnd(14)} ${String(v).padStart(12)} (${(v * 100 / dispTotal).toFixed(1)}%)`);
}
console.log(`  x87 ops using a SIB (indexed) operand: ${totals.sibX87}`);
console.log(`  guest ops retired inside x87-carrying blocks: ${totals.x87BlockRetired}`
  + ` of ${totals.rankedRetired} ranked`
  + ` (${(totals.x87BlockRetired * 100 / totals.rankedRetired).toFixed(1)}%)`
  + ` = ${(totals.x87BlockRetired * 100 / index.totalRetired).toFixed(1)}% of the window`);
console.log('  the instruction that broke each declined run:');
for (const [m, v] of Object.entries(totals.breakers).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${m.padEnd(14)} ${String(v).padStart(12)} (${(v * 100 / dispTotal).toFixed(1)}%)`);
}
console.log(`\ntop ${TOP} x87-carrying blocks by x87 dispatches:`);
for (const r of rows.slice(0, TOP)) {
  const dec = Object.entries(r.declined).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`).join(' ') || '-';
  console.log(`  #${String(r.rank).padStart(3)} ${r.module}+${r.origVa} entries=${r.entries}`
    + ` ops=${r.ops} x87=${r.x87} caught=${r.caught} declined=${r.declinedOps}`
    + ` runs=[${r.runs.join(',')}] ${dec}`);
}
const jsonOut = arg('json', null);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ totals, rows }, null, 1));
