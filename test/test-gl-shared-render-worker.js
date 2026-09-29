#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const {Bridge,D3DIMBridge}=require('../lib/gl-render-host');
const GL=require('../lib/gl-compat');
const Stream=require('../lib/gl-command-stream');
const RPC=require('../lib/guest-rpc');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function batch(buffer,at,opcode,aux=0){
  const v=new DataView(buffer,at,32);v.setUint32(0,32,true);v.setUint32(4,opcode,true);v.setUint32(8,aux,true);
  return Stream.memoryBatch(buffer,at,32);
}
async function hostProtocol(){
  const memory=new SharedArrayBuffer(4096),commands=[],copies=[],draws=[],events={},gate=deferred();
  const windows={8:{hwnd:8,w:2,h:2,clientRect:{left:0,top:0,right:2,bottom:2}}};
  const surface={width:2,height:2,rgbaRect(){return Uint8ClampedArray.from({length:16},(_,i)=>i);},
    writeRgbaRect(...args){copies.push(args);}};
  const port={ready:Promise.resolve(),addEventListener(type,fn){events[type]=fn;},
    request(msg){commands.push(msg);return gate.promise;},terminate(){this.stopped=true;}};
  let contextCount=-1,merged=0,repaints=0,enabled=true;
  const renderer={windows,getWindowCanvas(){},nextSurfaceWriteSeq:()=>19,
    mergeGpuLayerIntoBackCanvas(hwnd){assert.strictEqual(hwnd,8);merged++;},scheduleRepaint(){repaints++;}};
  const bridge=new Bridge({backend:'webgl',shouldUseRenderWorker:()=>enabled,renderer:()=>renderer,getGdiSurface:id=>id===5?{surface}:null,
    createRenderEndpoint(options){assert.deepStrictEqual(options,{api:'gl',backend:'webgl'});return port;},
    createCanvas:(width,height)=>({width,height,getContext:kind=>{assert.strictEqual(kind,'2d');return {drawImage:b=>draws.push(b)};}}),
    onContextCountChange:n=>{contextCount=n;}});
  const input=batch(memory,128,GL.CALL_INDEX.wglCreateContext,0x80000005);
  input.softwareFront=512;
  input.softwareConfig=new Int32Array(new SharedArrayBuffer(16));
  let settled=false;const done=bridge.replay(input,3).then(value=>{settled=true;return value;});
  await tick();assert(!settled,'caller retains command and query memory until request completion');
  assert.strictEqual(commands[0].memoryOffset,128);assert.strictEqual(commands[0].bytes,32);assert.strictEqual(commands[0].owner,3);
  assert.strictEqual(commands[0].softwareFront,512,'front descriptor belongs to the producing guest');
  assert.deepStrictEqual(commands[0].windows,[windows[8]]);
  assert.strictEqual(commands[0].surfaces[0].id,5);assert.strictEqual(commands[0].surfaces[0].pixels[15],15);
  const image={closed:false,close(){this.closed=true;}};
  events.message({data:{t:'frame',frame:{hwnd:8,width:2,height:2,bitmap:image}}});
  assert(image.closed);assert.strictEqual(draws[0],image);assert.strictEqual(merged,1);assert.strictEqual(repaints,1);
  assert.strictEqual(windows[8]._gpuFrameLayer.writeSeq,19);
  new DataView(memory).setUint32(2048,0x12345678,true); // worker query writes its leased shared output
  gate.resolve({value:6,contexts:1,producerConfig:[1,2,2,5],surfaces:[{id:5,x:0,y:0,width:1,height:1,pixels:new Uint8ClampedArray([9,8,7,255])}]});
  assert.strictEqual(await done,6);assert.strictEqual(contextCount,1);
  assert.deepStrictEqual([...input.softwareConfig],[1,2,2,5],'producer setup is published before its RPC lease ends');
  assert.strictEqual(new DataView(memory).getUint32(2048,true),0x12345678);
  assert.deepStrictEqual(Array.from(copies[0][4]),[9,8,7,255]);
  enabled=false;
  assert.strictEqual(await bridge.replay(input,3),6);
  assert.strictEqual(commands.length,2,'a live endpoint stays on its worker when the host predicate turns off');
  assert.strictEqual(bridge.local,null,'predicate change must not create a second local renderer');
  await bridge.close();assert(port.stopped);
  assert.throws(()=>bridge.replay(input,3),/closed/,'closed bridge cannot reopen through disabled-predicate fallback');
  assert(!windows[8]._gpuFrameLayer&&!windows[8]._dxFrameLayer,'close detaches owned presentation layers');
  const late={close(){this.closed=true;}};
  events.message({data:{t:'frame',frame:{hwnd:8,width:2,height:2,bitmap:late}}});
  assert(late.closed);assert.strictEqual(draws.length,1,'late frames cannot repaint a closed bridge');
}
async function brokerProtocol(){
  const memory={buffer:new SharedArrayBuffer(RPC.RPC_BASE+RPC.RPC_STRIDE*4)};
  const gate=deferred(),errors=[];let calls=0;
  const broker=RPC.createMainBroker(memory,{gpu_gl_batch(desc,owner){calls++;assert.strictEqual(owner,1);assert.strictEqual(desc.memoryOffset,512);return gate.promise;}},
    {gpu_gl_call:{params:['i32','i32','i32'],results:['i32']}},{onError:(name,error)=>errors.push([name,error])});
  const v=RPC.views(memory,1);Atomics.store(v.i32,RPC.SLOT.STATUS,RPC.STATUS_REQ);
  assert(broker.serveGlBatch({slot:1,memoryOffset:512,bytes:32}));
  assert.strictEqual(Atomics.load(v.i32,RPC.SLOT.STATUS),RPC.STATUS_REQ);
  assert(!broker.serveGlBatch({slot:1,memoryOffset:512,bytes:32}));assert(!broker.serveRpc(1));assert.strictEqual(calls,1);
  new DataView(memory.buffer).setUint32(1024,17,true);gate.resolve(73);await tick();
  assert.strictEqual(Atomics.load(v.i32,RPC.SLOT.STATUS),RPC.STATUS_RESP);assert.strictEqual(v.i32[RPC.SLOT.RESULT],73);
  assert.strictEqual(new DataView(memory.buffer).getUint32(1024,true),17);assert.strictEqual(errors.length,0);
}
function bitmapWorkerCoherence(){
  // Exercise the production endpoint surface adapter without a GPU: a bitmap
  // publish followed by a seed in one batch must read the just-written bytes.
  let observed;
  class FakeGL{
    constructor(options){this.options=options;this.contexts=new Map();}
    replay(){const s=this.options.getGdiSurface(5).surface;
      s.writeRgbaRect(1,0,1,1,new Uint8ClampedArray([10,20,30,40]));observed=s.rgbaRect(0,0,2,1);return 9;}
  }
  const context={OpenGLCompat:{OpenGLHostBridge:FakeGL},GLCommandStream:Stream,Uint8ClampedArray};
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/gl-render-worker'),'utf8'),context);
  const adapter=context.GLRenderWorker.create({instance:{exports:{}},memory:{buffer:new SharedArrayBuffer(128)},backend:'webgl',sendFrame(){}});
  const result=adapter.execute({memoryOffset:0,bytes:0,surfaces:[{id:5,width:2,height:1,pixels:new Uint8ClampedArray([1,2,3,4,5,6,7,8])}]});
  assert.strictEqual(result.value,9);assert.deepStrictEqual(Array.from(observed),[1,2,3,4,10,20,30,40]);
  assert.deepStrictEqual(Array.from(result.surfaces[0].pixels),[10,20,30,40]);adapter.destroy();
}
async function legacyProxy(){
  let calls=0;const gate=deferred();const port={ready:gate.promise,request:async msg=>{calls++;assert.strictEqual(msg.wa,128);return 1;},terminate(){this.stopped=true;}};
  const bridge=new D3DIMBridge({createRenderEndpoint:()=>port,backend:'software'});
  const done=bridge.call(0x20000,128);await tick();assert.strictEqual(calls,0);gate.resolve();assert.strictEqual(await done,1);
  await bridge.close();assert(port.stopped);assert.throws(()=>bridge.call(0x20000,128),/closed/);
}
function legacyWorkerCleanup(){
  let stops=0;
  class FakeGPU{stop(){stops++;}}
  const context={D3DIMGpu:{D3DIMGpu:FakeGPU}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/d3dim-render-worker'),'utf8'),context);
  const adapter=context.D3DIMRenderWorker.create({instance:{exports:{}},memory:{buffer:new SharedArrayBuffer(128)},backend:'webgl'});
  adapter.destroy();assert.strictEqual(stops,1,'legacy GPU teardown flushes and releases resources through stop()');
}
(async()=>{await hostProtocol();await brokerProtocol();bitmapWorkerCoherence();await legacyProxy();legacyWorkerCleanup();
  console.log('GL shared render worker protocol PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
