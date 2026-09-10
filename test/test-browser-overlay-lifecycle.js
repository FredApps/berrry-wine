#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { createBrowserShell } = require('../lib/browser-shell');
const { VirtualFS } = require('../lib/filesystem');
const Overlay = require('../lib/vfs-overlay');
const { memoryStore } = require('../lib/overlay-store');
const ownership = require('../lib/vfs-entry-ownership');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { GuestThreadHost, WorkerLink } = require('../lib/guest-thread-host');
const status = { textContent: '' };
global.document = { getElementById: id => id === 'status' ? status : null };
global.window = {};
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function shell(apps = {}) {
  return createBrowserShell({ apps, screenCanvasSize: () => ({ w: 640, h: 480 }) });
}
function tree() {
  const vfs = new VirtualFS();
  const provider = { size: 4, refs: 1,
    retain() { assert(this.refs > 0); this.refs++; },
    release() { assert(this.refs > 0); this.refs--; },
    readRangeSync(off, len) { assert(this.refs > 0); return Uint8Array.of(1, 2, 3, 4).slice(off, off + len); },
    async readRange(off, len) { return this.readRangeSync(off, len); },
  };
  vfs.setProviderFile('c:\\source.bin', { provider });
  provider.release();
  return { vfs, provider };
}
function wine(vfs, overlay, durable = false) {
  return { _helpCtx: { vfs }, _vfsOverlay: overlay, _vfsOverlayDurable: durable,
    _vfsOverlayMediaId: 'test-media' };
}
function dirty(vfs) {
  const h = vfs.createFile('c:\\save.bin', 0xC0000000, 2);
  assert(vfs.writeFile(h, Uint8Array.of(7, 8, 9), 3).ok);
}
async function settle(s) { await s.retryStoppedOverlays(); await ownership.drain(); }

(async () => {
  // Exit acquires the last-exited snapshot before releasing the live map.
  // Replacing that snapshot must release the final lease, not leave an old
  // garbage-collected map's phantom ownership count behind.
  {
    const s = shell(), { vfs, provider } = tree();
    let writes = 0;
    const store = memoryStore(), overlay = Overlay.attach(vfs, {
      store: { ...store, async writeBatch(...args) { writes++; return store.writeBatch(...args); } },
    });
    dirty(vfs);
    const w = wine(vfs, overlay);
    s.runningApps.push({ name: 'first', wine: w });
    s.unregisterRunningApp(w);
    await settle(s);
    assert.strictEqual(vfs.files.size, 0);
    assert.strictEqual(writes, 0, 'session stop must not clone tree into memory store');
    assert.strictEqual(provider.refs, 1, 'exit snapshot remains an owner');
    s.unregisterRunningApp(w); // repeated stop does not reacquire an empty snapshot
    const next = wine(new VirtualFS());
    s.runningApps.push({ name: 'next', wine: next });
    s.unregisterRunningApp(next);
    await settle(s);
    assert.strictEqual(provider.refs, 0, 'snapshot replacement releases final provider pin');
  }

  // A failed launch was never registered and therefore has no exit snapshot.
  // A failed final write must keep its real VFS alive for retry, not clear it
  // and turn the eventual retry into deletion records.
  {
    const s = shell(), { vfs, provider } = tree(), store = memoryStore();
    let fail = true;
    const overlay = Overlay.attach(vfs, { store: { ...store,
      async writeBatch(...args) { if (fail) throw Error('quota unavailable'); return store.writeBatch(...args); },
    } });
    dirty(vfs);
    const w = wine(vfs, overlay, true);
    s.unregisterRunningApp(w);
    await settle(s);
    assert.strictEqual(s.pendingStoppedVfsCount, 1);
    assert(vfs.files.has('c:\\save.bin'));
    assert.strictEqual(provider.refs, 1);
    assert.match(status.textContent, /unsaved.*retry/);
    fail = false;
    await settle(s);
    assert.deepStrictEqual([...await store.read('c:\\save.bin')], [7, 8, 9]);
    assert.strictEqual(s.pendingStoppedVfsCount, 0);
    assert.strictEqual(vfs.files.size, 0);
    assert.strictEqual(provider.refs, 0);
    assert.strictEqual(status.textContent, 'Ready');
  }

  // Dirty marks are consumed when a checkpoint begins. Stopping while that
  // checkpoint is blocked must still join its chain before clearing anything.
  for (const fail of [false, true]) {
    const s = shell(), { vfs, provider } = tree(), store = memoryStore();
    const entered = deferred(), resume = deferred();
    let inject = fail;
    const overlay = Overlay.attach(vfs, { store: { ...store,
      async writeBatch(...args) {
        entered.resolve(); await resume.promise;
        if (inject) throw Error('in-flight store failure');
        return store.writeBatch(...args);
      },
    } });
    dirty(vfs);
    const checkpoint = overlay.flush();
    await entered.promise;
    assert.strictEqual(overlay.dirtyPaths().length, 0);
    s.unregisterRunningApp(wine(vfs, overlay, true));
    await Promise.resolve();
    assert(vfs.files.size > 0, 'in-flight barrier preserves original map');
    resume.resolve();
    await checkpoint;
    await settle(s);
    if (fail) {
      assert.strictEqual(s.pendingStoppedVfsCount, 1);
      assert.strictEqual(provider.refs, 1);
      inject = false;
      await settle(s);
    }
    assert.deepStrictEqual([...await store.read('c:\\save.bin')], [7, 8, 9]);
    assert.strictEqual(provider.refs, 0);
    assert.strictEqual(s.pendingStoppedVfsCount, 0);
  }

  // Real host stop waits for an async cooperative step and detached thread
  // fill. A chained app receives the final late-created file, not the early
  // map copied at the synchronous stop notification.
  {
    const context = { console, URLSearchParams, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
      '\n;globalThis.Host = WineAssembly;', context);
    const apps = {}, s = shell(apps), { vfs, provider } = tree();
    const w = Object.create(context.Host.prototype);
    for (const name of ['_cancelDelayedStep', '_cancelVblankWait', '_frozenUnregister',
      '_removeVisibilityPause', '_removeInputWake', '_stopAudioIdleWatch',
      '_stopPerfCounterPoll', '_cleanupAudio']) w[name] = () => {};
    w._helpCtx = { vfs };
    w.running = true;
    const stepGate = deferred(), fillGate = deferred(), bootGate = deferred(), lateWorkerGate = deferred();
    w._vfsLaunchBarrier = bootGate.promise;
    w.threadManager = { threads: new Map([[1, { ioFill: fillGate.promise }]]) };
    w.onStopped = stopped => s.unregisterRunningApp(stopped);
    s.runningApps.push({ name: 'late', wine: w });
    // Register the inherited-world snapshot without booting a browser guest.
    s.launchApp = () => {};
    vfs.files.set('c:\\child.exe', { data: Uint8Array.of(77, 90), attrs: 0x20 });
    assert(s.launchVfsExe('c:\\child.exe', w));
    const work = w._trackGuestStep(async () => {
      await stepGate.promise;
      vfs.files.set('c:\\late.bin', { data: Uint8Array.of(42), attrs: 0x20 });
    })();
    w.stop();
    const child = new VirtualFS();
    let mounted = false;
    const mounting = apps['vfs:c:\\child.exe'].mounts[0](child).then(() => { mounted = true; });
    await Promise.resolve();
    assert(vfs.files.size > 0);
    assert(!mounted, 'chain mount waits for final snapshot');
    stepGate.resolve(); await work;
    await Promise.resolve();
    assert(vfs.files.size > 0, 'detached IO fill still owns a producer');
    fillGate.resolve();
    let lateStopped = false;
    w.guestWorker = { stop() { lateStopped = true; return lateWorkerGate.promise; } };
    bootGate.resolve();
    await Promise.resolve(); await Promise.resolve();
    assert(lateStopped, 'a Worker published by an already-started boot is also stopped');
    assert(vfs.files.size > 0, 'late Worker termination is part of the barrier');
    lateWorkerGate.resolve();
    await w._vfsStopBarrier;
    await settle(s);
    await mounting;
    assert.deepStrictEqual([...child.files.get('c:\\late.bin').data], [42]);
    assert.strictEqual(vfs.files.size, 0);
    assert.strictEqual(provider.refs, 1, 'exit/chain snapshots share their entry lease');
    // Replacing the exit snapshot must not revive an earlier released one.
    const next = wine(new VirtualFS());
    s.runningApps.push({ name: 'next', wine: next });
    s.unregisterRunningApp(next);
    await settle(s);
    // The dynamic chain entry intentionally remains a page-lifetime owner.
    assert.strictEqual(provider.refs, 1);
    child.files.clear();
    apps['vfs:c:\\child.exe']._releaseVfsSnapshot();
    await ownership.drain();
    assert.strictEqual(provider.refs, 0);
  }

  // Termination promises include Workers which have started but have not yet
  // published their guest-thread link. Queued RPC after stop cannot mutate VFS.
  {
    const done = deferred();
    let rpc = 0, readyRejected = false;
    const link = new WorkerLink({ slot: 2, broker: { serveRpc() { rpc++; } } });
    link.worker = { terminate: () => done.promise };
    link._readyPromise = { reject() { readyRejected = true; } };
    const host = Object.create(GuestThreadHost.prototype);
    host.threadLinks = new Map(); host._startingLinks = new Set([link]);
    let stopped = false;
    const stopping = host.stop().then(() => { stopped = true; });
    link._onMessage({ t: 'rpc' });
    await Promise.resolve();
    assert(readyRejected);
    assert(!stopped);
    assert.strictEqual(rpc, 0);
    done.resolve(); await stopping;
    await assert.rejects(host.spawnThread({}), /stopped/);
  }

  // A failed durable checkpoint does not make the retained session snapshot
  // unusable. An installed child can adopt it while a kept-media relaunch must
  // still wait for storage recovery before hydrating its older manifest.
  {
    const apps = {}, s = shell(apps), { vfs, provider } = tree(), store = memoryStore();
    let fail = true;
    vfs.files.set('c:\\child.exe', { data: Uint8Array.of(77, 90), attrs: 0x20 });
    const overlay = Overlay.attach(vfs, { store: { ...store, async writeBatch(...args) {
      if (fail) throw Error('storage unavailable');
      return store.writeBatch(...args);
    } } });
    dirty(vfs);
    const w = wine(vfs, overlay, true);
    s.launchApp = () => {};
    assert(s.launchVfsExe('c:\\child.exe', w));
    s.unregisterRunningApp(w);
    const child = new VirtualFS();
    await apps['vfs:c:\\child.exe'].mounts[0](child);
    assert.deepStrictEqual([...child.files.get('c:\\save.bin').data], [7, 8, 9]);
    assert.strictEqual(s.pendingStoppedVfsCount, 1);
    fail = false; await settle(s);
    child.files.clear(); apps['vfs:c:\\child.exe']._releaseVfsSnapshot();
    await ownership.drain();
    assert.strictEqual(provider.refs, 0);
  }

  // Actual Node Worker termination, not just a mocked resolved stop call.
  {
    const { Worker } = require('worker_threads');
    const counter = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker('const {parentPort,workerData}=require("worker_threads");' +
      'const n=new Int32Array(workerData);setInterval(()=>Atomics.add(n,0,1),1);parentPort.postMessage("ready");',
      { eval: true, workerData: counter.buffer });
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const link = new WorkerLink({ slot: 3 }); link.worker = worker;
    const host = Object.create(GuestThreadHost.prototype);
    host.threadLinks = new Map([[3, link]]);
    await host.stop();
    const stoppedCount = Atomics.load(counter, 0);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(Atomics.load(counter, 0), stoppedCount);
  }

  // Registry replacement during a real launch's init await must not clear the
  // older descriptor's snapshot before that launch reaches its async mounts.
  {
    const apps = {}, s = shell(apps), first = tree(), second = tree();
    first.vfs.files.set('c:\\same.exe', { data: Uint8Array.of(77, 90, 1), attrs: 0x20 });
    second.vfs.files.set('c:\\same.exe', { data: Uint8Array.of(77, 90, 2), attrs: 0x20 });
    const entered = deferred(), resume = deferred();
    const previousDocument = global.document, previousWine = global.WineAssembly;
    const previousRenderer = global.Win98Renderer, previousInput = window.browserInput;
    const canvas = { focus() {} }, log = { textContent: '' };
    global.document = { getElementById(id) {
      return id === 'screen' ? canvas : id === 'status' ? status : id === 'log' ? log : null;
    } };
    global.Win98Renderer = class {
      constructor() { this.windows = {}; }
      repaint() {}
    };
    global.WineAssembly = class {
      primeAudio() {}
      hasGuestExport() { return false; }
      async init() { this._helpCtx = { vfs: new VirtualFS() }; entered.resolve(); await resume.promise; }
      stop() { this.onStopped(this); }
    };
    window.browserInput = { wireCanvasInput() {} };
    let launch, adopted = false;
    const realLaunch = s.launchApp;
    s.launchApp = key => { launch = realLaunch(key); return launch; };
    const oldError = console.error;
    console.error = () => {}; // expected deliberate abort immediately after adoption
    try {
      assert(s.launchVfsExe('c:\\same.exe', wine(first.vfs)));
      await entered.promise;
      const oldApp = apps['vfs:c:\\same.exe'];
      oldApp.mounts.push(async newVfs => {
        assert.deepStrictEqual([...newVfs.files.get('c:\\same.exe').data], [77, 90, 1]);
        adopted = true;
        throw Error('intentional stop after adoption');
      });
      s.launchApp = () => {}; // queued replacement is outside this first-launch test
      assert(s.launchVfsExe('c:\\same.exe', wine(second.vfs)));
      assert.notStrictEqual(apps['vfs:c:\\same.exe'], oldApp);
      first.vfs.files.clear();
      assert.strictEqual(first.provider.refs, 1, 'launch lease survives registry replacement');
      resume.resolve(); await launch; await settle(s);
      assert(adopted, 'first captured descriptor mounted its original executable');
      assert.strictEqual(first.provider.refs, 0, 'launch finally and failed child cleanup release final pin');
      second.vfs.files.clear();
      apps['vfs:c:\\same.exe']._releaseVfsSnapshot();
      await ownership.drain();
      assert.strictEqual(second.provider.refs, 0);
    } finally {
      console.error = oldError;
      global.document = previousDocument;
      global.WineAssembly = previousWine;
      global.Win98Renderer = previousRenderer;
      window.browserInput = previousInput;
    }
  }

  // Main Worker startup owns its producer before readiness. Failed readiness
  // and stop-during-start both terminate it; failed termination cannot silently
  // fall back to a second producer on the same memory.
  for (const mode of ['start-failure', 'stopped-during-start', 'termination-failure']) {
    const entered = deferred(), resume = deferred(), workers = [];
    const context = { console, URLSearchParams, crossOriginIsolated: true,
      window: { WINE_THREADS: true },
      fetch: async () => ({ ok: true, json: async () => ({ sigs: [] }) }),
      GuestThreadHost: class {
        constructor() { this.stops = 0; workers.push(this); }
        async start() {
          entered.resolve(); await resume.promise;
          if (mode !== 'stopped-during-start') throw Error('readiness rejected');
        }
        async stop() {
          this.stops++;
          if (mode === 'termination-failure') throw Error('termination rejected');
        }
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
      '\n;globalThis.Host = WineAssembly;', context);
    const w = Object.create(context.Host.prototype);
    w._mainImports = { host: {} }; w.renderer = {}; w.instance = {}; w.logToUI = () => {};
    const starting = w._maybeStartGuestWorker({});
    await entered.promise;
    assert.strictEqual(w.guestWorker, workers[0], 'starting producer is published before readiness');
    if (mode === 'stopped-during-start') w._stopped = true;
    resume.resolve();
    if (mode === 'termination-failure') {
      await assert.rejects(starting, /termination rejected/);
      assert.strictEqual(w.guestWorker, workers[0], 'failed termination retains producer identity');
    } else {
      await starting;
      assert.strictEqual(w.guestWorker, null);
    }
    assert.strictEqual(workers[0].stops, 1);
  }
  console.log('PASS browser overlay lifecycle: snapshot handoff, session stop, failed-launch retry, in-flight flush barrier and final provider release');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
