#!/usr/bin/env node
'use strict';
// ONE fixed-work measurement in ONE tree, printed as one JSON line, for
// bench-trees.js. It makes exactly the call tools/toyvm/bench-dos.js makes per
// rep (bench-dos.js:169 at base 2683a6e3):
//   runDos({ exe, variant: 'tailcall', budget, cpu: 386, log: quiet, autoKey: true, cpuMeter })
// and reports bench-dos's own metric (guest seconds x 1e9 / dispatched; guest
// CPU seconds under --cpu-time, bench-dos.js:176), plus the EXACT dispatch
// count and frame hash. bench-dos itself cannot be the child here: its --json
// rows carry only timings, and its text line rounds dispatches to 0.1M, so a
// cross-tree identity gate could not be exact from its output.
//   node bench-one.js --tree=<dir> --exe=<prog> [--dispatches=20m] [--cpu-time]
const path = require('path');
const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
function count(s, d) {
  if (s === undefined) return d;
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(String(s).trim());
  if (!m) throw new Error(`not a count: ${s}`);
  return Math.round(Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()]);
}
const tree = arg('tree'), exe = arg('exe');
if (!tree || !exe) { console.error('usage: node bench-one.js --tree=<dir> --exe=<prog> [--dispatches=20m] [--cpu-time]'); process.exit(2); }
const budget = count(arg('dispatches'), 20e6), cpuMeter = argv.includes('--cpu-time');
(async () => {
  const { runDos } = require(path.join(path.resolve(tree), 'tools/toyvm/run-dos.js'));
  const r = await runDos({ exe: path.resolve(exe), variant: 'tailcall', budget, cpu: 386, log: () => {}, autoKey: true, cpuMeter });
  const secs = cpuMeter ? r.guestCpuSecs : r.guestSecs;
  console.log(JSON.stringify({ dispatched: r.dispatched, frame: r.frame, handbacks: r.handbacks, pixels: r.pixels,
    guestSecs: r.guestSecs, guestCpuSecs: r.guestCpuSecs === undefined ? null : r.guestCpuSecs,
    nsPerDispatch: secs * 1e9 / r.dispatched, cpuMeter }));
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
