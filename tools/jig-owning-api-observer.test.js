'use strict';
const assert=require('node:assert/strict'),install=require('./jig-owning-api-observer');
const apis=require('../src/api_table.json');
const names=['GetOpenFileNameA','IVBDirectDraw7_DirectSlot008','IVBImageSurface7_GetSurfaceDesc','ExitProcess'];
for(const name of names)assert(apis.some(a=>a.name===name),name);
function setup(original=function(){return 91;}){
 const buffer=new ArrayBuffer(16384),view=new DataView(buffer),events=[];let count=0,esp=0x1000,eip=0x400100,eax=0;
 const ex={get_api_calls:()=>count,get_image_base:()=>0x400000,get_esp:()=>esp,get_eip:()=>eip,get_eax:()=>eax,get_yield_reason:()=>0};let actual=ex;
 const host={log:original,log_i32(){return 92;},log_api_exit(){return 93;}};const originals={...host};
 const obs=install({host,getExports:()=>actual,getBuffer:()=>buffer,g2w:g=>g>=0x200&&g<buffer.byteLength?g:0,apis,names,context:'test-owner',emit:r=>events.push(JSON.parse(JSON.stringify(r)))});
 const text=(name)=>{new Uint8Array(buffer,0x400,256).fill(0);new Uint8Array(buffer,0x400,name.length).set(Buffer.from(name));return[0x400,name.length];};
 const enter=(name,increment=true)=>{if(increment)count=(count+1)>>>0;const api=apis.find(a=>a.name===name);if(esp+40<buffer.byteLength){view.setUint32(esp,0x42e5b3,true);for(let i=0;i<(api?.nargs||0);i++)view.setUint32(esp+4+i*4,0,true);}return host.log(...text(name));};
 const exit=name=>{const a=apis.find(a=>a.name===name);esp+=4*(a.nargs+1);return host.log_api_exit();};
 return{host,obs,events,ex,originals,enter,exit,text,view,setESP:n=>esp=n,setCount:n=>count=n,foreign:()=>actual={...ex}};
}
const a=setup(function(...args){assert.equal(this,a.host);assert.deepEqual(args,a.text('ExitProcess'));return 17;});a.obs.arm();assert.equal(a.enter('ExitProcess'),17);assert.equal(a.exit('ExitProcess'),93);assert.equal(a.events.filter(e=>e.stage==='entry').length,1);assert(a.obs.snapshot().records[0].completed);assert.deepEqual(a.obs.close().restored,{log:true,log_i32:true,log_api_exit:true});assert.equal(a.host.log,a.originals.log);
const thrown=Error('original');const b=setup(()=>{throw thrown});b.obs.arm();assert.throws(()=>b.enter('ExitProcess'),e=>e===thrown);b.obs.close();
const c=setup();c.obs.arm();c.enter('ExitProcess');c.enter('ExitProcess',false);c.exit('ExitProcess');assert.equal(c.obs.snapshot().records.length,1);assert(c.obs.snapshot().records[0].completed);c.obs.close();
const d=setup();d.obs.arm();d.setESP(0xfffffffe);d.enter('ExitProcess');assert(d.obs.snapshot().errors.some(e=>e.includes('original range')));assert.equal(d.obs.snapshot().armed,false);assert.equal(d.obs.snapshot().records.length,0);d.obs.close();
const f=setup();f.obs.arm();f.foreign();assert.equal(f.enter('ExitProcess'),91);assert(f.obs.snapshot().errors.some(e=>e.includes('Owning exports changed')));f.obs.close();
const g=setup();g.obs.arm();const foreign=()=>99;g.host.log=foreign;const closed=g.obs.close();assert.equal(g.host.log,foreign);assert.equal(closed.restored.log,false);assert(closed.errors.some(e=>e.includes('Foreign import')));
const cap=setup();cap.obs.arm();for(let i=0;i<25;i++){cap.setESP(0x1000);cap.enter('ExitProcess');cap.exit('ExitProcess');}assert.equal(cap.obs.snapshot().records.length,24);assert.equal(cap.obs.snapshot().dropped.ExitProcess,1);cap.obs.close();
const h=setup();h.obs.arm();h.setCount(3);h.enter('ExitProcess');assert(h.obs.snapshot().ambiguous);h.obs.close();
console.log('PASS current metadata, exact receiver/arguments/return/throw, owner identity, original pointer bounds, debug-text pairing, caps/gaps and foreign cleanup');
