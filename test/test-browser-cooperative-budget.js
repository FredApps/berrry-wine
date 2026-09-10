#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = { console, URLSearchParams, performance: { now: () => 0 } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
  '\n;globalThis.WineAssembly = WineAssembly;', context);

function fixture({ cost = 0.02, halt = 1, yieldReason = 0, frozen = false,
  retired = n => n } = {}) {
  let now = 0, last = 0;
  const calls = [];
  const wine = Object.create(context.WineAssembly.prototype);
  wine._frozen = frozen;
  wine._audioSchedulerNow = () => now;
  wine.instance = { exports: {
    run(n) { calls.push(n); last = retired(n); now += cost * n; },
    get_last_run_blocks: () => last,
    get_last_run_halt: () => halt,
    get_yield_reason: () => yieldReason,
    get_eip: () => 0x401000,
  } };
  return { wine, calls };
}

{
  const { wine, calls } = fixture();
  const result = wine._runCooperativeSlice(500000);
  assert(result.hitDeadline);
  assert(result.elapsedMs >= 8 && result.elapsedMs < 10);
  assert(result.blocks < 500000);
  assert(calls.length > 1);
  assert.strictEqual(result.blocks, calls.reduce((a, b) => a + b, 0));
}

{
  const callbacks = [];
  context.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
  const wine = Object.create(context.WineAssembly.prototype);
  wine.running = true;
  let ran = false;
  wine._scheduleStep(() => { ran = true; });
  assert.strictEqual(ran, false, 'continuation is not executed synchronously or as an awaited microtask');
  assert.strictEqual(callbacks.length, 1, 'fallback posts a real macrotask');
  callbacks.shift()();
  assert.strictEqual(ran, true);
}
for (const options of [{ halt: 3 }, { halt: 5 }, { yieldReason: 1 },
  { retired: () => 0 }]) {
  const { wine, calls } = fixture(options);
  const result = wine._runCooperativeSlice(500000);
  assert.strictEqual(calls.length, 1, 'yield/debug/zero-work must return to host');
  assert.strictEqual(result.hitDeadline, false);
}
{
  const { wine } = fixture({ halt: 6, retired: () => 32 });
  const exports = wine.instance.exports;
  const calls = [], enabled = [];
  exports.run_budgeted = (n, deadline) => { calls.push([n, deadline]); exports.run(32); };
  exports.set_run_deadline_enabled = value => enabled.push(value);
  const result = wine._runCooperativeSlice(500000, 8);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][1], 8, 'WAT sees the shared host deadline');
  assert.strictEqual(result.blocks, 32);
  assert.strictEqual(result.hitDeadline, true, 'halt 6 reports deadline without a blocking yield');
  assert.deepStrictEqual(enabled, [0]);
  exports.run_budgeted = () => { throw new Error('test trap'); };
  assert.throws(() => wine._runCooperativeSlice(500000, 8), /test trap/);
  assert.deepStrictEqual(enabled, [0, 0], 'top-level trap clears armed deadline');
  wine._frozen = true;
  wine._runCooperativeSlice(10);
  assert.strictEqual(calls.length, 1, 'frozen stepping selects plain run even when budgeted export exists');
}
{
  const { wine, calls } = fixture({ cost: 1 });
  const first = wine._runCooperativeSlice(500000);
  assert.strictEqual(calls.length, 1, 'one expensive native call cannot be preempted');
  assert(first.hitDeadline && first.elapsedMs > 8, 'the deadline is a between-call bound');
  assert.strictEqual(wine._cooperativeQuantumBlocks, 1, 'adapt down after an expensive phase');
  const next = wine._runCooperativeSlice(500000);
  assert(next.hitDeadline && next.elapsedMs === 8);
}
{
  const { wine, calls } = fixture({ cost: 0 });
  const result = wine._runCooperativeSlice(300);
  assert.deepStrictEqual(calls, [128, 128, 44]);
  assert.strictEqual(result.blocks, 300);
  assert.strictEqual(result.hitDeadline, false);
}
{
  const { wine, calls } = fixture({ frozen: true });
  const result = wine._runCooperativeSlice(10000);
  assert.deepStrictEqual(calls, [10000], 'frozen stepping keeps deterministic budget');
  assert.strictEqual(result.blocks, 10000);
  assert.strictEqual(result.hitDeadline, false);
}
{
  const { wine, calls } = fixture({ retired: () => 7, halt: 3 });
  assert.strictEqual(wine._runCooperativeSlice(10000).blocks, 7,
    'account retired blocks, never the requested budget');
  assert.strictEqual(calls.length, 1);
}
console.log('PASS cooperative wall budget, actual work, yields, and frozen stepping');

{
  const { wine, calls } = fixture();
  assert.strictEqual(wine._runCooperativeSlice(1000, 0).blocks, 0);
  assert.deepStrictEqual(calls, [], 'expired shared deadline dispatches no new block');
  wine._runCooperativeSlice(0, 0);
  assert.deepStrictEqual(calls, [0], 'pending-block run(0) completion is mandatory');
}

const { ThreadManager } = require('../lib/thread-manager');
function manager() {
  const tm = new ThreadManager({}, new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
    { exports: { get_sync_table: () => 0 } }, () => ({ host: {} }));
  tm._log = () => {};
  return tm;
}

async function hostTurns(visible, cost, deferredWake = false) {
  let now = 0, lastMain = 0, lastWorker = 0;
  const mainCalls = [], workerCalls = [];
  const wine = Object.create(context.WineAssembly.prototype);
  const tm = manager();
  tm.threads.set(1, { tid: 1, state: 'active', sleepCount: 0, instance: { exports: {
    get_yield_reason: () => 0, get_eip: () => 0x401000, get_sleep_yielded: () => 0,
    get_last_run_blocks: () => lastWorker,
    run(n) { workerCalls.push(n); lastWorker = n; now += n * cost; },
  } } });
  tm.resolveMainThreadSend = async () => {};
  tm.checkMainYield = () => false;
  if (deferredWake) {
    tm._cooperativeWakeTargets = new Map([[1, 10]]);
    let attempts = 0;
    tm.drainCooperativeWakes = async () => {
      if (++attempts === 1) { now += 9; return { blocks: 1, pending: true }; }
      tm._cooperativeWakeTargets.clear();
      return { blocks: 1 };
    };
  }
  wine.threadManager = tm;
  wine.instance = { exports: {
    get_eip: () => 0x401000, get_yield_reason: () => 0, get_last_run_halt: () => 1,
    get_last_run_blocks: () => lastMain,
    run(n) { mainCalls.push(n); lastMain = n; now += n * cost; },
  } };
  wine._audioSchedulerNow = () => now;
  wine.renderer = visible ? { windows: { 1: {} }, flushRepaint() {} } : null;
  for (const name of ['_frozenRegister', '_installVisibilityPause', '_installInputWake',
    '_beginGuestTickBatch', '_pumpMultimediaTimer', '_checkLastWindowStop', '_presentDxIfDirty',
    'handleCooperativeThreadLoadLibraries', 'logToUI']) wine[name] = () => {};
  for (const name of ['_maybePauseForHidden', '_isMainExecutionSuspended', '_isAudioHot', '_hasOpenMenu']) {
    wine[name] = () => false;
  }
  wine._parkedSleepMs = () => 0;
  wine.stop = () => { throw new Error('unexpected host stop'); };
  let next, firstDone;
  const first = new Promise(resolve => { firstDone = resolve; });
  wine._scheduleStep = fn => { next = fn; firstDone(); };
  wine.run(500000);
  await first;
  if (deferredWake) {
    assert.strictEqual(mainCalls.length, 0, 'main cannot pass an unfinished wake continuation');
    assert.strictEqual(workerCalls.length, 0);
    await next();
  }
  const firstMainCount = mainCalls.length;
  assert(firstMainCount > 0);
  assert.strictEqual(workerCalls.length, 0, 'main used this turn deadline; no fresh worker budget');
  for (let i = 0; i < 5; i++) {
    const before = now;
    await next();
    if (cost === 0.02) assert(now - before < 11, 'all phases share one eight-ms between-call bound');
  }
  assert(workerCalls.length > 0, 'workers get a turn after expensive main work');
  assert(mainCalls.length > firstMainCount, 'worker preference cannot permanently starve main');
  assert(Math.max(...workerCalls) <= 128, 'worker calls start bounded and adapt under costly work');
  assert(Math.min(...workerCalls) < 128, 'worker quantum adapts down');
  console.log(`PASS shared host-turn deadline and main/worker fairness (${visible ? 'visible' : 'no-window'}, cost=${cost})`);
}

async function wakes() {
  const tm = manager();
  let now = 0;
  tm._cooperativeWakeTargets = new Map([[1, 10], [2, 20]]);
  for (const handle of [1, 2]) tm.threads.set(handle, {
    state: 'active', instance: { exports: { get_yield_reason: () => 0 } },
  });
  const order = [];
  tm.runSlice = (n, options) => {
    assert.strictEqual(options.deadline, 8);
    assert.strictEqual(options.now(), now);
    order.push(options.onlyThreadHandle);
    now += 9;
    return { steps: 128, blocks: 128, threadsRun: 1, hitDeadline: true };
  };
  const result = await tm.drainCooperativeWakes({ deadline: 8, now: () => now });
  assert(result.pending && result.hitDeadline);
  assert.deepStrictEqual(order, [1]);
  assert.deepStrictEqual([...tm._cooperativeWakeTargets], [[1, 10], [2, 20]], 'deferred wake order retained');
  tm.threads.get(1).instance.exports = { get_yield_reason: () => 1, get_wait_handle: () => 10 };
  now = 0;
  await tm.drainCooperativeWakes({ deadline: 8, now: () => now });
  assert.deepStrictEqual(order, [1, 2], 'completed first wake is retired before the second runs');
  console.log('PASS wake drain shares absolute deadline and retains continuation ordering');
}

function workerPeers() {
  const tm = manager();
  let now = 0;
  const order = [];
  for (const handle of [1, 2]) tm.threads.set(handle, { tid: handle, state: 'active', instance: { exports: {
    get_yield_reason: () => 0, get_eip: () => 0x401000, get_sleep_yielded: () => 0,
    get_last_run_blocks: () => 128,
    run() { order.push(handle); now += 9; },
  } } });
  for (let i = 0; i < 4; i++) tm.runBudgeted({ maxTotalSteps: 50000, quantumSteps: 50000,
    deadline: now + 8, now: () => now });
  assert.deepStrictEqual(order, [1, 2, 1, 2], 'a costly peer cannot starve other equal-priority workers');
}

(async () => {
  await hostTurns(false, 0.02);
  await hostTurns(true, 0.02);
  await hostTurns(false, 1);
  await hostTurns(false, 0.02, true);
  await wakes();
  workerPeers();
})().catch(error => { console.error(error); process.exitCode = 1; });
