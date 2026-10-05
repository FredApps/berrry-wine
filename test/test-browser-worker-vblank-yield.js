#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
const rafs = [];
const timers = new Map();
let nextTimer = 1;
const context = {
  console,
  URLSearchParams,
  performance: { now: () => 0 },
  requestAnimationFrame(fn) { rafs.push(fn); return rafs.length; },
  cancelAnimationFrame() {},
  setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
};
vm.runInNewContext(source + '\n;globalThis.WineAssembly = WineAssembly;', context);

const threadedStart = source.indexOf('  _runThreaded(stepsPerSlice) {');
const threadedEnd = source.indexOf('\n  // Schedule the next guest slice.', threadedStart);
const threaded = source.slice(threadedStart, threadedEnd);
const branch = threaded.match(
  /else if \(r\.yield === 13\) \{([\s\S]*?)\n        \} else if \(r\.yield === 14/);
assert(branch, 'guest-main Worker loop handles vblank yield 13 explicitly');
// The display beat travels on the next slice message rather than as two
// callExport round trips ahead of it: three rendezvous per frame cost DX-Ball
// ~40% of its vblanks.
assert(branch[1].includes('self._workerVblankDue = true'),
  'the display beat is recorded for the owning Worker instance');
assert(/if \(self\._workerVblankDue\) \{[\s\S]*?vblank: 1[\s\S]*?guestWorker\.slice\(steps, sliceSync\)/
  .test(threaded), 'the next main slice carries the display beat');
const workerSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'guest-worker.js'), 'utf8');
assert(/if \(msg\.sync\.vblank\) \{\s*if \(ex\.vblank_tick\) ex\.vblank_tick\(\);\s*if \(ex\.clear_yield\) ex\.clear_yield\(\);/
  .test(workerSource),
  'the owning Worker ticks, then clears the parked DirectDraw thunk, before running');
assert(branch[1].includes('_awaitVblank('),
  'live mode waits for a compositor display beat');
assert(branch[1].includes('if (self._frozen)'),
  'frozen mode advances deterministically without waiting for rAF');
assert(!branch[1].includes('self.instance.exports.vblank_tick'),
  'worker mode must not tick the idle browser-side WASM instance');

(async () => {
  const wine = Object.create(context.WineAssembly.prototype);
  let localTicks = 0;
  wine.instance = { exports: { vblank_tick() { localTicks++; } } };

  let resumed = 0;
  wine._awaitVblank(() => { resumed++; });
  assert.strictEqual(rafs.length, 1);
  rafs.shift()(1000 / 60);
  assert.strictEqual(localTicks, 1, 'cooperative mode still ticks its local instance');
  assert.strictEqual(resumed, 1, 'synchronous cooperative tick resumes immediately');

  const order = [];
  let finishAdvance;
  wine._awaitVblank(() => { order.push('resume'); }, () => {
    order.push('advance');
    return new Promise(resolve => { finishAdvance = resolve; })
      .then(() => { order.push('advanced'); });
  });
  assert.strictEqual(rafs.length, 1);
  rafs.shift()(2000 / 60);
  assert.deepStrictEqual(order, ['advance'],
    'an asynchronous Worker tick holds the next slice');
  assert.strictEqual(localTicks, 1,
    'a custom Worker advance does not touch the idle local instance');
  finishAdvance();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(order, ['advance', 'advanced', 'resume'],
    'the retry is scheduled only after the Worker tick and yield clear finish');

  console.log('PASS browser guest-main Worker services display-paced vblank yields');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
