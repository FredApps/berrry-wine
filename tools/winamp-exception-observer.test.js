'use strict';
const assert=require('node:assert/strict');
const {createWinampExceptionObserver}=require('./winamp-exception-observer');
const memory={buffer:new ArrayBuffer(0x10000)}, view=new DataView(memory.buffer);
const addresses=new Map(), translate=ga=>addresses.get(ga) ?? 0xf0;
let next=0x1000;
function word(ga,value) {for(let i=0;i<4;i++)addresses.set(ga+i,next+i);view.setUint32(next,value,true);next+=4;}
word(0x100,0x200);word(0x200,0xffffffff);word(0x204,0x401000);
word(0x208,0x446af8);word(0x20c,1);word(0x300,0x4405fa);
word(0x458c78,0x500);word(0x500+0x92c,0x10029a90);
let clock=0, calls=[], events=[];
const token={}, host={log(...a){calls.push(['log',this,a]);return token;},log_i32(v){calls.push(['int',this,v]);return 73;},log_api_exit(){throw token;}};
const originals={...host};
const ex={get_image_base:()=>0x400000,get_eip:()=>0x10012345,get_esp:()=>0x300,
  get_fs_base:()=>0x100,get_eax:()=>9};
const observer=createWinampExceptionObserver({host,getExports:()=>ex,memory,translate,emit:e=>events.push(e),now:()=>clock,maxEvents:50,maxMs:20});
new Uint8Array(memory.buffer,0x800,4).set([84,101,115,116]);
const before=Buffer.from(memory.buffer).toString('hex');
observer.activate({startAddr:0x432bc0,tid:1});
assert.equal(host.log(0x800,4),token);assert.equal(events.length,0);
observer.activate({startAddr:0x440330,tid:4});
assert.equal(host.log(0x800,4),token);
assert.equal(host.log_i32(0xcae8c000),73);
host.log_i32(0xc0000094);host.log_i32(0x10012345);
const marker=events.find(e=>e.kind==='exception-marker');
assert.equal(marker.state.chain[0].words[2],0x446af8);
assert.equal(marker.state.callbacks[1],0x10029a90);
assert.equal(events.find(e=>e.kind==='api').returnAddress,0x4405fa);
assert.equal(events.find(e=>e.kind==='exception-code').value,0xc0000094);
assert.throws(()=>host.log_api_exit(),e=>e===token);
const foreign=()=>{};host.log=foreign;
const summary=observer.finish();assert.deepEqual(summary.foreign,['log']);
assert.equal(host.log,foreign);assert.equal(host.log_i32,originals.log_i32);
assert.equal(calls[1][1],host);assert.equal(summary.dropped,0);
assert.equal(memory.buffer.byteLength,0x10000);
assert.equal(Buffer.from(memory.buffer).toString('hex'),before);
console.log('PASS owning-import observer: original receiver/results/errors, thread scope, exception sequence, read-only sparse snapshot, caps, foreign wrapper restoration');

for (const cap of ['events','deadline']) {
  let reads=0, snapshots=0, forwarded=0, time=0;
  const output=[], receiver={};
  const cappedHost={log(){forwarded++;assert.equal(this,receiver);return token;},
    log_i32(){forwarded++;assert.equal(this,receiver);return 73;},
    log_api_exit(){forwarded++;assert.equal(this,receiver);throw token;}};
  const original={...cappedHost};
  const capped=createWinampExceptionObserver({host:cappedHost,
    getExports:()=>{snapshots++;return ex;},memory,
    translate:ga=>{reads++;return translate(ga);},emit:e=>output.push(e),
    now:()=>time,maxEvents:cap==='events'?2:512,maxMs:20});
  capped.activate({startAddr:0x440330,tid:4});
  // Keep references too: a foreign wrapper can retain the observer wrapper.
  const retained={...cappedHost};
  retained.log_i32.call(receiver,0xcae8c000);
  if(cap==='events') retained.log_i32.call(receiver,0xc0000094);
  else {time=20;retained.log_i32.call(receiver,0xc0000094);}
  assert.equal(output.filter(e=>e.kind==='cap').length,1);
  const baseline={reads,snapshots,outputs:output.length,forwarded};
  for(let i=0;i<3;i++) {
    assert.equal(retained.log.call(receiver,0x800,4),token);
    for(const value of [0xcae8c000,0xc0000005,0x10012345])
      assert.equal(retained.log_i32.call(receiver,value),73);
    assert.throws(()=>retained.log_api_exit.call(receiver),e=>e===token);
  }
  capped.finish();capped.activate({startAddr:0x440330,tid:4});
  assert.equal(reads,baseline.reads);assert.equal(snapshots,baseline.snapshots);
  assert.equal(output.length,baseline.outputs);assert.equal(forwarded,baseline.forwarded+15);
  for(const name of Object.keys(original))assert.equal(cappedHost[name],original[name]);
  assert.equal(Buffer.from(memory.buffer).toString('hex'),before);
}
console.log('PASS real observer event/deadline closure: zero post-cap reads/snapshots/output, one terminal cap, exact retained-wrapper forwarding and restoration');
