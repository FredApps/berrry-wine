#!/usr/bin/env node
'use strict';

// Summarize a browser present-pacing log: is a capped app janky, and why?
//
//   node tools/profile-web-frames.js --app=ID --seconds=N --headful \
//     --query='?debug&perf&present-cap=60&present-pace=smooth' \
//     --after-launch="$(cat tools/page-probes/arm-pace-log.js)" \
//     --report-eval="$(cat tools/page-probes/read-pace-log.js)" > run.log
//   node tools/pace-intervals.js run.log [more.log ...] [--skip-sec=N] [--json]
//
// Takes the profile-web-frames log (its `report-eval:` line) or the JSON
// itself. Per log, prints the interval distribution of paced frame ends,
// presents and real rAF callbacks (lib/frame-intervals.js), the paced frames
// measured against the page's own rAF timestamps (how many display refreshes
// showed 0, 1 or 2+ new frames), the waits the pacer asked for, and the wall
// lateness of each main-thread wake after a paced Sleep. Those are the four
// jank sources separately: the guest's own frame work (paced interval spread
// with small waits), the pacer (wait swings), the host wake granularity
// (wake lateness), and cap-vs-refresh aliasing (rAF census against a steady
// paced interval).

const fs = require('fs');
const { summarize, format, percentile, rafCensus } = require('../lib/frame-intervals');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const opt = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const SKIP_SEC = Number(opt('skip-sec', '2'));
const JSON_OUT = args.includes('--json');
if (!files.length) {
  console.error('usage: node tools/pace-intervals.js <profile-web-frames log | json> [...] [--skip-sec=N] [--json]');
  process.exit(2);
}

function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const line = text.split('\n').reverse().find(l => l.startsWith('report-eval: {'));
  if (!line) throw new Error(`${file}: no "report-eval: {...}" line`);
  return JSON.parse(line.slice('report-eval: '.length));
}

const dist = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? { n: s.length, p50: percentile(s, 0.5), p90: percentile(s, 0.9),
    p99: percentile(s, 0.99), max: s[s.length - 1] } : { n: 0 };
};
const fmtDist = d => d.n ? `n ${d.n} p50 ${d.p50.toFixed(1)} p90 ${d.p90.toFixed(1)} p99 ${d.p99.toFixed(1)} max ${d.max.toFixed(1)}` : 'none';

const out = [];
for (const file of files) {
  const log = load(file);
  if (log.error) { console.log(`${file}: ${log.error}`); continue; }
  const from = log.startedAt + SKIP_SEC * 1000;
  const raf = log.raf.filter(t => t >= from);
  const paced = log.paced.filter(p => p[0] >= from);
  const pacedT = paced.map(p => p[0]);
  const present = log.present.filter(t => t >= from);
  const r = {
    file, cap: log.presentCap, mode: log.presentPace,
    paced: summarize(pacedT, { raf }),
    present: summarize(present, { raf }),
    raf: summarize(raf),
    waits: dist(paced.map(p => p[1])),
    waitStep: dist(paced.slice(1).map((p, i) => Math.abs(p[1] - paced[i][1]))),
    guestIv: summarize(paced.map(p => p[2])),
    wakeLate: dist((log.wakes || [])),
  };
  // Aliasing alone: the rAF census with every overrun (a paced interval over
  // 1.5x the median) and the three refreshes after it left out. What 0-new /
  // 2+-new refreshes remain are the cadence beating against the display.
  if (r.paced.p50) {
    const lim = r.paced.p50 * 1.5, ex = [];
    for (let i = 1; i < pacedT.length; i++) {
      if (pacedT[i] - pacedT[i - 1] > lim) ex.push([pacedT[i - 1], pacedT[i] + 3 * r.paced.p50]);
    }
    r.steadyRaf = rafCensus(pacedT, raf, ex);
    r.overruns = ex.length;
  }
  out.push(r);
  if (JSON_OUT) continue;
  console.log(`== ${file}  cap ${r.cap} ${r.mode}  (${((log.endedAt - from) / 1000).toFixed(1)}s after a ${SKIP_SEC}s skip)`);
  console.log(format(r.paced, '  paced frame  '));
  console.log(format(r.guestIv, '  (guest ms)   '));
  console.log(format(r.present, '  present      '));
  console.log(format(r.raf, '  page rAF     '));
  if (r.steadyRaf) {
    const pc = x => `${(100 * x).toFixed(1)}%`;
    console.log(`  between overruns (${r.overruns} left out): vs real rAF (${r.steadyRaf.slots} refreshes): `
      + `0 new ${pc(r.steadyRaf.zero)}, 1 ${pc(r.steadyRaf.one)}, 2+ ${pc(r.steadyRaf.multi)}`);
  }
  console.log(`  pacer wait ms   ${fmtDist(r.waits)}`);
  console.log(`  wait step ms    ${fmtDist(r.waitStep)}   (|wait[i] - wait[i-1]|)`);
  console.log(`  wake late ms    ${fmtDist(r.wakeLate)}   (wall, main Sleep deadline -> resumed)`);
}
if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
