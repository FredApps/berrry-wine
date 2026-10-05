#!/usr/bin/env node
// tl;dr: turn the logs collect-round18-windows.sh writes into the two tables
// section 28 of docs/block-executor-design.md prints -- the CENSUS (read off
// the r17 arm, whose counters record the opportunity whether or not the switch
// is on) and the COVERAGE/KILL-RULE table (all three arms).
//
// It refuses to tabulate an arm whose run did not reach its --max-batches.
// These are cumulative counters over a fixed amount of guest work; an arm the
// wall-clock guard stopped early did LESS work than its partner, and every
// column would then be a comparison of two different runs. That is the one
// mistake this file exists to prevent, so a short arm prints INCOMPLETE and
// the window is dropped from both tables rather than quietly averaged in.
//
// usage: node docs/block-executor-design/read-round18.js [dir] [--json]
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || '/tmp/r18-windows';
const asJson = args.includes('--json');
const ARMS = ['off', 'r17', 'on'];

function num(s) { return s == null ? null : Number(s); }

function parse(file) {
  if (!fs.existsSync(file)) return null;
  const t = fs.readFileSync(file, 'utf8');
  const o = { file };
  let m = /(\d+) batches in ([\d.]+)s/.exec(t);
  if (m) { o.batches = num(m[1]); o.secs = num(m[2]); }
  m = /want-batches=(\d+)/.exec(t);
  o.want = m ? num(m[1]) : null;
  m = /cache: block decodes (\d+)/.exec(t);
  if (m) o.decodes = num(m[1]);
  m = /pages compiled (\d+)/.exec(t);
  if (m) o.pages = num(m[1]);
  m = /block-exec: M\s+armed yes installs (\d+) declines (\d+) entries (\d+)/.exec(t);
  if (m) { o.installs1 = num(m[1]); o.entries = num(m[3]); }
  m = /ops native (\d+) fallback (\d+)/.exec(t);
  if (m) { o.opsNative = num(m[1]); o.opsFb = num(m[2]); }
  m = /transfersSaved (\d+)/.exec(t);
  if (m) o.transfers = num(m[1]);
  m = /block-exec-regions: M\s+armed yes installs (\d+) declines (\d+) meanBlocks ([\d.]+)/.exec(t);
  if (m) { o.rgInstalls = num(m[1]); o.rgDeclines = num(m[2]); o.meanN = num(m[3]); }
  m = /ops1 (\d+) opsMulti (\d+) entriesMulti (\d+)/.exec(t);
  if (m) { o.ops1 = num(m[1]); o.opsMulti = num(m[2]); o.entriesMulti = num(m[3]); }
  m = /classifyRefused (.*)$/m.exec(t);
  if (m) {
    o.refused = {};
    for (const kv of m[1].trim().split(/\s+/)) {
      const [k, v] = kv.split('=');
      if (v != null) o.refused[k] = num(v);
    }
  }
  m = /tailExits on (\d+) refusals (\d+) admitted (\d+) regions (\d+) members (\d+) runs (\d+) wouldAdmit (\d+) wouldGrow (\d+)/.exec(t);
  if (m) {
    o.tail = {
      on: num(m[1]), refusals: num(m[2]), admitted: num(m[3]),
      regions: num(m[4]), members: num(m[5]), runs: num(m[6]),
      wouldAdmit: num(m[7]), wouldGrow: num(m[8]),
    };
  }
  o.complete = o.batches != null && o.want != null && o.batches >= o.want;
  return o;
}

const windows = [];
for (const f of fs.readdirSync(dir).sort()) {
  const m = /^(.*)-off\.log$/.exec(f);
  if (m) windows.push(m[1]);
}

const rows = [];
for (const w of windows) {
  const a = {};
  for (const arm of ARMS) a[arm] = parse(path.join(dir, `${w}-${arm}.log`));
  rows.push({ window: w, arms: a });
}

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const pct = (x, base) => (base ? `${(((x - base) / base) * 100).toFixed(1)}%` : '-');

console.log('== completeness (an arm that did not reach --max-batches is not a measurement) ==');
for (const r of rows) {
  for (const arm of ARMS) {
    const a = r.arms[arm];
    if (!a) { console.log(`  ${r.window} ${arm}: MISSING`); continue; }
    console.log(`  ${r.window} ${arm}: ${a.batches}/${a.want} batches in ${a.secs}s` +
      (a.complete ? '' : '   <-- INCOMPLETE, window dropped'));
  }
}

const good = rows.filter((r) => ARMS.every((x) => r.arms[x] && r.arms[x].complete));

console.log('\n== census, read off the r17 arm (term_kind 10 refused) ==');
console.log('window                termNotModelled  otherRefusals  wouldAdmit  wouldGrow  rgInstalls');
for (const r of good) {
  const a = r.arms.r17;
  const ref = a.refused || {};
  const tnm = ref.termNotModelled || 0;
  const other = Object.entries(ref).reduce((s, [k, v]) => s + (k === 'termNotModelled' ? 0 : v), 0);
  console.log(`${r.window.padEnd(21)} ${String(tnm).padStart(14)} ${String(other).padStart(14)}` +
    ` ${String(a.tail ? a.tail.wouldAdmit : '-').padStart(11)} ${String(a.tail ? a.tail.wouldGrow : '-').padStart(10)}` +
    ` ${String(a.rgInstalls).padStart(11)}`);
}

console.log('\n== realised (on arm) ==');
console.log('window                termNotModelled  realised%  admitted  tailRegions  tailMembers  sideExits');
for (const r of good) {
  const b = r.arms.r17; const a = r.arms.on;
  const before = (b.refused || {}).termNotModelled || 0;
  const after = (a.refused || {}).termNotModelled || 0;
  const realised = before ? (((before - after) / before) * 100).toFixed(1) + '%' : '-';
  console.log(`${r.window.padEnd(21)} ${String(after).padStart(14)} ${realised.padStart(10)}` +
    ` ${String(a.tail.admitted).padStart(9)} ${String(a.tail.regions).padStart(12)}` +
    ` ${String(a.tail.members).padStart(12)} ${String(a.tail.runs).padStart(10)}`);
}

console.log('\n== gates ==');
console.log('window                arm   decodes  vs off   rgInstalls  opsMulti  entriesMulti  ops native');
for (const r of good) {
  const base = r.arms.off.decodes;
  for (const arm of ARMS) {
    const a = r.arms[arm];
    console.log(`${(arm === 'off' ? r.window : '').padEnd(21)} ${arm.padEnd(4)}` +
      ` ${String(a.decodes).padStart(9)} ${pct(a.decodes, base).padStart(7)}` +
      ` ${String(a.rgInstalls == null ? '-' : a.rgInstalls).padStart(11)}` +
      ` ${String(a.opsMulti == null ? '-' : a.opsMulti).padStart(9)}` +
      ` ${String(a.entriesMulti == null ? '-' : a.entriesMulti).padStart(13)}` +
      ` ${String(a.opsNative == null ? '-' : a.opsNative).padStart(11)}`);
  }
}
