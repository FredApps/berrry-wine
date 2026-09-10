'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const State = require('../lib/guest-callback-state');
let checks = 0;
function test(name, body) { body(); checks++; console.log(`PASS ${name}`); }

test('main cooperative preserves absolute deadlines and poll floor across virtual time', () => {
  let now = 100;
  const owner = { _mainSleepUntil: 180, _mainWaitStartedAt: 70, _mainWaitPolls: 12, other: 9 };
  assert.strictEqual(State.begin(owner, 1, 'mainCooperative'), true);
  assert.deepStrictEqual(owner, { _mainSleepUntil: 0, _mainWaitStartedAt: 0, _mainWaitPolls: 0, other: 9 });
  now = 250;
  owner._mainSleepUntil = now + 500;
  owner._mainWaitStartedAt = now;
  owner._mainWaitPolls = 2;
  assert.strictEqual(State.finish(owner, 1), true);
  assert.deepStrictEqual(owner, { _mainSleepUntil: 180, _mainWaitStartedAt: 70, _mainWaitPolls: 12, other: 9 });
  assert(now >= owner._mainSleepUntil);
  assert(now - owner._mainWaitStartedAt >= 100);
});

test('thread callback waits cannot extend original sleep or replace accounting', () => {
  const owner = { sleepUntil: 500, waitStartedAt: 200, waitPolls: 8, sleepCount: 17 };
  const old = { ...owner };
  assert(State.begin(owner, 2, 'thread'));
  assert.deepStrictEqual(owner, { sleepUntil: 0, waitStartedAt: 0, waitPolls: 0, sleepCount: 0 });
  Object.assign(owner, { sleepUntil: 900, waitStartedAt: 600, waitPolls: 4, sleepCount: 2 });
  assert(State.finish(owner, 2));
  assert.deepStrictEqual(owner, old);
});

test('main Worker isolates callback object and restores original identity and values', () => {
  const original = { waitStartedAt: 100, waitPolls: 5, other: 'retained' };
  const owner = { _mainWaitState: original };
  assert(State.begin(owner, 3, 'mainWorker'));
  assert.notStrictEqual(owner._mainWaitState, original);
  assert.deepStrictEqual(owner._mainWaitState, { waitStartedAt: 0, waitPolls: 0 });
  owner._mainWaitState.waitStartedAt = 700;
  owner._mainWaitState.waitPolls = 100;
  assert.deepStrictEqual(original, { waitStartedAt: 100, waitPolls: 5, other: 'retained' });
  assert(State.finish(owner, 3));
  assert.strictEqual(owner._mainWaitState, original);
  assert.deepStrictEqual(original, { waitStartedAt: 100, waitPolls: 5, other: 'retained' });
});

test('absent and explicitly undefined fields retain their distinct presence', () => {
  for (const mode of ['mainCooperative', 'thread', 'mainWorker']) {
    const owner = {};
    assert(State.begin(owner, 4, mode));
    assert(State.finish(owner, 4));
    assert.deepStrictEqual(owner, {});
  }
  for (const initial of [undefined, null, {}]) {
    const owner = { _mainWaitState: initial };
    assert(State.begin(owner, 4, 'mainWorker'));
    assert(State.finish(owner, 4));
    assert(Object.hasOwn(owner, '_mainWaitState'));
    assert.strictEqual(owner._mainWaitState, initial);
    if (initial) assert.deepStrictEqual(initial, {});
  }
});

test('nested begin and token mismatch reject without changing active transaction', () => {
  const owner = { sleepUntil: 300 };
  assert(State.begin(owner, 5, 'thread'));
  owner.waitPolls = 9;
  const callback = { ...owner };
  assert.strictEqual(State.begin(owner, 5, 'thread'), false);
  assert.strictEqual(State.begin(owner, 6, 'mainCooperative'), false);
  assert.strictEqual(State.finish(owner, 6), false);
  assert.deepStrictEqual(owner, callback);
  assert(State.finish(owner, 5));
  assert.deepStrictEqual(owner, { sleepUntil: 300 });
  assert.strictEqual(State.finish(owner, 5), false);
  assert.strictEqual(State.cancel(owner), false);
  assert(State.begin(owner, 7, 'thread'));
  assert.strictEqual(State.finish(owner, 5), false);
  assert(State.finish(owner, 7));
});

test('cancel never restores terminated guest state and cannot finish afterward', () => {
  for (const mode of ['thread', 'mainCooperative', 'mainWorker']) {
    const owner = { sleepUntil: 300, _mainSleepUntil: 400, _mainWaitState: { waitPolls: 8 } };
    assert(State.begin(owner, 8, mode));
    const callback = { ...owner };
    assert(State.cancel(owner));
    assert.deepStrictEqual(owner, callback);
    assert.strictEqual(State.finish(owner, 8), false);
    assert.strictEqual(State.cancel(owner), false);
  }
});

test('owners are independent even when tokens match', () => {
  const a = { sleepUntil: 100 }, b = { sleepUntil: 200 };
  assert(State.begin(a, 9, 'thread'));
  assert(State.begin(b, 9, 'thread'));
  assert(State.cancel(a));
  assert(State.finish(b, 9));
  assert.strictEqual(a.sleepUntil, 0);
  assert.strictEqual(b.sleepUntil, 200);
});

test('invalid modes, owners, and reserved tokens reject without mutations', () => {
  const owner = { sleepUntil: 100 };
  for (const mode of ['unknown', 'toString', '__proto__']) assert.strictEqual(State.begin(owner, 1, mode), false);
  for (const token of [null, undefined, 0]) assert.strictEqual(State.begin(owner, token, 'thread'), false);
  for (const bad of [null, undefined, 1, 'owner']) {
    assert.strictEqual(State.begin(bad, 1, 'thread'), false);
    assert.strictEqual(State.finish(bad, 1), false);
    assert.strictEqual(State.cancel(bad), false);
  }
  assert.deepStrictEqual(owner, { sleepUntil: 100 });
});

test('browser IIFE has no imports and exposes the same transaction API', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/guest-callback-state'), 'utf8'), sandbox);
  const owner = { sleepUntil: 90 };
  assert(sandbox.GuestCallbackState.begin(owner, 10, 'thread'));
  assert(sandbox.GuestCallbackState.finish(owner, 10));
  assert.strictEqual(owner.sleepUntil, 90);
});
console.log(`${checks} callback scheduling-state checks passed`);
