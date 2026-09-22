'use strict';

// Which gate keeps each corpus program away from the µop tier.
//
//   node tools/toyvm/shell-bench.js --from=sweep.json --mode=uop --arms=node --out=uop.json
//   node tools/toyvm/uop-coverage.js uop.json [--arm=node] [--list=no-hot-head] [--json]
//
// The tier only ever runs where uop-live.js installed a head, so a corpus
// geomean is mostly a statement about coverage: most programs never enter a
// micro-op program at all. Reading `declined` does not say why, because only
// the heads that reached build() are recorded there. A program that never
// finished a profile window, or never saw a block at minShare, leaves it empty.
// UopLive.outcome() names the first gate that stopped each run, and this
// groups the corpus by it:
//
//   no-window / window-open   the run was too short for the profile schedule
//   no-samples                windows closed with nothing in them
//   no-hot-head               time spread over many blocks, none >= minShare
//   declined                  reached the install chain, refused (by reason)
//   dropped / installed       the tier ran
//
// Counts, not timings, so the answer does not depend on box load, and the
// counts are the same for every engine (the tier's decisions are made in JS
// from dispatch counts). Arms that disagree are reported, not merged.

const fs = require('fs');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const files = argv.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: uop-coverage.js <shell-bench --mode=uop --out JSON> [--arm=node] [--list=OUTCOME] [--json]');
  process.exit(2);
}

// A refusal reason without its head key (`cs:ip`) or a trailing `(count)`, so
// heads group. uop-live.js writes reasons as kinds, not per-head numbers:
// `head unsupported: op cd`, `not a loop: ret, unsupported 0f b6`.
function reasonClass(s) {
  return s.replace(/^\S+\s+/, '').replace(/\s*\(\d+\)$/, '').replace(/\s+/g, ' ').slice(0, 90);
}

// The cuts named by a `not a loop: a, b, c` reason, one per kind.
function cutsOf(s) {
  const m = /not a loop: (.*)$/.exec(s);
  return m ? m[1].split(', ') : [];
}

const ORDER = ['no-window', 'window-open', 'no-samples', 'no-hot-head', 'declined', 'dropped', 'installed', 'failed'];

const rows = [];
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  const arm = arg('arm', doc.arms[0]);
  for (const r of doc.rows) {
    const a = r.arms[arm];
    const u = a && a.ok ? a.uop : null;
    if (a && a.ok && (!u || !u.outcome)) {
      throw new Error(`${r.name}: no uop outcome -- was this run with --mode=uop on a build with UopLive.outcome()?`);
    }
    const others = doc.arms.filter((x) => x !== arm && r.arms[x] && r.arms[x].ok && r.arms[x].uop)
      .filter((x) => r.arms[x].uop.outcome !== u?.outcome);
    rows.push({ name: r.name, outcome: u ? u.outcome : 'failed', why: a && !a.ok ? a.reason : null,
      u, disagree: others });
  }
}

const by = new Map(ORDER.map((o) => [o, []]));
for (const r of rows) by.get(r.outcome).push(r);

if (argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries([...by].map(([k, v]) => [k, v.map((r) => r.name)])), null, 1));
  process.exit(0);
}

const n = rows.length;
console.log(`${n} programs\n`);
for (const [o, list] of by) {
  if (!list.length) continue;
  console.log(`  ${o.padEnd(12)} ${String(list.length).padStart(4)}  ${(100 * list.length / n).toFixed(1).padStart(5)}%`);
}

// no-hot-head: how close did the best block come? A mass just under minShare
// says the threshold is the gate; a mass at 1% says the time is genuinely flat.
const nh = by.get('no-hot-head');
if (nh.length) {
  const edges = [0.005, 0.01, 0.02, 0.03];
  console.log(`\nno-hot-head: best block's share of samples`);
  let lo = 0;
  for (const e of [...edges, Infinity]) {
    const c = nh.filter((r) => r.u.bestShare >= lo && r.u.bestShare < e).length;
    console.log(`  [${(100 * lo).toFixed(1)}%, ${e === Infinity ? 'inf' : `${(100 * e).toFixed(1)}%`})`.padEnd(18) + ` ${c}`);
    lo = e;
  }
}

// declined: every refused head, grouped by reason, with which programs hit it.
const heads = new Map();
for (const r of rows) {
  for (const d of (r.u?.declined || [])) {
    const k = reasonClass(d).replace(/^not a loop: .*/, 'not a loop (cuts below)');
    if (!heads.has(k)) heads.set(k, new Set());
    heads.get(k).add(r.name);
  }
}
if (heads.size) {
  console.log(`\nrefusal reasons (all programs, heads grouped by reason -> programs)`);
  for (const [k, s] of [...heads].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${String(s.size).padStart(4)}  ${k}   [${[...s].slice(0, 4).join(' ')}${s.size > 4 ? ' ...' : ''}]`);
  }
}

// not a loop: what ended the paths, per kind. A head counts under every kind
// its exploration hit (`any`) and under `first` for the most frequent one, so
// `first` sums to the not-a-loop heads. Neither says what a fix BUYS: a head
// cut by two kinds stays cut when one is fixed. `sole` does -- heads whose
// ONLY cut is this kind, and `sole-progs` the programs they are in. That is
// the lower bound on what fixing the kind alone unlocks (a newly explored
// path can still meet a further cut, so it is an upper bound too, loosely).
const cuts = new Map();
let withRet = 0, decoderOnly = 0;
for (const r of rows) {
  for (const d of (r.u?.declined || [])) {
    const cs = cutsOf(d);
    if (!cs.length) continue;
    if (cs.includes('ret')) withRet++;
    else if (cs.every((c) => c.startsWith('unsupported'))) decoderOnly++;
    cs.forEach((c, i) => {
      if (!cuts.has(c)) cuts.set(c, { any: 0, first: 0, sole: 0, progs: new Set(), soleProgs: new Set() });
      const e = cuts.get(c);
      e.any++;
      if (!i) e.first++;
      if (cs.length === 1) { e.sole++; e.soleProgs.add(r.name); }
      e.progs.add(r.name);
    });
  }
}
if (cuts.size) {
  console.log(`\nnot a loop: what ended exploration   first    any  programs   sole  sole-progs`);
  for (const [k, e] of [...cuts].sort((a, b) => b[1].sole - a[1].sole || b[1].first - a[1].first).slice(0, 30)) {
    console.log(`  ${k.padEnd(34)} ${String(e.first).padStart(5)}  ${String(e.any).padStart(5)}  ${String(e.progs.size).padStart(8)}`
      + `  ${String(e.sole).padStart(5)}  ${String(e.soleProgs.size).padStart(10)}`);
  }
  console.log(`  heads cut by a top-level ret: ${withRet}; cut ONLY by decoder gaps: ${decoderOnly}`);
}

const dem = new Map();
for (const r of rows) {
  for (const d of (r.u?.demotedWhy || [])) {
    const k = reasonClass(d).replace(/^bails.*/, 'bails');
    dem.set(k, (dem.get(k) || 0) + 1);
  }
}
if (dem.size) {
  console.log(`\ndemotions`);
  for (const [k, c] of [...dem].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${k}`);
}

// WEIGHTED BY TIME. The tables above count heads and programs; a refused head
// at 3% and one at 80% count alike there. Each head carries its share of its
// profile window's samples, and a program's weight for a class is the sum of
// its heads' shares over the number of windows it profiled -- the fraction of
// its sampled time that class covers. Summed over the corpus the unit is
// "programs' worth of time": 1.00 = all of one program. Approximate twice
// over: samples are budget-exhausted slice ends, a proxy for time, and a
// later window samples only what installed programs did NOT cover.
// `why` here is the bare reason (refusedHeads), with no head key in front.
function refusalClass(why) {
  const cs = cutsOf(why);
  if (cs.length === 1) return `not a loop: ${cs[0]}`;
  if (cs.length) return cs.includes('ret') ? 'not a loop: ret + decoder cuts' : 'not a loop: several decoder cuts';
  return why.replace(/\s*\(\d+\)$/, '');
}
const weigh = new Map();
const addW = (k, name, w) => {
  if (!weigh.has(k)) weigh.set(k, { w: 0, progs: new Set() });
  const e = weigh.get(k);
  e.w += w;
  e.progs.add(name);
};
const sole = new Map(), anyCut = new Map();
let haveShares = false;
for (const r of rows) {
  const u = r.u;
  if (!u || !u.refusedHeads) continue;
  haveShares = true;
  const per = 1 / Math.max(1, u.windows);
  for (const h of u.refusedHeads) {
    addW(`refused  ${refusalClass(h.why)}`, r.name, h.share * per);
    // An unsupported HEAD instruction is a cut like any other, and the only one.
    const cs = /^head unsupported: /.test(h.why) ? [h.why.replace(/^head unsupported: /, 'unsupported ')] : cutsOf(h.why);
    for (const c of cs) anyCut.set(c, (anyCut.get(c) || 0) + h.share * per);
    if (cs.length === 1) sole.set(cs[0], (sole.get(cs[0]) || 0) + h.share * per);
  }
  for (const h of (u.demotedHeads || [])) addW(`demoted  ${h.why.replace(/^bails.*/, 'bails')}`, r.name, h.share * per);
  for (const h of (u.liveHeads || [])) addW('LIVE', r.name, h.share * per);
}
if (haveShares) {
  console.log(`\nweighted by sampled time (1.00 = all of one program's time)   weight  programs`);
  for (const [k, e] of [...weigh].sort((a, b) => b[1].w - a[1].w).slice(0, 25)) {
    console.log(`  ${k.padEnd(56)} ${e.w.toFixed(2).padStart(6)}  ${String(e.progs.size).padStart(8)}`);
  }
  console.log(`\nwhat each fix is worth, in the same unit:  sole = heads it alone blocks (incl. the head insn), any = every head it appears in`);
  const keys = new Set([...sole.keys(), ...anyCut.keys()]);
  for (const k of [...keys].sort((a, b) => (sole.get(b) || 0) - (sole.get(a) || 0)).slice(0, 25)) {
    console.log(`  ${k.padEnd(34)} sole ${(sole.get(k) || 0).toFixed(2).padStart(6)}   any ${(anyCut.get(k) || 0).toFixed(2).padStart(6)}`);
  }
}

const dis = rows.filter((r) => r.disagree.length);
if (dis.length) console.log(`\nARMS DISAGREE on outcome: ${dis.map((r) => `${r.name}(${r.disagree.join(',')})`).join(' ')}`);

const list = arg('list', null);
if (list) {
  console.log(`\n${list}:`);
  for (const r of by.get(list) || []) {
    const u = r.u || {};
    console.log(`  ${r.name.padEnd(16)} windows=${u.windows ?? '-'} samples=${u.samples ?? '-'}`
      + ` best=${u.bestShare !== undefined ? (100 * u.bestShare).toFixed(1) + '%' : '-'}`
      + (r.why ? `  ${r.why}` : '')
      // Heads are declined in rank order, so the first is the first window's
      // hottest block: the one that would have mattered most.
      + (u.declined && u.declined.length ? `  top: ${reasonClass(u.declined[0])}` : ''));
  }
}

// Programs that installed NOTHING, by what refused their hottest head: the
// per-program version of the tables above, and the one that decides priority.
const dec = by.get('declined');
if (dec.length) {
  const top = new Map();
  for (const r of dec) {
    const d = r.u.declined[0];
    const cs = cutsOf(d);
    const k = cs.length ? (cs.length === 1 ? `not a loop: ${cs[0]}` : `not a loop: ${cs.includes('ret') ? 'ret + ' : ''}${cs.length} cut kinds`)
      : reasonClass(d).replace(/^head unsupported: .*/, 'head unsupported');
    top.set(k, (top.get(k) || 0) + 1);
  }
  console.log(`\ndeclined programs (${dec.length}), by what refused the hottest head`);
  for (const [k, c] of [...top].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${k}`);
}
