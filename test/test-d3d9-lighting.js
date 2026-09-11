'use strict';
const assert=require('assert'),{bootRenderHarness}=require('./render-helper'),{Device}=require('../lib/d3d9-software-backend');
const fixtures=require('./fixtures/d3d9-lighting-cases');
(async()=>{
 const {exports:e,memory}=await bootRenderHarness({fonts:'none'});
 let calls=0;
 const native={...e,d3d_fixed_bind_lighting(bundle,desc,lighting){
  const before=new Uint32Array(memory.buffer,bundle,8).slice(),words=new Uint32Array(memory.buffer,lighting,32);
  for(const [slot,value]of[[1,2],[2,9],[3,16],[4,3],[6,2],[8,3],[11,1],[13,1],[28,1]]){
   const old=words[slot];words[slot]=value;assert.strictEqual(e.d3d_fixed_bind_lighting(bundle,desc,lighting),0,'malformed lighting '+slot);
   assert.deepStrictEqual(new Uint32Array(memory.buffer,bundle,8),before,'failure retains original bundle');words[slot]=old;
  }
  calls++;return e.d3d_fixed_bind_lighting(bundle,desc,lighting);
 }};
 const d=new Device({getExports:()=>native,getMemory:()=>memory.buffer,width:4,height:4,fixedCacheBytes:0}),base=d.bytes;
 try{
  for(const c of fixtures.cases()){
   d.clear([0,0,0,1],1);assert.strictEqual(d.draw(c.draw),1,c.name);
   const b=d.present().pixels,p=[b[2],b[1],b[0],b[3]];
   p.forEach((n,i)=>assert(Math.abs(n-c.expected[i])<=1,`${c.name}: ${p} != ${c.expected}`));
   assert.strictEqual(d.bytes,base,'temporary allocation retirement');
  }
  for(const edit of[(d,s)=>s.lights[0].type=1,(d,s)=>s.specular=true,(d,s)=>s.lights[0].direction[0]=NaN,
   (d,s)=>d.attributes=d.attributes.filter(a=>a.usage!==3)]){
   const snapshot=fixtures.draw();edit(snapshot,snapshot.fixedFunction);assert.throws(()=>d.draw(snapshot));assert.strictEqual(d.bytes,base);
  }
 }finally{d.destroy();}
 assert(calls>=21,'direct native binder interception ran the malformed descriptor matrix');
 console.log('native directional lighting PASS '+calls+' pixel cases and malformed descriptor/retirement checks');
})().catch(e=>{console.error(e);process.exitCode=1;});
