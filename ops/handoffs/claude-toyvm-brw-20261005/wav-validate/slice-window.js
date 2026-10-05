#!/usr/bin/env node
'use strict';
// Read a run-dos --slice-log/--slice-log-regs file over a window of dispatch
// counts: every handback's odometer, `left` (> 0: the slice handed back EARLY,
// before its budget; < 0: it spent the budget and ran past its date), cs:ip,
// (0: exactly on it), the IF bit of FLAGS, and whether the odometer sits EXACTLY on a date of the
// BLIQ schedule (bliq-dates.js: frame k*143051, lattice k*35762, tick k*550000).
// This is what decides BLIQ-DIVERGENCE-20261005.md's fact 2 (head's handback at
// 13,732,896 early?) and H1 (IF at v2v3's stops before 13,804,137).
//
//   node slice-window.js <file.slices> --from=N --to=N [--json]
// Line format (run-dos.js afterSlice): `${dispatched} ${left} cs:ip ax,..,seg..,flags` (hex regs).

const fs = require('fs');
const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const DATES = [['frame', 143051], ['lattice', 35762], ['tick', 550000]];

function readWindow(file, from, to) {
  const out = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue;
    const [d, left, csip, regs] = l.split(' ');
    const dispatched = Number(d);
    if (dispatched < from || dispatched > to) continue;
    const flags = regs ? parseInt(regs.split(',').pop(), 16) : null;
    const onDate = DATES.filter(([, p]) => dispatched % p === 0).map(([n, p]) => `${n}#${dispatched / p}`);
    // left 0: the handback landed exactly where the budget ran out -- ON the
    // date -- which a budget stop (tested as $steps < 0) never does; v2 calls it
    // an early handback that coincided (BRW's side exit had `left` 0).
    const n = Number(left);
    out.push({ dispatched, left: n, kind: n > 0 ? 'early' : n === 0 ? 'ondate' : 'budget', at: csip,
      IF: flags === null ? null : (flags & 0x200 ? 1 : 0), onDate: onDate.length ? onDate.join('+') : null });
  }
  return out;
}

if (require.main === module) {
  const file = argv.find((a) => !a.startsWith('--'));
  const from = Number(arg('from')), to = Number(arg('to'));
  if (!file || !Number.isFinite(from) || !Number.isFinite(to)) {
    console.error('usage: node slice-window.js <file.slices> --from=N --to=N [--json]');
    process.exit(2);
  }
  const rows = readWindow(file, from, to);
  if (argv.includes('--json')) console.log(JSON.stringify(rows));
  else for (const r of rows) console.log(`${r.dispatched} left=${r.left} ${r.kind.padEnd(6)} ${r.at} IF=${r.IF}${r.onDate ? `  ON ${r.onDate}` : ''}`);
}
module.exports = { readWindow };
