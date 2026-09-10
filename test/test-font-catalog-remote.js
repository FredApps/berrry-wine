'use strict';
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const Catalog = require('../lib/font-catalog');
const DIR = 'c:\\windows\\fonts\\';
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
function fixture() {
  const vfs=new VirtualFS(), providers=[];
  const add=(name,data=Uint8Array.of(1,2,3),read)=>{
    const p={size:data.length,revision:0,refs:0,calls:0,
      retain(){this.refs++;},release(){this.refs--;},
      async readRange(off,n){this.calls++;return read?read(off,n):data.slice(off,off+n);}};
    providers.push(p);vfs.setProviderFile(DIR+name,{provider:p});return p;
  };
  const clean=()=>{vfs.files.clear();for(const p of providers)assert.strictEqual(p.refs,0);assert.strictEqual(vfs.handles.size,0);};
  return {vfs,add,clean,providers};
}
function remote(options={}) {
  const entered=deferred(), reply=deferred(); let installs=0,stops=0;
  const worker={
    async getFontCatalogStartupState(){return options.state||'OPEN';},
    async getFontCatalogExclusions(){return options.excluded||[];},
    async installFontCatalog(entries,policy){installs++;entered.resolve({entries,policy});return reply.promise;},
    async stop(){stops++;throw Error('helper must not stop caller-owned Worker');},
  };
  return {worker,entered,reply,get installs(){return installs;},get stops(){return stops;}};
}
let passed=0;
async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
(async()=>{
  await test('successful publication holds leases until reply and returns native count',async()=>{
    const f=fixture(),p=f.add('a.ttf'),w=remote(),pending={};f.vfs.pendingRead=pending;
    const work=Catalog.installRemote(f.vfs,{worker:w.worker});
    const sent=await w.entered.promise;
    assert.deepStrictEqual(sent.policy,[]);assert.strictEqual(sent.entries.length,1);
    assert.strictEqual(sent.entries[0].path,DIR+'a.ttf');
    assert.deepStrictEqual(sent.entries[0].bytes,Uint8Array.of(1,2,3));
    assert.strictEqual(p.refs,2,'prepared source remains retained while publication awaits');
    assert.strictEqual(f.vfs.pendingRead,pending);assert.strictEqual(f.vfs.handles.size,0);
    w.reply.resolve({count:1,generation:1});
    const result=await work;assert.deepStrictEqual(result,{count:1,generation:1});
    assert.strictEqual(p.refs,1);assert.strictEqual(w.stops,0);f.clean();
  });
  await test('reply-time revision, replacement, eager mutation, membership and abort require discard',async()=>{
    for(const mode of ['revision','replacement','eager','membership','delete','abort','check']){
      const f=fixture(),p=f.add('a.ttf'),w=remote(),controller=new AbortController();let valid=true;
      if(mode==='eager')f.vfs.files.set(DIR+'a.ttf',{data:Uint8Array.of(1,2,3)});
      const work=Catalog.installRemote(f.vfs,{worker:w.worker,signal:controller.signal,check(){if(!valid)throw Error('launch superseded');}});
      const failed=assert.rejects(work,/discard/i);await w.entered.promise;
      if(mode==='revision')p.revision++;
      else if(mode==='replacement')f.vfs.files.set(DIR+'a.ttf',{data:Uint8Array.of(7,8,9)});
      else if(mode==='eager')f.vfs.files.get(DIR+'a.ttf').data[1]=9;
      else if(mode==='membership')f.add('b.ttf');
      else if(mode==='delete')f.vfs.files.delete(DIR+'a.ttf');
      else if(mode==='abort'){controller.abort();assert.strictEqual(p.refs,2,'abort cannot release prepared source while Worker still owns publication');}
      else valid=false;
      w.reply.resolve({count:1,generation:1});await failed;
      if(mode==='abort')assert.strictEqual(p.refs,1,'aborted publication releases only after Worker reply settles');
      assert.strictEqual(w.stops,0);f.clean();
    }
  });
  await test('pending source abort retains provider until read settles and sends no install',async()=>{
    const f=fixture(),gate=deferred(),entered=deferred(),w=remote(),controller=new AbortController();
    const p=f.add('a.ttf',Uint8Array.of(3),async()=>{entered.resolve();await gate.promise;return Uint8Array.of(3);});
    const work=Catalog.installRemote(f.vfs,{worker:w.worker,signal:controller.signal}),failed=assert.rejects(work);
    await entered.promise;controller.abort();assert.strictEqual(p.refs,2);
    gate.resolve();await failed;assert.strictEqual(p.refs,1);assert.strictEqual(w.installs,0);assert.strictEqual(w.stops,0);f.clean();
  });
  await test('closed startup, prepare faults and prior cancellation prevent publication',async()=>{
    for(const mode of ['NEW','SEALED','fault','abort','check']){
      const f=fixture(),w=remote({state:['NEW','SEALED'].includes(mode)?mode:'OPEN'}),controller=new AbortController();
      const p=f.add('a.ttf',Uint8Array.of(1),mode==='fault'?async()=>{throw Error('media offline');}:undefined);
      if(mode==='abort')controller.abort();
      await assert.rejects(Catalog.installRemote(f.vfs,{worker:w.worker,signal:controller.signal,check(){if(mode==='check')throw Error('superseded');}}));
      assert.strictEqual(w.installs,0);assert.strictEqual(w.stops,0);
      if(['NEW','SEALED','abort','check'].includes(mode))assert.strictEqual(p.calls,0);
      f.clean();
    }
  });
  await test('remote rejection after send releases staging and communicates discard',async()=>{
    const f=fixture(),p=f.add('a.ttf'),w=remote();
    const work=Catalog.installRemote(f.vfs,{worker:w.worker}),failed=assert.rejects(work,/discard/i);
    await w.entered.promise;assert.strictEqual(p.refs,2);w.reply.reject(Error('worker policy mismatch'));
    await failed;assert.strictEqual(p.refs,1);assert.strictEqual(w.stops,0);f.clean();
  });
  await test('malformed publication replies reject with discard and release retained sources',async()=>{
    for(const reply of [null,{}, {count:0,generation:1},{count:1,generation:0},
      {count:1,generation:-1},{count:1,generation:1.5},{count:1,generation:0x100000000}]){
      const f=fixture(),p=f.add('a.ttf'),w=remote();
      const work=Catalog.installRemote(f.vfs,{worker:w.worker}),failed=assert.rejects(work,/discard/i);
      await w.entered.promise;assert.strictEqual(p.refs,2);w.reply.resolve(reply);
      await failed;assert.strictEqual(p.refs,1);assert.strictEqual(w.stops,0);f.clean();
    }
  });
  await test('native exclusions omit matching sources and aggregate rejects before oversized loader',async()=>{
    const f=fixture(),p=f.add('arial.ttf'),w=remote({excluded:[DIR+'arial.ttf']});
    const work=Catalog.installRemote(f.vfs,{worker:w.worker});
    const sent=await w.entered.promise;assert.strictEqual(sent.entries.length,0);assert.strictEqual(p.calls,0);
    assert.deepStrictEqual(sent.policy,[DIR+'arial.ttf']);w.reply.resolve({count:0,generation:1});await work;f.clean();
    const bounded=fixture(),bad=remote();let loads=0;
    for(let i=0;i<5;i++)bounded.vfs.setLazyFile(DIR+`f${i}.ttf`,{size:4*1024*1024,load:()=>{loads++;return new Uint8Array(4*1024*1024);}});
    await assert.rejects(Catalog.installRemote(bounded.vfs,{worker:bad.worker}));
    assert(loads<=4,'aggregate budget must reject fifth 4MiB loader before I/O');assert.strictEqual(bad.installs,0);bounded.clean();
  });
  console.log(`${passed} remote font catalog groups passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
