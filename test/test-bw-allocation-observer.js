'use strict';
const assert=require('assert');
const {installBwAllocationObserver:install}=require('../tools/bw-allocation-observer');
function fixture(){
 let bp=0,state={},calls=0,clears=0;
 const e={run(...args){calls++;if(state.error)throw state.error;return args[0];},
  get_bp_addr:()=>bp,set_bp:v=>{bp=v;},clear_bp:()=>{bp=0;clears++;},
  get_last_run_halt:()=>state.halt??5,guest_read32:p=>p===4096?32:p===4100?0:7};
 for(const n of ['eax','ebx','ecx','edx','esi','edi','ebp','esp','eip'])e['get_'+n]=()=>state[n]??0;
 for(const n of ['heap_ptr','heap_end','heap_sparse_ptr','heap_sparse_end','virtual_alloc_top'])e['get_'+n]=()=>0;
 e.get_free_list=()=>4096;
 const instance=Object.create({get exports(){return e;}}),ctx={},tick={batch:1};
 return {e,instance,ctx,tick,set:v=>{state=v;},calls:()=>calls,clears:()=>clears};
}
const f=fixture(),output=[],log=console.log;
console.log=line=>output.push(line);
try{
 assert(install(f.instance,f.e,f.ctx,f.tick).armed);
 for(const size of [231184,24,4096]){
  f.set({eip:0x009a81c9,edi:size,eax:42});
  assert.strictEqual(f.instance.exports.run(123),123);
  assert.strictEqual(f.ctx.bwAllocCapture,undefined);
  assert.strictEqual(f.e.get_bp_addr(),0x009a81c9);
 }
 f.set({eip:0x009a81c9,edi:0x00a58780,eax:0});f.tick.batch=9;
 assert.strictEqual(f.instance.exports.run(987),987);
 assert.strictEqual(f.calls(),4,'observer never reexecutes guest');
 assert.strictEqual(f.ctx.bwAllocCapture.skipped,3);
 assert.strictEqual(f.ctx.bwAllocCapture.regs.eax,0);
 assert.deepStrictEqual(f.ctx.bwAllocCapture.free,{count:1,total:32,largest:32,bad:null,truncated:false});
 assert.strictEqual(f.instance.exports,f.e);assert.strictEqual(f.e.get_bp_addr(),0);
 assert.strictEqual(output.length,1,'capture is durable before return');
 assert.strictEqual(f.ctx.bwAllocRestore,undefined);
 for(const mode of ['cancel','throw','success','readError']){
  const q=fixture();install(q.instance,q.e,q.ctx,q.tick);
  if(mode==='cancel'){const restore=q.ctx.bwAllocRestore;restore();restore();assert.strictEqual(q.clears(),1);}
  else if(mode==='throw'){const error=Error('guest trap');q.set({error});assert.throws(()=>q.instance.exports.run(1),e=>e===error);}
  else{q.set({eip:0x009a81c9,edi:0x00a58780,eax:88});if(mode==='readError')q.e.guest_read32=()=>{throw Error('read');};
   assert.strictEqual(q.instance.exports.run(22),22);assert(mode==='success'?q.ctx.bwAllocCapture.regs.eax===88:!!q.ctx.bwAllocCapture.error);}
  assert.strictEqual(q.instance.exports,q.e);assert.strictEqual(q.e.get_bp_addr(),0);
 }
 const conflict=fixture();conflict.e.set_bp(123);
 assert.throws(()=>install(conflict.instance,conflict.e,conflict.ctx,conflict.tick),/conflicts/);
 assert.strictEqual(conflict.e.get_bp_addr(),123);
 const sink=fixture();install(sink.instance,sink.e,sink.ctx,sink.tick);
 sink.set({eip:0x009a81c9,edi:0x00a58780});console.log=()=>{throw Error('log sink');};
 assert.strictEqual(sink.instance.exports.run(44),44,'diagnostic sink failure cannot change guest result');
 assert(sink.ctx.bwAllocCapture.logError);assert.strictEqual(sink.instance.exports,sink.e);
 console.log=line=>output.push(line);
 // Serialization must not capture module-local bindings used only by Node.
 const serialized=Function('return ('+install.toString()+')')(),q=fixture();
 serialized(q.instance,q.e,q.ctx,q.tick);q.ctx.bwAllocRestore();
 const regions={VIRTUAL_MAP_STATE:{base:64,size:16},VIRTUAL_MAP_TABLE:{base:128,size:64},
  VIRTUAL_BACKING_BASE:{base:1024,size:1024},HEAP_ARENAS:{base:256,size:80}};
 function mapped(options={}){
  const t=fixture();t.ctx._memory={buffer:new ArrayBuffer(4096)};
  const dv=new DataView(t.ctx._memory.buffer),put=(p,v)=>dv.setUint32(p,v,true);
  put(64,2);put(68,1792);put(72,0x40000000);
  // Unsorted, separated backing ranges: 128+256 active; gaps128+256+256.
  put(128,0x30000000);put(132,256);put(136,1536);
  put(144,0x30001000);put(148,128);put(152,1152);put(256,3);
  put(140,4);put(156,32);put(272,0x30000000);put(276,0x30000100);put(280,0x30000080);
  serialized(t.instance,t.e,t.ctx,t.tick,{regionMap:regions,layoutHash:'test-layout',...options});
  return {t,put,hit(){t.set({eip:0x009a81c9,edi:0x00a58780,eax:123});assert.strictEqual(t.instance.exports.run(99),99);assert.strictEqual(t.calls(),1);return t.ctx.bwAllocCapture;}};
 }
 const m=mapped(),capture=m.hit();
 assert.strictEqual(capture.virtualMaps.count,2);assert.strictEqual(capture.virtualMaps.capacity,4);
 assert.strictEqual(capture.virtualMaps.backingCursor,1792);assert.strictEqual(capture.virtualMaps.reservationTop,0x40000000);
 assert.strictEqual(capture.virtualMaps.activeBytes,384);assert.strictEqual(capture.virtualMaps.freeBackingBytes,640);
 assert.strictEqual(capture.virtualMaps.largestFreeBackingGap,256);
 assert.strictEqual(capture.layoutHash,'test-layout');assert.strictEqual(capture.virtualMaps.stateChanged,false);
 assert.strictEqual(capture.arenas.count,3);assert.strictEqual(capture.arenas.capacity,4);assert.strictEqual(capture.arenas.overflow,false);
 assert.deepStrictEqual(capture.virtualMaps.records,[[0x30000000,256,1536,4],[0x30001000,128,1152,32]]);
 assert.deepStrictEqual(capture.arenas.records,[[0x30000000,0x30000100,0x30000080],[0,0,0],[0,0,0]]);
 assert.deepStrictEqual(capture.arenas.unpublished,[1,2]);assert.strictEqual(capture.arenas.truncated,false);
 const corrupt=mapped();corrupt.put(64,0xffffffff);const broken=corrupt.hit();
 assert(broken.virtualMaps.error);assert.strictEqual(broken.regs.eax,123);assert.strictEqual(broken.heap.free_list,4096);
 assert.strictEqual(broken.virtualMaps.count,0xffffffff);
 assert.strictEqual(broken.arenas.count,3,'one optional section failure leaves other sections intact');
 const outOfPool=mapped();outOfPool.put(136,4000);assert(outOfPool.hit().virtualMaps.error);
 const missing=mapped({regionMap:{}}).hit();assert(missing.virtualMaps.error);assert.strictEqual(missing.regs.eax,123);
 const failedRead=mapped();failedRead.t.e.guest_read32=()=>{throw Error('guest read unavailable');};
 const partial=failedRead.hit();assert.strictEqual(partial.regs.eax,123);assert.strictEqual(partial.virtualMaps.activeBytes,384);
 const empty=mapped();empty.put(64,0);const noMaps=empty.hit();
 assert.strictEqual(noMaps.virtualMaps.freeBackingBytes,1024);assert.strictEqual(noMaps.virtualMaps.largestFreeBackingGap,1024);
 const overlap=mapped();overlap.put(152,1536);const shared=overlap.hit();
 assert.strictEqual(shared.virtualMaps.overlap,true);assert.strictEqual(shared.virtualMaps.freeBackingBytes,768);
 const noMemory=mapped();delete noMemory.t.ctx._memory;assert(noMemory.hit().virtualMaps.error);
 const arenaOverflow=mapped();arenaOverflow.put(256,0xffffffff);const capped=arenaOverflow.hit().arenas;
 assert(capped.overflow);assert(capped.truncated);assert.strictEqual(capped.records.length,4);
}finally{console.log=log;}
console.log('PASS targeted B&W allocation observer: filter, return values, durable capture, restoration');
