#!/usr/bin/env node
'use strict';

// What did the micro-op tier decide about each hot head, and was it right?
//
// `run.js --uop --uop-census` logs one record per verdict through log_i32
// (07d $uop_census_ev): every compile attempt (installed, or declined and
// why), every program retired as poor (with its enters, blocks and the EIP
// it left by), every code-write kill, every flush, and at exit the live
// programs and the declined/poor markers still in the map. This folds them
// into per-head rows so three questions have answers:
//
//   - churn:    how many compiles were the SAME head again (a flush or a map
//               collision forgot the verdict), and how much of the compile
//               count is that;
//   - poor:     how short the retired programs' trips really were, and which
//               exit they left by (head+N) -- a side exit on every trip reads
//               very differently from a loop that runs once;
//   - coverage: with --hist (a --hist-json window from the SAME run), how many
//               of the block entries the tier did NOT take are at heads it
//               declined, retired, or never saw hot, and for what reason.
//
// usage:
//   node tools/uop-census.js <run.log> [--hist=window.json] [--exe-base=0x400000]
//     [--exe=PATH] [--pe-dir=DIR] [--thread=N] [--top=N] [--json]
//
// --pe-dir names a directory holding the exe and DLLs; each head is then
// disassembled (first instruction) from the module file its address maps to.

const fs = require('fs');
const path = require('path');
const { readHist, makeAttributor } = require('./hist-blocks');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const files = argv.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: uop-census.js <run.log> [--hist=F] [--exe-base=0x400000] [--pe-dir=DIR] [--top=N] [--json]');
  process.exit(2);
}
const TOP = parseInt(flag('top', '25'), 10);
const EXE_BASE = parseInt(flag('exe-base', '0x400000'), 16) >>> 0;
const PE_DIR = flag('pe-dir', null);
// The exe's file, when --pe-dir holds several: the histogram names it `exe`.
const EXE = flag('exe', null);

// Must match test/runner-experiments.js UOP_REASONS and the 07e header.
const REASONS = [null, 'scan-limit', 'overlap', 'head-unsupported', 'no-backedge', 'loop-too-big',
  'seam-ambiguous', 'long-block', 'unreached-block', 'demand-no-fixpoint', 'branch-mid-block',
  'dead-flags-consumed', 'dead-cf', 'cf-no-recipe', 'cf-kind', 'dead-flags-rec', 'rec-no-recipe', 'rec-kind',
  'dead-flags-jcc', 'kind', 'too-many-windows', 'label', 'arg', 'too-many-temps', 'program-too-big',
  'ranges-full', 'scratch-overflow'];
const why = r => r === 0 ? 'installed' : r === 0xFFFF ? 'busy' : (REASONS[r] || `reason${r}`);
const hex = v => '0x' + (v >>> 0).toString(16);

// ---- read the records ------------------------------------------------------
// Other LOG_I32 users share the channel, so a record is a marker followed by
// exactly four more values; anything else is skipped.
// --thread=N reads cooperative guest thread N's records instead of the main
// thread's (run.js tags those `[i32 TN]`); each thread has its own arena and map.
const THREAD = flag('thread', null);
const vals = [];
for (const line of fs.readFileSync(files[0], 'utf8').split('\n')) {
  // run.js prints them as `[i32] 0x…`; the shared host import as `[LOG_I32]`.
  const m = line.match(/^\[(?:i32|LOG_I32)(?: T(\d+))?\] 0x([0-9a-f]+)/);
  if (!m || (m[1] || null) !== THREAD) continue;
  vals.push(parseInt(m[2], 16) >>> 0);
}
const recs = [];
for (let i = 0; i + 4 < vals.length; i++) {
  if ((vals[i] & 0xFFFF0000) >>> 0 !== 0xC5E50000) continue;
  const k = vals[i] & 0xFFFF;
  if (k < 1 || k > 8) continue;
  recs.push({ k, a: vals[i + 1], b: vals[i + 2], c: vals[i + 3], d: vals[i + 4] });
  i += 4;
}
if (!recs.length) {
  console.error('no --uop-census records in the log (was the run started with --uop --uop-census?)');
  process.exit(1);
}

// ---- fold per head ---------------------------------------------------------
const heads = new Map();
const head = eip => {
  let h = heads.get(eip);
  if (!h) heads.set(eip, h = { eip, compiles: 0, installs: 0, declines: {}, busy: 0,
    poor: [], writes: 0, live: null, marker: false, last: null, insns: 0 });
  return h;
};
let flushes = 0, flushAll = 0;
let hotTable = null;
for (const r of recs) {
  if (r.k === 1) {
    const h = head(r.a);
    if (r.b === 0xFFFF) { h.busy++; continue; }
    h.compiles++;
    if (r.b === 0) { h.installs++; h.insns = r.c; } else h.declines[why(r.b)] = (h.declines[why(r.b)] || 0) + 1;
    h.last = why(r.b);
  } else if (r.k === 2) {
    head(r.a).poor.push({ enters: r.b, blocks: r.c, exit: r.d });
    head(r.a).last = 'poor';
  } else if (r.k === 3) {
    head(r.a).writes++;
  } else if (r.k === 4) {
    flushes++;
  } else if (r.k === 5) {
    flushAll++;
  } else if (r.k === 6) {
    head(r.a).live = { enters: r.b, blocks: r.c };
  } else if (r.k === 7) {
    head(r.a).marker = true;
  } else if (r.k === 8) {
    hotTable = { takeovers: r.a, warm: r.b, probes: r.c };
  }
}
const all = [...heads.values()];

// ---- attribution and disassembly --------------------------------------------
let hist = null, attribute = a => ({ name: '?', va: a });
if (flag('hist', null)) {
  hist = readHist(flag('hist', null));
  attribute = makeAttributor(hist, EXE_BASE);
}
const peCache = new Map();
function peFor(name) {
  if (name === '?') return null;
  if (peCache.has(name)) return peCache.get(name);
  if (name === 'exe' && EXE) {
    const pe = require('../lib/pe').readPE(EXE);
    peCache.set(name, pe);
    return pe;
  }
  if (!PE_DIR) return null;
  let file = null;
  const want = name.toLowerCase();
  for (const f of fs.readdirSync(PE_DIR)) {
    const l = f.toLowerCase();
    if (l === want || l === want.replace(/\.dll$/, '.exe')) file = f;
  }
  let pe = null;
  if (file) { try { pe = require('../lib/pe').readPE(path.join(PE_DIR, file)); } catch (_) { pe = null; } }
  peCache.set(name, pe);
  return pe;
}
let disasmAt = null;
try { ({ disasmAt } = require('./disasm')); } catch (_) { /* optional */ }
function firstInsn(eip) {
  const a = attribute(eip);
  const pe = peFor(a.name);
  if (!pe || !disasmAt) return '';
  const off = pe.va2off(a.va);
  if (off < 0) return '';
  // "0040e20f  3c 5a                        cmp al, 0x5a" -> the mnemonic part
  try { return String(disasmAt(pe.buf, off, a.va, 1)[0] || '').replace(/^\s*[0-9a-f]+\s+(?:[0-9a-f]{2}\s)+\s*/i, '').trim(); }
  catch (_) { return ''; }
}
const where = eip => {
  const a = attribute(eip);
  return a.name === '?' ? hex(eip) : `${a.name}+${hex(a.va)}`;
};

// ---- summary ----------------------------------------------------------------
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const compiles = sum(all, h => h.compiles);
const distinct = all.filter(h => h.compiles).length;
const installed = all.filter(h => h.installs);
const poorHeads = all.filter(h => h.poor.length);
const out = [];
const say = s => out.push(s);
say(`records: ${recs.length}   heads seen: ${all.length}`);
say(`compiles: ${compiles} over ${distinct} distinct heads  (repeat compiles: ${compiles - distinct}, ` +
  `${compiles ? (100 * (compiles - distinct) / compiles).toFixed(1) : 0}%)`);
say(`flushes: ${flushes} (of them flush-all, verdicts forgotten: ${flushAll})   busy (lock held): ${sum(all, h => h.busy)}`);
say(`installs: ${sum(all, h => h.installs)} over ${installed.length} heads   ` +
  `retired poor: ${sum(all, h => h.poor.length)} over ${poorHeads.length} heads   ` +
  `code-write kills: ${sum(all, h => h.writes)}`);
if (hotTable) {
  say(`hot table (512 slots, threshold 256 taken-branch entries): ${hotTable.probes} threshold hits, ` +
    `${hotTable.takeovers} slot takeovers, ${hotTable.warm} of them discarding a count >= 16`);
}
const byWhy = {};
for (const h of all) for (const [w, n] of Object.entries(h.declines)) {
  byWhy[w] = byWhy[w] || { heads: 0, events: 0 };
  byWhy[w].heads++; byWhy[w].events += n;
}
say('declines (distinct heads / events):');
for (const [w, v] of Object.entries(byWhy).sort((a, b) => b[1].heads - a[1].heads)) {
  say(`  ${w.padEnd(20)} ${String(v.heads).padStart(7)} / ${v.events}`);
}
const recompile = {};
for (const h of all) if (h.compiles) recompile[Math.min(h.compiles, 10)] = (recompile[Math.min(h.compiles, 10)] || 0) + 1;
say('compiles per head: ' + Object.entries(recompile).map(([n, c]) => `${n === '10' ? '10+' : n}x=${c}`).join('  '));
// The verdict map is 2048 two-way sets, and a head only recompiles once its
// set stopped naming it: other heads installed or were marked there. So a
// repeat compile on a head that shares its set with another compiled head is
// map aliasing, not a verdict that changed. `$uop_map_set` is the index.
const vslot = e => ((e ^ (e >>> 12)) & 2047) >>> 0;
const bySlot = new Map();
for (const h of all) if (h.compiles) bySlot.set(vslot(h.eip), (bySlot.get(vslot(h.eip)) || []).concat([h]));
let aliasRepeats = 0, aliasSlots = 0;
for (const hs of bySlot.values()) {
  if (hs.length < 2) continue;
  aliasSlots++;
  aliasRepeats += sum(hs, h => h.compiles - 1);
}
say(`verdict-map aliasing: ${aliasSlots} slots hold 2+ compiled heads; ` +
  `${aliasRepeats} of ${compiles - distinct} repeat compiles are on those heads`);
for (const h of all) h.slotMates = (bySlot.get(vslot(h.eip)) || []).filter(o => o !== h);

// Poor programs: trips per entry, and where they left.
if (poorHeads.length) {
  const bpe = poorHeads.map(h => { const p = h.poor[h.poor.length - 1]; return p.blocks / Math.max(1, p.enters); });
  bpe.sort((a, b) => a - b);
  const q = f => bpe[Math.min(bpe.length - 1, Math.floor(f * bpe.length))].toFixed(2);
  say(`poor programs, blocks per entry: p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}`);
  const exits = {};
  for (const h of poorHeads) {
    const d = (h.poor[h.poor.length - 1].exit - h.eip) | 0;
    const b = d <= 0 ? 'before head' : d < 16 ? '+1..15' : d < 64 ? '+16..63' : d < 256 ? '+64..255' : '+256..';
    exits[b] = (exits[b] || 0) + 1;
  }
  say('poor programs, exit EIP relative to head: ' + Object.entries(exits).map(([k, v]) => `${k}=${v}`).join('  '));
}

// ---- coverage against a histogram window ----------------------------------
const verdict = h => !h ? 'no-verdict' : h.live ? 'live' : h.poor.length ? 'poor'
  : Object.keys(h.declines).length ? `declined:${h.last}` : h.last || 'seen';
const rows = [];
if (hist) {
  const total = hist.blockHits || sum(hist.blocks, b => b[1]);
  const byVerdict = {};
  for (const [hx, hits] of hist.blocks) {
    const eip = parseInt(hx, 16) >>> 0;
    const v = verdict(heads.get(eip));
    byVerdict[v] = (byVerdict[v] || 0) + hits;
    rows.push({ eip, hits, v });
  }
  say(`\nhistogram window ${hist.window ? `${hist.window.start}..${hist.window.stop}` : ''}: ` +
    `${total} threaded block entries (top ${hist.blocks.length} blocks listed = ` +
    `${(100 * sum(hist.blocks, b => b[1]) / total).toFixed(1)}%)`);
  // A block with no verdict either never ended a taken branch (a fallthrough
  // or a call-return landing: never counted at all), or it shares one of the
  // 512 hot slots with another hot target and keeps losing its count. The
  // histogram cannot tell which; it can say how many share a slot.
  const slot = e => (e >>> 2) & 511;
  const slotHits = new Map();
  for (const [hx, hits] of hist.blocks) {
    const e = parseInt(hx, 16) >>> 0;
    slotHits.set(slot(e), (slotHits.get(slot(e)) || []).concat([[e, hits]]));
  }
  let noVerdict = 0, contested = 0;
  for (const [hx, hits] of hist.blocks) {
    const e = parseInt(hx, 16) >>> 0;
    if (heads.get(e)) continue;
    noVerdict += hits;
    if (slotHits.get(slot(e)).length > 1) contested += hits;
  }
  say(`no-verdict entries in a hot slot shared with another listed block: ` +
    `${(100 * contested / total).toFixed(1)}% of the window (of ${(100 * noVerdict / total).toFixed(1)}% no-verdict)`);
  say('entries NOT taken by the tier, by the verdict on that block as a head:');
  for (const [v, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) {
    say(`  ${v.padEnd(28)} ${(100 * n / total).toFixed(1).padStart(5)}%`);
  }
  say(`\ntop ${TOP} threaded blocks:`);
  for (const r of rows.slice(0, TOP)) {
    const h = heads.get(r.eip);
    const extra = h && h.poor.length
      ? ` (${h.poor.length}x poor, last ${h.poor[h.poor.length - 1].blocks}/${h.poor[h.poor.length - 1].enters} ` +
        `blk/entry, exit ${where(h.poor[h.poor.length - 1].exit)})` : '';
    say(`  ${(100 * r.hits / total).toFixed(2).padStart(6)}%  ${where(r.eip).padEnd(26)} ${r.v.padEnd(28)} ` +
      `${h ? `c=${h.compiles}` : ''}${extra}  ${firstInsn(r.eip)}`);
  }
}

// Heads that were compiled the most: the churn, by name.
say(`\nmost-recompiled heads:`);
for (const h of all.filter(x => x.compiles > 1).sort((a, b) => b.compiles - a.compiles).slice(0, TOP)) {
  say(`  ${String(h.compiles).padStart(4)}x  ${where(h.eip).padEnd(26)} ${verdict(h).padEnd(24)} ` +
    `poor=${h.poor.length} installs=${h.installs}  ${firstInsn(h.eip)}` +
    (h.slotMates.length ? `  [slot shared with ${h.slotMates.slice(0, 3).map(o => `${where(o.eip)} ${o.compiles}x`).join(', ')}]` : ''));
}
// The live programs that did the work.
const live = all.filter(h => h.live).sort((a, b) => b.live.blocks - a.live.blocks);
say(`\nlive programs at exit: ${live.length}, blocks run in them (since their last install): ` +
  `${sum(live, h => h.live.blocks)}`);
for (const h of live.slice(0, TOP)) {
  say(`  ${String(h.live.blocks).padStart(11)} blk  ${String(h.live.enters).padStart(9)} ent  ` +
    `${(h.live.blocks / Math.max(1, h.live.enters)).toFixed(1).padStart(7)} blk/ent  ${where(h.eip).padEnd(26)} ` +
    `insns=${h.insns}  ${firstInsn(h.eip)}`);
}

if (argv.includes('--json')) {
  console.log(JSON.stringify({ heads: all, flushes, flushAll, rows }));
} else {
  console.log(out.join('\n'));
}
