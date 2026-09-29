#!/usr/bin/env node
'use strict';
// Real manager + worker dispatcher; small injected adapters expose ordering
// independently of GPU availability and native rasterizer execution speed.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const {Manager}=require('../lib/render-worker');
const Stream=require('../lib/d3d-command-stream');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(legacy=false){
  const events=[],pending=[],listeners=new Map();let init=0,retire=0,terminated=0,transients=0;
  const self={postMessage(message,transfer){
    const owned=structuredClone(message,{transfer:transfer||[]});
    queueMicrotask(()=>{for(const f of listeners.get('message')||[])f({data:owned});});
  }};
  const factory={create({options,sendFrame}){
    return {execute(message){
      assert.strictEqual(transients,0,'peer starts with cleared raster hooks and state override');
      const p=message.payload||message;events.push(['execute',options.name,p.kind,p.value]);
      if(p.kind==='hold'){
        transients=7;
        return {value:p.value,completion:new Promise(resolve=>pending.push(()=>{
          assert.strictEqual(transients,7,'raster hooks survive until asynchronous completion');resolve();
        }))};
      }
      if(p.kind==='fail'){transients=7;throw new WebAssembly.RuntimeError('injected endpoint failure');}
      if(p.kind==='frame')sendFrame({pixels:new Uint8Array([p.value]),width:1,height:1});
      return {complete:true,value:p.value};
    },destroy(){events.push(['destroy',options.name]);}};
  }};
  Object.assign(self,{GlideRenderWorker:factory,GLRenderWorker:factory,D3DIMRenderWorker:factory,
    D3D9RenderWorker:factory,D3DCommandStream:Stream});
  const sharedMemory={buffer:new SharedArrayBuffer(legacy?6*1024*1024:1024)};
  let allocation=4096,override=0;
  const exports={d3d_render_reset_transients(){transients=0;override=0;},d3dim_worker_init(){init++;},d3d_render_retire_heap(){retire++;return 1234;},
    d3dim_worker_draw(...args){events.push(['software-draw',...args]);},
    d3dim_worker_flip(...args){events.push(['flip',...args]);},
    guest_to_wasm:p=>p,
    d3dim_gpu_state_override(p){override=p;events.push(['override',p]);},
    guest_alloc(bytes){const p=allocation;allocation+=bytes;return p;}};
  if(legacy){
    class FakeGPU {
      constructor(){this.targets=new Map();}
      call(opcode,wa){
        if(opcode===0x20001)return this.fence();
        const d=new DataView(sharedMemory.buffer);
        if(opcode===0x20000){
          assert(override,'GPU draw receives packet state override');
          assert.strictEqual(d.getUint32(wa+20,true),override);
          events.push(['gpu-draw',d.getUint32(override,true),d.getUint32(d.getUint32(wa+12,true),true)]);
          return d.getUint32(wa+4,true)===1?0:1;
        }
        assert.strictEqual(override,0,'state override reset before clear');
        events.push(['gpu-clear',wa]);return 7;
      }
      fence(){assert.strictEqual(override,0);events.push(['gpu-fence']);return 1;}
      snapshot(){return {draws:events.filter(e=>e[0]==='gpu-draw').length};}
      stop(){events.push(['gpu-stop']);}
    }
    const adapterContext={module:{exports:{}},require:()=>({D3DIMGpu:FakeGPU}),DataView,Error};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/d3dim-render-worker.js'),'utf8'),adapterContext);
    self.D3DIMRenderWorker=adapterContext.module.exports;
  }
  const imported=new Set(),importOrder=[],failedImports=new Set();
  const context={self,importScripts(url){
    importOrder.push(url);
    if(failedImports.delete(url))throw new Error('injected import failure');
    assert(!imported.has(url),'dependency evaluated twice: '+url);imported.add(url);
  },setTimeout,clearTimeout,performance,console,
    ArrayBuffer,SharedArrayBuffer,Uint8Array,Int32Array,DataView,Atomics,Map,Set,Promise,
    WebAssembly:{Memory:WebAssembly.Memory,Module:WebAssembly.Module,instantiate:async()=>({exports})}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/d3d-render-worker.js'),'utf8'),context);
  const worker={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    postMessage(message){const owned=structuredClone(message);queueMicrotask(()=>self.onmessage({data:owned}));},
    terminate(){terminated++;return Promise.resolve();}};
  const adopted=[];
  const manager=new Manager({workerFactory:()=>worker,module:{},memory:sharedMemory,
    sigs:{},imageBase:0x400000,maxQueuedCommands:2,maxQueuedBytes:legacy?65536:4096,reclaimHeap:p=>{adopted.push(p);return 1;}});
  return {manager,events,pending,adopted,sharedMemory,importOrder,failedImports,counts:()=>({init,retire,terminated})};
}
(async()=>{
  const f=fixture(),a=f.manager.createEndpoint({api:'glide',name:'a'}),b=f.manager.createEndpoint({api:'gl',name:'b'});
  await Promise.all([a.ready,b.ready]);
  assert.strictEqual(f.counts().init,1,'one native initializer for both APIs');
  const first=a.request({kind:'hold',value:1});
  const packet={kind:'echo',value:new Uint8Array([7])};
  const second=b.request(packet);packet.value[0]=99;
  await assert.rejects(b.request({kind:'echo',value:3}),/capacity/);
  await tick();
  assert.strictEqual(f.events.filter(e=>e[0]==='execute').length,1,'other endpoint waits for sliced draw completion');
  f.pending.shift()();assert.strictEqual(await first,1);
  assert.deepStrictEqual(await second,new Uint8Array([7]),'postMessage owns mutable payload');
  await tick();assert.strictEqual(f.manager.queuedBytes,0);
  await assert.rejects(a.request({kind:'echo',value:new Uint8Array(5000)}),/capacity/);
  let frame;
  b.addEventListener('message',event=>{if(event.data.t==='frame')frame=event.data.frame;});
  await b.request({kind:'frame',value:42});assert.strictEqual(frame.pixels[0],42);
  await assert.rejects(a.request({kind:'fail'}),/injected/);
  assert.strictEqual(await b.request({kind:'echo',value:4}),4,'failed endpoint does not poison peer');
  await a.terminate();assert.strictEqual(f.counts().retire,0,'closing endpoint keeps process heap');
  const anotherGL=f.manager.createEndpoint({api:'gl',name:'second-gl',backend:'software'});
  await anotherGL.ready;
  assert.strictEqual(f.importOrder.filter(url=>url==='mem-utils.js').length,1,'GL dependencies shared across endpoints');
  await anotherGL.terminate();
  f.failedImports.add('d3d9-fixed.js');
  const failedLoad=f.manager.createEndpoint({api:'neutral',name:'failed-load'});
  await assert.rejects(failedLoad.ready,/injected import failure/);
  await failedLoad.terminate();

  // Existing neutral command receipts use a separate per-port namespace.
  const c=f.manager.createEndpoint({api:'neutral',name:'c'});await c.ready;
  assert.strictEqual(f.importOrder.filter(url=>url==='d3d9-fixed.js').length,2,'failed dependency retried');
  assert.strictEqual(f.importOrder.filter(url=>url==='d3d9-shader.js').length,1,'successful predecessor retained across retry');
  const consumer=new Stream.WorkerConsumer(c);
  const command={version:Stream.VERSION,opcode:Stream.OPCODES.FENCE,deviceId:1,generation:1,sequence:1,payload:{kind:'echo',value:9}};
  const receipt=consumer.execute(command);await receipt.consumed;await receipt.completion;
  assert.strictEqual(await receipt.value,9);
  await consumer.cancel(1);assert.strictEqual(f.counts().retire,0);
  await b.terminate();await f.manager.stop();
  assert.deepStrictEqual(f.adopted,[1234]);
  assert.deepStrictEqual(f.counts(),{init:1,retire:1,terminated:1});
  await f.manager.stop();assert.strictEqual(f.counts().retire,1,'idempotent process shutdown');
  // Actual legacy decoder + production D3DIM worker adapter. A GPU call is
  // recorded rather than rendered, so the fixture isolates ordering and owns
  // the expected snapshot values independently of rasterization.
  {
  const l=fixture(true),port=l.manager.createEndpoint({api:'legacy',backend:'webgl'});
  await port.ready;
  const control=new Int32Array(new SharedArrayBuffer(64));
  const packet=new SharedArrayBuffer(16384),d=new DataView(packet);
  let offset=0;
  function drawRecord(state,vertex,primitive=4){
    const size=32+4096+96;
    [size,123,primitive,3,3,4096,96,0].forEach((v,i)=>d.setUint32(offset+i*4,v,true));
    d.setUint32(offset+32,state,true);d.setUint32(offset+32+4096,vertex,true);offset+=size;
  }
  drawRecord(11,21);drawRecord(12,22);
  port.postMessage({t:'init',control:control.buffer,buffers:[packet]});await tick();
  port.postMessage({t:'batch',index:0,seq:1,bytes:offset,commands:2,imageBase:0x400000});await tick();
  assert.strictEqual(Atomics.load(control,1),1,'batch consumption releases snapshots');
  assert.deepStrictEqual(l.events.filter(e=>e[0]==='gpu-draw'),[['gpu-draw',11,21],['gpu-draw',12,22]]);
  assert.strictEqual(l.events.filter(e=>e[0]==='gpu-fence').length,0,'no readback per batch');
  let gpuStats;
  port.onmessage=event=>{if(event.data.t==='stats')gpuStats=event.data.stats;};
  port.postMessage({t:'legacy-fence',seq:2});await tick();
  assert.strictEqual(Atomics.load(control,1),2);assert.strictEqual(gpuStats.draws,2);
  assert.strictEqual(l.events.filter(e=>e[0]==='gpu-fence').length,1,'explicit fence materializes GPU contents');
  port.postMessage({t:'legacy-call',seq:3,opcode:0x20004,wa:80});await tick();
  assert.strictEqual(Atomics.load(control,11),7,'clear returns result through shared control');
  assert.strictEqual(Atomics.load(control,1),3);
  offset=0;drawRecord(13,23,1);
  [32,123,456,0,0,0,0,1].forEach((v,i)=>d.setUint32(offset+i*4,v,true));offset+=32;
  port.postMessage({t:'batch',index:0,seq:4,bytes:offset,commands:2,imageBase:0x400000});await tick();
  const softwareIndex=l.events.findIndex(e=>e[0]==='software-draw');
  assert.strictEqual(l.events[softwareIndex-1][0],'gpu-fence','fallback materializes prior GPU writes');
  const flipIndex=l.events.findIndex(e=>e[0]==='flip');
  assert.strictEqual(l.events[flipIndex-1][0],'gpu-fence','DIB swap follows GPU materialization');
  port.postMessage({t:'legacy-close'});await tick();
  assert(l.events.some(e=>e[0]==='gpu-stop'));assert.strictEqual(l.counts().retire,0);
  await l.manager.stop();assert.strictEqual(l.counts().init,1);assert.strictEqual(l.counts().retire,1);
  let orphanTerminated=0;
  assert.throws(()=>new Manager({workerFactory:()=>({addEventListener(){},postMessage(){throw new Error('clone failed');},
    terminate(){orphanTerminated++;}}),module:{},memory:{},imageBase:0x400000}),/clone failed/);
  assert.strictEqual(orphanTerminated,1,'failed constructor terminates unowned worker');
  }
  console.log('PASS shared render worker: global completion order, ownership/bounds, frames, scoped errors, neutral receipts and single heap retirement');
})().catch(error=>{console.error(error);process.exit(1);});
