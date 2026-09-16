#!/usr/bin/env node
// Tabulate collect-round19-windows.sh. One table per window, four arms
// (off/chain/exec/both), plus the round's two gates evaluated per window.
//
// It REFUSES an arm whose run did not reach the batch count stamped into its
// log by the collector: every counter here is cumulative over the run, so an
// arm the --max-seconds guard cut short describes a different amount of work
// and putting it in the same table as its partners is the one mistake that
// makes a whole round's numbers meaningless.
//
// Usage: node docs/block-executor-design/read-round19.js [/tmp/r19-windows]

const fs = require('fs');
const path = require('path');

const DIR = process.argv[2] || '/tmp/r19-windows';
const ARMS = ['off', 'chain', 'exec', 'both'];

function readArm(dir, win, arm) {
  const f = path.join(dir, `${win}-${arm}.log`);
  if (!fs.existsSync(f)) return null;
  const txt = fs.readFileSync(f, 'utf8');
  const want = /want-batches=(\d+)/.exec(txt);
  const stats = /(\d+) batches in ([\d.]+)s/.exec(txt);
  const chain = /chain: M {2}armed \w+ hits (\d+) slow (\d+) branchEnd (\d+) chained% ([\d.-]+) patches (\d+) epochBumps (\d+) epoch (\d+) adjacent (\d+)/.exec(txt);
  const pool = /chain: M {2}pool hits (\d+) slow (\d+) patches (\d+) tailExits (\d+) tailChained% ([\d.-]+) chainableTails (\d+) ofChainable% ([\d.-]+) poolDesk (\d+) refuseTgt (\d+) refuseAnc (\d+) staleRegs (\d+)/.exec(txt);
  const dec = /cache: block decodes (\d+)/.exec(txt);
  const bx = /block-exec: M {2}armed \w+ installs (\d+) declines (\d+) entries (\d+)/.exec(txt);
  if (!stats || !chain || !dec) return { arm, broken: true };
  const batches = Number(stats[1]);
  return {
    arm,
    batches,
    seconds: Number(stats[2]),
    short: want ? batches < Number(want[1]) : false,
    want: want ? Number(want[1]) : null,
    hits: Number(chain[1]),
    slow: Number(chain[2]),
    branchEnd: Number(chain[3]),
    patches: Number(chain[5]),
    adjacent: Number(chain[8]),
    decodes: Number(dec[1]),
    installs: bx ? Number(bx[1]) : 0,
    bxEntries: bx ? Number(bx[3]) : 0,
    poolHits: pool ? Number(pool[1]) : 0,
    poolSlow: pool ? Number(pool[2]) : 0,
    tailExits: pool ? Number(pool[4]) : 0,
    chainableTails: pool ? Number(pool[6]) : 0,
    poolDesk: pool ? Number(pool[8]) : 0,
    refuseTgt: pool ? Number(pool[9]) : 0,
    refuseAnc: pool ? Number(pool[10]) : 0,
    staleRegs: pool ? Number(pool[11]) : 0,
  };
}

const windows = [...new Set(fs.readdirSync(DIR)
  .filter(f => f.endsWith('.log'))
  .map(f => f.replace(/-(off|chain|exec|both)\.log$/, '')))].sort();

let gateDesk = true, gateDecode = true;
for (const win of windows) {
  const rows = ARMS.map(a => readArm(DIR, win, a)).filter(Boolean);
  if (rows.length !== 4 || rows.some(r => r.broken)) {
    console.log(`\n== ${win}: incomplete (${rows.length} arms) -- skipped`);
    continue;
  }
  const shortArms = rows.filter(r => r.short);
  console.log(`\n== ${win} (${rows[0].batches} batches)`);
  if (shortArms.length) {
    console.log(`   REFUSED: ${shortArms.map(r => `${r.arm} stopped at ${r.batches}/${r.want}`).join(', ')}`);
    console.log('   The --max-seconds guard fired, so these counters are not comparable.');
    continue;
  }
  // "Retired blocks" is the executor-aware unit: an entry into a descriptor
  // retires one block of budget however many guest blocks it covers, and every
  // transfer that reaches the desk or a chain slot retires one too.
  // Retired blocks, measured rather than assumed: $block_budget is spent by
  // exactly three things -- an entry to $branch_end, a chained transfer, and
  // the adjacent fall-through that skips both desks -- so their sum IS the
  // block count this run retired, whatever shape the blocks had.
  console.log('arm      desk(branchEnd)   retiredBlocks   desk/block   chainHits   decodes  installs');
  const per = {};
  for (const r of rows) {
    const retired = r.hits + r.branchEnd + r.adjacent;
    per[r.arm] = retired > 0 ? r.branchEnd / retired : 0;
    console.log(`${r.arm.padEnd(6)} ${String(r.branchEnd).padStart(16)} ${String(retired).padStart(15)}` +
      `   ${per[r.arm].toFixed(4).padStart(9)}   ${String(r.hits).padStart(9)}` +
      `  ${String(r.decodes).padStart(7)}  ${String(r.installs).padStart(6)}`);
  }
  const both = rows[3], exec = rows[2], chain = rows[1];
  const deskOk = per.both <= Math.min(per.chain, per.exec) + 1e-9;
  gateDesk = gateDesk && deskOk;
  console.log(`GATE desk/block both <= min(chain,exec): ${deskOk ? 'PASS' : 'FAIL'}` +
    ` (both ${per.both.toFixed(4)}, chain ${per.chain.toFixed(4)}, exec ${per.exec.toFixed(4)})`);
  const decOk = both.decodes === exec.decodes;
  gateDecode = gateDecode && decOk;
  console.log(`GATE block decodes both == exec: ${decOk ? 'PASS' : 'FAIL'}` +
    ` (${both.decodes} vs ${exec.decodes}; installs ${both.installs} vs ${exec.installs},` +
    ` entries ${both.bxEntries} vs ${exec.bxEntries})`);
  const pct = t => (t > 0 ? (100 * both.poolHits / t).toFixed(2) : '-');
  console.log(`executor exits: ${both.tailExits} tails, of which ${both.chainableTails}` +
    ` have a chain slot at all; chained ${both.poolHits}` +
    ` = ${pct(both.tailExits)}% of tails, ${pct(both.chainableTails)}% of chainable tails`);
  console.log(`refusals: target ${both.refuseTgt} anchor ${both.refuseAnc}` +
    ` (chain-alone anchor ${chain.refuseAnc}), staleRegs ${both.staleRegs}`);
}

console.log(`\nGATES: desk/block ${gateDesk ? 'PASS' : 'FAIL'}, decode identity ${gateDecode ? 'PASS' : 'FAIL'}`);
