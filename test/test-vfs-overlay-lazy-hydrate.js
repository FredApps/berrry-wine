#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VirtualFS } = require('../lib/filesystem');
const Overlay = require('../lib/vfs-overlay');
const { memoryStore, nodeDirStore } = require('../lib/overlay-store');
const ownership = require('../lib/vfs-entry-ownership');
const bytes = text => new TextEncoder().encode(text);
const decode = data => new TextDecoder().decode(data);

function track(store) {
  const snapshots = [], stats = { reads: 0, requested: 0 };
  const open = store.openSnapshot.bind(store);
  store.openSnapshot = async () => {
    const snapshot = await open();
    const tracked = [];
    for (const record of snapshot.records) {
      const p = record.provider;
      if (!p) continue;
      const count = { refs: 1 };
      tracked.push(count);
      const read = p.readRange.bind(p), retain = p.retain.bind(p), release = p.release.bind(p);
      p.retain = () => { const result = retain(); count.refs++; return result; };
      p.release = () => { if (count.refs) count.refs--; return release(); };
      p.readRange = (offset,length) => { stats.reads++; stats.requested += length; return read(offset,length); };
    }
    snapshots.push(tracked);
    return snapshot;
  };
  return { snapshots, stats };
}
function resident(vfs) {
  let payload = 0, cache = 0;
  for (const entry of vfs.files.values()) {
    if (!entry._provider) payload += entry.data.length;
    else for (const chunk of entry._provider._chunks.values()) cache += chunk.byteLength;
  }
  return {payload,cache};
}
(async () => {
  const store = memoryStore(), observed = track(store);
  await store.writeBatch([
    {path:'c:\\small',kind:'file',data:bytes('persisted bytes')},
    {path:'c:\\gone',kind:'whiteout'},
    ...Array.from({length:8},(_,i)=>({path:'c:\\large-'+i,kind:'file',size:3*1024**3,ranges:[]})),
  ]);
  const vfs = new VirtualFS();
  vfs.files.set('c:\\gone',{data:bytes('base'),attrs:0x80});
  const overlay = Overlay.attach(vfs,{store,lazyHydrate:true});
  const report = await overlay.hydrate();
  assert.strictEqual(report.files,9); assert.strictEqual(report.whiteouts,1);
  assert.strictEqual(vfs.files.has('c:\\gone'),false);
  assert.strictEqual(observed.stats.reads,0);
  assert.deepStrictEqual(resident(vfs),{payload:0,cache:0});
  assert(observed.snapshots[0].every(p=>p.refs===1), 'managed maps retain snapshot providers');
  await overlay.hydrate();
  await ownership.drain();
  assert(observed.snapshots[0].every(p=>p.refs===0), 'repeat hydrate releases previous providers');
  assert(observed.snapshots[1].every(p=>p.refs===1));
  const handle = vfs.createFile('c:\\small',0x80000000,3);
  const output = new Uint8Array(15);
  const pending = vfs.readFile(handle,output,output.length);
  assert(pending.pending);
  await vfs.fillPendingRead(pending.pending);
  assert.strictEqual(vfs.readFile(handle,output,output.length).bytesRead,15);
  assert.strictEqual(decode(output),'persisted bytes');
  vfs.closeHandle(handle);
  const big = vfs.createFile('c:\\large-0',0x80000000,3);
  const scratch = new Uint8Array(8);
  const bigPending = vfs.readFile(big,scratch,8);
  assert(bigPending.pending);
  await vfs.fillPendingRead(bigPending.pending);
  assert.strictEqual(vfs.readFile(big,scratch,8).bytesRead,8);
  vfs.closeHandle(big);
  const measured = resident(vfs);
  assert.strictEqual(measured.payload,0);
  assert(measured.cache <= 1024*1024, 'one small read cannot hydrate the multi-GiB installation');
  console.log(`PASS lazy mount: 24 GiB logical large-file descriptors, 0 payload/cache bytes at mount; after small reads ${measured.cache} cache bytes, ${measured.payload} materialized payload bytes (accounting, not RSS)`);
  assert(vfs.copyFile('c:\\small','c:\\copy',false));
  const adopted = new VirtualFS(); adopted.adoptFrom(vfs);
  await store.remove('c:\\small');
  vfs.files.clear(); await ownership.drain();
  assert.strictEqual(decode(await adopted.materialize('c:\\copy')),'persisted bytes');
  assert(adopted.deleteFile('c:\\small'));
  adopted.files.clear(); await ownership.drain();
  assert(observed.snapshots[1].every(p=>p.refs===0), 'adopt/copy/materialize/delete/clear release the final owners');
  // Independent per-file LRUs are not enough: touching many small files must
  // still respect one installation-wide retained byte budget, including rebase.
  const manyStore = memoryStore(), many = new VirtualFS();
  await manyStore.writeBatch(Array.from({length:12}, (_,i)=>({
    path:`c:\\file-${i}`,kind:'file',size:256*1024,
    ranges:[{offset:0,data:Uint8Array.of(i)}],
  })));
  const manyOverlay = Overlay.attach(many,{store:manyStore,lazyHydrate:true,rangeWrites:true,cacheBytes:512*1024});
  await manyOverlay.hydrate();
  async function firstByte(i) {
    const h = many.createFile(`c:\\file-${i}`,0x80000000,3), byte = new Uint8Array(1);
    let read = many.readFile(h,byte,1);
    if (read.pending) { await many.fillPendingRead(read.pending); read = many.readFile(h,byte,1); }
    assert(read.ok); many.closeHandle(h); return byte[0];
  }
  for (let i=0;i<12;i++) {
    assert.strictEqual(await firstByte(i),i);
    assert(manyOverlay.cacheBudget.bytes <= 512*1024);
  }
  assert.strictEqual(await firstByte(0),0, 'an evicted file remains readable');
  const changed = many.createFile('c:\\file-0',0x40000000,3);
  assert(many.writeFile(changed,Uint8Array.of(99),1).ok);
  assert.strictEqual((await manyOverlay.flush()).failed,0);
  assert.strictEqual(many.files.get('c:\\file-0')._provider._cache.budget,manyOverlay.cacheBudget,
    'checkpoint rebase must retain installation-wide budgeting');
  assert.strictEqual(await firstByte(0),99);
  many.files.clear(); await ownership.drain();
  assert.strictEqual(manyOverlay.cacheBudget.bytes,0,'final entry release frees cached payloads');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wa-lazy-mount-'));
  try {
    const writer = nodeDirStore(dir), peer = nodeDirStore(dir), mounted = new VirtualFS();
    await writer.writeBatch([{path:'c:\\live',kind:'file',data:bytes('live')}]);
    await Overlay.attach(mounted,{store:writer,lazyHydrate:true}).hydrate();
    await peer.remove('c:\\live');
    assert.strictEqual(decode(await mounted.materialize('c:\\live')),'live');
    mounted.files.clear(); await ownership.drain();
    assert.deepStrictEqual(fs.readdirSync(path.join(dir,'blobs')),[]);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }

  let released = 0;
  const broken = {...memoryStore(), openSnapshot:async()=>({
    records:[{path:'c:\\broken',kind:'file',size:1}], release:async()=>{released++;throw new Error('cleanup failure');},
  })};
  const failed = Overlay.attach(new VirtualFS(),{store:broken,lazyHydrate:true});
  const bad = await failed.hydrate();
  assert.strictEqual(bad.files,0); assert.strictEqual(released,1);
  assert(bad.errors.some(e=>e.stage==='hydrate' && /no provider/.test(e.message)));
  assert(bad.errors.some(e=>e.stage==='cleanup'));
  const unreadable = {...memoryStore(), openSnapshot:async()=>({
    records:[{path:'c:\\unreadable',kind:'file',size:1,provider:{size:1,
      retain() { return this; }, release() {}, readRange:async()=>{throw new Error('lost bytes');},
    }}], release:async()=>{},
  })};
  const faultedVfs = new VirtualFS();
  await Overlay.attach(faultedVfs,{store:unreadable,lazyHydrate:true}).hydrate();
  const faultHandle = faultedVfs.createFile('c:\\unreadable',0x80000000,3);
  const faultPending = faultedVfs.readFile(faultHandle,new Uint8Array(1),1);
  assert.strictEqual(await faultedVfs.fillPendingRead(faultPending.pending),false);
  assert.strictEqual(faultedVfs.readFile(faultHandle,new Uint8Array(1),1).error,30);
  faultedVfs.files.clear(); await ownership.drain();
  const eagerStore = memoryStore(); await eagerStore.writeBatch([{path:'c:\\eager',kind:'file',data:bytes('eager')}]);
  eagerStore.openSnapshot = () => { throw new Error('default must not opt in'); };
  const eager = new VirtualFS(); await Overlay.attach(eager,{store:eagerStore}).hydrate();
  assert.strictEqual(decode(eager.files.get('c:\\eager').data),'eager');
  console.log('PASS lazy hydration: pending retries, whiteouts, repeated mount release, copy/adopt/delete/materialize ownership, diagnostics and default eager compatibility');
})().catch(error=>{console.error(error);process.exitCode=1;});
