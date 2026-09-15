#!/usr/bin/env node
// Turn collect-round13-windows.sh's 26 logs into section 22.6's table.
//
// One row per window, both arms side by side. The columns are the ones the
// round is about:
//
//   decodes       `cache: block decodes` (--verbose). Round 13's whole claim is
//                 that an install must not cost a decode, so this is the
//                 headline and the ON arm is supposed to sit ON TOP of the OFF
//                 arm, not above it.
//   pages         `pages: compiled` (--verbose), the other decode-time cost.
//   installs/entries/native%/fallback   the one-block executor's own line.
//   regions installs / opsMulti%        the multi-block matcher: opsMulti over
//                 (ops1 + opsMulti) is the share of retired micro-ops that ran
//                 inside a descriptor the ONE-block matcher could never have
//                 built.
//   split/rle/movelim/immfold/rmw       the round-11/12 decode-time pass.
//
//   cap           `batch` when the arm stopped on --max-batches and `time` when
//                 --max-seconds got there first. A time-capped arm reached a
//                 different point of its app than its partner may have, so its
//                 ABSOLUTE columns are not deterministic and the row says so.
//
// Usage: node docs/block-executor-design/parse-round13-windows.js <dir> [--json]
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: node parse-round13-windows.js <log dir> [--json]');
  process.exit(2);
}
const AS_JSON = process.argv.includes('--json');

const WINDOWS = [
  'quake2-loading', 'quake2-gameplay',
  'mw3-loading', 'mw3-gameplay',
  'gta2-loading', 'gta2-gameplay',
  'rct-loading', 'rct-gameplay',
  'heroes2-loading', 'heroes2-gameplay',
  'caesar3-loading', 'starcraft-loading', 'diablo-loading',
];

// --max-batches as collect-round13-windows.sh sets it, so "did this arm reach
// its batch cap" is answerable without re-reading the shell script.
const CAP = {
  'quake2-loading': 2600, 'quake2-gameplay': 20000,
  'mw3-loading': 830, 'mw3-gameplay': 1400,
  'gta2-loading': 3000, 'gta2-gameplay': 9000,
  'rct-loading': 4250, 'rct-gameplay': 6000,
  'heroes2-loading': 1400, 'heroes2-gameplay': 3000,
  'caesar3-loading': 1600, 'starcraft-loading': 1500, 'diablo-loading': 400,
};

function num(re, text, group) {
  const m = re.exec(text);
  return m ? Number(m[group == null ? 1 : group]) : null;
}

function parse(file, window) {
  if (!fs.existsSync(file)) return null;
  const t = fs.readFileSync(file, 'utf8');
  const bx = /^block-exec: M .*$/m.exec(t);
  const sp = /^block-exec-split: M .*$/m.exec(t);
  const rg = /^block-exec-regions: M {2}armed .*$/m.exec(t);
  const batches = (() => {
    let last = null;
    for (const m of t.matchAll(/(\d+) batches in ([\d.]+)s/g)) last = m;
    return last ? { n: Number(last[1]), secs: Number(last[2]) } : null;
  })();
  const ops1 = sp && rg ? num(/ops1 (\d+)/, rg[0]) : null;
  const opsMulti = rg ? num(/opsMulti (\d+)/, rg[0]) : null;
  const nat = bx ? num(/ops native (\d+)/, bx[0]) : null;
  const fb = bx ? num(/fallback (\d+)/, bx[0]) : null;
  return {
    armed: bx ? /armed yes/.test(bx[0]) : false,
    decodes: num(/^cache: block decodes (\d+)/m, t),
    pages: num(/^pages: compiled (\d+)/m, t),
    installs: bx ? num(/installs (\d+)/, bx[0]) : null,
    declines: bx ? num(/declines (\d+)/, bx[0]) : null,
    entries: bx ? num(/entries (\d+)/, bx[0]) : null,
    native: nat,
    fallback: fb,
    nativePct: bx ? (/native% ([\d.]+)/.exec(bx[0]) || [])[1] ?? null : null,
    transfersSaved: bx ? num(/transfersSaved (\d+)/, bx[0]) : null,
    regionInstalls: rg ? num(/installs (\d+)/, rg[0]) : null,
    regionDeclines: rg ? num(/declines (\d+)/, rg[0]) : null,
    meanBlocks: rg ? (/meanBlocks ([\d.-]+)/.exec(rg[0]) || [])[1] ?? null : null,
    ops1,
    opsMulti,
    opsMultiPct: ops1 != null && opsMulti != null && (ops1 + opsMulti) > 0
      ? (100 * opsMulti / (ops1 + opsMulti)) : null,
    split: sp ? num(/ split (\d+)/, sp[0]) : null,
    rle: sp ? num(/ rle (\d+)/, sp[0]) : null,
    movelim: sp ? num(/ movelim (\d+)/, sp[0]) : null,
    immfold: sp ? num(/ immfold (\d+)/, sp[0]) : null,
    rmw: sp ? num(/ rmw (\d+)/, sp[0]) : null,
    uopsBefore: sp ? num(/uopsBefore (\d+)/, sp[0]) : null,
    uopsAfter: sp ? num(/uopsAfter (\d+)/, sp[0]) : null,
    batches: batches ? batches.n : null,
    seconds: batches ? batches.secs : null,
    cap: batches ? (batches.n >= CAP[window] ? 'batch' : 'time') : '?',
  };
}

const rows = [];
for (const w of WINDOWS) {
  rows.push({
    window: w,
    off: parse(path.join(DIR, `${w}-off.log`), w),
    on: parse(path.join(DIR, `${w}-on.log`), w),
  });
}

if (AS_JSON) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const f = n => (n == null ? '-' : n.toLocaleString('en-US'));
const pctDelta = (off, on) => (off == null || on == null || off === 0)
  ? '-' : `${on >= off ? '+' : '−'}${Math.abs(100 * (on - off) / off).toFixed(1)}%`;

console.log('| window | cap off/on | batches off/on | decodes off | decodes on | Δ | pages off | pages on |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (!r.off || !r.on) { console.log(`| ${r.window} | MISSING LOG |  |  |  |  |  |  |`); continue; }
  console.log(`| ${r.window} | ${r.off.cap}/${r.on.cap} | ${f(r.off.batches)}/${f(r.on.batches)} `
    + `| ${f(r.off.decodes)} | ${f(r.on.decodes)} | ${pctDelta(r.off.decodes, r.on.decodes)} `
    + `| ${f(r.off.pages)} | ${f(r.on.pages)} |`);
}
console.log('');
console.log('| window | installs | declines | entries | native% | fallback ops | transfersSaved |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (!r.on) continue;
  console.log(`| ${r.window} | ${f(r.on.installs)} | ${f(r.on.declines)} | ${f(r.on.entries)} `
    + `| ${r.on.nativePct ?? '-'} | ${f(r.on.fallback)} | ${f(r.on.transfersSaved)} |`);
}
console.log('');
console.log('| window | region installs | region declines | meanBlocks | opsMulti | opsMulti% |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  if (!r.on) continue;
  console.log(`| ${r.window} | ${f(r.on.regionInstalls)} | ${f(r.on.regionDeclines)} `
    + `| ${r.on.meanBlocks ?? '-'} | ${f(r.on.opsMulti)} `
    + `| ${r.on.opsMultiPct == null ? '-' : r.on.opsMultiPct.toFixed(2) + '%'} |`);
}
console.log('');
console.log('| window | uopsBefore | uopsAfter | split | rle | movelim | immfold | rmw |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (!r.on) continue;
  console.log(`| ${r.window} | ${f(r.on.uopsBefore)} | ${f(r.on.uopsAfter)} | ${f(r.on.split)} `
    + `| ${f(r.on.rle)} | ${f(r.on.movelim)} | ${f(r.on.immfold)} | ${f(r.on.rmw)} |`);
}
