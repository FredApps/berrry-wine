'use strict';
const assert=require('assert'),{compileSrcWasm}=require('./compile-src'),{Device}=require('../lib/d3d9-software-backend'),sigs=require('../lib/host-import-sigs.generated.json').sigs,cases=require('./fixtures/d3d9-triangle-edge-cases');
(async()=>{const module=await WebAssembly.compile(compileSrcWasm()),memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true}),host={memory};
 for(const[name,sig]of Object.entries(sigs))host[name]=sig.results?.length?()=>0:()=>{};
 const e=(await WebAssembly.instantiate(module,{host})).exports;e.d3dim_worker_init(0x400000);let count=0;
 for(const clip of[false,true])for(const[name,points,width,height,viewport]of cases.cases){const d=new Device({getExports:()=>e,getMemory:()=>memory.buffer,width,height});
  try{d.clear([0,0,0,1],1,1,null,null);d.draw(cases.draw(points,width,height,clip,viewport));const bytes=d.readColor(null).pixels;
   assert.deepStrictEqual(Array.from({length:width*height},(_,i)=>bytes[i*4]>127),cases.mask(points,width,height),name+'/'+clip);count++;
  }finally{d.destroy();}
 }
 for(const clip of[false,true]){const d=new Device({getExports:()=>e,getMemory:()=>memory.buffer,width:8,height:8});
  try{for(const {viewport,points}of cases.viewportSequence()){
   d.clear([0,0,0,1],1,1,null,null);d.draw(cases.draw(points,8,8,clip,viewport));const bytes=d.readColor(null).pixels;
   assert.deepStrictEqual(Array.from({length:64},(_,i)=>bytes[i*4]>127),cases.mask(points,8,8),'same-device viewport sequence/'+clip);count++;
  }}finally{d.destroy();}
 }
 for(const c of cases.clippingCases())for(const reverse of[false,true]){
  const d=new Device({getExports:()=>e,getMemory:()=>memory.buffer,width:8,height:8});
  try{const snapshot=cases.draw([[0,0],[8,0],[0,8]],8,8,true),vertices=reverse?c.vertices.slice().reverse():c.vertices;
   snapshot.vertices=new Uint8Array(new Float32Array(vertices.flat()).buffer);
   d.clear([0,0,0,1],1,1,null,null);d.queryBegin(1);d.draw(snapshot);const samples=d.queryEnd(1),bytes=d.readColor(null).pixels;
   const expected=cases.polygonMask(c.polygon,8,8);
   assert.deepStrictEqual(Array.from({length:64},(_,i)=>bytes[i*4]>127),expected,'analytic clip polygon '+c.name+'/'+reverse);
   assert.strictEqual(samples.samplesLow,expected.filter(Boolean).length,'clip fan has single ownership '+c.name+'/'+reverse);
   assert.strictEqual(samples.samplesHigh,0);count++;
  }finally{d.destroy();}
 }console.log('Native triangle edge masks PASS '+count);
})().catch(e=>{console.error(e);process.exitCode=1;});
