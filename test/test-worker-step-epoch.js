#!/usr/bin/env node
'use strict';

// The host step epoch (lib/guest-rpc.js SLOT.STEP_EPOCH, host arm `w`): a
// guest thread's Worker that yields for a short Sleep waits it out on this
// word and runs on, until the page ends the step. The wait must return early
// on endStepEpoch from another thread, time out when nobody ends the step,
// and see a step that already ended before it started waiting.

const assert = require('assert');
const { Worker } = require('worker_threads');
const RPC = require('../lib/guest-rpc');

(async () => {
  assert.strictEqual(RPC.SLOT.STEP_EPOCH, 10, 'slot 10 carries the step epoch');
  assert.ok(RPC.SLOT.STEP_EPOCH !== RPC.SLOT.INPUT_WAKE && RPC.SLOT.STEP_EPOCH < RPC.SLOT.ARGS,
    'and overlaps neither the WAT-read INPUT_WAKE word nor the argument slots');

  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const epoch = RPC.readStepEpoch(memory);

  // Nobody ends the step: the wait is the Sleep, and times out.
  let t0 = Date.now();
  assert.strictEqual(RPC.waitStepEpoch(memory, epoch, 20), false, 'no step end: times out');
  assert.ok(Date.now() - t0 >= 15, 'having actually waited the Sleep out');

  // Another thread ends the step while a Worker waits on it.
  const worker = new Worker(`
    const { parentPort, workerData } = require('worker_threads');
    const RPC = require(${JSON.stringify(require.resolve('../lib/guest-rpc'))});
    const t0 = Date.now();
    const ended = RPC.waitStepEpoch(workerData.memory, workerData.epoch, 5000);
    parentPort.postMessage({ ended, ms: Date.now() - t0 });
  `, { eval: true, workerData: { memory, epoch } });
  setTimeout(() => RPC.endStepEpoch(memory), 30);
  const r = await new Promise((res, rej) => { worker.once('message', res); worker.once('error', rej); });
  await worker.terminate();
  assert.strictEqual(r.ended, true, 'endStepEpoch wakes the waiting Worker');
  assert.ok(r.ms < 2000, `long before its Sleep would have ended (${r.ms}ms)`);

  // A step that already ended: the next wait on the old epoch returns at once.
  t0 = Date.now();
  assert.strictEqual(RPC.waitStepEpoch(memory, epoch, 5000), true, 'stale epoch: already ended');
  assert.ok(Date.now() - t0 < 1000, 'without waiting');
  assert.strictEqual(RPC.readStepEpoch(memory), epoch + 1, 'one end, one bump');

  console.log('PASS worker step epoch: Sleep waits time out, step end wakes them, stale epochs return at once');
})().catch(err => { console.error(err); process.exit(1); });
