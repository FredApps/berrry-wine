#!/usr/bin/env node

'use strict';

// What changed between two sweep-dos.js runs.
//
//   node tools/toyvm/sweep-dos.js --dir=/tmp/demos --out=/tmp/sweep-base.json   # base arm
//   node tools/toyvm/sweep-dos.js --dir=/tmp/demos --out=/tmp/sweep-fix.json    # your arm
//   node tools/toyvm/sweep-diff.js /tmp/sweep-base.json /tmp/sweep-fix.json
//
// A whole-corpus A/B is a gate on ~200 programs and the answer that matters is
// "which rows moved, and which way", not the timings -- so this compares only
// what is deterministic in a sweep row: the verdict (ok / crash /
// arms-disagree / nondeterministic), how far the program got, where it stopped,
// and the frame hash with its non-black pixel count. The ns/dispatch figures
// are deliberately ignored: they are a measurement of a loaded box, they differ
// on every run, and reporting them here would bury the four columns that do not.
//
// Exits 1 when anything moved, so it chains in a shell. --json prints the
// changed rows instead of the table.

const fs = require('fs');

function load(p) {
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = Array.isArray(doc) ? doc : (doc.rows || []);
  const by = new Map();
  for (const r of rows) by.set(r.name, r);
  return by;
}

// The one-word verdict a row carries, from whichever half failed first.
function verdict(r) {
  if (!r) return 'missing';
  if (r.shells && r.shells.ok === false) return r.shells.reason;
  if (r.jit && r.jit.ok === false) return `jit-${r.jit.reason}`;
  return 'ok';
}

const facts = (r) => r ? {
  verdict: verdict(r),
  frame: r.frame === undefined ? null : r.frame,
  pixels: r.pixels === undefined ? null : r.pixels,
  dispatched: r.dispatched === undefined ? null : r.dispatched,
  stuckAt: r.stuckAt || null,
} : { verdict: 'missing', frame: null, pixels: null, dispatched: null, stuckAt: null };

function main() {
  const [a, b] = process.argv.slice(2).filter(x => !x.startsWith('--'));
  if (!a || !b) {
    console.error('usage: sweep-diff.js <base.json> <arm.json> [--json] [--all]');
    process.exit(2);
  }
  const showAll = process.argv.includes('--all');
  const base = load(a); const arm = load(b);
  const names = [...new Set([...base.keys(), ...arm.keys()])].sort();

  const changed = [];
  for (const name of names) {
    const x = facts(base.get(name)); const y = facts(arm.get(name));
    // dispatched moves with the budget the sweep spent, not with behaviour, so
    // it is reported but never on its own the reason a row is listed.
    const keys = ['verdict', 'frame', 'pixels', 'stuckAt'];
    const moved = keys.filter(k => x[k] !== y[k]);
    if (moved.length || showAll) changed.push({ name, moved, base: x, arm: y });
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(changed, null, 1));
  } else {
    console.log(`${names.length} program(s); ${changed.length} row(s) moved`);
    for (const c of changed) {
      console.log(`  ${c.name}  [${c.moved.join(',') || 'same'}]`);
      const show = (t, f) => `    ${t} verdict=${f.verdict} frame=${f.frame}`
        + ` px=${f.pixels} stuck=${f.stuckAt || '-'} dispatched=${f.dispatched}`;
      console.log(show('base', c.base));
      console.log(show(' arm', c.arm));
    }
  }
  process.exit(changed.length && !showAll ? 1 : 0);
}

main();
