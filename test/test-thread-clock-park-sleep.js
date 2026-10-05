#!/usr/bin/env node
'use strict';

// A cooperative guest THREAD that the clock-spin detector parks (yield 14)
// must be slept to the park's deadline, not re-sliced on the next turn.
//
// WHY THIS EXISTS
// Blobby Volley runs its whole game on a spawned thread, and its frame limiter
// at 0x445242 is `call GetTickCount / cmp eax,[deadline] / jb 0x445242` with
// nothing else in the loop. $clock_spin_step catches it, but the scheduler used
// to answer the park with "clear the yield, skip one turn": the next turn
// re-read the same millisecond, the one-park-per-millisecond latch refused a
// second park, and the thread spun out the rest of its slice. Worse, a thread
// sitting on a pending yield 14 is "not idle" to parkedThreadDelay, so the
// browser host never slept either. Headless (200000-block batches) the same
// match went from >280s to 29s for 700 batches once the park slept.
//
// What is pinned here, with a fake instance and a manual clock (no wasm, no
// wall time, deterministic):
//   1. the parked slice clears the yield, so the due turn re-enters the call;
//   2. the thread is not run again before the deadline, while a peer is;
//   3. the host may sleep (parkedThreadDelay > 0) once only parked threads remain;
//   4. at the deadline it runs again;
//   5. a bogus far deadline is clamped, and a past one still sleeps 1ms;
//   6. `clockParkSleep: false` keeps the old behaviour (the A/B arm).

const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');

let nowMs = 5000;

function machine(onRun) {
  const state = { yieldReason: 0, eip: 0x401000, esp: 0x1000, runs: 0, clears: 0, tick: 0, deadline: 0 };
  const ex = {
    get_sync_table: () => 0,
    get_yield_reason: () => state.yieldReason,
    get_eip: () => state.eip, set_eip: n => { state.eip = n; },
    get_esp: () => state.esp, set_esp: n => { state.esp = n; },
    run: () => { state.runs++; if (onRun) onRun(state); },
    get_bp_addr: () => 0,
    get_sleep_yielded: () => 0,
    clear_yield: () => { state.yieldReason = 0; state.clears++; },
    get_tick_count: () => state.tick,
    get_spin_deadline_ms: () => state.deadline,
  };
  for (const name of ['ebp', 'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'handler_set_eip', 'steps']) {
    ex['get_' + name] = () => state[name] || 0;
    ex['set_' + name] = v => { state[name] = v; };
  }
  return { state, ex };
}

function manager(opts) {
  const main = machine();
  const tm = new ThreadManager({}, new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
    { exports: main.ex }, () => ({ host: {} }),
    Object.assign({ now: () => nowMs, waitNow: () => nowMs }, opts || {}));
  tm._log = () => {};
  return tm;
}

const thread = (tid, m) => ({ tid, state: 'active', sleepCount: 0, sleepUntil: 0, waitPolls: 0,
  instance: { exports: m.ex } });

// The spinner: every slice ends in a clock park on the millisecond it read.
const spinPark = owedMs => st => {
  st.tick = nowMs;
  st.deadline = (nowMs + owedMs) >>> 0;
  st.yieldReason = 14;
};

// 1-4: park sleeps to the deadline, peers keep running, host may sleep.
{
  const tm = manager();
  const spinner = machine(spinPark(1));
  const peer = machine();
  tm.threads.set(1, thread(1, spinner));
  tm.threads.set(2, thread(2, peer));

  tm.runSlice(100);
  assert.strictEqual(spinner.state.runs, 1, 'spinner ran its first slice');
  assert.strictEqual(spinner.state.clears, 1, 'park yield cleared so the due turn re-enters the call');
  assert.strictEqual(spinner.state.yieldReason, 0);
  assert.strictEqual(tm.threads.get(1).sleepUntil, nowMs + 1, 'slept to the named deadline');
  assert.strictEqual(tm.threads.get(1).clockParkSleeps, 1);

  tm.runSlice(100);
  assert.strictEqual(spinner.state.runs, 1, 'not re-sliced before its deadline');
  assert.strictEqual(peer.state.runs, 2, 'a parked spinner does not stall its peer');

  nowMs += 1;
  tm.runSlice(100);
  assert.strictEqual(spinner.state.runs, 2, 'due at the deadline, re-enters GetTickCount');
}

{
  // Only the parked spinner: after one pass with no work the host may sleep.
  const tm = manager();
  const spinner = machine(spinPark(1));
  tm.threads.set(1, thread(1, spinner));
  tm.runSlice(100);
  tm.runSlice(100); // the no-work pass parkedThreadDelay requires
  const delay = tm.parkedThreadDelay(50);
  assert(delay > 0 && delay <= 1, `host may sleep to the park deadline (got ${delay})`);
}

// 5: clamps.
{
  const tm = manager();
  const far = machine(spinPark(100000));
  tm.threads.set(1, thread(1, far));
  tm.runSlice(100);
  assert.strictEqual(tm.threads.get(1).sleepUntil, nowMs + 50, 'a bogus far deadline is capped at 50ms');

  const tm2 = manager();
  const past = machine(spinPark(-5));
  tm2.threads.set(1, thread(1, past));
  tm2.runSlice(100);
  assert.strictEqual(tm2.threads.get(1).sleepUntil, nowMs + 1, 'a passed deadline still sleeps 1ms');
}

// 6: the A/B arm keeps the old contract: the park stays pending, the next turn
// only clears it, and the host is told not to sleep.
{
  const tm = manager({ clockParkSleep: false });
  const spinner = machine(spinPark(1));
  tm.threads.set(1, thread(1, spinner));
  tm.runSlice(100);
  assert.strictEqual(spinner.state.yieldReason, 14, 'old arm leaves the park pending');
  assert.strictEqual(tm.threads.get(1).sleepUntil, 0);
  tm.runSlice(100);
  assert.strictEqual(spinner.state.clears, 1, 'old arm clears on the next turn');
  assert.strictEqual(spinner.state.runs, 1);
  assert.strictEqual(tm.parkedThreadDelay(50), 0, 'old arm: host never sleeps for a clock park');
}

console.log('PASS thread clock park: sleeps to the deadline, peers run, host may sleep, clamps, A/B arm');
