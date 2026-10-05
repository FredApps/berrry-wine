#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hostSource = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
const channels = [];
class FakeMessageChannel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = { postMessage: () => {} };
    channels.push(this);
  }
}

const context = {
  MessageChannel: FakeMessageChannel,
  URLSearchParams,
  console,
  setTimeout,
};
vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', context);

const wine = new context.WineAssembly();
let calls = 0;
wine._scheduleStep(() => { calls++; });

assert.strictEqual(channels.length, 1, 'the scheduler creates one MessageChannel');
assert.strictEqual(wine._stepListenPort, channels[0].port1,
  'the process retains the listener port for its full run lifetime');
assert.strictEqual(typeof wine._stepListenPort.onmessage, 'function');

wine._stepListenPort.onmessage();
assert.strictEqual(calls, 1, 'the retained listener runs the pending guest slice');
assert.strictEqual(wine._pendingStep, null, 'delivery consumes the pending slice exactly once');

wine._scheduleStep(() => { calls++; });
assert.strictEqual(channels.length, 1, 'later slices reuse the retained channel');
wine._stepListenPort.onmessage();
assert.strictEqual(calls, 2);

console.log('PASS  browser scheduler retains and reuses its MessageChannel listener');

// ---- parked slices and the browser's nested-timer clamp ----------------
//
// A fake event loop that models what browsers actually do with timers: a
// setTimeout called from inside a timer callback inherits that callback's
// nesting level plus one, and once the level passes 5 a delay under 4ms is
// raised to 4ms (HTML "timer initialization steps"). A MessageChannel task
// is not a timer task, so a timer scheduled from it starts at level 1.
// Heroes II parks its main thread for 1ms on every slice of its hero walk;
// before the fix every one of those became ~3.8ms in Chrome.
function makeLoop() {
  let now = 0;
  let seq = 0;
  let currentLevel = 0;
  const timers = new Map();
  const ports = [];
  const delays = [];
  const loop = {
    get now() { return now; },
    delays,
    setTimeout(fn, ms) {
      const level = currentLevel + 1;
      let delay = Math.max(0, ms | 0);
      if (level > 5 && delay < 4) delay = 4;
      const id = ++seq;
      timers.set(id, { fn, due: now + delay, level, id });
      delays.push({ requested: ms, effective: delay, level });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    MessageChannel: class {
      constructor() {
        const port1 = { onmessage: null };
        this.port1 = port1;
        this.port2 = { postMessage: () => ports.push(port1) };
      }
    },
    // Run one macrotask: posted port messages first (they are due now), else
    // the earliest timer, advancing the virtual clock to it.
    runOne() {
      if (ports.length) {
        const p = ports.shift();
        currentLevel = 0;
        p.onmessage();
        return true;
      }
      let next = null;
      for (const t of timers.values()) if (!next || t.due < next.due || (t.due === next.due && t.id < next.id)) next = t;
      if (!next) return false;
      timers.delete(next.id);
      now = next.due;
      currentLevel = next.level;
      next.fn();
      currentLevel = 0;
      return true;
    },
    pendingTimers() { return timers.size; },
  };
  return loop;
}

function makeWine(loop) {
  const ctx = {
    MessageChannel: loop.MessageChannel,
    URLSearchParams,
    console,
    setTimeout: (fn, ms) => loop.setTimeout(fn, ms),
    clearTimeout: (id) => loop.clearTimeout(id),
  };
  vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', ctx);
  const w = new ctx.WineAssembly();
  w.running = true;
  w._frozenIdle = () => {};
  return w;
}

{
  // 1. A guest that parks for 1ms on every slice gets 1ms every time.
  const loop = makeLoop();
  const w = makeWine(loop);
  let slices = 0;
  const step = () => { slices++; if (slices < 40) w._scheduleStep(step, 1); };
  w._scheduleStep(step, 1);
  while (loop.runOne()) { /* drain */ }
  assert.strictEqual(slices, 40, 'every parked slice ran');
  const clamped = loop.delays.filter(d => d.effective !== d.requested);
  assert.deepStrictEqual(clamped, [], 'no 1ms park is stretched by the nested-timer clamp');
  assert.ok(loop.delays.every(d => d.level === 1),
    'each park timer is scheduled from a port task, at nesting level 1');
  assert.strictEqual(loop.now, 40, '40 one-millisecond parks take 40ms, not ~160ms');
}

{
  // 2. Control: the same chain run straight from the timer callback (the old
  // shape) is what the clamp punishes. Pins the model, so (1) is meaningful.
  const loop = makeLoop();
  let slices = 0;
  const step = () => { slices++; if (slices < 40) loop.setTimeout(step, 1); };
  loop.setTimeout(step, 1);
  while (loop.runOne()) { /* drain */ }
  assert.ok(loop.now >= 4 * 30, `old nested chain is clamped (took ${loop.now}ms)`);
}

{
  // 3. A long park keeps its full delay: idle/menu power savings unchanged.
  const loop = makeLoop();
  const w = makeWine(loop);
  let ran = 0;
  w._scheduleStep(() => { ran++; }, 30);
  assert.strictEqual(loop.delays[0].effective, 30);
  loop.runOne();                               // the timer fires at 30ms ...
  assert.strictEqual(ran, 0, '... and posts the slice instead of running it inline');
  assert.strictEqual(loop.now, 30);
  loop.runOne();                               // ... which runs at once
  assert.strictEqual(ran, 1);
  assert.strictEqual(loop.now, 30, 'the extra hop costs no virtual time');
  // The scheduler cap still applies.
  w._scheduleStep(() => {}, 5000);
  assert.strictEqual(loop.delays[1].effective, w.constructor.MAX_PARK_SLEEP_MS);
  w._cancelDelayedStep();
}

{
  // 4. Early wake: input during a park runs the slice now, not at the deadline.
  const loop = makeLoop();
  const w = makeWine(loop);
  let ran = 0;
  w._scheduleStep(() => { ran++; }, 40);
  w._wakeStep();
  assert.strictEqual(loop.pendingTimers(), 0, 'wake cancels the park timer');
  loop.runOne();
  assert.strictEqual(ran, 1);
  assert.strictEqual(loop.now, 0, 'woken slice ran without waiting out the park');
}

{
  // 5. Cancel: a stopped app does not run the parked slice when its timer fires.
  const loop = makeLoop();
  const w = makeWine(loop);
  let ran = 0;
  w._scheduleStep(() => { ran++; }, 1);
  w.running = false;
  while (loop.runOne()) { /* drain */ }
  assert.strictEqual(ran, 0, 'no slice after stop');
}

{
  // 6. Freezing during the hop: the slice runs once, then parks in frozen mode.
  const loop = makeLoop();
  const w = makeWine(loop);
  let ran = 0;
  const step = () => { ran++; w._scheduleStep(step, 1); };
  w._scheduleStep(step, 1);
  loop.runOne();                               // timer fired, slice posted
  w._frozen = true;
  while (loop.runOne()) { /* drain */ }
  assert.strictEqual(ran, 1, 'one slice, then the loop holds');
  assert.strictEqual(w._frozenStep, step, 'frozen mode holds the continuation');
  assert.strictEqual(loop.pendingTimers(), 0);
}

console.log('PASS  parked slices wake through the port: no nested-timer clamp, long parks/wake/stop/freeze intact');
