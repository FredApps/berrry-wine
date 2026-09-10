#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HelpNavigationPump = require('../lib/help-navigation-pump');
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
      _now: () => now, _getVfs: () => f.vfs, _threadEntries: () => [[1, thread]], _log() {} });
    assert.strictEqual(await manager.runWorkerSlices(100), 0);
    assert.strictEqual(slices, 0);
    assert.strictEqual(link.helpPending, false, 'sleeping Worker pumps Help without a guest slice');
    assert.strictEqual(thread.sleepUntil, 1000000);
    assert.strictEqual(thread.inFlight, false);
    assert.strictEqual(manager.lastWorkerSliceBlocks, 0, 'help-only work never retires uncounted guest blocks');
  }
  console.log('PASS deferred Help pump: local/remote, wait-state preservation, own/foreign IO, bounded retry, stop/fault, idle/frozen scheduling');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
