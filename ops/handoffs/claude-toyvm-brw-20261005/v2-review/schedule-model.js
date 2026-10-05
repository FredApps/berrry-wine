#!/usr/bin/env node
'use strict';
// Pure-JS model of DosSession.step's schedule arithmetic (tools/toyvm/dos-loop.js
// lines 1683-1711, 1771-1795, 1801-1803, 1841, 1943) for HEAD and patch v2.
// Loads no guest, no wasm, no tools/toyvm module. Each expression below is
// copied verbatim from the source; `exprCheck()` greps the two files to prove
// the copies did not drift.
//
//   node schedule-model.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HERE = __dirname;
const SRC = { head: path.join(HERE, 'patched/dos-loop.base.js'), v2: path.join(HERE, 'patched/dos-loop.js') };

const MODEL = {
  head: {
    stopAt: (d, grain) => Math.floor(d / grain) * grain + grain,
    accept: (at, d) => at > d,
    atStop: (d, stopAt, cut, sched) => !sched || d >= stopAt,
    label: (left, atStop) => (left <= 0 ? (atStop ? 'date' : 'budget') : 'early'),
    sbDueNow: (d, audioAt, sbInterval) => d - audioAt >= sbInterval,
  },
  v2: {
    stopAt: (d, grain) => Math.ceil(d / grain) * grain || grain,
    accept: (at, d) => at >= d,
    atStop: (d, stopAt, cut, sched) => !sched || d > stopAt || (cut >= 0 && d >= stopAt),
    label: (left, atStop) => (left < 0 ? (atStop ? 'date' : 'budget') : 'early'),
    sbDueNow: (d, audioAt, sbInterval) => d - audioAt > sbInterval,
  },
};
// The verbatim source text each model line stands for.
const TEXT = {
  head: [
    'let stopAt = Math.floor(this.dispatched / grain) * grain + grain;',
    'const due = (at) => { if (at > this.dispatched && at < stopAt) stopAt = at; };',
    'const atStop = !this.irqSchedule || this.dispatched >= stopAt;',
    ": left <= 0 ? (atStop ? 'date' : 'budget')",
    'const sbDueNow = sbInterval !== Infinity && this.dispatched - this.audioAt >= sbInterval;',
  ],
  v2: [
    'let stopAt = Math.ceil(this.dispatched / grain) * grain || grain;',
    'const due = (at) => { if (at >= this.dispatched && at < stopAt) stopAt = at; };',
    'const atStop = !this.irqSchedule || this.dispatched > stopAt',
    '|| (cut >= 0 && this.dispatched >= stopAt);',
    ": left < 0 ? (atStop ? 'date' : 'budget')",
    '? this.dispatched - this.audioAt > sbInterval',
  ],
  // Unchanged by v2, and relevant to it.
  both: [
    'due(Math.round(Math.ceil((this.dispatched + 1) / tickUnit) * tickUnit));',
    'const budget = this.irqSchedule',
    '? Math.max(1, Math.min(this.slice, stopAt - this.dispatched))',
    'const clockAt = atStop && this.irqSchedule ? stopAt : this.dispatched;',
    'const frame = Math.floor(clockAt / this.vgaPeriod);',
    'if (frame !== this.vgaFrame) { this.vgaFrame = frame; this.retraceEdge = true; }',
    'if (this.vgaPeriod) due((this.vgaFrame + 1) * this.vgaPeriod);',
    'while (session.dispatched < budget && !session.done) {',
  ],
};

function exprCheck() {
  const src = { head: fs.readFileSync(SRC.head, 'utf8'), v2: fs.readFileSync(SRC.v2, 'utf8') };
  const runDos = fs.readFileSync(path.join(HERE, '../../tools/toyvm/run-dos.js'), 'utf8');
  for (const k of ['head', 'v2']) for (const t of TEXT[k]) assert(src[k].includes(t), `${k} lacks: ${t}`);
  for (const t of TEXT.both) {
    const inRun = t.startsWith('while (session');
    if (inRun) assert(runDos.includes(t), `run-dos lacks: ${t}`);
    else for (const k of ['head', 'v2']) assert(src[k].includes(t), `${k} lacks: ${t}`);
  }
  // And HEAD's text is NOT in v2 where v2 replaced it.
  assert(!src.v2.includes(TEXT.head[0]) && !src.v2.includes(TEXT.head[2]));
  return 'expression copies match HEAD and v2 sources';
}

// One slice's schedule: the stop and the budget, from the odometer and dates.
function plan(m, d, { grain, dates = [], slice = 2e6, tickUnit = 0, sched = true }) {
  let stopAt = m.stopAt(d, grain);
  const due = (at) => { if (m.accept(at, d) && at < stopAt) stopAt = at; };
  for (const at of dates) due(at);
  if (tickUnit) due(Math.round(Math.ceil((d + 1) / tickUnit) * tickUnit));
  const budget = sched ? Math.max(1, Math.min(slice, stopAt - d)) : slice;
  return { stopAt, budget };
}
// The handback: billed odometer, atStop, clockAt, label.
function back(m, d0, p, left, cut = -1, sched = true) {
  const l = cut >= 0 ? cut : left;
  const d = d0 + p.budget - l;
  const atStop = m.atStop(d, p.stopAt, cut, sched);
  const clockAt = atStop && sched ? p.stopAt : d;
  return { d, atStop, clockAt, label: cut >= 0 ? 'cut' : m.label(l, atStop) };
}

const out = [];
const say = (s) => { out.push(s); console.log(s); };
say(exprCheck());

// 1. stopAt arithmetic edge cases.
const G = 25000;
say('\n1. stopAt(d) with grain 25000 (no due dates)');
say('   d            head-stopAt  v2-stopAt  v2-budget');
for (const d of [0, 1, G - 1, G, G + 1, 4 * G - 1, 4 * G, 89250000 - 1, 89250000, 89250001]) {
  const h = plan(MODEL.head, d, { grain: G }), v = plan(MODEL.v2, d, { grain: G });
  say(`   ${String(d).padEnd(12)} ${String(h.stopAt).padEnd(12)} ${String(v.stopAt).padEnd(10)} ${v.budget}`);
  // invariants
  assert(h.stopAt > d);
  assert(v.stopAt >= d && (v.stopAt - d < G || d === 0) && (v.stopAt % G === 0));
  if (d === 0) assert.strictEqual(v.stopAt, G, 'd=0 must not give a 0 stop');
  if (d > 0 && d % G === 0) assert.strictEqual(v.budget, 1);
}
// grain 1 (shortest < 8): every odometer is a lattice point.
{
  const v = plan(MODEL.v2, 1234, { grain: 1 });
  say(`   grain=1, d=1234: v2 stopAt ${v.stopAt} budget ${v.budget} (head ${plan(MODEL.head, 1234, { grain: 1 }).stopAt})`);
}
// Floating-point safety of ceil(d/grain)*grain at large d (integers < 2^53 are exact).
for (const d of [2 ** 31 - 1, 2 ** 31, 3e9, 2 ** 40 + 7]) {
  for (const g of [1, 7, 801, 25000, 35763]) {
    const s = MODEL.v2.stopAt(d, g);
    assert(Number.isInteger(s) && s >= d && s - d < g && s % g === 0, `fp ${d}/${g}`);
  }
}
say('   fp: ceil(d/g)*g exact and in [d, d+g) for d up to 2^40, g in {1,7,801,25000,35763}');

// 2. The BRW case: early handback EXACTLY on the lattice date 89,250,000.
say('\n2. BRW 89.25M: slice cut to the lattice, region arm hands back early with left 0');
{
  for (const k of ['head', 'v2']) {
    const m = MODEL[k];
    const d0 = 89250000 - 262; const p = plan(m, d0, { grain: G });
    const h = back(m, d0, p, 0);
    const nxt = plan(m, h.d, { grain: G });
    say(`   ${k}: stop ${p.stopAt} -> handback d=${h.d} atStop=${h.atStop} clockAt=${h.clockAt} label=${h.label};`
      + ` next stopAt ${nxt.stopAt} budget ${nxt.budget}`);
    if (k === 'v2') {
      const h2 = back(m, h.d, nxt, -2); // inc/dec/jnz: 3 ops to the next transfer
      say(`       v2 budget-1 slice then ends at d=${h2.d} atStop=${h2.atStop} clockAt=${h2.clockAt} (L1 reached 89250003 left -3, clockAt 89250000)`);
      assert.deepStrictEqual([h2.d, h2.atStop, h2.clockAt], [89250003, true, 89250000]);
    }
  }
}

// 3. A cut (Machine.endSlice, cut==0) landing exactly on the stop: v2 counts it
//    AND schedules the same date again (due accepts at==d, ceil keeps a lattice).
say('\n3. cut==0 exactly on the stop (port write was the budget\'s last op)');
for (const k of ['head', 'v2']) {
  const m = MODEL[k];
  const d0 = 4 * G - 500; const p = plan(m, d0, { grain: G });
  const h = back(m, d0, p, -1, 0);
  const nxt = plan(m, h.d, { grain: G });
  const h2 = back(m, h.d, nxt, -2);
  say(`   ${k}: cut at d=${h.d} atStop=${h.atStop} clockAt=${h.clockAt}; next stopAt ${nxt.stopAt} budget ${nxt.budget}`
    + ` -> d=${h2.d} atStop=${h2.atStop} clockAt=${h2.clockAt}`);
  if (k === 'v2') assert(h.atStop && h2.atStop && h.clockAt === h2.clockAt, 'v2 double stop at one date');
}
// Same with a non-lattice due date (timer that did not fire because SB took the slot).
for (const k of ['head', 'v2']) {
  const m = MODEL[k];
  const date = 4 * G - 123; const d0 = date - 400;
  const p = plan(m, d0, { grain: G, dates: [date] });
  const h = back(m, d0, p, -1, 0);
  const nxt = plan(m, h.d, { grain: G, dates: [date] }); // timer mark unchanged -> still due
  say(`   ${k} (due date ${date}): cut at ${h.d} atStop=${h.atStop}; next stopAt ${nxt.stopAt} budget ${nxt.budget}`);
}

// 4. VGA frame date consumed by an early-exact handback (vgaFrame update runs
//    for every handback, clockAt = odometer when !atStop).
say('\n4. early handback exactly ON a VGA frame edge (period 143052, frame 624)');
{
  const period = 143052, F = 624, edge = F * period;
  for (const k of ['head', 'v2']) {
    const m = MODEL[k];
    let vgaFrame = F - 1;
    const d0 = edge - 1000;
    const p = plan(m, d0, { grain: G, dates: [(vgaFrame + 1) * period] });
    const h = back(m, d0, p, 0); // early, left 0, lands on the edge
    const frame = Math.floor(h.clockAt / period);
    let retraceEdge = false;
    if (frame !== vgaFrame) { vgaFrame = frame; retraceEdge = true; }
    const deliveredHere = h.atStop && retraceEdge;
    const nxt = plan(m, h.d, { grain: G, dates: [(vgaFrame + 1) * period] });
    say(`   ${k}: stopAt ${p.stopAt}=edge, early at ${h.d} atStop=${h.atStop}; vgaFrame->${vgaFrame} edge armed;`
      + ` retrace delivered here=${deliveredHere}; next stopAt ${nxt.stopAt} (edge kept: ${nxt.stopAt === edge})`);
    if (k === 'v2') assert(!deliveredHere && nxt.stopAt !== edge, 'v2 loses the frame date');
  }
  // the arm that did not hand back early:
  const m = MODEL.v2; const d0 = edge - 1000;
  const p = plan(m, d0, { grain: G, dates: [edge] });
  const h = back(m, d0, p, -2);
  say(`   other arm (no early exit): stops at ${h.d} atStop=${h.atStop} clockAt=${h.clockAt} -> retrace delivered at the edge`);
}

// 5. Tick date (tickUnit not a lattice multiple: GUS grain, --pit-clock, tickScale)
say('\n5. early handback exactly ON a BIOS tick date when tickUnit is off the lattice');
{
  const g = 801, tu = 550000; const T = 37 * tu;  // 20,350,000; 20350000 % 801 = ?
  for (const k of ['head', 'v2']) {
    const m = MODEL[k];
    const d0 = T - 300; const p = plan(m, d0, { grain: g, tickUnit: tu });
    const h = back(m, d0, p, 0);
    const nxt = plan(m, h.d, { grain: g, tickUnit: tu });
    say(`   ${k}: stopAt ${p.stopAt} (T=${T}, T%grain=${T % g}); early at ${h.d} atStop=${h.atStop};`
      + ` next stopAt ${nxt.stopAt} (T kept: ${nxt.stopAt === T})`);
  }
  // default config: grain 25000, tickUnit 550000 = 22 lattice steps -> kept by the lattice
  const nxt = plan(MODEL.v2, 22 * G, { grain: G, tickUnit: tu });
  say(`   default grain 25000: T=550000 is a lattice point, v2 next stopAt ${nxt.stopAt} (kept)`);
}

// 6. Budget stop whose overshoot lands exactly on ANOTHER date D.
say('\n6. budget stop at S overshoots exactly onto another date D = S+3');
for (const k of ['head', 'v2']) {
  const m = MODEL[k];
  const S = 4 * G - 3, D = 4 * G; const d0 = S - 500;
  const p = plan(m, d0, { grain: G, dates: [S] });
  const h = back(m, d0, p, -3);
  const nxt = plan(m, h.d, { grain: G });
  say(`   ${k}: stop at ${h.d} (clockAt ${h.clockAt}); next stopAt ${nxt.stopAt} budget ${nxt.budget}`
    + ` -> D ${nxt.stopAt === D ? 'TAKEN (extra budget-1 stop)' : 'skipped'}`);
}

// 7. Livelock: how many budget-1 slices can one date cost?
say('\n7. budget-1 slices per date');
{
  const m = MODEL.v2; let d = 4 * G; let n = 0;
  // zero-dispatch handback (left == budget): odometer does not move
  for (let i = 0; i < 3; i++) { const p = plan(m, d, { grain: G }); const h = back(m, d, p, p.budget); n++; d = h.d; }
  say(`   zero-dispatch handbacks keep d=${d}: each re-plans budget ${plan(m, d, { grain: G }).budget} (unbounded only if the guest makes no progress, as at HEAD)`);
  const p = plan(m, d, { grain: G }); const h = back(m, d, p, 0);
  say(`   one op dispatched (left 0): d=${h.d} atStop=${h.atStop} label=${h.label} -> date consumed, next stopAt ${plan(m, h.d, { grain: G }).stopAt}`);
}

// 8. Run end: an early handback exactly on endAt ends the run (run-dos while
//    `dispatched < budget`) without the date being reached under v2's rule.
say('\n8. early handback exactly on endAt');
{
  const m = MODEL.v2; const endAt = 8e6; const d0 = endAt - 77;
  const p = plan(m, d0, { grain: G, dates: [endAt] });
  const h = back(m, d0, p, 0);
  say(`   v2: stopAt ${p.stopAt}=endAt, early at ${h.d} atStop=${h.atStop}; run loop continues: ${h.d < endAt} -> run ends with the final date NOT reached (no render/IRQ at endAt)`);
}

// 9. sbDueNow under the schedule: when can it be true at a non-stop handback?
say('\n9. sbDueNow at a non-stop handback (v2 strict)');
{
  const m = MODEL.v2; const audioAt = 1e6, sbI = 5000, sbDate = audioAt + sbI;
  for (const d0 of [audioAt + 100, audioAt + 6000]) { // sb date future / already overdue at slice start
    const p = plan(m, d0, { grain: G, dates: [sbDate] });
    const h = back(m, d0, p, 7); // early, 7 left
    say(`   slice start ${d0} (sb date ${sbDate} ${d0 > sbDate ? 'OVERDUE' : 'future'}): stopAt ${p.stopAt}, early at ${h.d},`
      + ` atStop=${h.atStop}, sbDueNow=${m.sbDueNow(h.d, audioAt, sbI)}`);
  }
}

// 10. The suggested v3 delta (v3-delta-on-v2.patch): `from` = max(d, reachedAt+1),
//     tick due from `from`, vgaFrame armed only at a stop, run loop owes endAt.
say('\n10. suggested v3 delta, same scenarios');
{
  const v3 = { ...MODEL.v2 };
  const plan3 = (d, reachedAt, { grain, dates = [], tickUnit = 0, slice = 2e6 }) => {
    const from = Math.max(d, reachedAt + 1);
    let stopAt = Math.ceil(from / grain) * grain || grain;
    const due = (at) => { if (at >= from && at < stopAt) stopAt = at; };
    for (const at of dates) due(at);
    if (tickUnit) due(Math.round(Math.ceil(from / tickUnit) * tickUnit));
    return { stopAt, budget: Math.max(1, Math.min(slice, stopAt - d)) };
  };
  // BRW: early exactly on the lattice -> next slice still cut to it.
  { const d0 = 89250000 - 262; const p = plan3(d0, d0 - 5, { grain: G }); const h = back(v3, d0, p, 0);
    const n = plan3(h.d, d0 - 5, { grain: G }); const h2 = back(v3, h.d, n, -2);
    say(`   BRW: early at ${h.d} -> next stopAt ${n.stopAt} budget ${n.budget} -> ${h2.d} clockAt ${h2.clockAt}`);
    assert.deepStrictEqual([n.stopAt, h2.clockAt], [89250000, 89250000]); }
  // cut==0 on the stop: no second stop at the same date.
  { const d0 = 4 * G - 500; const p = plan3(d0, -1, { grain: G }); const h = back(v3, d0, p, -1, 0);
    const reached = h.atStop ? p.stopAt : -1; const n = plan3(h.d, reached, { grain: G });
    say(`   cut on the stop: reachedAt ${reached}; next stopAt ${n.stopAt} budget ${n.budget} (no double stop)`);
    assert(n.stopAt > h.d); }
  // tick date T off the lattice: kept.
  { const g = 801, tu = 550000, T = 37 * tu; const d0 = T - 300;
    const p = plan3(d0, d0 - 50, { grain: g, tickUnit: tu }); const h = back(v3, d0, p, 0);
    const n = plan3(h.d, d0 - 50, { grain: g, tickUnit: tu });
    say(`   tick T=${T}: early at ${h.d}; next stopAt ${n.stopAt} (T kept: ${n.stopAt === T})`);
    assert.strictEqual(n.stopAt, T); }
  // VGA edge: early exact handback no longer arms the edge; the date stays due.
  { const period = 143052, F = 624, edge = F * period; let vgaFrame = F - 1; const d0 = edge - 1000;
    const p = plan3(d0, d0 - 7, { grain: G, dates: [(vgaFrame + 1) * period] }); const h = back(v3, d0, p, 0);
    if (h.atStop) vgaFrame = Math.floor(h.clockAt / period);
    const n = plan3(h.d, d0 - 7, { grain: G, dates: [(vgaFrame + 1) * period] });
    const h2 = back(v3, h.d, n, -2);
    say(`   VGA edge ${edge}: early at ${h.d} (frame not armed); next stopAt ${n.stopAt} -> stop ${h2.d} clockAt ${h2.clockAt}, edge armed there`);
    assert.strictEqual(n.stopAt, edge); }
  // endAt: owesEnd keeps the loop going one budget-1 slice.
  { const endAt = 8e6; const d0 = endAt - 77; const p = plan3(d0, d0 - 9, { grain: G, dates: [endAt] }); const h = back(v3, d0, p, 0);
    const owes = !h.atStop && h.d === endAt;
    const n = plan3(h.d, d0 - 9, { grain: G, dates: [endAt] }); const h2 = back(v3, h.d, n, -1);
    say(`   endAt: early at ${h.d}, owesEnd=${owes}; one more slice ends ${h2.d} atStop=${h2.atStop} clockAt=${h2.clockAt}`);
    assert(owes && h2.atStop && h2.clockAt === endAt); }
}
fs.writeFileSync(path.join(HERE, 'schedule-model.out.txt'), out.join('\n') + '\n');
