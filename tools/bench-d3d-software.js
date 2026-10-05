#!/usr/bin/env node
'use strict';
// Diagnostic instrumentation only. Both arms use the shipped Device, queue,
// WAT module and (for the worker arm) unmodified production worker entrypoint.
const assert=require('assert');
const os=require('os');
const crypto=require('crypto');
const {Worker,isMainThread,parentPort}=require('worker_threads');
const {Device}=require('../lib/d3d9-software-backend');
const {CommandQueue,WorkerConsumer,OPCODES:OP}=require('../lib/d3d-command-stream');
function instrumentation(){
  let stats;
  const reset=()=>{stats={native:{},timerCalls:0,timerWaitMs:0,completedDraws:0};};reset();
  const cache=new WeakMap();
  function wrap(exports){
    if(cache.has(exports))return cache.get(exports);
    const result={...exports};
    for(const name of ['d3d_fixed_compile','d3d_shader_ir_compile','d3d_shader_vm_compile','d3d_software_create','d3d_software_step']){
      result[name]=(...args)=>{
        const begin=performance.now();const value=exports[name](...args),elapsed=performance.now()-begin;
        const entry=stats.native[name]||(stats.native[name]={calls:0,ms:0});entry.calls++;entry.ms+=elapsed;
        if(name==='d3d_software_step'&&value===0)stats.completedDraws++;
        return value;
      };
    }
    cache.set(exports,result);return result;
  }
  return {wrap,reset,read:()=>structuredClone(stats),timer(ms){stats.timerCalls++;stats.timerWaitMs+=ms;}};
}
if(!isMainThread){
  const metrics=instrumentation(),originalExports=Device.prototype.exports;
  Device.prototype.exports=function(){return metrics.wrap(originalExports.call(this));};
  const originalTimer=global.setTimeout;
  global.setTimeout=function(callback,delay,...args){
    if(delay!==0)return originalTimer(callback,delay,...args);
    const begin=performance.now();
    return originalTimer(()=>{metrics.timer(performance.now()-begin);callback(...args);},delay);
  };
  parentPort.on('message',message=>{
    if(message.t==='bench-metrics'){
      if(message.reset)metrics.reset();
      parentPort.postMessage({t:'bench-metrics',id:message.id,stats:metrics.read()});
    }
  });
  require('../lib/d3d-render-worker');
}else{
  const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=')[1];
  const draws=Number(arg('draws')||3),maxSeconds=Number(arg('max-seconds')||45);
  assert(Number.isInteger(draws)&&draws>=1&&draws<=20);
  assert(Number.isFinite(maxSeconds)&&maxSeconds>=5&&maxSeconds<=180);
  function snapshot(){
    const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const vertices=new Float32Array([-1,1,.5,1,1,0,0,1, 1,1,.5,1,1,0,0,1,
      -1,-1,.5,1,1,0,0,1, 1,-1,.5,1,1,0,0,1]);
    return {primitive:5,primitiveCount:2,stride:32,vertices:new Uint8Array(vertices.buffer),
      attributes:[{register:0,usage:0,usageIndex:0,type:3,offset:0},{register:5,usage:10,usageIndex:0,type:3,offset:16}],
      vertexShader:null,pixelShader:null,textures:[],
      state:{zenable:false,cull:1,blend:false,alphaTest:true,alphaFunc:7,alphaRef:1},
      fixedFunction:{lighting:false,fog:false,specular:false,alphaTest:true,alphaFunc:7,alphaRef:1,
        world:identity(),view:identity(),projection:identity(),textureFactor:0xffffffff,
        stages:[{colorOp:4,colorArg1:2,colorArg2:0,alphaOp:2,alphaArg1:2,alphaArg2:0,constant:0xffffffff,transformFlags:0,texCoordIndex:0},{colorOp:1}]}};
  }
  let requestId=0;
  function metrics(worker,reset=false){return new Promise((resolve,reject)=>{
    const id=++requestId,timer=setTimeout(()=>{worker.off('message',receive);reject(new Error('metrics deadline'));},5000);
    function receive(message){if(message.t==='bench-metrics'&&message.id===id){clearTimeout(timer);worker.off('message',receive);resolve(message.stats);}}
    worker.on('message',receive);worker.postMessage({t:'bench-metrics',id,reset});
  });}
  (async()=>{
    const begin=performance.now(),deadline=begin+maxSeconds*1000,loadStart=os.loadavg();
    const check=()=>{if(performance.now()>deadline)throw new Error('benchmark wall-clock bound reached');};
    const compileStart=performance.now();
    const bytes=require('../test/compile-src').compileSrcWasm();
    const watCompileMs=performance.now()-compileStart;
    const moduleStart=performance.now(),module=await WebAssembly.compile(bytes),wasmCompileMs=performance.now()-moduleStart;
    const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
    const sigs=require('../lib/host-import-sigs.generated.json').sigs,host={memory};
    for(const [name,sig]of Object.entries(sigs))host[name]=sig.results?.length?()=>0:()=>{};
    const instanceStart=performance.now(),e=(await WebAssembly.instantiate(module,{host})).exports;
    e.d3dim_worker_init(0x400000);const instantiateMs=performance.now()-instanceStart;
    const rounds=[];let referenceHash;
    for(const mode of ['direct','worker'])for(const budget of [256,4096]){
      check();const measured=instrumentation();let worker,consumer,device,queue,workerReadyMs=0;
      if(mode==='direct'){
        device=new Device({getExports:()=>measured.wrap(e),getMemory:()=>memory.buffer,width:800,height:600,quadBudget:budget});
        queue=new CommandQueue({deviceId:1,consumer:device});
      }else{
        const ready=performance.now();worker=new Worker(__filename);
        consumer=new WorkerConsumer(worker,{module,memory,sigs,imageBase:0x400000,reclaimHeap:head=>e.d3d_render_adopt_free_list(head)});
        await consumer.ready;workerReadyMs=performance.now()-ready;
        queue=new CommandQueue({deviceId:1,consumer});
        await queue.submit(OP.RESOURCE_CREATE,{kind:'device',width:800,height:600,quadBudget:budget}).value;
      }
      try{
        // Report warm-up separately; compilation above is never charged to draw timing.
        const warm=performance.now();queue.submit(OP.DRAW,snapshot());await queue.fence();const warmupMs=performance.now()-warm;
        if(worker)await metrics(worker,true);else measured.reset();
        const start=performance.now();
        for(let i=0;i<draws;i++){check();queue.submit(OP.DRAW,snapshot());await queue.fence();}
        const drawElapsedMs=performance.now()-start;
        const stats=worker?await metrics(worker):measured.read();
        const readStart=performance.now(),frame=await queue.submit(OP.PRESENT).value,readbackMs=performance.now()-readStart;
        const hash=crypto.createHash('sha256').update(frame.pixels).digest('hex');
        if(referenceHash)assert.strictEqual(hash,referenceHash,'direct and worker canonical pixels differ');else referenceHash=hash;
        assert.strictEqual(stats.completedDraws,draws);
        const nativeMs=Object.values(stats.native).reduce((sum,entry)=>sum+entry.ms,0);
        const result={mode,quadBudget:budget,width:800,height:600,workerReadyMs,warmupMs,drawElapsedMs,readbackMs,
          nativeMs,unattributedMs:drawElapsedMs-nativeMs-stats.timerWaitMs,...stats};
        rounds.push(result);process.stdout.write(JSON.stringify({round:result})+'\n');
      }finally{
        if(device)device.destroy();
        if(consumer){queue.submit(OP.RESOURCE_RELEASE,{kind:'device'});await queue.fence();await consumer.cancel();}
      }
    }
    process.stdout.write(JSON.stringify({summary:{watCompileMs,wasmCompileMs,instantiateMs,totalMs:performance.now()-begin,
      loadStart,loadEnd:os.loadavg(),drawsCompleted:rounds.reduce((sum,r)=>sum+r.completedDraws,0),referenceHash,
      note:'Node production worker; browser timer clamping is not measured. Instrumented timings include profiling overhead.'}})+'\n');
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
