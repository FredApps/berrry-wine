'use strict';
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const { BytesProvider, SliceProvider, ChunkCache, ChunkCacheBudget, SparseByteProvider } = require('../lib/byte-provider');
const path = 'c:\\lease.bin';
const fixture = (length = 19) => {
  const vfs = new VirtualFS(), bytes = Uint8Array.from({ length }, (_, i) => i + 1);
  const provider = { size: length, revision: 0, refs: 0, calls: [],
    retain() { this.refs++; }, release() { this.refs--; },
    async readRange(off, size) { this.calls.push([off, size]); return bytes.slice(off, off + size); } };
  vfs.setProviderFile(path, { provider });
  return { vfs, provider, bytes };
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('bounded immutable reads preserve provider entry and pending slot', async () => {
    const { vfs, provider, bytes } = fixture();
    const entry = vfs.files.get(vfs._resolvePath(path)), pending = {};
    const mounted = entry._provider;
    vfs.pendingRead = pending;
    const refs = provider.refs;
    const lease = await vfs.prepareReadLease(path, { maxBytes: 19, chunkSize: 4 });
    assert.deepStrictEqual(provider.calls, [[0,4],[4,4],[8,4],[12,4],[16,3]]);
    assert.strictEqual(provider.refs, refs + 1);
    assert.strictEqual(vfs.pendingRead, pending);
    assert.strictEqual(vfs.files.get(vfs._resolvePath(path)), entry);
    assert.strictEqual(entry._provider, mounted);
    assert.strictEqual(vfs.handles.size, 0);
    assert.deepStrictEqual(lease.read(0, 19), bytes);
    const copy = lease.read(0, 19); copy.fill(0);
    assert.deepStrictEqual(lease.read(0, 19), bytes);
    assert.strictEqual(lease.isCurrent(), true);
    assert.deepStrictEqual(lease.read(19, 0), new Uint8Array());
    for (const args of [[-1,1],[0,-1],[19,1],[0,20],[0,1.5],[NaN,1],[Number.MAX_SAFE_INTEGER,2]]) {
      assert.throws(() => lease.read(...args), RangeError);
    }
    lease.release(); lease.release();
    assert.strictEqual(provider.refs, refs);
    assert.strictEqual(lease.isCurrent(), false);
    assert.throws(() => lease.read(0, 1));
    vfs.files.clear(); assert.strictEqual(provider.refs, 0);
  });
  await test('invalid budgets reject before I/O and release allocation failures', async () => {
    const { vfs, provider } = fixture();
    for (const options of [{}, {maxBytes:18}, {maxBytes:-1}, {maxBytes:Infinity},
      {maxBytes:19,chunkSize:0}, {maxBytes:19,chunkSize:1048577}]) {
      await assert.rejects(vfs.prepareReadLease(path, options), RangeError);
    }
    assert.strictEqual(provider.calls.length, 0); assert.strictEqual(provider.refs, 1);
    await assert.rejects(vfs.prepareReadLease('missing', {maxBytes:19}));
    vfs.files.clear();
  });
  await test('short reads and provider faults publish no lease', async () => {
    for (const throwing of [false, true]) {
      const { vfs, provider } = fixture();
      provider.readRange = async () => { if (throwing) throw Error('offline'); return new Uint8Array(1); };
      await assert.rejects(vfs.prepareReadLease(path, {maxBytes:19}));
      assert.strictEqual(provider.refs, 1); vfs.files.clear();
    }
  });
  await test('legacy lazy metadata and pre-abort reject before invoking loader', async () => {
    const vfs = new VirtualFS(); let loads = 0;
    const mount = size => vfs.setLazyFile(path, {size, load: () => {
      loads++; return Uint8Array.of(1,2,3);
    }});
    mount(100);
    await assert.rejects(vfs.prepareReadLease(path, {maxBytes:3}), RangeError);
    assert.strictEqual(loads, 0);
    mount(3);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(vfs.prepareReadLease(path, {maxBytes:3,signal:controller.signal}), /aborted/);
    assert.strictEqual(loads, 0);
    mount(1);
    await assert.rejects(vfs.prepareReadLease(path, {maxBytes:1}), RangeError);
    assert.strictEqual(loads, 1, 'actual size is checked even if loader metadata lies');
    mount(3);
    const lease = await vfs.prepareReadLease(path, {maxBytes:3});
    assert.deepStrictEqual(lease.read(0,3), Uint8Array.of(1,2,3));
    lease.release(); vfs.files.clear();
  });
  await test('revision and path replacement during a read reject stale publication', async () => {
    for (const replace of [false, true]) {
      const { vfs, provider, bytes } = fixture(); let finish;
      provider.readRange = () => new Promise(resolve => { finish = resolve; });
      const work = vfs.prepareReadLease(path, {maxBytes:19});
      const rejected = assert.rejects(work, /stale/);
      if (replace) vfs.files.set(vfs._resolvePath(path), {data:Uint8Array.of(99),attrs:0x20}); else provider.revision++;
      finish(bytes); await rejected;
      assert.strictEqual(provider.refs, replace ? 0 : 1); vfs.files.clear();
    }
  });
  await test('abort holds provider until in-flight read settles; ready abort releases once', async () => {
    const { vfs, provider, bytes } = fixture(); let finish;
    provider.readRange = () => new Promise(resolve => { finish = resolve; });
    const signal = new AbortController();
    const work = vfs.prepareReadLease(path, {maxBytes:19,signal:signal.signal});
    const rejected = assert.rejects(work, /aborted/);
    signal.abort(); assert.strictEqual(provider.refs, 2);
    finish(bytes); await rejected; assert.strictEqual(provider.refs, 1);
    provider.readRange = async () => bytes;
    const readySignal = new AbortController();
    const lease = await vfs.prepareReadLease(path, {maxBytes:19,signal:readySignal.signal});
    readySignal.abort(); assert.strictEqual(provider.refs, 1);
    assert.strictEqual(lease.isCurrent(), false); assert.throws(() => lease.read(0,1));
    lease.release(); assert.strictEqual(provider.refs, 1);
    await assert.rejects(vfs.prepareReadLease(path, {maxBytes:19,signal:readySignal.signal}), /aborted/);
    assert.strictEqual(provider.refs, 1); vfs.files.clear();
  });
  await test('eager in-place edits, provider revisions and deletion invalidate prepared bytes', async () => {
    const vfs = new VirtualFS(); vfs.files.set(vfs._resolvePath(path), {data:Uint8Array.of(1,2,3),attrs:0x20});
    const lease = await vfs.prepareReadLease(path, {maxBytes:3});
    vfs.files.get(vfs._resolvePath(path)).data[1] = 9;
    assert.strictEqual(lease.isCurrent(), false); assert.throws(() => lease.read(0,3)); lease.release();
    const f = fixture();
    const a = await f.vfs.prepareReadLease(path, {maxBytes:19}); f.provider.revision++;
    assert.strictEqual(a.isCurrent(), false); a.release();
    const b = await f.vfs.prepareReadLease(path, {maxBytes:19}); f.vfs.files.clear();
    assert.strictEqual(b.isCurrent(), false); b.release(); assert.strictEqual(f.provider.refs, 0);
  });
  await test('zero-cache reads and offset windows do not depend on residency', async () => {
    const { vfs, provider, bytes } = fixture(31);
    const budget = new ChunkCacheBudget({maxBytes:0});
    const cache = new ChunkCache(provider, {chunkSize:4,maxChunks:1,readAhead:0,budget});
    vfs.setProviderFile(path, {provider:cache,offset:5,length:17});
    const lease = await vfs.prepareReadLease(path, {maxBytes:17,chunkSize:3});
    assert.deepStrictEqual(lease.read(0,17), bytes.slice(5,22));
    assert.strictEqual(budget.bytes, 0); lease.release(); vfs.files.clear();
  });
  await test('nested caches cannot hide sparse revisions or serve old cached bytes', async () => {
    const vfs = new VirtualFS();
    const sparse = new SparseByteProvider(new BytesProvider(Uint8Array.of(1,2,3,4,5,6,7,8)));
    const inner = new ChunkCache(sparse, {chunkSize:4,maxChunks:2,readAhead:0});
    await inner.readRange(0,8); sparse.write(2, Uint8Array.of(99));
    const slice = new SliceProvider(inner,1,5);
    const outer = new ChunkCache(slice, {chunkSize:4,maxChunks:2,readAhead:0});
    vfs.setProviderFile(path, {provider:outer});
    const lease = await vfs.prepareReadLease(path, {maxBytes:5,chunkSize:2});
    assert.deepStrictEqual(Array.from(lease.read(0,5)), [2,99,4,5,6]);
    sparse.write(3, Uint8Array.of(88)); assert.strictEqual(lease.isCurrent(), false); lease.release();
    const read = sparse.readRange.bind(sparse); let calls = 0;
    sparse.readRange = async (...args) => { const bytes = await read(...args); if (++calls === 1) sparse.write(4,Uint8Array.of(77)); return bytes; };
    await assert.rejects(vfs.prepareReadLease(path, {maxBytes:5,chunkSize:2}), /stale/);
    vfs.files.clear(); sparse.release();
  });
  await test('fill-returned immutable bytes work even when tryRead misses', async () => {
    const vfs = new VirtualFS(), bytes = Uint8Array.of(4,5,6);
    vfs.setProviderFile(path, {provider:{size:3, tryRead:()=>null, fill:async(off,n)=>bytes.slice(off,off+n)}});
    const lease = await vfs.prepareReadLease(path, {maxBytes:3,chunkSize:2});
    assert.deepStrictEqual(lease.read(0,3), bytes); lease.release(); vfs.files.clear();
  });
  console.log(`${passed} read-lease groups passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
