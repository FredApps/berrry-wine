#!/usr/bin/env node
'use strict';

// The micro-op tier's driver: find hot loops in real programs, lower them,
// check them against the interpreter, and count what the passes remove.
//
//   node tools/toyvm/uop-bench.js census EXE [--budget=N] [--top=N]
//       Profile EXE, rank its hot blocks, and for each one say what the
//       region discovery makes of it: body size, exits, and every
//       instruction that ended the region because the lowering does not
//       handle it.
//
//   node tools/toyvm/uop-bench.js diff EXE [--head=KEY:IP] [--budgets=a,b,c]
//       Snapshot the guest standing at a loop head, then run the L1 arm and
//       the µop arm (JS reference interpreter) from it at each budget and
//       compare registers, live flags, memory, gip and unspent budget. Also
//       prints dynamic µops per iteration, naive vs optimized, per pass
//       ablation.

const path = require('path');
const { disasmAt } = require(path.join(__dirname, '..', 'disasm.js'));
const H = require('./uop-harness');
const IR = require('./uop-ir');
const { runRef } = require('./uop-ref');
const OPT = require('./uop-opt');
const { profile, capture, envFromKey, bench } = require('./uop-speed');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const a = args.find(x => x === `--${n}` || x.startsWith(`--${n}=`));
  if (!a) return d;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const num = (s) => {
  if (typeof s === 'number') return s;
  const m = /^([\d.]+)([kmb]?)$/i.exec(s);
  if (!m) return Number(s);
  return Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()];
};
const hex = (v) => (v >>> 0).toString(16);

function describeRegion(vm, env, headIp, log) {
  const rd = (lin) => vm.mem[lin];
  const reg = IR.discover(rd, env, headIp);
  const body = [...reg.body].map(k => reg.nodes.get(k));
  const unsup = [...reg.nodes.values()].filter(n => n.unsupported);
  log(`    body ${body.length} insns${reg.cyclic ? '' : ' (NOT a loop through the head)'}, `
    + `${reg.nodes.size} explored, ${unsup.length} unsupported`);
  const why = new Map();
  for (const n of unsup) why.set(n.unsupported, (why.get(n.unsupported) || 0) + 1);
  if (why.size) log(`    unsupported: ${[...why].map(([k, n]) => `${k} x${n}`).join(', ')}`);
  return reg;
}

function disasm(vm, env, ip, count, log) {
  const buf = Buffer.from(vm.mem.buffer);
  try {
    const lines = disasmAt(buf, (env.codeBase + ip) & env.mask, ip, count, null,
      { bits: env.d32 ? 32 : 16 });
    for (const l of lines) log(`      ${typeof l === 'string' ? l : JSON.stringify(l)}`);
  } catch (e) { log(`      (disasm failed: ${e.message})`); }
}

async function census(exe) {
  const o = { budget: num(flag('budget', '20m')), slice: num(flag('slice', '20000')),
    sampleFrom: Number(flag('sample-from', '0.5')) };
  const { r, rank } = await profile(exe, o);
  const top = Number(flag('top', '6'));
  console.log(`${path.basename(exe)}: ${r.dispatched} dispatched, ${rank.total} samples`);
  const mask = r.vm.exports.get_linmask() >>> 0;
  for (const b of rank.ranked.slice(0, top)) {
    const env = envFromKey(b.cs, mask);
    console.log(`  ${b.cs}:${hex(b.bip)}  ${(100 * b.samples / rank.total).toFixed(1)}%`);
    describeRegion(r.vm, env, b.bip, console.log);
    if (flag('disasm')) disasm(r.vm, env, b.bip, 24, console.log);
  }
}

// One differential comparison of `prog` (µop program at `ip`) against L1.
function differential(vm, snap, prog, budget, opts = {}) {
  const head = { codeBase: snap.env.codeBase, ip: prog.headIp };
  let cache = H.seed(vm, snap);
  vm.exports.get_flags();
  const a = H.runArm(vm, cache, budget);
  const sa = H.guestState(vm, a);
  cache = H.seed(vm, snap);
  vm.exports.get_flags();
  const stats = { n: 0, steps: 0, runs: 0, counts: opts.counts || null };
  if (opts.install) opts.install();
  const b = H.runArm(vm, cache, budget, {
    head,
    enter: opts.enter ? (vm2, left) => { stats.runs++; return opts.enter(vm2, left); } : (vm2, left) => {
      vm2.exports.set_steps(left);
      const res = runRef(vm2, prog, { counts: stats.counts });
      stats.n += res.n; stats.steps += left - res.steps; stats.runs++;
      stats.heads = (stats.heads || 0) + (res.heads || 0);
      return res.steps;
    },
  });
  const sb = H.guestState(vm, b);
  return { l1: sa, uop: sb, diff: H.diffStates(sa, sb), stats };
}

module.exports = { profile, capture, differential, census, describeRegion, envFromKey };

if (require.main === module) {
  const mode = args[0];
  const exe = args[1];
  (async () => {
    if (mode === 'census') return census(exe);
    if (mode === 'diff') {
      const o = { budget: num(flag('budget', '20m')), slice: num(flag('slice', '20000')),
        sampleFrom: Number(flag('sample-from', '0.5')), head: flag('head', null),
        pick: Number(flag('pick', '0')) };
      const c = await capture(exe, o);
      console.log(`snapshot at ${c.key}:${hex(c.ip)}`);
      const reg = describeRegion(c.vm, c.env, c.ip, console.log);
      const budgets = String(flag('budgets', '0,1,3,37,1000,100000')).split(',').map(num);
      const only = flag('configs', null);
      let configs = OPT.ablationConfigs();
      if (only) configs = configs.filter(([n]) => String(only).split(',').includes(n));
      let bad = 0;
      const engine = flag('engine', 'ref');
      for (const [cname, passes] of configs) {
        const prog = OPT.build(reg, { passes, env: c.env, vm: c.vm });
        const st = {};
        const eopts = engine === 'ref' ? {} : { enter: await require('./uop-wasm').makeEnter(c.vm, prog, engine, st), install: () => st.install && st.install() };
        if (flag('dump') && cname === 'all') IR.dump(prog);
        const cells = [];
        let per = '';
        for (const B of budgets) {
          const d = differential(c.vm, c.snap, prog, B, eopts);
          if (d.diff.length) { bad++; cells.push(`${B}:MISMATCH ${d.diff.slice(0, 4).join('; ')}`); }
          if (B === budgets[budgets.length - 1]) {
            per = `${(d.stats.n / Math.max(1, d.stats.heads)).toFixed(1)} µop/iter`
              + ` ${(d.stats.n / Math.max(1, d.stats.steps)).toFixed(2)} µop/insn`
              + ` runs=${d.stats.runs} heads=${d.stats.heads}`;
          }
        }
        console.log(`  [${cname}] ${cells.length ? cells.join(' | ') : 'agree'}  ${per}`);
      }
      if (bad) process.exitCode = 1;
      return undefined;
    }
    if (mode === 'speed') {
      const r = await bench({ exe, budget: num(flag('budget', '20m')), slice: num(flag('slice', '20000')),
        sampleFrom: Number(flag('sample-from', '0.5')), head: flag('head', null), pick: Number(flag('pick', '0')),
        engines: String(flag('engines', 'l1,e1,straight')).split(','),
        configs: String(flag('configs', 'all')).split(','),
        steps: num(flag('steps', '2m')), warm: num(flag('warm', '50000')), reps: Number(flag('reps', '5')) });
      console.log(`${path.basename(exe)} ${r.head}: body ${r.body} insns`);
      for (const b of r.rows) {
        console.log(`  ${b.name.padEnd(22)} ${b.ns.toFixed(2)} ns/insn  steps=${b.steps} ${b.why}`
          + ` entries=${b.entries} handbacks=${b.handbacks} bails=${b.bails}`
          + (b.x !== null ? `  x${b.x.toFixed(2)} vs L1` : ''));
      }
      return undefined;
    }
    console.error('usage: uop-bench.js census|diff|speed EXE [...]');
    process.exitCode = 2;
    return undefined;
  })().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
}
