#!/usr/bin/env node
'use strict';
// Classify every interrupt delivery that differs between head and v2v3, from
// their COMPLETE --trace-irq logs and their COMPLETE slice records (one line
// per handback, run-dos afterSlice: `dispatched left cs:ip[ regs...,flags]`).
//
// An interrupt is raised in the step that produced the handback whose record
// has dispatched == the irq line's `at` (DosLoop.raise reads this.dispatched
// after afterSlice), so each delivery is looked up by that odometer:
//   left == 0  ON-DATE: the handback landed exactly where its budget ran out,
//              i.e. ON the date -- an early handback that coincided. Head's `>=`
//              counted it as a stop; v2's strict `>` does not. Class (a).
//   left <  0  BUDGET: a stop strictly past its date. Both rules deliver there,
//              so a moved delivery of this kind is a CONSEQUENCE of an earlier
//              divergence (coupled through lastIrq and guest state), not a
//              decision of its own.
//   left >  0  EARLY: a handback before its date. A scheduled interrupt should
//              never go in there; any such row is a finding.
// A move EPISODE starts at a head-only delivery whose predecessor in head's
// order was common to both; its first delivery is the independent decision.
// With registers (BLIQ), for each episode: the v2v3 handbacks from head's
// instant up to v2v3's replacement delivery, how many were stops (left <= 0),
// and the IF bit at each stop -- hypothesis H1 (BLIQ-DIVERGENCE-20261005.md).
//
//   node classify-moves.js <head.log> <v2v3.log> <head.slices> <v2v3.slices> [--regs] [--json]

const fs = require('fs');

function readIrqs(file) {
  const out = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = l.match(/^\s*irq vec=(\S+) (\S+)\s+at=(\d+) /);
    if (m) out.push({ key: `${m[1]} ${m[2]} ${m[3]}`, at: Number(m[3]) });
  }
  return out;
}
// Slice records into typed arrays for dispatched/left/flags (~26 MB for 1.6M
// handbacks) plus one cs:ip string per record (V8 short strings, ~70-100 MB).
function readSlices(file, regs) {
  const text = fs.readFileSync(file, 'latin1');
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  const d = new Float64Array(n), left = new Int32Array(n), flags = regs ? new Int32Array(n) : null, ip = new Array(n);
  let k = 0, s = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10) continue;
    const parts = text.slice(s, i).split(' ');
    d[k] = Number(parts[0]); left[k] = Number(parts[1]); ip[k] = parts[2];
    if (regs) flags[k] = parseInt(parts[3].split(',').pop(), 16);
    k++; s = i + 1;
  }
  return { n, d, left, flags, ip };
}
// All records with dispatched == at (zero-progress handbacks can repeat a value).
function lookup(sl, at) {
  let lo = 0, hi = sl.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sl.d[m] < at) lo = m + 1; else hi = m; }
  const idx = [];
  for (let i = lo; i < sl.n && sl.d[i] === at; i++) idx.push(i);
  return idx;
}
const kindOf = (l) => (l === 0 ? 'ondate' : l < 0 ? 'budget' : 'early');

function diff(A, B) {
  const cb = new Map();
  for (const x of B) cb.set(x.key, (cb.get(x.key) || 0) + 1);
  return A.map((x) => { const c = cb.get(x.key) || 0; if (c) { cb.set(x.key, c - 1); return false; } return true; });
}

function classify({ headLog, v2v3Log, headSlices, v2v3Slices, regs = false, maxEpisodes = 20 }) {
  const H = readIrqs(headLog), V = readIrqs(v2v3Log);
  const hOnly = diff(H, V), vOnly = diff(V, H);
  const hs = readSlices(headSlices, regs), vs = readSlices(v2v3Slices, regs);
  const side = (irqs, only, sl) => {
    const classes = { ondate: 0, budget: 0, early: 0, unmatched: 0 };
    let ambiguous = 0;
    const cls = irqs.map((x, i) => {
      if (!only[i]) return null;
      const idx = lookup(sl, x.at);
      if (!idx.length) { classes.unmatched++; return 'unmatched'; }
      if (idx.length > 1) ambiguous++;
      const k = kindOf(sl.left[idx[0]]);
      classes[k]++;
      return k;
    });
    return { irqs: irqs.length, moved: only.filter(Boolean).length, classes, ambiguous, cls };
  };
  const h = side(H, hOnly, hs), v = side(V, vOnly, vs);
  // Episodes over head's order.
  const episodes = [];
  for (let i = 0; i < H.length; i++) if (hOnly[i] && (i === 0 || !hOnly[i - 1])) episodes.push(i);
  const firstClass = { ondate: 0, budget: 0, early: 0, unmatched: 0 };
  for (const i of episodes) firstClass[h.cls[i]]++;
  const vOnlyAts = V.filter((x, i) => vOnly[i]).map((x) => x.at);
  const detail = episodes.slice(0, maxEpisodes).map((i) => {
    const at = H[i].at, idx = lookup(hs, at)[0];
    const repl = vOnlyAts.find((x) => x >= at);
    const e = { headIndex: i + 1, at, class: h.cls[i], left: idx === undefined ? null : hs.left[idx], ip: idx === undefined ? null : hs.ip[idx],
      v2v3Replacement: repl === undefined ? null : repl, laterBy: repl === undefined ? null : repl - at };
    if (regs && repl !== undefined) {
      // v2v3 handbacks in [at, repl]: stops (left <= 0) and IF at each.
      let lo = lookup(vs, at)[0];
      if (lo === undefined) { lo = 0; while (lo < vs.n && vs.d[lo] < at) lo++; }
      let handbacks = 0, stops = 0, stopsIF1 = 0, firstStop = null;
      for (let j = lo; j < vs.n && vs.d[j] <= repl; j++) {
        handbacks++;
        if (vs.left[j] <= 0) {
          stops++;
          const IF = (vs.flags[j] & 0x200) ? 1 : 0;
          stopsIF1 += IF;
          if (!firstStop) firstStop = { dispatched: vs.d[j], left: vs.left[j], ip: vs.ip[j], IF };
        }
      }
      e.v2v3Window = { handbacks, stops, stopsIF1, firstStop };
    }
    return e;
  });
  delete h.cls; delete v.cls;
  return { head: h, v2v3: v, episodes: episodes.length, firstClass, detail };
}

if (require.main === module) {
  const a = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (a.length !== 4) { console.error('usage: node classify-moves.js <head.log> <v2v3.log> <head.slices> <v2v3.slices> [--regs] [--json]'); process.exit(2); }
  const r = classify({ headLog: a[0], v2v3Log: a[1], headSlices: a[2], v2v3Slices: a[3], regs: process.argv.includes('--regs') });
  console.log(process.argv.includes('--json') ? JSON.stringify(r) : JSON.stringify(r, null, 1));
}
module.exports = { classify, readSlices, readIrqs };
