'use strict';
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const Catalog = require('../lib/font-catalog');
const DIR = 'c:\\windows\\fonts\\';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const vfs = new VirtualFS(), providers = [];
  function add(name, data = Uint8Array.of(1,2,3), read) {
    const provider = { size:data.length, revision:0, refs:0, calls:0,
      retain() { this.refs++; }, release() { this.refs--; },
      async readRange(off,n) { this.calls++; return read ? read(off,n) : data.slice(off,off+n); } };
    providers.push(provider); vfs.setProviderFile(DIR + name, {provider}); return provider;
  }
  function clean() { vfs.files.clear(); for (const p of providers) assert.strictEqual(p.refs, 0); assert.strictEqual(vfs.handles.size, 0); }
  return { vfs, add, clean, providers };
}
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
(async () => {
  await test('empty and excluded snapshots, deterministic paths and immutable copies', async () => {
    const f = fixture(), empty = await Catalog.prepare(f.vfs);
    assert.strictEqual(empty.count, 0); assert(empty.isCurrent()); empty.release();
    f.add('B.TTF', Uint8Array.of(4,5)); f.add('a.ttf');
    const skipped = [f.add('arial.ttf'), f.add('nested\\hidden.ttf'), f.add('other.fon')];
    const pending = {}; f.vfs.pendingRead = pending;
    const batch = await Catalog.prepare(f.vfs, {excludedPaths:['C:/WINDOWS/FONTS/ARIAL.TTF']});
    assert(Object.isFrozen(batch)); assert.strictEqual(batch.count, 2);
    assert.deepStrictEqual([batch.path(0),batch.path(1)], [DIR+'a.ttf',DIR+'b.ttf']);
    assert.strictEqual(batch.size(0), 3); assert.strictEqual(batch.size(1), 2);
    const copy = batch.read(0); copy.fill(99); assert.deepStrictEqual(batch.read(0), Uint8Array.of(1,2,3));
    assert.strictEqual(f.vfs.pendingRead, pending); assert.strictEqual(f.vfs.handles.size, 0);
    for (const p of skipped) assert.strictEqual(p.calls, 0);
    for (const i of [-1,2,NaN,0.5]) for (const method of ['path','size','read']) assert.throws(() => batch[method](i), RangeError);
    batch.release(); batch.release(); assert(!batch.isCurrent()); assert.throws(() => batch.read(0)); f.clean();
  });
  await test('earlier provider revision/replacement and eager same-size changes reject later pending publication', async () => {
    for (const mode of ['revision','replace','eager']) {
      const f = fixture(), gate = deferred(), entered = deferred();
      const a = f.add('a.ttf');
      if (mode === 'eager') f.vfs.files.set(DIR+'a.ttf', {data:Uint8Array.of(1,2,3)});
      f.add('b.ttf', Uint8Array.of(4,5,6), async () => { entered.resolve(); await gate.promise; return Uint8Array.of(4,5,6); });
      const work = Catalog.prepare(f.vfs), failed = assert.rejects(work);
      await entered.promise;
      if (mode === 'revision') a.revision++;
      else if (mode === 'replace') f.vfs.files.set(DIR+'a.ttf', {data:Uint8Array.of(7,8,9)});
      else f.vfs.files.get(DIR+'a.ttf').data[1] = 8;
      gate.resolve(); await failed; f.clean();
    }
  });
  await test('membership changes during preparation and after readiness invalidate whole batch', async () => {
    for (const mutation of ['add','delete']) {
      const f = fixture(), gate = deferred(), entered = deferred();
      f.add('a.ttf'); f.add('b.ttf', Uint8Array.of(4,5,6), async () => { entered.resolve(); await gate.promise; return Uint8Array.of(4,5,6); });
      const work = Catalog.prepare(f.vfs), failed = assert.rejects(work); await entered.promise;
      if (mutation === 'add') f.add('c.ttf'); else f.vfs.files.delete(DIR+'a.ttf');
      gate.resolve(); await failed; f.clean();
    }
    for (const mutation of ['add','delete','revision','eager']) {
      const f = fixture(), a = f.add('a.ttf');
      if (mutation === 'eager') f.vfs.files.set(DIR+'a.ttf', {data:Uint8Array.of(1,2,3)});
      const batch = await Catalog.prepare(f.vfs);
      if (mutation === 'add') f.add('b.ttf');
      else if (mutation === 'delete') f.vfs.files.delete(DIR+'a.ttf');
      else if (mutation === 'revision') a.revision++;
      else f.vfs.files.get(DIR+'a.ttf').data[0]++;
      assert(!batch.isCurrent()); assert.throws(() => batch.read(0)); batch.release(); f.clean();
    }
  });
  await test('aggregate remainder rejects oversized providers and lazy getters before their I/O', async () => {
    for (const lazy of [false,true]) {
      const f = fixture(); f.add('a.ttf', new Uint8Array(4)); let loads = 0;
      let large;
      if (lazy) f.vfs.setLazyFile(DIR+'b.ttf', {size:4,load:()=>{ loads++; return new Uint8Array(4); }});
      else large = f.add('b.ttf', new Uint8Array(4));
      await assert.rejects(Catalog.prepare(f.vfs, {maxTotalBytes:7}));
      assert.strictEqual(loads, 0); if (large) assert.strictEqual(large.calls, 0); f.clean();
    }
    const f = fixture(); f.add('a.ttf');
    for (const n of [-1,NaN,Infinity,1.5,128*1024*1024+1]) await assert.rejects(Catalog.prepare(f.vfs,{maxTotalBytes:n}));
    assert.strictEqual(f.providers[0].calls,0); f.clean();
  });
  await test('file count, individual size and bounded ASCII paths reject safely', async () => {
    const many = fixture(); for (let i=0;i<33;i++) many.add(`f${i}.ttf`);
    await assert.rejects(Catalog.prepare(many.vfs)); many.clean();
    for (const size of [0,4*1024*1024+1]) {
      const f = fixture(); let calls=0;
      f.vfs.setLazyFile(DIR+'huge.ttf',{size,load:()=>{ calls++; return new Uint8Array(size); }});
      await assert.rejects(Catalog.prepare(f.vfs)); assert.strictEqual(calls,0); f.clean();
    }
    for (const name of ['x'.repeat(132)+'.ttf','caf\u00e9.ttf']) {
      const f=fixture(); const p=f.add(name); await assert.rejects(Catalog.prepare(f.vfs)); assert.strictEqual(p.calls,0); f.clean();
    }
  });
  await test('faults and abort keep in-flight providers alive then release all staging leases', async () => {
    const fault=fixture(); fault.add('a.ttf'); fault.add('b.ttf',Uint8Array.of(1),async()=>{throw Error('media failure');});
    await assert.rejects(Catalog.prepare(fault.vfs),/media failure/); fault.clean();
    const f=fixture(), entered=deferred(), gate=deferred(), controller=new AbortController();
    f.add('a.ttf'); const p=f.add('b.ttf',Uint8Array.of(9),async()=>{entered.resolve(); await gate.promise; return Uint8Array.of(9);});
    const work=Catalog.prepare(f.vfs,{signal:controller.signal}), failed=assert.rejects(work);
    await entered.promise; controller.abort(); assert.strictEqual(p.refs,2);
    gate.resolve(); await failed; assert.strictEqual(p.refs,1); f.clean();
    const ready=fixture(); const r=ready.add('a.ttf'); const signal=new AbortController();
    const batch=await Catalog.prepare(ready.vfs,{signal:signal.signal}); signal.abort();
    assert(!batch.isCurrent()); assert.throws(()=>batch.read(0)); assert.strictEqual(r.refs,1); batch.release();
    const calls=r.calls; await assert.rejects(Catalog.prepare(ready.vfs,{signal:signal.signal})); assert.strictEqual(r.calls,calls); ready.clean();
  });
  console.log(`${passed} font catalog preparation groups passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
