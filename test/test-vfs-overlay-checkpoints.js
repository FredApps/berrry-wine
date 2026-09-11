#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const Overlay = require('../lib/vfs-overlay');
const { memoryStore } = require('../lib/overlay-store');
const ownership = require('../lib/vfs-entry-ownership');
const PATH = 'c:\\game\\save.dat';
const COPY = 'c:\\game\\copy.dat';
const text = data => Buffer.from(data).toString();
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

(async () => {
  const store = memoryStore();
  const vfs = new VirtualFS();
  const base = new Uint8Array(2 * 1024 * 1024).fill(65);
  let baseReads = 0;
  vfs.setProviderFile(PATH, { provider: { size: base.length,
    async readRange(off, len) { baseReads++; return base.slice(off, off + len); },
  } });
  let hook = null;
  const batches = [];
  const bridge = { ...store, async writeBatch(records, options) {
    batches.push(records.map(r => ({ path: r.path, size: r.size,
      ranges: (r.ranges || []).map(x => ({ offset: x.offset, length: x.data.length })) })));
    if (hook) return hook(records, options);
    return store.writeBatch(records, options);
  } };
  const tracker = Overlay.attach(vfs, { store: bridge, rangeWrites: true });
  const handle = vfs.createFile(PATH, 0xC0000000, 3);
  function write(offset, value, h = handle) {
    const data = Buffer.from(value);
    vfs.setFilePointer(h, offset, 0);
    assert.ok(vfs.writeFile(h, data, data.length).ok);
  }
  write(123, 'XYZ');
  assert.strictEqual(baseReads, 0, 'opening and writing need no base bytes');
  assert.strictEqual((await tracker.flush()).failed, 0);
  assert.deepStrictEqual(batches[0][0].ranges, [{ offset: 123, length: 3 }]);
  const p = vfs.files.get(PATH)._provider;
  assert.strictEqual(p.pages.size, 0, 'successful checkpoint releases acknowledged dirty pages');
  const readsAfterFirst = baseReads;
  write(140, 'next');
  assert.strictEqual((await tracker.flush()).failed, 0);
  assert.deepStrictEqual(batches[1][0].ranges, [{ offset: 140, length: 4 }]);
  assert.strictEqual(baseReads, readsAfterFirst, 'next checkpoint reuses committed base extents');

  hook = async () => { throw new Error('injected write failure'); };
  write(150, 'retry');
  assert.strictEqual((await tracker.flush()).failed, 1);
  assert.deepStrictEqual(tracker.dirtyPaths(), [PATH]);
  assert.ok(p.pages.size > 0, 'failed checkpoint keeps dirty bytes');
  hook = null;
  assert.strictEqual((await tracker.flush()).failed, 0);
  assert.strictEqual(text((await store.read(PATH)).subarray(150, 155)), 'retry');

  const entered = deferred(), resume = deferred();
  hook = async (records, options) => { entered.resolve(); await resume.promise; return store.writeBatch(records, options); };
  write(160, 'old');
  const flushing = tracker.flush();
  await entered.promise;
  write(160, 'new');
  resume.resolve(); await flushing;
  assert.strictEqual(text((await store.read(PATH)).subarray(160, 163)), 'old', 'flush snapshot is immutable');
  assert.deepStrictEqual(tracker.dirtyPaths(), [PATH]);
  assert.strictEqual(text(await p.readRange(160, 3)), 'new', 'rebase cannot discard a concurrent write');
  hook = null; await tracker.flush();
  assert.strictEqual(text((await store.read(PATH)).subarray(160, 163)), 'new');

  // Another writer commits after our transaction, before our caller receives
  // its result. Rebase must use the snapshot returned by OUR writeBatch.
  hook = async (records, options) => {
    const own = await store.writeBatch(records, options);
    await store.writeBatch([{ path: PATH, kind: 'file', data: new Uint8Array(base.length).fill(90), attrs: 0x80 }]);
    return own;
  };
  write(170, 'own'); await tracker.flush();
  assert.strictEqual(text(await p.readRange(170, 3)), 'own', 'adopt exact committed version, not latest writer');
  assert.strictEqual(text((await store.read(PATH)).subarray(170, 173)), 'ZZZ');
  hook = null;

  assert.ok(vfs.copyFile(PATH, COPY, false));
  const copyHandle = vfs.createFile(COPY, 0xC0000000, 3);
  write(170, 'cpy', copyHandle);
  assert.strictEqual(text(await p.readRange(170, 3)), 'own', 'copy writes cannot mutate source');
  vfs.setFilePointer(copyHandle, 2, 0); assert.ok(vfs.setEndOfFile(copyHandle));
  vfs.setFilePointer(copyHandle, 8, 0); assert.ok(vfs.setEndOfFile(copyHandle));
  await tracker.flush();
  assert.deepStrictEqual(Array.from(await store.read(COPY)), [65, 65, 0, 0, 0, 0, 0, 0]);

  const child = new VirtualFS(); child.adoptFrom(vfs);
  vfs.files.clear();
  assert.strictEqual(text(await child.files.get(PATH)._provider.readRange(170, 3)), 'own',
    'child shared entry retains checkpoint provider after source is cleared');
  await tracker.detach();
  child.files.clear();
  assert.deepStrictEqual(await ownership.drain(), []);

  // Cleanup is after commit: a rejected release must neither falsify the
  // written count nor prevent the remaining leases and next batch completing.
  {
    const cleanupVfs = new VirtualFS(), cleanupStore = memoryStore();
    let inject = true;
    const cleanupBridge = { ...cleanupStore, async writeBatch(records, options) {
      const result = await cleanupStore.writeBatch(records, options);
      if (inject) {
        const release = result.snapshot.release.bind(result.snapshot);
        result.snapshot.release = async () => { await release(); throw new Error('committed snapshot release rejected'); };
      }
      return result;
    } };
    const cleanupTracker = Overlay.attach(cleanupVfs, { store: cleanupBridge, rangeWrites: true });
    const releases = [];
    const handles = [];
    for (const [index, path] of [PATH, COPY].entries()) {
      const h = cleanupVfs.createFile(path, 0xC0000000, 2);
      handles.push(h);
      assert.ok(cleanupVfs.writeFile(h, Buffer.from('abc'), 3).ok);
      const provider = cleanupVfs.files.get(path)._provider;
      const snapshot = provider.snapshot.bind(provider);
      provider.snapshot = (...args) => {
        const result = snapshot(...args), release = result.release.bind(result);
        result.release = async () => {
          await release(); releases.push(path);
          if (inject && index === 0) throw new Error('first file snapshot release rejected');
        };
        return result;
      };
    }
    const result = await cleanupTracker.flush();
    assert.strictEqual(result.written, 2, 'committed files remain reported written');
    assert.strictEqual(result.failed, 0, 'cleanup failure is not commit failure');
    assert.deepStrictEqual(releases, [PATH, COPY], 'rejection cannot skip later file leases');
    assert.strictEqual(result.errors.filter(e => e.stage === 'cleanup').length, 2);
    assert.strictEqual(result.errors.some(e => e.stage === 'store'), false);
    assert.deepStrictEqual(cleanupTracker.dirtyPaths(), []);
    inject = false;
    assert.ok(cleanupVfs.writeFile(handles[0], Buffer.from('d'), 1).ok);
    const next = await cleanupTracker.flush();
    assert.strictEqual(next.written, 1, 'cleanup rejection cannot poison flush chain');
    assert.strictEqual(next.failed, 0);
    assert.strictEqual(text(await cleanupStore.read(PATH)), 'abcd');
    await cleanupTracker.detach(); cleanupVfs.files.clear();
  }

  // The operation itself owns a lease even if the final map entry disappears
  // while an asynchronous materialization is awaiting provider bytes.
  {
    const readingVfs = new VirtualFS(), entered = deferred(), ready = deferred();
    const provider = { size: 4, refs: 1,
      retain() { assert.ok(this.refs > 0); this.refs++; },
      release() { assert.ok(this.refs > 0); this.refs--; },
      async readRange() {
        entered.resolve(); await ready.promise;
        assert.ok(this.refs > 0, 'provider survives delete during read');
        return Buffer.from('live');
      },
    };
    readingVfs.setProviderFile(PATH, { provider }); provider.release();
    const reading = readingVfs.materialize(PATH);
    await entered.promise;
    assert.ok(readingVfs.deleteFile(PATH));
    assert.ok(provider.refs > 0, 'in-flight materialize owns remaining lease');
    ready.resolve();
    assert.strictEqual(text(await reading), 'live');
    assert.strictEqual(readingVfs.files.has(PATH), false, 'materialize must not resurrect deleted path');
    assert.deepStrictEqual(await ownership.drain(), []);
    assert.strictEqual(provider.refs, 0, 'final operation completion releases provider');
  }
  console.log('PASS opt-in overlay checkpoints: changed ranges, retry, concurrent writes, version pinning, copy/truncate and shared ownership');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
