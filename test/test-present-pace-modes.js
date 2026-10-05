#!/usr/bin/env node
'use strict';

// The two ways $present_pace can spend a present cap, driven with a fake clock
// and a per-frame work time the test chooses, so the interval each mode
// produces is arithmetic and not a picture of this machine's load.
//
//   deadline  sleep each early frame to a deadline one period after the
//             last; a late frame sleeps nothing (carries <= one period).
//   smooth    one delay slept after every frame, moved toward
//             period - (work + wake latency) by at most 1.5 ms per frame.
//
// With steady work the two converge on the same cadence. They differ when the
// work per frame swings or a frame runs over budget: deadline mode puts the
// whole swing into one interval (and the next frame can sleep most of a
// period in one go), smooth mode spreads it over several frames. Both must
// keep the long-run rate at or under the cap, must not burst after a stall,
// and must cost nothing with the cap off. See the design note above
// $present_pace_smooth in src/09a8-handlers-directx.wat.
//
// The simulated host sleeps what the pacer asks for, plus a wake latency
// (the scheduler only re-runs a sleeper on its next step), then spends the
// next frame's work, then presents. Present time = when $present_pace runs.
// `SHOW=1` prints each scenario's interval distribution for both modes.

const { bootRenderHarness } = require('./render-helper');
const { summarize, format } = require('../lib/frame-intervals');

const extraWat = String.raw`
  (func (export "t_pace") (result i32)
    (local $ms i32)
    (call $present_pace)
    (local.set $ms (select (global.get $sleep_timeout) (i32.const 0)
      (global.get $sleep_yielded)))
    (global.set $sleep_yielded (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $sleep_timeout (i32.const 0))
    (local.get $ms))
  (func (export "t_setup") (param $cap i32) (param $mode i32)
    (call $present_set_cap (local.get $cap))
    (call $present_set_pace_mode (local.get $mode))
    (global.set $present_paced_ms (i32.const 0))
    (global.set $present_paced_count (i32.const 0))
    (global.set $sleep_yielded (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $sleep_timeout (i32.const 0)))
  (func (export "t_delay_us") (result i32) (global.get $present_smooth_delay_us))
`;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

// Deterministic PRNG, so a failure reproduces.
const rng = seed => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

(async () => {
  const clock = { now: 0 };
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    // The guest clock is whole milliseconds, as GetTickCount is.
    extraHostOverrides: { get_ticks: () => Math.floor(clock.now) & 0x7FFFFFFF },
  });

  // Run `frames` frames. work(i) is frame i's guest work in ms (fractional:
  // the fake host has a sub-ms clock underneath the ms-granular guest one);
  // latency(i) is the host's extra wake delay on a slept frame.
  const run = (mode, cap, frames, work, latency = () => 0) => {
    wat.t_setup(cap, mode);
    clock.now = 1000;
    const times = [], waits = [], delays = [];
    for (let i = 0; i < frames; i++) {
      clock.now += work(i);
      times.push(clock.now);
      const wait = wat.t_pace() >>> 0;
      waits.push(wait);
      delays.push(wat.t_delay_us() | 0);
      if (wait) clock.now += wait + latency(i);
    }
    return { times, waits, delays, stats: summarize(times) };
  };
  const both = (label, cap, frames, work, latency, skip = 30) => {
    const out = {};
    for (const [name, mode] of [['deadline', 0], ['smooth', 1]]) {
      const r = run(mode, cap, frames, work, latency);
      // Drop the warm-up: smooth mode ramps its delay up from zero.
      r.steady = summarize(r.times.slice(skip));
      out[name] = r;
      if (process.env.SHOW) console.log(format(r.steady, `    ${label} ${name.padEnd(8)} `));
    }
    return out;
  };
  const maxStep = arr => {
    let m = 0;
    for (let i = 1; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i] - arr[i - 1]));
    return m;
  };

  // ---- 1. off costs nothing, in either mode ------------------------------
  for (const mode of [0, 1]) {
    const r = run(mode, 0, 200, () => 1);
    check(`cap 0 never sleeps (mode ${mode})`, r.waits.every(w => w === 0));
  }

  // ---- 2. steady work: both land on the cap -----------------------------
  const steady = both('steady 4ms', 60, 600, () => 4, () => 0);
  for (const name of ['deadline', 'smooth']) {
    const fps = steady[name].steady.fps;
    check(`steady work: ${name} lands on 60/s`, fps > 58.5 && fps <= 60.5, `${fps.toFixed(2)}/s`);
  }
  // A flat-out loop (no work at all) is the case a ramp could overshoot.
  const flat = both('flat out', 60, 600, () => 0, () => 0);
  for (const name of ['deadline', 'smooth']) {
    const fps = flat[name].steady.fps;
    check(`flat-out loop: ${name} holds the cap`, fps > 58.5 && fps <= 60.5, `${fps.toFixed(2)}/s`);
  }
  // Smooth mode reaches the cap within a few dozen frames, not seconds.
  {
    const r = flat.smooth;
    const t = r.times;
    const firstIv = t.slice(1).map((x, i) => x - t[i]);
    const settled = firstIv.findIndex(iv => iv >= 15);
    check('smooth mode ramps to the period within 20 frames', settled >= 0 && settled <= 20,
      `first >=15ms interval at frame ${settled}`);
  }

  // ---- 3. the per-frame delay moves by a bounded step ---------------------
  // The user-facing promise of smooth mode: no single frame's wait is a big
  // one-off. The controller's delay moves <= 1.5 ms a frame; the whole-ms
  // Sleep it becomes adds at most 1 ms of dither on top.
  const r3 = rng(7);
  const swing = both('random 1-14ms', 60, 1200, () => 1 + 13 * r3(), () => 0);
  check('smooth: delay moves <= 1.5 ms per frame',
    maxStep(swing.smooth.delays) <= 1500, `max step ${maxStep(swing.smooth.delays)}us`);
  check('smooth: slept ms moves <= 3 ms per frame (step + dither)',
    maxStep(swing.smooth.waits.slice(30)) <= 3, `max step ${maxStep(swing.smooth.waits.slice(30))}ms`);
  check('deadline: slept ms swings by far more (the bang-bang this replaces)',
    maxStep(swing.deadline.waits.slice(30)) >= 8, `max step ${maxStep(swing.deadline.waits.slice(30))}ms`);

  // ---- 4. variable work: smooth has the steadier cadence ------------------
  // Random work: deadline puts each frame's swing straight into the interval
  // (twice: once as this frame's work, once as the next frame's), smooth only
  // once. Alternating 2/12ms is the worst case for deadline.
  const r4 = rng(11);
  const alt = both('alternating 2/12ms', 60, 1200, i => (i & 1 ? 12 : 2), () => 0);
  for (const [label, sc] of [['random 1-14ms work', swing], ['alternating 2/12ms work', alt]]) {
    const d = sc.deadline.steady, s = sc.smooth.steady;
    check(`${label}: smooth frame-to-frame change is smaller`,
      s.meanAbsDelta < d.meanAbsDelta * 0.8,
      `smooth |d| ${s.meanAbsDelta.toFixed(2)} vs deadline ${d.meanAbsDelta.toFixed(2)}`);
    check(`${label}: both still hold the cap`, d.fps <= 60.5 && s.fps <= 60.5 && s.fps > 57,
      `deadline ${d.fps.toFixed(2)}/s smooth ${s.fps.toFixed(2)}/s`);
  }
  void r4;

  // ---- 5. an over-budget frame --------------------------------------------
  // Every 60th frame takes 30ms (e.g. a level load or a GC in the guest).
  const over = both('30ms overrun every 60', 60, 1200, i => (i % 60 === 59 ? 30 : 4), () => 0);
  // Deadline mode repays the overrun: the frame after it is short. Smooth mode
  // never repays, so its frame after an overrun is the steady cadence.
  const afterOverrun = r => {
    const iv = [];
    for (let i = 60; i + 1 < r.times.length; i += 60) iv.push(r.times[i + 1] - r.times[i]);
    return Math.min(...iv);
  };
  check('overrun: smooth does not rush the frame after it',
    afterOverrun(over.smooth) >= 13, `shortest interval after an overrun ${afterOverrun(over.smooth).toFixed(1)}ms`);
  check('overrun: both keep the rate at or under the cap',
    over.deadline.steady.fps <= 60.5 && over.smooth.steady.fps <= 60.5,
    `deadline ${over.deadline.steady.fps.toFixed(2)} smooth ${over.smooth.steady.fps.toFixed(2)}`);

  // dx_tunnel's measured shape: ~6ms D3D frames with a ~53ms one about every
  // 20th (a close-up textured triangle). The debt term is what keeps smooth
  // mode's rate level with deadline's here; without it the STEP clamp let the
  // rate settle ~10% under the cap (49.6/s against deadline's 55.2/s on the
  // real app). Smooth repays the overrun over several frames, so its
  // shortest interval stays well above deadline's unslept catch-up frames.
  const spiky = both('6ms + 53ms every 20', 60, 1200, i => (i % 20 === 19 ? 53 : 6), () => 0);
  if (process.env.SHOW_TRACE) {
    for (const name of ['deadline', 'smooth']) {
      const r = spiky[name];
      const row = [];
      for (let i = 600; i < 640; i++) row.push(`${(r.times[i + 1] - r.times[i]).toFixed(0)}/${r.waits[i]}/${(r.delays[i] / 1000).toFixed(1)}`);
      console.log(`    ${name} iv/wait/delay: ${row.join(' ')}`);
    }
  }
  check('spiky work: smooth keeps the rate within 3% of deadline',
    spiky.smooth.steady.fps >= spiky.deadline.steady.fps * 0.97,
    `deadline ${spiky.deadline.steady.fps.toFixed(2)} smooth ${spiky.smooth.steady.fps.toFixed(2)}`);
  const minIv = r => { let m = Infinity; for (let i = 31; i < r.times.length; i++) m = Math.min(m, r.times[i] - r.times[i - 1]); return m; };
  check('spiky work: smooth never runs a catch-up frame as short as deadline does',
    minIv(spiky.smooth) > minIv(spiky.deadline) + 2,
    `shortest interval deadline ${minIv(spiky.deadline).toFixed(1)} smooth ${minIv(spiky.smooth).toFixed(1)}`);
  check('spiky work: smooth wait moves <= 3 ms per frame',
    maxStep(spiky.smooth.waits.slice(30)) <= 3, `max step ${maxStep(spiky.smooth.waits.slice(30))}ms`);

  // ---- 6. a stall: no burst of catch-up frames ----------------------------
  // Deadline repays its one-period carry with back-to-back unslept frames;
  // smooth repays its (two-period) debt with frames a few ms short. Either
  // way the 100ms after a stall holds at most 8 frames (cap 60 = 6), and
  // smooth never presents two frames closer than 10ms.
  for (const [name, mode] of [['deadline', 0], ['smooth', 1]]) {
    const r = run(mode, 60, 400, i => (i === 200 ? 500 : 4), () => 0);
    const stallEnd = r.times[200];
    const after = r.times.filter(t => t > stallEnd && t <= stallEnd + 100);
    check(`stall: ${name} presents at most 8 frames in the 100ms after`, after.length <= 8, `${after.length} frames`);
    if (name === 'smooth') {
      const ivs = [stallEnd, ...after].slice(1).map((t, i) => t - [stallEnd, ...after][i]);
      check('stall: smooth repays with no interval under 10ms', Math.min(...ivs) >= 10,
        `intervals ${ivs.map(v => v.toFixed(0)).join(',')}`);
    }
  }

  // ---- 7. host wake latency ------------------------------------------------
  // A sleeper is re-run on the host's next step, 0-4ms late. Both modes are
  // closed-loop on the guest clock, so the rate still holds.
  const r7 = rng(3);
  const late = both('4ms work + 0-4ms wake latency', 60, 1200, () => 4, () => 4 * r7());
  for (const name of ['deadline', 'smooth']) {
    const fps = late[name].steady.fps;
    check(`wake latency: ${name} holds 57-60.5/s`, fps > 57 && fps <= 60.5, `${fps.toFixed(2)}/s`);
  }

  // ---- 8. a loop slower than the cap is not touched ------------------------
  for (const [name, mode] of [['deadline', 0], ['smooth', 1]]) {
    const r = run(mode, 60, 300, () => 25);
    check(`under the cap: ${name} never sleeps`, r.waits.every(w => w === 0),
      `slept ${r.waits.reduce((a, b) => a + b, 0)}ms`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
