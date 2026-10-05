#!/usr/bin/env node
'use strict';

// Every thread of one guest must read the same clock.
//
// The headless runner answers GetTickCount/timeGetTime on the batch-loop
// thread out of its own import table, and hands worker-hosted guest threads a
// value it PUBLISHES into their control block. Those were two independent
// expressions in test/run.js, and under `--real-ticks --threads` they were two
// different clocks: the main thread on the wall clock, every worker on the
// batch counter. lib/guest-clock.js makes the choice once for both.
//
// What this pins: with --real-ticks both entry points are the same wall
// reading; in batch mode both come from the batch clock, a publish never
// consumes a per-call step (so host bookkeeping cannot advance guest time),
// and a worker can lag the main thread by less than one batch step but can
// never lead it or go backwards.

const assert = require('assert');
const { createBatchClock } = require('../lib/batch-clock');
const { createGuestClockSource } = require('../lib/guest-clock');

// 1. --real-ticks: one wall reading, shared exactly.
{
  let fake = 1_000_000;
  const clock = createGuestClockSource({
    realTicks: true, timeScale: 1, clockOrigin: 1_000_000, now: () => fake,
  });
  assert.strictEqual(clock.ticks(), 0, 'the origin is time zero');
  assert.strictEqual(clock.publish(), 0, 'and the publish agrees at the origin');
  fake += 1234;
  assert.strictEqual(clock.ticks(), 1234);
  assert.strictEqual(clock.publish(), 1234,
    'a worker thread must read exactly what the main thread reads');
  console.log('PASS  --real-ticks gives both threads the same wall reading');
}

// 2. --real-ticks --time-scale: the scale applies to both, not just one.
{
  let fake = 0;
  const clock = createGuestClockSource({
    realTicks: true, timeScale: 10, clockOrigin: 0, now: () => fake,
  });
  fake = 50;
  assert.strictEqual(clock.ticks(), 500);
  assert.strictEqual(clock.publish(), 500,
    '--time-scale must not be applied to one thread and withheld from another');
  console.log('PASS  --time-scale reaches worker threads too');
}

// 3. Batch mode: both come from the batch clock, and a publish is free.
{
  const batchClock = createBatchClock(200);
  const clock = createGuestClockSource({ batchClock });
  batchClock.state.batch = 3;
  const before = batchClock.state.callsInBatch;
  assert.strictEqual(clock.publish(), 600, 'publish is the batch base');
  assert.strictEqual(clock.publish(), 600, 'and is stable across publishes');
  assert.strictEqual(batchClock.state.callsInBatch, before,
    'publishing must not consume a per-call step');
  const first = clock.ticks();
  const second = clock.ticks();
  assert(first >= 600 && second > first,
    'successive guest calls inside a batch must be distinguishable');
  console.log('PASS  a publish shares the batch clock without spending a call step');
}

// 4. A worker may lag the main thread, never lead it, never go backwards.
{
  const batchClock = createBatchClock(200);
  const clock = createGuestClockSource({ batchClock });
  let lastPublish = -1;
  for (let batch = 0; batch < 25; batch++) {
    batchClock.state.batch = batch;
    batchClock.state.callsInBatch = 0;
    const published = clock.publish();
    assert(published >= lastPublish, 'the published clock must never go backwards');
    lastPublish = published;
    for (let call = 0; call < 5; call++) {
      const main = clock.ticks();
      assert(main >= published,
        `a worker must not lead the main thread (batch ${batch}: ${published} > ${main})`);
      assert(main - published < 200,
        `a worker must not lag by a whole batch step (batch ${batch}: ${main - published}ms)`);
    }
  }
  console.log('PASS  workers lag within one batch step and never lead or rewind');
}

// 5. A mid-run --tick-ms-per-batch change rebases both together. This is the
//    case the old worker formula (batch * TICK_MS_PER_BATCH, read from argv)
//    could not express at all: it would have jumped backwards here.
{
  const batchClock = createBatchClock(200);
  const clock = createGuestClockSource({ batchClock });
  batchClock.state.batch = 10;
  const before = clock.publish();
  assert.strictEqual(before, 2000);
  batchClock.setTickMsPerBatch(5);
  assert.strictEqual(clock.publish(), before,
    'a slope change must preserve the clock at the transition for workers too');
  batchClock.state.batch = 11;
  assert.strictEqual(clock.publish(), before + 5, 'and take effect from there');
  console.log('PASS  a slope change rebases the worker clock with the main one');
}

console.log('PASS  one guest clock for every thread');
