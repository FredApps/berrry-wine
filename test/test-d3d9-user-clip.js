'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper');
const {Device}=require('../lib/d3d9-software-backend');
const {Device:WebGLDevice}=require('../lib/d3d9-backend');
for(const mask of [1,32,63,64,undefined])
 assert.throws(()=>WebGLDevice.prototype.draw.call({get gpu(){throw Error('unexpected GPU access');}},
  {userClipPlanes:{mask}}),/WebGL user clip planes are not implemented/);
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'}),scheduled=[],counts=[];
 const native={...e,d3d_software_create_deferred_clipped(desc,...args){
  counts.push(new Uint32Array(memory.buffer,desc,32)[12]);return e.d3d_software_create_deferred_clipped(desc,...args);
 }};
 const device=new Device({width:8,height:8,getExports:()=>native,getMemory:()=>memory.buffer,schedule:fn=>scheduled.push(fn)});
 const baseline=device.bytes;
 const vs=new Uint32Array([0xfffe0101,81,0xa00f0000,0x3f800000,0,0,0x3f800000,
  1,0xc00f0000,0x90e40000,1,0xd00f0000,0xa0e40000,65535]);
 const ps=new Uint32Array([0xffff0101,1,0x800f0000,0x90e40000,65535]);
 const snapshot=(mask=1,count=1)=>({primitive:4,primitiveCount:count,stride:16,
  vertices:new Uint8Array(new Float32Array([-1,1,.5,1,3,1,.5,1,-1,-3,.5,1]).buffer),
  indices:Uint16Array.from({length:count*3},(_,i)=>i%3),
  attributes:[{register:0,usage:0,usageIndex:0,type:3,offset:0}],vertexShader:vs,pixelShader:ps,
  userClipPlanes:{space:'clip',mask,planes:Float32Array.from({length:24},(_,i)=>i%4===0?1:0)},
  state:{zenable:false,zwrite:false,cull:1},textures:[]});
 const pixel=(bytes,x,y)=>[...bytes.slice((y*8+x)*4,(y*8+x)*4+4)];
 try{
  for(const mask of [1,2,4,8,16,32,63]){
   const before=device.readPixels(),source=snapshot(mask,211),start=counts.length;
   const task=device.drawAsync(source);
   source.userClipPlanes.planes.fill(0);source.userClipPlanes.mask=0;source.vertices.fill(0);
   while(scheduled.length)scheduled.shift()();await task;
   assert.deepStrictEqual(counts.slice(start),[630,3],'large guest draw split into clipped native batches');
   const pixels=device.readPixels();
   assert.deepStrictEqual(pixel(pixels,1,1),pixel(before,1,1),'clipped samples stay untouched');
   assert.deepStrictEqual(pixel(pixels,6,1),[0,0,255,255],'retained samples render from immutable data');
   assert.strictEqual(device.bytes,baseline,'clip/setup payload retires');
  }
  for(const patch of [{mask:64},{mask:-1},{mask:1.5},{space:'world'},{planes:new Float32Array(23)},
   {planes:new Float32Array(24).fill(NaN)},{planes:new Float32Array(24).fill(Infinity)}]){
   const source=snapshot(),before=device.readPixels();Object.assign(source.userClipPlanes,patch);
   assert.throws(()=>device.draw(source),/clip-plane/);
   assert.deepStrictEqual(device.readPixels(),before);assert.strictEqual(device.bytes,baseline);
  }
  const fixed=snapshot();fixed.vertexShader=null;
  assert.throws(()=>device.draw(fixed),/world-space fixed-function/);
  const before=device.readPixels(),task=device.drawAsync(snapshot(63,211));
  scheduled.shift()();device.cancel();await assert.rejects(task,/cancel/);
  while(scheduled.length)scheduled.shift()();
  assert.deepStrictEqual(device.readPixels(),before);assert.strictEqual(device.bytes,baseline);
 }finally{device.destroy();}
 assert.strictEqual(device.bytes,0);
 console.log('PASS software user-plane queue: six planes, 211-triangle splits, immutable snapshots, rejection/cancellation and retirement');
})().catch(error=>{console.error(error);process.exitCode=1;});
