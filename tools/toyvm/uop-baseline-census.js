'use strict';

// Phase 0 of docs/uop-baseline-tier-design.md, measured rather than argued:
// if EVERY hot L1 block were compiled to block-local µops instead of threaded
// code, how many µops per x86 instruction would it take, and how much of the
// program's time could such a tier run at all?
//
//   node tools/toyvm/uop-baseline-census.js <exe>... [--from=sweep.json]
//        [--only=REGEX] [--budget=20m] [--json=out.json] [--top=N]
//
// Per program: one sampled run, rankSamples() for the time per L1 block, and
// for each sampled block a STRAIGHT-LINE region from its head (uop-ir
// discover {straight}: through jmp/call/ret, ending at a conditional branch or
// the first instruction the µop set cannot express). That region is lowered
// under several configurations and the µops on its path are counted:
//
//   naive      uop-ir lower, the exact transcription
//   base       the design's baseline rules: promote + addrfold + flagfwd
//   base+      base + constprop + mergesink + clock (all block-local here)
//   all        every pass (on a straight line, the global passes are local)
//   ...R       the same, guest vregs resident in L1's register file
//              (uop-opt.js finalize): no reload, no write-back, and a narrow
//              register's writes are narrow stores
//
// Two counts per configuration: the optimizer's µops, and the ENGINE ops E1
// dispatches for them after lowering (uop-wasm.js lowerProgram) -- the second
// is the one that prices a resident vreg file, since its narrow stores and
// dropped merges exist only there.
//
// Every block's time lands in exactly one class:
//
//   spin       L1 already folds it (in_*_pspin / in_8_gspin): no tier gains
//   head       the block's FIRST instruction is not in the µop set
//   cut        the region stops early at an unsupported instruction
//   whole      the region covers the block and ends at a branch
//
// A static count: the path's ops plus one per terminator, with the mean exit
// stub, weighted by the block's samples. It prices DISPATCH COUNT, not time --
// the timing gate (phase 0 item 2) is uop-speed.js's job.

const fs = require('fs');
const path = require('path');
const { runDos } = require('./run-dos');
const { rankSamples } = require('./trace-jit');
const { HANDLERS } = require('./emit');
const IR = require('./uop-ir');
const OPT = require('./uop-opt');
const W = require('./uop-wasm');
const { envFromKey } = require('./uop-speed');

const ALL = Object.fromEntries(OPT.PASSES.map(p => [p, true]));
const NONE = Object.fromEntries(OPT.PASSES.map(p => [p, false]));
const CONFIGS = [
  ['naive', null],
  ['base', { ...NONE, promote: true, addrfold: true, flagfwd: true }],
  ['base+', Object.fromEntries(OPT.PASSES.map(p => [p, OPT.BASELINE.includes(p)]))],
  ['all', ALL],
];
for (const [n, c] of CONFIGS.slice(2)) CONFIGS.push([`${n}R`, { ...c, resident: true }]);

function arg(name, dflt) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}
const count = (s) => {
  const m = /^([\d.]+)([km]?)$/i.exec(String(s));
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1));
};

// µops on the path through one lowered straight-line program: every block the
// path runs (ops + terminator) and the mean of its exit stubs.
//
// `size(b)` counts one block: by default its µops and terminator; given a
// lowered program, the engine ops E1 dispatches for it.
function pathUops(prog, fast, size = (b) => b.ops.length + (b.term ? 1 : 0)) {
  let run = 0;
  const exits = [];
  for (const b of prog.blocks) {
    if (b.kind === 'dead') continue;
    const n = size(b);
    if (fast) {
      if (!b.fast) { if (b.id === prog.entry) run += n; continue; }
      if (b.kind === 'fexit') exits.push(n);
      else if (b.kind === 'body' || b.kind === 'pre' || b.kind === 'fenter') run += n;
    } else if (b.kind === 'exit') exits.push(n);
    else if (b.kind === 'body' || b.kind === 'entry') run += n;
  }
  return run + (exits.length ? exits.reduce((a, x) => a + x, 0) / exits.length : 0);
}

// Does the L1 block at arena word `w` carry a spin fold?
function spinFolded(mem32, w) {
  for (let n = 0; n < 64; n++) {
    const h = HANDLERS[mem32[w]];
    if (!h) return false;
    if (/_[pg]spin$/.test(h.name)) return true;
    w += 1 + h.args;
    if (/^(end|jmp|jcc|call|ret|int)/.test(h.name) || /_j[a-z]+(_t)?$/.test(h.name)) return false;
  }
  return false;
}

// The same block as L1 runs it: its threaded ops, and the x86 instructions
// they retire (a fused compare-and-branch is two, the synthetic jump none) --
// so µops per instruction can be set against L1's dispatches per instruction.
function l1Block(mem32, w) {
  let ops = 0, insns = 0;
  for (let n = 0; n < 256; n++) {
    const h = HANDLERS[mem32[w]];
    if (!h) break;
    ops++;
    insns += h.name === 'jmp_syn' || h.name === 'end_cut' ? 0 : /_j[a-z]+(_t)?$/.test(h.name) ? 2 : 1;
    w += 1 + h.args;
    if (/^(end|jmp|jcc|call|ret|int)/.test(h.name) || /_j[a-z]+(_t)?$/.test(h.name)) break;
  }
  return { ops, insns };
}

async function censusOne(exe, o) {
  const cwd = process.cwd();
  process.chdir(path.dirname(exe));
  let r;
  try {
    r = await runDos({ exe: path.basename(exe), budget: o.budget, slice: 20000, sample: true,
      autoKey: true, cpu: 386, log: () => {} });
  } finally { process.chdir(cwd); }
  const rank = rankSamples(r, 0.5);
  const mem32 = new Int32Array(r.vm.mem.buffer);
  const mask = r.vm.exports.get_linmask() >>> 0;
  const rd = (lin) => r.vm.mem[lin];
  const cls = { spin: 0, head: 0, cut: 0, whole: 0 };
  const why = new Map();
  const sums = Object.fromEntries(CONFIGS.map(([n]) => [n, { uops: 0, insns: 0 }]));
  let failed = 0, total = 0, insnsW = 0, l1ops = 0, l1insns = 0;
  for (const b of rank.ranked) {
    const w = b.samples;
    total += w;
    if (spinFolded(mem32, b.addr >> 2)) { cls.spin += w; continue; }
    const env = envFromKey(b.cs, mask);
    let reg;
    try { reg = IR.discover(rd, env, b.bip, { straight: true }); } catch (e) { failed += w; continue; }
    if (!reg.body.size) {
      cls.head += w;
      const k = `head: ${reg.nodes.get(reg.headKey).unsupported}`;
      why.set(k, (why.get(k) || 0) + w);
      continue;
    }
    // What stopped the straight line: an unsupported successor is a cut.
    let cut = null;
    for (const k of reg.body) {
      for (const e of reg.nodes.get(k).succ) {
        const n = e.k && reg.nodes.get(e.k);
        if (n && n.unsupported && !reg.body.has(e.k)) cut = n.unsupported;
      }
    }
    if (cut) { cls.cut += w; const k = `cut: ${cut}`; why.set(k, (why.get(k) || 0) + w); } else cls.whole += w;
    const insns = reg.body.size;
    insnsW += w * insns;
    const l1 = l1Block(mem32, b.addr >> 2);
    if (l1.insns) { l1ops += w * l1.ops; l1insns += w * l1.insns; }
    for (const [name, passes] of CONFIGS) {
      let prog;
      try { prog = OPT.build(reg, { passes, env, vm: r.vm }); } catch (e) { sums[name].err = (sums[name].err || 0) + w; continue; }
      sums[name].uops += w * pathUops(prog, passes !== null);
      sums[name].insns += w * insns;
      if (passes) {
        const low = W.lowerProgram(prog);
        const e = (b) => { const l = low.blocks.get(b.id); return l && l.native ? l.ops.length : b.ops.length + (b.term ? 1 : 0); };
        const en = `${name}:e1`;
        sums[en] = sums[en] || { uops: 0, insns: 0 };
        sums[en].uops += w * pathUops(prog, true, e);
        sums[en].insns += w * insns;
      }
    }
  }
  const per = {};
  for (const name of Object.keys(sums)) per[name] = sums[name].insns ? sums[name].uops / sums[name].insns : null;
  const share = (x) => (total ? x / total : 0);
  return {
    name: path.basename(exe), blocks: rank.ranked.length, samples: total,
    spin: share(cls.spin), head: share(cls.head), cut: share(cls.cut), whole: share(cls.whole),
    failed: share(failed), meanInsns: insnsW / Math.max(1, total - cls.spin - cls.head - failed),
    per, l1: l1insns ? l1ops / l1insns : null, why: [...why].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, share(v)]),
  };
}

async function main() {
  let exes = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const from = arg('from', null);
  if (from) exes = exes.concat(JSON.parse(fs.readFileSync(from, 'utf8')).rows.map(x => x.exe));
  const only = arg('only', null);
  if (only) exes = exes.filter(e => new RegExp(only, 'i').test(path.basename(e)));
  const budget = count(arg('budget', '20m'));
  const rows = [];
  for (const exe of exes) {
    let row;
    try { row = await censusOne(exe, { budget }); } catch (e) { row = { name: path.basename(exe), error: String(e.message || e).slice(0, 160) }; }
    rows.push(row);
    if (row.error) { console.log(`${row.name.padEnd(14)} ERROR ${row.error}`); continue; }
    const p = (x) => (x * 100).toFixed(0).padStart(3) + '%';
    const u = (x) => (x == null ? '  -  ' : x.toFixed(2).padStart(5));
    console.log(`${row.name.padEnd(14)} spin${p(row.spin)} head${p(row.head)} cut${p(row.cut)} whole${p(row.whole)}`
      + `  insn/blk ${row.meanInsns.toFixed(1).padStart(4)}  L1 op/insn ${u(row.l1)}  µop/insn naive ${u(row.per.naive)} base ${u(row.per.base)}`
      + ` base+ ${u(row.per['base+'])} all ${u(row.per.all)}  E1 all ${u(row.per['all:e1'])} allR ${u(row.per['allR:e1'])}  ${row.why.slice(0, 2).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`);
  }
  const ok = rows.filter(r => !r.error && r.samples > 0);
  if (ok.length > 1) {
    const med = (xs) => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
    const mean = (k) => ok.reduce((a, r) => a + r[k], 0) / ok.length;
    console.log(`\n${ok.length} programs  mean share: spin ${(mean('spin') * 100).toFixed(1)}%  head ${(mean('head') * 100).toFixed(1)}%`
      + `  cut ${(mean('cut') * 100).toFixed(1)}%  whole ${(mean('whole') * 100).toFixed(1)}%`);
    const NAMES = [...CONFIGS.map(([n]) => n), ...CONFIGS.slice(1).map(([n]) => `${n}:e1`)];
    console.log(`median µop/insn: ${NAMES.map((n) => `${n} ${(med(ok.map(r => r.per[n])) || 0).toFixed(2)}`).join('  ')}`
      + `   median L1 op/insn ${(med(ok.map(r => r.l1)) || 0).toFixed(2)}`);
    // Dispatch-cost model from the Ion instruction counts: an E1 transition
    // ~11 native instructions, an L1 threaded dispatch ~33. <1 favours E1.
    const ratio = (n) => med(ok.filter(r => r.l1 && r.per[n]).map(r => (r.per[n] * 11) / (r.l1 * 33)));
    console.log(`median dispatch-cost ratio E1/L1 (11 vs 33 insns per transition): `
      + NAMES.map((n) => `${n} ${(ratio(n) || 0).toFixed(2)}`).join('  '));
    const agg = new Map();
    for (const r of ok) for (const [k, v] of r.why) agg.set(k, (agg.get(k) || 0) + v / ok.length);
    console.log(`top stop reasons (mean share): ${[...agg].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')}`);
  }
  const out = arg('json', null);
  if (out) fs.writeFileSync(out, JSON.stringify({ budget, configs: CONFIGS.map(([n]) => n), rows }, null, 1));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { censusOne, pathUops, CONFIGS };
