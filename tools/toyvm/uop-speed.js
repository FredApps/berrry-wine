'use strict';

// Snapshot capture and wall-clock timing for the micro-op tier, with nothing
// Node-only in reach, so tools/toyvm/uop-shell-bench.js can run it inside a
// bare d8 / SpiderMonkey shell from a bundle as well as under node.
//
//   capture(exe, o)  profile the program, then step it to a hot loop head
//                    (o.head = 'KEY:IP', or the o.pick-th hottest block) and
//                    snapshot the machine standing there.
//   speed(vm, snap, arms, o)
//                    time each arm -- L1, or a µop program on an engine --
//                    from that snapshot; best ns per x86 instruction.
//   bench(o)         both, for one program, returning plain rows.

const { runDos } = require('./run-dos');
const { rankSamples } = require('./trace-jit');
const H = require('./uop-harness');
const IR = require('./uop-ir');
const OPT = require('./uop-opt');
const W = require('./uop-wasm');
const { runRef } = require('./uop-ref');

function envFromKey(key, mask) {
  const d32 = typeof key === 'string' && key.endsWith('d');
  const ip32 = d32 || (typeof key === 'string' && key.endsWith('w'));
  return { codeBase: typeof key === 'number' ? key : parseInt(key, 10), mask, d32, ip32 };
}

async function profile(exe, o) {
  const r = await runDos({ exe, budget: o.budget, slice: o.slice, sample: true,
    autoKey: true, log: () => {} });
  return { r, rank: rankSamples(r, o.sampleFrom) };
}

// A named head is hot in some phase of the program, not necessarily the one
// running at o.budget: an intro effect can be over by 20M steps, a later scene
// not yet begun (27 of the 67 corpus heads missed at a flat 20M). So run to
// each budget of a ladder around o.budget, fresh each time, and stand at the
// head from the first one it recurs after.
async function captureHead(exe, o) {
  const m = /^(\w+):([0-9a-f]+)$/i.exec(o.head);
  const key = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
  const ip = parseInt(m[2], 16);
  const B = o.budget;
  const ladder = [...new Set([B, B / 2, B / 4, B / 8, B * 2, B * 4].map((x) => Math.max(1e6, Math.round(x))))];
  for (const budget of ladder) {
    const r = await runDos({ exe, budget, slice: o.slice, autoKey: true, log: () => {} });
    const env = envFromKey(key, r.vm.exports.get_linmask() >>> 0);
    if (!H.stepTo(r.vm, {}, env.codeBase, ip, 2e6, r.machine)) continue;
    const snap = H.snapshot(r.vm, { key, head: ip });
    return { vm: r.vm, snap, env: H.envOf(r.vm), key, ip, at: budget };
  }
  throw new Error(`never reached ${o.head} after any of ${ladder.map((x) => `${x / 1e6}M`).join(' ')} steps`);
}

async function capture(exe, o) {
  if (o.head) return captureHead(exe, o);
  const { r, rank } = await profile(exe, o);
  let key, ip;
  {
    const b = rank.ranked[o.pick || 0];
    if (!b) throw new Error('no hot block');
    key = b.cs; ip = b.bip;
  }
  const mask = r.vm.exports.get_linmask() >>> 0;
  const env = envFromKey(key, mask);
  if (!H.stepTo(r.vm, {}, env.codeBase, ip, 2e6, r.machine)) throw new Error(`never reached ${key}:${ip.toString(16)}`);
  const snap = H.snapshot(r.vm, { key, head: ip });
  return { vm: r.vm, snap, env: H.envOf(r.vm), key, ip, at: o.budget };
}

// Each rep seeds every arm from the snapshot, in an order that alternates, so
// machine load lands on all of them.
//
// L1 warms up in place (its block cache is per seed) and is then timed in the
// loop's steady state. An engine is entered by the host only at a handback
// standing at the head, so it is timed from the snapshot -- which IS the head:
// one entry covers the budget, and the min over reps drops the run that paid
// for tier-up. A step is one guest instruction dispatched, so ns/step is ns
// per x86 instruction on every arm.
async function speed(vm, snap, arms, o = {}) {
  const budget = o.budget || 2e6, warm = o.warm || 50000, reps = o.reps || 5;
  const now = () => process.hrtime.bigint();
  const head = { codeBase: snap.env.codeBase };
  const prepared = [];
  for (const a of arms) {
    if (a.engine === 'l1') { prepared.push({ ...a, enter: null }); continue; }
    const st = {};
    const enter = a.engine === 'ref'
      ? (vm2, left) => { vm2.exports.set_steps(left); return runRef(vm2, a.prog).steps; }
      : await W.makeEnter(vm, a.prog, a.engine, st);
    prepared.push({ ...a, enter, st, head: { ...head, ip: a.prog.headIp } });
  }
  const best = new Map();
  for (let r = 0; r < reps; r++) {
    const order = r % 2 ? [...prepared].reverse() : prepared;
    for (const a of order) {
      const cache = H.seed(vm, snap);
      if (a.st && a.st.install) a.st.install();
      if (!a.enter) {
        const w = H.runArm(vm, cache, warm);
        if (w.why !== 'budget') throw new Error(`${a.name}: warm-up ended by ${w.why}`);
      }
      let runs = 0;
      const opts = a.enter ? { head: a.head, enter: (v2, left) => { runs++; return a.enter(v2, left); } } : {};
      const t0 = now();
      const res = H.runArm(vm, cache, budget, opts);
      const ns = Number(now() - t0);
      const steps = budget - res.left;
      const per = ns / steps;
      const prev = best.get(a.name);
      if (!prev || per < prev.ns) {
        best.set(a.name, { ns: per, steps, why: res.why, entries: runs, handbacks: res.handbacks,
          bails: a.st ? a.st.bails : 0, bailAt: bailSites(a) });
      }
    }
  }
  return best;
}

// The blocks a program bailed on most, with why each has no native form:
// 'N x B12 deopt ip=3f0: full memory'. A bail row's time is the reference
// interpreter's, so this names what to lower next.
function bailSites(a, top = 3) {
  if (!a.st || !a.st.bails || !a.st.bailAt) return [];
  const low = a.st.low;
  return [...a.st.bailAt].sort((x, y) => y[1] - x[1]).slice(0, top).map(([bid, n]) => {
    const b = a.prog.blocks[bid] || {};
    const lb = low && low.blocks && low.blocks.get ? low.blocks.get(bid) : null;
    const ip = b.ip === undefined ? '?' : b.ip.toString(16);
    return `${n}x B${bid} ${b.fast ? 'fast' : 'slow'}-${b.kind} ip=${ip}: ${(lb && lb.why) || '?'}`;
  });
}

// One program: capture, build the programs, time. Arms are named ENGINE/CONFIG
// (and 'l1'). Returns { head, body, rows: [{ name, ns, x, ... }] }.
async function bench(o) {
  const c = await capture(o.exe, { budget: o.budget || 20e6, slice: o.slice || 20000,
    sampleFrom: o.sampleFrom || 0.5, head: o.head || null, pick: o.pick || 0 });
  const reg = IR.discover((lin) => c.vm.mem[lin], c.env, c.ip);
  const configs = OPT.ablationConfigs();
  const arms = [];
  for (const e of o.engines || ['l1', 'e1', 'straight']) {
    if (e === 'l1') { arms.push({ name: 'l1', engine: 'l1' }); continue; }
    // A config named twice is a second, independent arm of the same program
    // (`all#2`): the pair's spread is the run's own null band.
    const seen = new Map();
    for (const cn of o.configs || ['all']) {
      const hit = configs.find(([n]) => n === cn);
      if (!hit) throw new Error(`no config ${cn}`);
      const k = (seen.get(cn) || 0) + 1;
      seen.set(cn, k);
      const name = `${e}/${cn}${k > 1 ? `#${k}` : ''}`;
      arms.push({ name, engine: e, prog: OPT.build(reg, { passes: hit[1], env: c.env, vm: c.vm }) });
    }
  }
  const best = await speed(c.vm, c.snap, arms, { budget: o.steps || 2e6, warm: o.warm || 50000, reps: o.reps || 5 });
  const base = best.get('l1');
  const rows = [...best].map(([name, b]) => ({ name, ...b, x: base ? base.ns / b.ns : null }));
  return { head: `${c.key}:${c.ip.toString(16)}`, at: c.at, body: reg.body.size, rows };
}

module.exports = { envFromKey, profile, capture, speed, bench };
