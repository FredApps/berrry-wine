'use strict';
// Private-copy run of the worker-A regression spec (regression-spec.md):
// does a region arm deliver the timer in front of a different instruction
// than the interpreter, one loop iteration early, at a head an install made a
// block start? Usage: node run-spec.js <toyvm-root> <outdir>
// <toyvm-root> is a directory holding tools/toyvm (a private copy at HEAD).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const { runDos } = require(path.join(ROOT, 'tools/toyvm/run-dos'));
const { inlineBackend } = require(path.join(ROOT, 'tools/toyvm/region-prepare'));

function asm() {
  const b = [], labels = new Map(), fixups = [];
  const at = () => 0x100 + b.length;
  return {
    w: (...x) => { b.push(...x); },
    label(n) { labels.set(n, at()); },
    rel8(n) { fixups.push({ i: b.length, n, size: 1 }); b.push(0); },
    rel16(n) { fixups.push({ i: b.length, n, size: 2 }); b.push(0, 0); },
    abs16(n) { fixups.push({ i: b.length, n, size: 2, abs: true }); b.push(0, 0); },
    at,
    addr: (n) => labels.get(n),
    done() {
      for (const f of fixups) {
        const target = labels.get(f.n);
        assert.ok(target !== undefined, `no such label: ${f.n}`);
        const v = f.abs ? target : target - (0x100 + f.i + f.size);
        if (f.size === 1) {
          assert.ok(v >= -128 && v <= 127, `${f.n} is out of rel8 range (${v})`);
          b[f.i] = v & 0xFF;
        } else { b[f.i] = v & 0xFF; b[f.i + 1] = (v >> 8) & 0xFF; }
      }
      return Buffer.from(b);
    },
  };
}

const INNER = 7, ADD = 7, XOR = 0x5A5A, OUT_HI = 4, OUT_LO = 64000;
function program({ headIsCallTarget = false } = {}) {
  const a = asm(); const { w } = a;
  const lo = (n) => n & 0xFF, hi = (n) => (n >> 8) & 0xFF;
  const setup = () => {
    w(0x31, 0xFF); w(0x31, 0xD2); w(0x89, 0xF0); w(0x25, 0x07, 0x00); w(0x01, 0xC2);
    w(0x83, 0xC2, 0x11); w(0xD1, 0xC2); w(0x81, 0xF2, 0x01, 0x01); w(0x01, 0xF2); w(0x42);
  };
  w(0xB8, 0x08, 0x25); w(0xBA); a.abs16('isr'); w(0xCD, 0x21);
  w(0x31, 0xDB); w(0x31, 0xF6); w(0xBD, lo(OUT_HI), hi(OUT_HI));
  a.label('outer2');
  w(0xB9, lo(OUT_LO), hi(OUT_LO));
  a.label('outer1');
  if (headIsCallTarget) { setup(); w(0xE8); a.rel16('hot'); } else { w(0xE8); a.rel16('sub'); }
  w(0x01, 0xD3); w(0xE2); a.rel8('outer1');
  w(0x4D); w(0x75); a.rel8('outer2');
  w(0x8B, 0x3E); a.abs16('acc'); w(0x8B, 0x2E); a.abs16('ticks');
  w(0xB8, 0x00, 0x4C); w(0xCD, 0x21);
  if (!headIsCallTarget) { a.label('sub'); setup(); }
  a.label('hot');
  w(0x83, 0xC2, ADD); w(0x81, 0xF2, lo(XOR), hi(XOR)); w(0x46); w(0x47);
  w(0x83, 0xFF, INNER); w(0x74); a.rel8('done');
  a.label('jmpip'); w(0xEB); a.rel8('hot');
  a.label('done'); w(0xC3);
  a.label('isr');
  w(0x50); w(0x01, 0x3E); a.abs16('acc'); w(0xFF, 0x06); a.abs16('ticks');
  w(0xB0, 0x20); w(0xE6, 0x20); w(0x58); w(0xCF);
  while ((a.at() & 15) !== 0) w(0x90);
  for (let i = 0; i < 32; i++) w(0x90);
  a.label('acc'); w(0, 0); a.label('ticks'); w(0, 0);
  const bytes = a.done();
  return { bytes, hot: a.addr('hot'), jmpip: a.addr('jmpip') };
}

function expected() {
  let bx = 0, si = 0;
  for (let c = 0; c < OUT_HI * OUT_LO; c++) {
    let dx = (si & 7) & 0xFFFF, di = 0;
    dx = (dx + 0x11) & 0xFFFF; dx = ((dx << 1) | (dx >>> 15)) & 0xFFFF;
    dx ^= 0x0101; dx = (dx + si) & 0xFFFF; dx = (dx + 1) & 0xFFFF;
    do { dx = (dx + ADD) & 0xFFFF; dx ^= XOR; si = (si + 1) & 0xFFFF; di++; } while (di !== INNER);
    bx = (bx + dx) & 0xFFFF;
  }
  return { bx, si };
}

async function run(com, name, jit, budget = 60e6, slice = 5e4) {
  const irqs = [];
  const r = await runDos({
    exe: com, budget, slice, irqEvery: 2003, traceIrq: true,
    log: (s) => {
      const m = /^\s*irq vec=(\w+) (\w+)\s+at=(\d+) hb=\d+ t=(\S+) from (\w+):(\w+)/.exec(s);
      if (m) irqs.push({ vec: m[1], src: m[2], at: +m[3], t: m[4], cs: m[5], ip: parseInt(m[6], 16) });
    },
    regionJit: jit ? { sampleAfter: 2e6, profileFor: 4e6, minOps: 2, gateAt: 0,
      backend: inlineBackend(), log: () => {}, sep: true } : null,
  });
  const g = r.vm.getAll();
  const res = { name, dispatched: r.dispatched, handbacks: r.handbacks, bx: g.bx, si: g.si, di: g.di, bp: g.bp,
    jit: r.jit ? { installs: r.jit.installs, at: r.jit.at, phase: r.jit.phase, declined: r.jit.declined } : null,
    irqCount: irqs.length };
  fs.writeFileSync(path.join(OUT, `${name}.irq`), irqs.map(e => `${e.vec} ${e.src} at=${e.at} t=${e.t} from ${e.cs}:${e.ip.toString(16)}`).join('\n') + '\n');
  return { res, irqs };
}

const key = (e) => `${e.vec} ${e.src} at=${e.at} t=${e.t} from ${e.cs}:${e.ip.toString(16)}`;
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let first = -1, count = 0;
  for (let i = 0; i < n; i++) if (key(a[i]) !== key(b[i])) { count++; if (first < 0) first = i; }
  return { first, count, lenA: a.length, lenB: b.length };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const main = program(), nc1 = program({ headIsCallTarget: true });
  const comMain = path.join(OUT, 'MAIN.COM'), comNc1 = path.join(OUT, 'NC1.COM');
  fs.writeFileSync(comMain, main.bytes); fs.writeFileSync(comNc1, nc1.bytes);
  const exp = expected();
  const report = { expected: exp, hot: main.hot.toString(16), jmpip: main.jmpip.toString(16), checks: {} };
  const t0 = Date.now();
  const L1 = await run(comMain, 'L1', false);
  const RJ = await run(comMain, 'RJ', true);
  const N1L = await run(comNc1, 'NC1-L1', false);
  const N1R = await run(comNc1, 'NC1-RJ', true);
  const NC2 = await run(comMain, 'NC2', false, 60e6, 2e6);
  report.runs = [L1, RJ, N1L, N1R, NC2].map(x => x.res);
  const c = report.checks;
  c.P1 = L1.res.bx === exp.bx && L1.res.si === exp.si && exp.bx !== 0;
  c.P2 = !!(RJ.res.jit && RJ.res.jit.installs >= 1 && RJ.res.jit.at && RJ.res.jit.at.includes(main.hot));
  c.P3 = L1.irqs.filter(e => e.vec === '08').length >= 2000 && L1.res.bp === L1.irqs.filter(e => e.vec === '08').length;
  c.P4 = firstDiff(L1.irqs, NC2.irqs);
  c.A5 = RJ.res.bx === exp.bx && RJ.res.si === exp.si;
  c.A1 = { L1: L1.res.dispatched, RJ: RJ.res.dispatched, delta: RJ.res.dispatched - L1.res.dispatched };
  const d = firstDiff(L1.irqs, RJ.irqs);
  c.A3 = { ...d, pass: d.count === 0 && d.lenA === d.lenB,
    firstL1: d.first >= 0 ? key(L1.irqs[d.first]) : null, firstRJ: d.first >= 0 ? key(RJ.irqs[d.first]) : null };
  c.A4 = { L1di: L1.res.di, RJdi: RJ.res.di, pass: L1.res.di === RJ.res.di };
  const n1 = firstDiff(N1L.irqs, N1R.irqs);
  c.NC1 = { P2: !!(N1R.res.jit && N1R.res.jit.installs >= 1), irqDiffs: n1.count, lens: [n1.lenA, n1.lenB],
    di: [N1L.res.di, N1R.res.di], dispatched: [N1L.res.dispatched, N1R.res.dispatched],
    bxOk: N1L.res.bx === exp.bx && N1R.res.bx === exp.bx };
  if (!c.A3.pass && d.first >= 0) {
    const X = RJ.irqs[d.first].at;
    const a2L = await run(comMain, 'A2-L1', false, X - 1);
    const a2R = await run(comMain, 'A2-RJ', true, X - 1);
    c.A2 = { budget: X - 1, L1: a2L.res.dispatched, RJ: a2R.res.dispatched, pass: a2L.res.dispatched === a2R.res.dispatched };
  } else c.A2 = 'skipped (A3 passed)';
  report.wallMs = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.checks, null, 1));
  console.log('wallMs', report.wallMs);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
