'use strict';
const assert=require('node:assert/strict'),{installWorkerInputReceipt}=require('../tools/worker-input-receipt');
const memory={buffer:new ArrayBuffer(8192)},view=new DataView(memory.buffer),host={},seen=[],rows=[];
let contexts=0,time=100,flags=0,tid=1,translateExpiry=false,expiredBufferReads=0;
for(const name of ['log','log_api_exit','check_input','check_input_hwnd','check_input_lparam','check_input_wparam'])host[name]=function(...args){assert.equal(this,host);seen.push({name,args});if(args[0]==='throw')throw Error('original import');return name==='check_input'?0x10201:17;};
const originals={...host},clock=Date.now;Date.now=()=>time;
const ex={get_current_thread_id:()=>tid,get_eip:()=>0x7500000,get_esp:()=>0x600,get_eax:()=>1,
  get_capture_hwnd:()=>flags?0x10004:0,get_focus_hwnd:()=>0x10004,
  button_get_flags:()=>flags,ctrl_get_id:()=>1559,ctrl_get_wh:()=>(20<<16)|195,
  wnd_get_proc_export:()=>0x57e790,wnd_get_parent:()=>0x10002,get_post_queue_count:()=>0,
  guest_to_wasm:p=>{if(translateExpiry)time+=8000;return p;}};
const context=()=>{contexts++;return{exports:ex,memory:{get buffer(){if(time>=8100)expiredBufferReads++;return memory.buffer;}},slot:0}};
function api(name,stack){new Uint8Array(memory.buffer,0x200,128).fill(0);new Uint8Array(memory.buffer,0x200,name.length).set(Buffer.from(name));stack.forEach((v,i)=>view.setUint32(0x600+i*4,v,true));const before=Buffer.from(memory.buffer),result=host.log(0x200,name.length);assert.deepEqual(Buffer.from(memory.buffer),before,'API observer performs no guest write');return result;}
try{
 const observer=installWorkerInputReceipt(host,context,row=>rows.push(row));
 assert.equal(host.log(0x200,5),17);assert.equal(contexts,0,'unarmed import performs no context/CPU/memory read');
 assert.equal(host.check_input(),0x10201);assert.equal(contexts,0);
 observer.arm(0x10004);
 const bytesBefore=Buffer.from(memory.buffer);
 assert.equal(api('CallWindowProcA',[0x57e7ff,0xffff0002,0x10004,0x201,1,0x000a005c]),17);
 assert.equal(rows[0].kind,'api-entry');assert.equal(rows[0].state.button.flags,0);
 assert.deepEqual(rows[0].stack,[0x57e7ff,0xffff0002,0x10004,0x201,1,0x000a005c]);
 flags=0x601;host.log_api_exit();
 assert.equal(rows[1].state.button.flags,0x601);assert.equal(rows[1].state.capture,0x10004);
 assert.equal(rows[1].callbackReturned,'unmeasured','dispatch exit never invents a guest callback return');
 assert.equal(host.check_input_hwnd(0),17);assert.equal(rows.at(-1).state.tid,1);
 assert.throws(()=>host.check_input_hwnd('throw'),/original import/);
 assert.equal(seen.filter(r=>r.name==='check_input_hwnd'&&r.args[0]==='throw').length,1);
 // Read the actual MSG handed to DispatchMessage, not a separately sampled queue.
 [0x10002,0x111,1559,0x10004,123,316,213].forEach((v,i)=>view.setUint32(0x800+i*4,v,true));
 api('DispatchMessageA',[0x401234,0x800]);host.log_api_exit();
 assert.deepEqual(rows.find(r=>r.name==='DispatchMessageA'&&r.kind==='api-entry').message,[0x10002,0x111,1559,0x10004,123,316,213]);
 // Observing imports never writes guest memory; only the test changes its fixtures.
 const bytesAfterFixtures=Buffer.from(memory.buffer),rowCount=rows.length;
 translateExpiry=true;api('CallWindowProcA',[0x57e7ff,0xffff0002,0x10004,0x202,0,0x000a005c]);
 const afterExpiry=contexts;host.check_input_lparam();host.log_api_exit();
 assert.equal(contexts,afterExpiry,'deadline crossing inside translator blocks every later read');
 assert.equal(rows.length,rowCount,'expired snapshot is not emitted');
 assert.equal(expiredBufferReads,0,'deadline inside translator prevents access to the memory buffer');
 assert.equal(bytesBefore.length,bytesAfterFixtures.length);
 const beforeClose=Buffer.from(memory.buffer),receipt=observer.close();assert(receipt.closed);
 assert.throws(()=>observer.arm(0x10004),/closed/);
 assert.deepEqual(Buffer.from(memory.buffer),beforeClose,'close does not touch guest state');
 for(const n of Object.keys(originals))assert.equal(host[n],originals[n]);
 // A later hook owner survives shutdown; row cap forwards all original imports.
 translateExpiry=false;time=100;
 const capped=installWorkerInputReceipt(host,context,()=>{});capped.arm(0x10004);
 const initialCalls=seen.length;
 for(let i=0;i<300;i++)assert.equal(host.check_input(),0x10201);
 assert.equal(seen.length-initialCalls,300);
 assert.equal(capped.close().rows,256);
 const foreign=installWorkerInputReceipt(host,context,()=>{}),replacement=()=>91;
 host.log=replacement;foreign.close();assert.equal(host.log,replacement);
 const incomplete={log:()=>1};assert.throws(()=>installWorkerInputReceipt(incomplete,context,()=>{}),/missing import/);assert.equal(incomplete.log(),1,'failed install does not leave partial hooks');
 console.log('PASS coherent owning import/API receipts: inactive zero reads; original receiver/results/errors once; native flags/MSG snapshots; deadline/row caps; no guest writes; foreign hook preserved');
}finally{Date.now=clock;}
