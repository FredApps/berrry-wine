#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HelpNavigationPump = require('../lib/help-navigation-pump');
const GuestCallbackState = require('../lib/guest-callback-state');
const { ThreadManager } = require('../lib/thread-manager');
function fixture() {
  const cpu = { eip: 0x401123, esp: 0x10ff00, eax: 91, ebx: 92, ecx: 93,
    edx: 94, esi: 95, edi: 96, ebp: 97, flags: 0x246,
    yieldReason: 7, yieldFlag: 1, waitHandle: 29, waitAll: 1, timeout: 999 };
  let pending = true, ready = false, calls = 0, fills = 0, alive = true;
  const request = { handle: 19, path: 'c:\\deferred.hlp' };
  const vfs = { pendingRead: null, async fillPendingRead(p) {
    assert.strictEqual(p, request); fills++; ready = true;
  } };
  const ex = {
    get_help_macro_native_token: () => 0,
    get_help_navigation_pending: () => +pending,
    get_help_navigation_io_handle: () => 19,
    help_navigation_cancel() { pending = false; },
    help_navigation_service() {
      calls++;
      if (!pending) return 0;
      if (vfs.pendingRead) return -1;
      if (!ready) { vfs.pendingRead = request; return -1; }
      pending = false; return 1;
    },
  };
  return { cpu, ex, vfs, request, run: options => HelpNavigationPump.pump({
    exports: ex, vfs, alive: () => alive, ...options }),
  stats: () => ({ calls, fills, pending }), stop() { alive = false; } };
}
(async () => {
  function nativeFixture() {
    const owner = { sleepUntil: 180, waitStartedAt: 70, waitPolls: 12, sleepCount: 8 };
    let phase = 1, token = 123, alive = true, begins = 0, finishes = 0, cancels = 0;
    const vfs = { pendingRead: null };
    const ex = {
      get_help_navigation_pending: () => +!!token,
      get_help_macro_native_token: () => token,
      get_help_macro_native_phase: () => phase,
      get_help_macro_native_io_handle: () => 19,
      help_macro_native_prepare: () => 1,
      help_macro_native_begin(value) { assert.strictEqual(value, token); begins++; phase = 2; return 1; },
      help_macro_native_finish(value) { assert.strictEqual(value, token); finishes++; token = 0; return 1; },
      help_navigation_cancel() { cancels++; token = 0; },
    };
    return { owner, ex, vfs, run: options => HelpNavigationPump.pump({ exports: ex,
      vfs, callbackOwner: owner, callbackMode: 'thread', alive: () => alive, ...options }),
      returned() { phase = 3; }, stop() { alive = false; },
      stats: () => ({ begins, finishes, cancels, phase, token }) };
  }
  for (const remote of [false, true]) {
    const f = nativeFixture(), old = { ...f.owner };
    const options = remote ? { exports: undefined, call: async (name, ...args) => f.ex[name](...args) } : {};
    assert.strictEqual((await f.run(options)).pending, true);
    assert.deepStrictEqual(f.owner, { sleepUntil: 0, waitStartedAt: 0, waitPolls: 0, sleepCount: 0 });
    f.owner.sleepUntil = 900; f.owner.waitStartedAt = 500; f.owner.waitPolls = 2;
    assert.strictEqual((await f.run(options)).serviced, false, 'executing callback stays in ordinary scheduler');
    assert.strictEqual(f.stats().begins, 1);
    f.returned();
    assert.strictEqual((await f.run(options)).pending, false);
    assert.deepStrictEqual(f.owner, old, 'absolute old deadline and wait age survive callback scheduling');
    const now = 700;
    assert(now >= f.owner.sleepUntil, 'expired old sleep is not extended');
    await f.run(options);
    assert.strictEqual(f.stats().finishes, 1, 'typed return completes once');
  }
  // Use real wait resolution and atomic event/semaphore consumption. Only the
  // WAT exports/handle lookup are fixtures; callback scheduling must inspect the
  // current descriptor, not a slice reply captured before callback entry.
  for (const mode of ['mainWorker', 'mainCooperative']) {
    for (const type of [1, 2]) {
      for (const signaled of [false, true]) {
        const f = nativeFixture();
        const manager = Object.create(ThreadManager.prototype);
        let now = 100, currentHandle = 101, currentYield = 1, completion = null;
        const sync = new Int32Array(new SharedArrayBuffer(32));
        sync.set([101, type, +signaled, 0, 102, type, 1, 0]);
        Object.assign(manager, { _renderSendTargets: new Set(), syncView: sync, _getSyncIdx: handle => handle === 101 ? 0 : 1,
          _now: () => now, _waitNow: () => now, hasActiveThreads: () => true,
          _mainWaitState: { waitStartedAt: 70, waitPolls: 100 },
          _mainSleepUntil: 0, _mainWaitStartedAt: 70, _mainWaitPolls: 100,
          _completeWait(_ex, result, bytes) { completion = { result, bytes }; currentYield = 0; return 0x401000; } });
        const oldWaitState = manager._mainWaitState;
        Object.assign(f.ex, { get_sleep_yielded: () => 0, get_yield_reason: () => currentYield,
          get_wait_handle: () => currentHandle, get_wait_handles_ptr: () => 0,
          get_wait_all: () => 0, get_wait_timeout: () => 100,
          get_wait_stack_bytes: () => 12 });
        manager.mainInstance = { exports: f.ex };
        const enter = f.ex.help_macro_native_begin, finish = f.ex.help_macro_native_finish;
        f.ex.help_macro_native_begin = token => {
          const ok = enter(token); currentHandle = 102; currentYield = 1; return ok;
        };
        f.ex.help_macro_native_finish = token => {
          const ok = finish(token); currentHandle = 101; currentYield = 1; return ok;
        };
        const pump = () => f.run({ callbackOwner: manager, callbackMode: mode });
        const resolveCurrent = () => {
          if (mode === 'mainWorker') {
            const r = manager.resolveMainWorkerWait({ waitHandle: f.ex.get_wait_handle(),
              waitTimeout: f.ex.get_wait_timeout(), waitStackBytes: 12 });
            if (r) completion = { result: r.result, bytes: r.waitStackBytes };
            return r;
          }
          return manager.checkMainYield();
        };
        await pump();
        assert.strictEqual(sync[2], +signaled, `${mode}: preparation does not consume original object`);
        resolveCurrent();
        assert.deepStrictEqual(completion, { result: 0, bytes: 12 }, 'callback wait resolves its current object');
        assert.strictEqual(sync[6], 0, 'real callback event/semaphore is consumed');
        assert.strictEqual(sync[2], +signaled, 'original auto-reset event/semaphore remains untouched');
        now = 700;
        await pump();
        assert.strictEqual(sync[2], +signaled, 'phase2 pump does not poll interrupted wait');
        f.returned(); await pump();
        if (mode === 'mainWorker') {
          assert.strictEqual(manager._mainWaitState, oldWaitState);
          assert.deepStrictEqual(manager._mainWaitState, { waitStartedAt: 70, waitPolls: 100 });
        } else {
          assert.strictEqual(manager._mainWaitStartedAt, 70);
          assert.strictEqual(manager._mainWaitPolls, 100);
        }
        completion = null; resolveCurrent();
        assert.deepStrictEqual(completion, { result: signaled ? 0 : 0x102, bytes: 12 },
          'restored wait consumes original signal or expires immediately using original age and poll count');
        assert.strictEqual(sync[2], 0);
      }
    }
  }
  {
    const f = nativeFixture(), manager = Object.create(ThreadManager.prototype);
    let now = 100;
    Object.assign(manager, { _renderSendTargets: new Set(), _now: () => now, _waitNow: () => now, _mainSleepUntil: 180,
      _mainWaitStartedAt: 70, _mainWaitPolls: 12,
      mainInstance: { exports: { get_sleep_yielded: () => 0, get_yield_reason: () => 0 } } });
    const options = { callbackOwner: manager, callbackMode: 'mainCooperative' };
    await f.run(options);
    assert.strictEqual(manager.checkMainYield(), false, 'callback bypasses original sleep');
    now = 120; f.returned(); await f.run(options);
    assert.strictEqual(manager._mainSleepUntil, 180);
    assert.strictEqual(manager.checkMainYield(), true, 'remaining original absolute sleep is honored');
    now = 181;
    assert.strictEqual(manager.checkMainYield(), false, 'original deadline expires without extension');
  }
  for (const reject of [false, true]) {
    const f = nativeFixture(); let complete;
    f.ex.help_macro_native_begin = () => new Promise((resolve, rejectPromise) => {
      complete = () => reject ? rejectPromise(Error('stopped during begin')) : resolve(0);
    });
    const running = f.run();
    while (!complete) await Promise.resolve();
    const callback = { ...f.owner };
    f.stop(); complete();
    if (reject) await assert.rejects(running, /stopped during begin/);
    else await running;
    assert.deepStrictEqual(f.owner, callback, 'late failed begin cannot revive a stopped wait');
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false);
  }
  {
    const f = nativeFixture(); await f.run(); f.returned();
    f.owner.sleepUntil = 900;
    let complete;
    f.ex.help_macro_native_finish = () => new Promise(resolve => { complete = () => resolve(1); });
    const running = f.run();
    while (!complete) await Promise.resolve();
    const callback = { ...f.owner };
    f.stop(); complete(); await running;
    assert.deepStrictEqual(f.owner, callback, 'late successful finish cannot revive stopped original wait');
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false);
  }
  {
    const f = nativeFixture(); await f.run(); f.stop();
    f.ex.get_help_navigation_pending = () => 0;
    const callback = { ...f.owner };
    assert.strictEqual((await f.run()).pending, false);
    assert.deepStrictEqual(f.owner, callback);
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false,
      'stopped owner is canceled even when no WAT job remains pending');
  }
  {
    const f = nativeFixture(); await f.run();
    f.owner.sleepUntil = 999;
    const current = { ...f.owner };
    f.stop();
    assert.strictEqual((await f.run()).pending, false);
    assert.deepStrictEqual(f.owner, current, 'stop drops transaction without reviving original wait');
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false);
    assert.strictEqual(f.stats().cancels, 1);
  }
  {
    const f = nativeFixture(), old = { ...f.owner };
    f.ex.help_macro_native_begin = () => 0;
    await f.run();
    assert.deepStrictEqual(f.owner, old, 'rejected guest entry rolls back host scheduling state');
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false);
    f.ex.help_macro_native_begin = () => { throw Error('entry failed'); };
    await assert.rejects(f.run(), /entry failed/);
    assert.deepStrictEqual(f.owner, old, 'throwing entry also rolls back');
    assert.strictEqual(GuestCallbackState.finish(f.owner, 123), false);
  }
  {
    const f = nativeFixture();
    assert(GuestCallbackState.begin(f.owner, 456, 'thread'));
    f.owner.waitPolls = 99;
    const current = { ...f.owner };
    await f.run();
    assert.strictEqual(f.stats().begins, 0, 'occupied host transaction rejects native begin');
    assert.deepStrictEqual(f.owner, current);
    f.returned(); f.ex.help_macro_native_finish = () => 0;
    await f.run();
    assert.deepStrictEqual(f.owner, current, 'stale rejected guest finish cannot restore another token');
    assert(GuestCallbackState.finish(f.owner, 456));
  }
  {
    const f = nativeFixture(), old = { ...f.owner };
    const foreign = { handle: 71 };
    f.vfs.pendingRead = foreign;
    await f.run();
    assert.strictEqual(f.stats().begins, 0);
    assert.strictEqual(f.vfs.pendingRead, foreign);
    assert.deepStrictEqual(f.owner, old, 'foreign I/O prevents callback preparation and entry');
  }
  {
    const f = nativeFixture(), old = { ...f.owner };
    let release;
    const request = { handle: 19 };
    f.ex.help_macro_native_prepare = () => { f.vfs.pendingRead = request; return -1; };
    f.vfs.fillPendingRead = () => new Promise(resolve => { release = resolve; });
    const run = f.run();
    while (!release) await Promise.resolve();
    f.stop(); release(); await run;
    assert.strictEqual(f.stats().begins, 0, 'late native fill cannot enter a stopped guest');
    assert.deepStrictEqual(f.owner, old);
    assert.strictEqual(f.vfs.pendingRead, null);
  }
  for (const remote of [false, true]) {
    const f = fixture(), before = { ...f.cpu };
    const result = await f.run(remote ? { exports: undefined,
      call: async (name, ...args) => f.ex[name](...args), pending: true } : {});
    assert.deepStrictEqual(result, { pending: false, serviced: true, filled: true });
    assert.deepStrictEqual(f.cpu, before, 'CPU and original WaitMessage frame untouched');
    assert.deepStrictEqual(f.stats(), { calls: 2, fills: 1, pending: false });
  }
  {
    const f = fixture(), foreign = { handle: 71 };
    f.vfs.pendingRead = foreign;
    assert.deepStrictEqual(await f.run(), { pending: true, serviced: false, filled: false });
    assert.strictEqual(f.vfs.pendingRead, foreign);
    assert.deepStrictEqual(f.stats(), { calls: 0, fills: 0, pending: true });
  }
  {
    const f = fixture(); f.vfs.pendingRead = f.request;
    assert.strictEqual((await f.run()).pending, false, 'existing own miss filled before service');
    assert.strictEqual(f.stats().calls, 1);
  }
  {
    const f = fixture(), foreign = { handle: 71 };
    f.vfs.fillPendingRead = async () => { f.vfs.pendingRead = foreign; };
    await f.run();
    assert.strictEqual(f.vfs.pendingRead, foreign, 'late foreign notification is not cleared or filled');
    assert.strictEqual(f.stats().calls, 1, 'foreign read prevents retry');
  }
  {
    const f = fixture(); let done;
    f.vfs.fillPendingRead = () => new Promise(resolve => { done = resolve; });
    const running = f.run();
    while (!done) await Promise.resolve();
    f.stop(); done(); await running;
    assert.deepStrictEqual(f.stats(), { calls: 1, fills: 0, pending: false }, 'late fill cannot restart stopped job');
  }
  {
    const f = fixture(); let fault = false;
    f.vfs.fillPendingRead = async () => { fault = true; throw Error('latched read failure'); };
    const original = f.ex.help_navigation_service;
    f.ex.help_navigation_service = () => fault ? (f.ex.help_navigation_cancel(), 0) : original();
    assert.strictEqual((await f.run()).pending, false, 'failed fill reaches terminal service');
  }
  {
    const f = fixture(); f.stop();
    await f.run({ exports: undefined, pending: true,
      call: async () => { throw Error('worker stopped'); } });
    assert.strictEqual(f.stats().calls, 0);
  }
  {
    const f = fixture();
    f.vfs.fillPendingRead = async () => {};
    const result = await f.run();
    assert.strictEqual(result.pending, true);
    assert.strictEqual(f.stats().calls, 2, 'only one fill and one retry per host turn');
  }
  // Exercise the actual host scheduling seam: private work bypasses idle
  // delay, but frozen stepping still owns when the next guest turn happens.
  const context = { console, URLSearchParams, HelpNavigationPump };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
    '\n;globalThis.TestWine = WineAssembly;', context);
  const wine = Object.create(context.TestWine.prototype);
  let posted = 0;
  wine.instance = { exports: { get_help_navigation_pending: () => 1 } };
  wine._cancelDelayedStep = () => {};
  wine._postStep = () => { posted++; };
  wine._scheduleStep(() => {}, 5000);
  assert.strictEqual(posted, 1, 'pending Help schedules a macrotask despite idle guest');
  wine._frozen = true; wine._frozenPump = () => {};
  wine._scheduleStep(() => {}, 5000);
  assert.strictEqual(posted, 1, 'frozen control is not bypassed');
  for (const expiresDuringFill of [false, true]) {
    const f = fixture(); let slices = 0, now = 1;
    const fill = f.vfs.fillPendingRead;
    f.vfs.fillPendingRead = async request => {
      await fill(request);
      if (expiresDuringFill) now = 2000000;
    };
    const link = { helpPending: true, lastEip: 0x401000,
      async callExport(name, ...args) {
        const value = f.ex[name](...args); this.helpPending = !!f.ex.get_help_navigation_pending(); return value;
      }, async slice() { slices++; throw Error('sleeping guest must not execute'); } };
    const thread = { state: 'active', tid: 1, link, sleepUntil: 1000000, suspendCount: 0 };
    const manager = Object.create(ThreadManager.prototype);
    Object.assign(manager, { workerBackend: {}, _pendingThreads: [], threads: new Map([[1, thread]]),
      _now: () => now, _waitNow: () => now, _getVfs: () => f.vfs, _threadEntries: () => [[1, thread]], _log() {} });
    assert.strictEqual(await manager.runWorkerSlices(100), 0);
    assert.strictEqual(slices, 0);
    assert.strictEqual(link.helpPending, false, 'sleeping Worker pumps Help without a guest slice');
    assert.strictEqual(thread.sleepUntil, 1000000);
    assert.strictEqual(thread.inFlight, false);
    assert.strictEqual(manager.lastWorkerSliceBlocks, 0, 'help-only work never retires uncounted guest blocks');
  }
  console.log('PASS deferred Help pump: local/remote, wait-state preservation, own/foreign IO, bounded retry, stop/fault, idle/frozen scheduling');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
