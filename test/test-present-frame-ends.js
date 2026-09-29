#!/usr/bin/env node

'use strict';

// Which events the present cap counts as frame ends ($present_frame_end and
// $present_pump in src/09a8-handlers-directx.wat).
//
// WHY THIS EXISTS
// Fallout draws straight into the primary. Each dirty rect is a NULL-rect
// Lock, a copy and an Unlock, and one turn of its main loop copies five of
// them between two PeekMessage calls. Each of those Unlocks counts as a frame
// end, so a limiter that paces every one sleeps five periods per game frame.
// At cap 60 the same 52-frame walk took 2.62 guest-s instead of 1.55
// (docs/re-notes/fallout-demo.md). The fix treats the frame ends between two
// message pumps as one frame, paced at the pump. The checks:
//
//  1. uncapped, the census still counts: 5 frame ends, 1 pump-bounded frame.
//  2. a Fallout-shaped loop at cap 60 sleeps at most once per turn, and turns
//     do not fall under the cap's rate.
//  3. the pump that paces parks on its own thunk (frame untouched,
//     $handler_set_eip raised), and the re-run does not pace again.
//  4. a thread that presents and never pumps is paced at every frame end,
//     as before.
//  5. the audit (lib/present-frame-audit.js) flags Fallout's numbers UNSAFE
//     and a one-present loop OK.
//
// The guest clock is supplied here, so the file is deterministic.

const path = require('path');
const fs = require('fs');
const audit = require('../lib/present-frame-audit');

const IMAGE_BASE = 0x400000;
const WASM = path.join(__dirname, '..', 'build', 'wine-assembly.wasm');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

async function boot() {
  const { createHostImports } = require('../lib/host-imports');
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const clock = { now: 1000 };
  const ctx = {
    getMemory: () => memory.buffer,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
    guestNowMs: () => clock.now,
  };
  const base = createHostImports(ctx);
  base.host.memory = memory;
  for (const stub of ['create_thread', 'exit_thread', 'terminate_thread', 'create_event',
    'set_event', 'reset_event', 'wait_single', 'wait_multiple']) base.host[stub] = () => 0;
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM), base);
  ctx.exports = instance.exports;
  instance.exports.init_thread(1, IMAGE_BASE, 0, 0, 0, 0, 0);
  return { e: instance.exports, clock };
}

// Consume what one guest slice would have left for the host: a pending sleep
// advances the guest clock by its length, like the batch clock does.
function hostTakeSleep(e, clock) {
  let slept = 0;
  if (e.get_sleep_yielded()) { slept = e.get_sleep_timeout() >>> 0; clock.now += slept; }
  e.clear_yield();
  e.set_handler_set_eip(0);
  return slept;
}

function reset(e, cap) {
  e.test_present_frame_reset();
  e.set_present_cap(cap);
  e.get_sleep_yielded();
  e.clear_yield();
}

// One Fallout main-loop turn: pump, `work` ms of game logic, then `ends`
// dirty-rect frame ends. A pump that parks is re-run, as the thunk would.
function loopTurn(e, clock, ends, work) {
  let sleeps = 0;
  while (e.test_present_pump()) {
    if (hostTakeSleep(e, clock)) sleeps++;
  }
  clock.now += work;
  for (let i = 0; i < ends; i++) {
    e.test_present_frame_end();
    if (hostTakeSleep(e, clock)) sleeps++;
  }
  return sleeps;
}

async function main() {
  const { e, clock } = await boot();

  // ---- 1. uncapped census ------------------------------------------------
  reset(e, 0);
  for (let i = 0; i < 5; i++) e.test_present_frame_end();
  const parked = e.test_present_pump();
  check('1 uncapped: pump never parks', parked === 0);
  check('1 uncapped: 5 frame ends counted', e.get_present_frame_ends() === 5, `${e.get_present_frame_ends()}`);
  check('1 uncapped: 1 pump-bounded frame', e.get_present_pump_frames() === 1, `${e.get_present_pump_frames()}`);
  check('1 uncapped: nothing slept', e.get_sleep_yielded() === 0);

  // ---- 2. Fallout-shaped loop at cap 60 ---------------------------------
  // 5 frame ends per turn, 5 ms of work: uncapped that is 200 turns/s, so the
  // cap should hold it near 60 turns/s -- one sleep per turn, not five.
  reset(e, 60);
  const t0 = clock.now;
  let sleeps = 0;
  const TURNS = 240;
  for (let t = 0; t < TURNS; t++) sleeps += loopTurn(e, clock, 5, 5);
  const secs = (clock.now - t0) / 1000;
  const rate = TURNS / secs;
  check('2 cap 60: learned the pump bound', e.get_present_pump_bounded() === 1);
  // The first turn is paced per frame end: nothing is learned before a pump
  // has followed a frame end, so up to four extra sleeps there.
  check('2 cap 60: at most one sleep per turn after the first', sleeps <= TURNS + 4, `${sleeps} sleeps in ${TURNS} turns`);
  check('2 cap 60: turns run at the cap, not a fifth of it',
    rate > 55 && rate < 66, `${rate.toFixed(1)} turns/guest-s`);
  check('2 cap 60: census says 5 frame ends per pumped frame',
    Math.abs(e.get_present_frame_ends() / e.get_present_pump_frames() - 5) < 0.05,
    `${e.get_present_frame_ends()}/${e.get_present_pump_frames()}`);

  // ---- 3. the park ------------------------------------------------------
  // After learning, a pump with a frame pending and the deadline ahead parks.
  reset(e, 60);
  loopTurn(e, clock, 1, 1);          // learn
  loopTurn(e, clock, 1, 1);
  e.test_present_frame_end();        // pending, early
  e.set_current_thunk_eip(0x07500040);
  e.set_eip(0x00401234);
  const p = e.test_present_pump();
  check('3 park: pump returns 1 when it slept', p === 1);
  check('3 park: EIP back on the thunk', (e.get_eip() >>> 0) === 0x07500040, `eip=${(e.get_eip() >>> 0).toString(16)}`);
  check('3 park: handler_set_eip raised', e.get_handler_set_eip() === 1);
  check('3 park: a sleep was asked for', hostTakeSleep(e, clock) > 0);
  check('3 park: the re-run does not pace again', e.test_present_pump() === 0 && e.get_sleep_yielded() === 0);

  // ---- 4. a thread that never pumps --------------------------------------
  reset(e, 60);
  let s4 = 0;
  for (let i = 0; i < 20; i++) {
    clock.now += 2;
    e.test_present_frame_end();
    if (hostTakeSleep(e, clock)) s4++;
  }
  check('4 no pump: frame ends still paced one by one', s4 >= 18, `${s4} of 20 slept`);
  check('4 no pump: not switched to pump pacing', e.get_present_pump_bounded() === 0);

  // ---- 5. the audit ------------------------------------------------------
  const snap = (ends, pumps, bounded, ms, logical) => ({
    guestMs: ms, logical,
    rows: { main: { frameEnds: ends, pumpFrames: pumps, pumpBounded: bounded, paced: 0, pacedMs: 0 } },
  });
  const zero = snap(0, 0, 0, 0, 0);
  const fallout = audit.audit(zero, snap(2627, 525, 0, 3140, null), {});
  check('5 audit: Fallout without pump pacing is UNSAFE', fallout.verdict === 'UNSAFE', fallout.lines.join(' | '));
  check('5 audit: ratio 5', Math.abs(fallout.ratio - 5.0) < 0.01, `${fallout.ratio}`);
  const pumped = audit.audit(zero, snap(2627, 525, 1, 3140, null), {});
  check('5 audit: with pump pacing it is MULTI-PRESENT, not UNSAFE', /^MULTI-PRESENT/.test(pumped.verdict), pumped.verdict);
  const logical = audit.audit(zero, snap(1900, 0, 0, 100000, 950), { logicalLabel: 'GAME' });
  check('5 audit: two frame ends per game-counter frame is UNSAFE', logical.verdict === 'UNSAFE', logical.lines.join(' | '));
  const one = audit.audit(zero, snap(600, 600, 1, 10000, null), {});
  check('5 audit: one present per pump is OK', one.verdict === 'OK', one.verdict);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
