#!/usr/bin/env node
// A spawned guest thread that parks on io_wait (yield 12) must be serviced by
// its scheduler, in both backends. Storm reads Diablo's 500MB CD archive on a
// reader thread; in the browser that file is provider-backed (the async File
// API), so every read of a non-resident chunk parks. Before this worked, the
// WAT completed such reads as ERROR_READ_FAULT on any thread but the main one
// and the chain-launched retail game raised its Data File Error dialog.
const assert = require('assert');
const { ThreadManager } = require('../lib/thread-manager');

// A stand-in for lib/filesystem.js's lazy-read surface, with the fill held
// open until the test resolves it. It mirrors the real ownership model: each
// 1-based guest thread ID (main = 1, spawned tid N = N+1) has its own
// pendingRead slot, a parked record names the slot it lives in (`ioState`),
// and a fill retires only that slot. A scheduler that selects a peer's
// request, or one that reads a shared slot, fails here as it would there.
function makeVfs() {
  const vfs = {
    _io: new Map(),
    fills: [],
    _resolvers: [],
    getIoState(threadId = 1) {
      threadId >>>= 0;
      let state = this._io.get(threadId);
      if (!state) this._io.set(threadId, state = { pendingRead: null });
      return state;
    },
    getPendingRead(threadId = 1) {
      return this._io.get(threadId >>> 0)?.pendingRead || null;
    },
    park(threadId, pending) {
      const io = this.getIoState(threadId);
      pending.ioState = io;
      io.pendingRead = pending;
      return pending;
    },
    fillPendingRead(pending) {
      this.fills.push(pending);
      return new Promise(resolve => {
        this._resolvers.push(() => {
          const io = pending.ioState;
          if (io && io.pendingRead === pending) io.pendingRead = null;
          resolve(true);
        });
      });
    },
    finishFill() {
      const r = this._resolvers.shift();
      if (r) r();
    },
  };
  return vfs;
}

async function testWorkerBackend() {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const mainInstance = { exports: { get_sync_table: () => 0, get_bp_addr: () => 0, get_watch_addr: () => 0 } };
  const vfs = makeVfs();
  const sliceResults = [];
  const exportCalls = [];
  const workerBackend = {
    async readExports() {
      return {
        get_image_base: 0x400000, get_code_start: 0x401000, get_code_end: 0x500000,
        get_thunk_base: 0x700000, get_thunk_end: 0x710000, get_num_thunks: 100,
        get_dll_count: 3, get_vlan_local_ip: 0, get_tls_next_index: 7,
      };
    },
    async spawnThread(spec) {
      return {
        slot: 1,
        startEip: spec.startAddr >>> 0,
        startEsp: 0x100000,
        slice: async () => sliceResults.shift() || { yield: 0, eip: 0x4010 },
        callExport: async (name) => { exportCalls.push(name); },
      };
    },
  };
  const tm = new ThreadManager({}, memory, mainInstance, () => ({ host: {} }), {
    workerBackend,
    getVfs: () => vfs,
  });
  tm._log = () => {};

  tm.createThread(0x401100, 0, 0x10000, 0);
  await tm._spawnPendingWorkers();
  const [handle, thread] = Array.from(tm.threads.entries())[0];

  // The brokered ReadFile ran on the main JS thread but carried this guest
  // thread's ID, so it parked in this thread's slot. A peer (and the main
  // thread) has a request of its own parked at the same time; the scheduler
  // must fill this thread's, not whichever import happened to run last.
  const ownId = (thread.tid | 0) + 1;
  const peer = vfs.park(ownId + 1, { path: 'd:\\peer.mpq', handle: 0x34, pos: 0, offset: 0, length: 4096 });
  const mainRead = vfs.park(1, { path: 'd:\\main.mpq', handle: 0x38, pos: 0, offset: 0, length: 4096 });
  const pending = vfs.park(ownId, { path: 'd:\\diabdat.mpq', handle: 0x30, pos: 0, offset: 0, length: 4096 });
  sliceResults.push({ yield: 12, eip: 0x4010 });
  const run = tm._runWorkerThread(handle, thread, 1000, {});
  // The fill is awaited before clear_yield, so resolve it while the slice
  // handler is in flight.
  await Promise.resolve();
  vfs.finishFill();
  await run;

  assert.strictEqual(vfs.fills.length, 1, 'worker backend must run the chunk fill');
  assert.strictEqual(vfs.fills[0], pending, 'the fill must receive the parked read');
  assert.strictEqual(vfs.getPendingRead(ownId), null, 'the pending slot must be consumed');
  assert.strictEqual(vfs.getPendingRead(ownId + 1), peer, "a peer's request is left alone");
  assert.strictEqual(vfs.getPendingRead(1), mainRead, "the main thread's request is left alone");
  assert.deepStrictEqual(exportCalls, ['clear_yield'],
    'the parked thread must be re-entered after the fill');
  assert.strictEqual(thread.state, 'active', 'the thread stays alive across the park');

  // This thread's request was retired (CloseHandle, say) while a peer's is
  // still parked: clear without filling anything — never the peer's — and the
  // retry either hits or parks again with a fresh request of its own.
  sliceResults.push({ yield: 12, eip: 0x4010 });
  await tm._runWorkerThread(handle, thread, 1000, {});
  assert.strictEqual(vfs.fills.length, 1, 'no own pending: nothing to fill');
  assert.strictEqual(vfs.getPendingRead(ownId + 1), peer);
  assert.deepStrictEqual(exportCalls, ['clear_yield', 'clear_yield'],
    'the thread must still be re-entered');

  console.log('  ok    worker backend fills the chunk and re-enters the parked ReadFile');
}

async function testCooperativeBackend() {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const mainInstance = { exports: { get_sync_table: () => 0, get_bp_addr: () => 0, get_watch_addr: () => 0 } };
  const vfs = makeVfs();
  const tm = new ThreadManager({}, memory, mainInstance, () => ({ host: {} }), {
    getVfs: () => vfs,
  });
  tm._log = () => {};

  let yieldReason = 12;
  let clears = 0;
  let runs = 0;
  const exportsMock = {
    get_yield_reason: () => yieldReason,
    clear_yield: () => { clears++; yieldReason = 0; },
    get_eip: () => 0x4010,
    get_esp: () => 0x100000,
    get_current_thread_id: () => 3, // tid 2 -> 1-based guest thread ID 3
    run: () => { runs++; },
  };
  tm.threads.set(0xE1001, {
    instance: { exports: exportsMock },
    state: 'active', tid: 2, suspendCount: 0,
    sleepUntil: 0, sleepCount: 0, waitPolls: 0,
  });

  const peer = vfs.park(2, { path: 'd:\\peer.mpq', handle: 0x34, pos: 0, offset: 0, length: 4096 });
  const pending = vfs.park(3, { path: 'd:\\diabdat.mpq', handle: 0x30, pos: 0, offset: 0, length: 4096 });

  // Slice 1: the park starts the async fill and leaves the thread parked.
  tm.runSlice(1000, { quantumSteps: 1000 });
  assert.strictEqual(vfs.fills.length, 1, 'first slice must start the fill');
  assert.strictEqual(vfs.fills[0], pending, "the fill must be this thread's request, not a peer's");
  assert.strictEqual(clears, 0, 'the thread stays parked while the fill is in flight');
  assert.strictEqual(runs, 0, 'a parked thread gets no steps');

  // Slice 2, fill still in flight: no second fill, still parked.
  tm.runSlice(1000, { quantumSteps: 1000 });
  assert.strictEqual(vfs.fills.length, 1, 'the fill must not be restarted');
  assert.strictEqual(clears, 0);

  // The fill lands on the event loop.
  vfs.finishFill();
  await new Promise(resolve => setImmediate(resolve));

  // Slice 3: the yield is cleared and the thread runs its slice.
  tm.runSlice(1000, { quantumSteps: 1000 });
  assert.strictEqual(clears, 1, 'the slice after the fill must clear the yield');
  assert.strictEqual(runs, 1, 'the re-entered thread must get its steps');
  assert.strictEqual(vfs.getPendingRead(3), null);
  assert.strictEqual(vfs.getPendingRead(2), peer, "a peer's request is left alone");

  // Retired request: yield 12 with nothing of its own pending clears
  // immediately, even though a peer's request is still parked.
  yieldReason = 12;
  tm.runSlice(1000, { quantumSteps: 1000 });
  assert.strictEqual(clears, 2, 'no pending: retry immediately');
  assert.strictEqual(vfs.fills.length, 1);

  console.log('  ok    cooperative backend parks across the async fill and re-enters');
}

(async () => {
  await testWorkerBackend();
  await testCooperativeBackend();
  console.log('PASS  spawned-thread io_wait is serviced by both scheduler backends');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
