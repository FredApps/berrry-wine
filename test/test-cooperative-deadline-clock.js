'use strict';
// The global deadline clock (ThreadManager.deadlineNow, host `?sched-arm=g`,
// on by default in the browser): every clock read stands at the earliest
// overdue timed-sleep deadline until that thread has run, never goes
// backwards, and trails the real clock by at most 100ms.
const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');

let real = 1000;
const tm = Object.create(ThreadManager.prototype);
Object.assign(tm, { threads: new Map(), workerBackend: null, deadlineClock: true, _dcNow: 0,
  _realWaitNow: () => real });
tm._waitNow = () => (tm.deadlineClock ? tm.deadlineNow(tm._realWaitNow()) : tm._realWaitNow());
const sleeper = (sleepUntil, extra) => Object.assign(
  { state: 'active', suspendCount: 0, sleepCount: 3, lastSleepMs: 5, sleepUntil }, extra);

assert.strictEqual(tm._waitNow(), 1000, 'no threads: real time');

// A Sleep(5) mixer due at 1005 and a second sleeper due at 1030; the host was
// busy until 1040.
const mixer = sleeper(1005), other = sleeper(1030);
tm.threads.set(1, mixer);
tm.threads.set(2, other);
real = 1040;
assert.strictEqual(tm._waitNow(), 1005, 'stands at the earliest overdue deadline');
assert.strictEqual(tm.deadlineLagMs(), 35, 'lag is real minus the deadline clock');
assert.ok(tm._waitNow() < other.sleepUntil, 'the later sleeper is not due yet');

// The mixer runs and sleeps again from the time it saw: 1010, still overdue.
mixer.sleepUntil = tm._waitNow() + 5;
assert.strictEqual(tm._waitNow(), 1010, 'advances one wake at a time');
for (let i = 0; i < 4; i++) mixer.sleepUntil = tm._waitNow() + 5;
assert.strictEqual(tm._waitNow(), 1030, 'reaches the other sleeper in deadline order');
assert.ok(tm._waitNow() >= other.sleepUntil, 'which is now due');
other.sleepUntil = 1100;
for (let i = 0; i < 2; i++) mixer.sleepUntil = tm._waitNow() + 5;
assert.strictEqual(tm._waitNow(), 1040, 'caught up: real time once nothing is overdue');
assert.strictEqual(tm.deadlineLagMs(), 0, 'no lag when caught up');

// Never backwards: a deadline earlier than what was already handed out.
mixer.sleepUntil = 1020;
assert.strictEqual(tm._waitNow(), 1040, 'monotone for every reader');

// Idle, suspended and untimed threads do not hold the clock.
mixer.sleepUntil = 1045;
real = 1060;
mixer.suspendCount = 1;
assert.strictEqual(tm._waitNow(), 1060, 'suspended sleeper ignored');
mixer.suspendCount = 0;
mixer.lastSleepMs = 0;
mixer.sleepUntil = 1070;
real = 1080;
assert.strictEqual(tm._waitNow(), 1080, 'Sleep(0) spinner ignored');
mixer.lastSleepMs = 5;

// Bounded lag: a sleeper nobody serves cannot hold the world back further.
mixer.sleepUntil = 1085;
real = 1300;
assert.strictEqual(tm._waitNow(), 1200, 'trails real time by at most 100ms');
assert.strictEqual(tm.deadlineLagMs(), 100);

// A clock that restarts (new session) is followed down, not held.
mixer.sleepUntil = 0;
real = 10;
assert.strictEqual(tm._waitNow(), 10, 'real clock reset is followed');

// Off, or with real Worker threads, it is the real clock.
mixer.sleepUntil = 5;
real = 50;
tm.deadlineClock = false;
assert.strictEqual(tm._waitNow(), 50, 'off: real clock');
assert.strictEqual(tm.deadlineLagMs(), 0);
tm.deadlineClock = true;
tm.workerBackend = {};
assert.strictEqual(tm._waitNow(), 50, 'worker backend: real clock');
assert.strictEqual(tm.deadlineLagMs(), 0);

console.log('PASS cooperative deadline clock pins overdue sleep deadlines, monotone, bounded');
