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
}finally{console.log=log;}
console.log('PASS targeted B&W allocation observer: filter, return values, durable capture, restoration');
