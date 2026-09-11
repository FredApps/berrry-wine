'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(worker, { gateCatalog = false } = {}) {
  const prep = deferred(), reply = deferred(), events = [];
  const catalogPrep = deferred(), catalogReply = deferred();
  if (!gateCatalog) { catalogPrep.resolve(); catalogReply.resolve(); }
  let current = true;
  let catalogCurrent = true, catalogFault = false;
  const batch = { count: 5, read: () => Uint8Array.of(1),
    isCurrent: () => current, release() { events.push('release'); } };
  const stock = {
    async prepare(vfs, { signal }) {
      events.push('prepare'); await prep.promise;
      if (signal.aborted) throw Error('aborted');
      return batch;
    },
    async install(vfs, options) {
      await stock.prepare(vfs, options);
      assert.strictEqual(options.exports, w.instance.exports);
      assert.strictEqual(options.memory, w.memory);
      events.push('local');
    },
  };
  const catalog = async (remote, options) => {
    events.push('catalog-prepare'); await catalogPrep.promise;
    options.check();
    if (options.signal.aborted || catalogFault) throw Error('catalog preparation failed');
    if (remote) { events.push('catalog-remote'); await catalogReply.promise; }
    options.check();
    if (!catalogCurrent) throw Error('catalog source changed; discard process');
    events.push('catalog-ready');
  };
  const context = { console, URLSearchParams, AbortController, StockFontBootstrap: stock,
    FontCatalog: {
      install(vfs, options) { assert.strictEqual(options.exports, w.instance.exports); return catalog(false, options); },
      installRemote(vfs, options) { assert.strictEqual(options.worker, w.guestWorker); return catalog(true, options); },
    },
    DllLoader: { loadDlls() { events.push('dll'); return []; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8') +
    '\n;globalThis.Host = WineAssembly;', context);
  const w = Object.create(context.Host.prototype);
  w.instance = { exports: {} }; w.memory = {}; w._helpCtx = { vfs: {} };
  w._loadExeOnce = async () => 0x401000;
  for (const name of ['_cancelDelayedStep', '_cancelVblankWait', '_frozenUnregister',
    '_removeVisibilityPause', '_removeInputWake', '_stopAudioIdleWatch',
    '_stopPerfCounterPoll', '_cleanupAudio']) w[name] = () => {};
  if (worker) w.guestWorker = {
    async installStockFonts() { events.push('remote'); await reply.promise; },
    async stop() { events.push('stop'); },
  };
  return { w, prep, reply, events, context, catalogPrep, catalogReply,
    invalidateCatalog() { catalogCurrent = false; }, failCatalog() { catalogFault = true; },
    invalidate() { current = false; }, load: () => w.loadExe('test.exe') };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await Promise.resolve(); }
  throw Error('boundary not reached');
}
(async () => {
  for (const outcome of ['ready', 'stop', 'fault', 'missing']) {
    const f = fixture(false, { gateCatalog: true });
    let opened = 0;
    f.w.instance.exports.wat_app_pump = () => {};
    if (outcome !== 'missing') f.w.instance.exports.scrsave_open = () => ++opened;
    const loading = f.w.loadWatApp('scrsave');
    const failed = outcome !== 'ready' ? assert.rejects(loading) : null;
    if (outcome !== 'missing') {
      await until(() => f.events.includes('prepare'));
      assert.throws(() => f.w.run(), /not ready/);
      await assert.rejects(f.w.loadWatApp('scrsave'), /fresh process/);
      f.prep.resolve();
      await until(() => f.events.includes('catalog-prepare'));
      assert.strictEqual(opened, 0, 'no window before cold font preparation');
      if (outcome === 'stop') f.w.stop();
      if (outcome === 'fault') f.failCatalog();
      f.catalogPrep.resolve();
    }
    if (failed) {
      await failed;
      assert.strictEqual(opened, 0);
      assert.strictEqual(f.w._fontBootState, 'failed');
      assert.strictEqual(f.w._stopped, true);
      await f.w._vfsStopBarrier;
    } else {
      assert.strictEqual(await loading, true);
      assert.strictEqual(opened, 1);
      assert.strictEqual(f.w._fontBootState, 'ready');
      assert.strictEqual(f.w._watApp, 'scrsave');
      assert.strictEqual(f.w._exeBytes, undefined);
      await assert.rejects(f.w.loadExe('test.exe'), /one-shot/);
    }
  }
  async function reachCatalog(f, worker) {
    await until(() => f.events.includes('prepare')); f.prep.resolve();
    if (worker) { await until(() => f.events.includes('remote')); f.reply.resolve(); }
    await until(() => f.events.includes('catalog-prepare'));
  }
  for (const worker of [false, true]) {
    const f = fixture(worker, { gateCatalog: true }), loading = f.load();
    await reachCatalog(f, worker);
    assert.strictEqual(f.w._fontBootState, 'loading');
    assert.throws(() => f.w.run(), /not ready/);
    await assert.rejects(f.w.loadDlls([]), /not ready/);
    f.catalogPrep.resolve();
    if (worker) {
      await until(() => f.events.includes('catalog-remote'));
      assert.strictEqual(f.w._fontBootState, 'loading');
      f.catalogReply.resolve();
    }
    await loading; assert.strictEqual(f.w._fontBootState, 'ready');
    assert(f.events.includes('catalog-ready'));
  }
  for (const mode of ['local-stop', 'prepare-stop', 'reply-stop', 'stale', 'fault']) {
    const worker = mode !== 'local-stop';
    const f = fixture(worker, { gateCatalog: true }), loading = f.load();
    const failed = assert.rejects(loading);
    await reachCatalog(f, worker);
    if (['reply-stop', 'stale'].includes(mode)) {
      f.catalogPrep.resolve(); await until(() => f.events.includes('catalog-remote'));
      if (mode === 'stale') f.invalidateCatalog(); else f.w.stop();
      if (mode === 'reply-stop') {
        let stopped = false; f.w._vfsStopBarrier.then(() => { stopped = true; });
        await Promise.resolve(); assert.strictEqual(stopped, false, 'stop joins pending catalog reply');
      }
      f.catalogReply.resolve();
    } else {
      if (mode === 'fault') f.failCatalog(); else f.w.stop();
      f.catalogPrep.resolve();
    }
    await failed; await f.w._vfsStopBarrier;
    assert.notStrictEqual(f.w._fontBootState, 'ready');
    assert(!f.events.includes('catalog-ready'));
    assert.throws(() => f.w.run(), /not ready/);
    await assert.rejects(f.w.loadDlls([]), /not ready/);
    if (worker) assert(f.events.includes('stop'));
  }
  for (const worker of [false, true]) {
    const f = fixture(worker), loading = f.load();
    await until(() => f.events.includes('prepare'));
    assert.strictEqual(f.w._fontBootState, 'loading');
    await assert.rejects(f.load(), /one-shot/);
    await assert.rejects(f.w.loadDlls([]), /not ready/);
    assert.throws(() => f.w.run(), /not ready/);
    f.prep.resolve();
    if (worker) { await until(() => f.events.includes('remote')); f.reply.resolve(); }
    await loading;
    assert.strictEqual(f.w._fontBootState, 'ready');
    assert.strictEqual(f.events.includes('local'), !worker);
    assert.strictEqual(f.events.includes('remote'), worker);
    await assert.rejects(f.load(), /one-shot/);
  }
  for (const mode of ['local', 'prepare', 'reply', 'stale']) {
    const f = fixture(mode !== 'local'), loading = f.load();
    const failed = assert.rejects(loading);
    await until(() => f.events.includes('prepare'));
    if (mode === 'reply' || mode === 'stale') {
      f.prep.resolve(); await until(() => f.events.includes('remote'));
      if (mode === 'stale') f.invalidate(); else f.w.stop();
      f.reply.resolve();
    } else { f.w.stop(); f.prep.resolve(); }
    await failed;
    assert.notStrictEqual(f.w._fontBootState, 'ready');
    assert(!f.events.includes('local'));
    assert.throws(() => f.w.run(), /not ready/);
    await assert.rejects(f.w.loadDlls([]), /not ready/);
    await assert.rejects(f.load(), /one-shot/);
    await f.w._vfsStopBarrier;
    if (mode !== 'local') assert(f.events.includes('stop'));
  }
  {
    const f = fixture(false), init = deferred();
    f.w.instance = null; delete f.w._loadExeOnce;
    f.w.init = async () => { await init.promise; f.w.instance = { exports: {} }; };
    const loading = f.load(), failed = assert.rejects(loading, /canceled/);
    f.w.stop();
    let stopped = false;
    const stopping = f.w._vfsStopBarrier.then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(stopped, false, 'stop joins direct loadExe initialization');
    init.resolve(); await failed; await stopping;
    assert(!f.events.includes('prepare'));
  }
  for (const mode of ['fetch', 'local-stop', 'local-throw', 'remote-stop']) {
    const f = fixture(mode === 'remote-stop'), pending = deferred();
    f.w._fontBootState = 'ready';
    f.w._helpCtx.vfs.files = new Map();
    f.context.Host.fetchAssetBytes = () => pending.promise;
    f.context.DllLoader.loadDlls = () => {
      if (mode === 'local-throw') throw Error('DLL failed');
      f.w.stop(); return [];
    };
    if (f.w.guestWorker) f.w.guestWorker.loadDlls = () => pending.promise;
    const loading = f.w.loadDlls(mode === 'fetch' ? ['sample.dll'] : []);
    const failed = assert.rejects(loading, /not ready|DLL failed/);
    assert.throws(() => f.w.run(), /pending/);
    await assert.rejects(f.w.loadDlls([]), /already pending|not ready/);
    if (mode === 'fetch' || mode === 'remote-stop') {
      f.w.stop(); pending.resolve(mode === 'fetch' ? Uint8Array.of(1) : []);
    }
    await failed;
    assert.strictEqual(f.w.running, false);
    assert.strictEqual(f.w._inDllInit, false);
    assert.strictEqual(f.w._dllBootLoading, false);
    assert.strictEqual(f.w._helpCtx.vfs.files.size, 0);
    await f.w._vfsStopBarrier;
  }
  console.log('PASS browser font gate: executing owner, cancellation/stale reply, one-shot, DLL/run guards, stop joins init');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
