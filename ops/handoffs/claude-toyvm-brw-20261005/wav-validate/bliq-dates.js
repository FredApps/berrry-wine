#!/usr/bin/env node
'use strict';
// For every timer IRQ in a BLIQ trace log, the nearest schedule date at or
// below its odometer (`at`), and how far past it the delivery landed. A budget
// stop always overshoots its date by >= 1 dispatch (the budget is tested as
// $steps < 0 at a block transfer, dos-loop.js atStop comment), so overshoot 0
// means the handback landed EXACTLY on a date -- an early handback (BLIQ has no
// machine cuts: kinds.cut = 0 in every row) that head's `>=` counted as a stop
// and v2's strict `>` does not.
//
// Dates, from dos-loop.js under --pit-clock with dispatchesPerTick 550000:
//   vga frame edge  k * vgaPeriod, vgaPeriod = round(1 / (70 * guestSeconds(1))) = 143051
//   lattice         k * grain, grain = floor(shortest / 4), shortest = min(timer, vga)
//   BIOS tick       k * 550000 (tickUnit)
// The timer interval after BLIQ's reload 0x5d37 is round(550000 * 23863 / 65536)
// = 200267 > 143051, so shortest is the vga period and grain = 35762. Before
// mode 13h / the reload these do not hold; lines there are printed but marked.
//
//   node bliq-dates.js <log> [<log> ...]

const fs = require('fs');
const DPS = 550000 * (1193182 / 65536);             // dispatches per guest second
const VGA = Math.max(100, Math.round(DPS / 70));     // 143051
const TIMER = Math.max(200, Math.round(550000 * 0x5d37 / 65536)); // 200267
const GRAIN = Math.max(1, Math.floor(Math.min(TIMER, VGA) / 4));  // 35762
const TICK = 550000;
const kinds = [['frame', VGA], ['lattice', GRAIN], ['tick', TICK]];

for (const file of process.argv.slice(2)) {
  console.log(`== ${file}  (vga ${VGA}, timer ${TIMER}, grain ${GRAIN})`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\s*irq vec=/.test(l));
  lines.forEach((l, i) => {
    const at = Number(l.match(/at=(\d+)/)[1]), hb = l.match(/hb=(\d+)/)[1], from = l.match(/from (\S+)/)[1];
    let best = null;
    for (const [name, p] of kinds) {
      const d = Math.floor(at / p) * p, over = at - d;
      if (!best || over < best.over) best = { name, k: at / p | 0, over };
    }
    const flag = best.over === 0 ? '  <== EXACTLY ON A DATE' : '';
    console.log(`${String(i + 1).padStart(4)} at=${at} hb=${hb} from ${from}  nearest ${best.name} #${best.k} +${best.over}${flag}`);
  });
}
