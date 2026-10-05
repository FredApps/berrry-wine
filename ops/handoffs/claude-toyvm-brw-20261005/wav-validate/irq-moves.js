#!/usr/bin/env node
'use strict';
// Which interrupt deliveries differ between two COMPLETE --trace-irq logs?
// Each delivery is keyed by (vec, src, at); `hb=` (the cache-dependent handback
// index) and `t=` (derived from at) are ignored. Prints how many deliveries are
// common, only-A and only-B, a histogram by source, and for the only-A ones how
// many sit EXACTLY on a 70 Hz frame edge (k*143051) or a BIOS tick (k*550000)
// -- program-independent dates under --pit-clock. Lattice and timer dates
// depend on the program's PIT reload and are not checked here, so "exactly on
// a date" is a lower bound.
//
//   node irq-moves.js <a.log> <b.log> [--json]

const fs = require('fs');
const [fa, fb] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
if (!fa || !fb) { console.error('usage: node irq-moves.js <a.log> <b.log> [--json]'); process.exit(2); }
const read = (f) => fs.readFileSync(f, 'utf8').split('\n')
  .map((l) => l.match(/^\s*irq vec=(\S+) (\S+)\s+at=(\d+) /)).filter(Boolean)
  .map((m) => ({ vec: m[1], src: m[2], at: Number(m[3]), key: `${m[1]} ${m[2]} ${m[3]}` }));
const A = read(fa), B = read(fb);
const count = (xs) => xs.reduce((m, x) => m.set(x.key, (m.get(x.key) || 0) + 1), new Map());
const ca = count(A), cb = count(B);
const only = (xs, other) => { const o = new Map(other); return xs.filter((x) => { const n = o.get(x.key) || 0; if (n) { o.set(x.key, n - 1); return false; } return true; }); };
const onlyA = only(A, cb), onlyB = only(B, ca);
const bySrc = (xs) => xs.reduce((m, x) => ({ ...m, [x.src]: (m[x.src] || 0) + 1 }), {});
const onDate = (xs) => xs.filter((x) => x.at % 143051 === 0 || x.at % 550000 === 0).length;
const r = {
  a: { lines: A.length, src: bySrc(A) }, b: { lines: B.length, src: bySrc(B) },
  common: A.length - onlyA.length, onlyA: onlyA.length, onlyB: onlyB.length,
  onlyASrc: bySrc(onlyA), onlyBSrc: bySrc(onlyB),
  onlyAExactlyOnFrameOrTick: onDate(onlyA), onlyBExactlyOnFrameOrTick: onDate(onlyB),
  firstOnlyA: onlyA.slice(0, 3).map((x) => x.key), firstOnlyB: onlyB.slice(0, 3).map((x) => x.key),
};
if (process.argv.includes('--json')) console.log(JSON.stringify(r));
else for (const [k, v] of Object.entries(r)) console.log(`${k.padEnd(26)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
