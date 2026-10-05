#!/usr/bin/env node
'use strict';
// Pipelined Present on the asynchronous software path: the first Present
// blocks on itself, the one after it returns at once, and every later Present
// leaves its own frame in flight while the guest parks on the previous one,
// whose pixels land at the address that previous Present named. Reset and
// release drop the frame in flight; a failed frame surfaces at the next call.
const assert=require('assert');
const {Bridge}=require('../lib/d3d9-host');
const {OPCODES:OP}=require('../lib/d3d-command-stream');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const memory=new ArrayBuffer(65536),v=new DataView(memory),commands=[],gates=[];
  const desc=64,program=1024,vertices=30000,target=32000;
  const set=(p,n)=>v.setUint32(p,n,true);
  [7,program,target,2,2,1,4,1,vertices,16].forEach((n,i)=>set(desc+i*4,n));
  set(program+12,0x42);v.setFloat32(program+1696,1,true);
  set(program+21784,0x80000000);
  const initialized=deferred();
  // Ordered, like the worker proxy: the next command is handed over without
  // waiting for the previous completion.
  const consumer={ready:initialized.promise,ordered:true,execute(command){
    commands.push(command);const gate=deferred();gates.push(gate);
    return {completion:gate.promise,value:gate.promise};
  },async cancel(){for(const gate of gates)gate.reject(new Error('cancelled'));}};
  const bridge=new Bridge({backend:'software',createSoftwareWorker:()=>consumer,
    getMemory:()=>memory,guestToWasm:p=>p});
  const advance=async value=>{const gate=gates.shift();assert(gate,'command is executing');gate.resolve(value);await tick();};
  const last=()=>commands[commands.length-1];
  const dest=()=>Array.from(new Uint8Array(memory,target,16));
  const frame=n=>new Uint8Array(16).fill(n);
  const draw=async()=>{
    // Frames already in flight keep their gates: the consumer takes the next
    // command without waiting for the previous completion, so only resolve
    // what the bridge queued for this call, until the draw's own token is ready.
    const held=gates.length;
    const token=bridge.call(0x30001,desc,0);
    if(!initialized.settled){initialized.settled=true;initialized.resolve();await tick();}
    if(token===1){
      // Deferred, as in production: the draw's own gate opens whenever.
      for(let i=0;i<8&&gates.length<=held;i++)await tick();
      assert(gates.length>held,'draw reached the consumer');
      while(gates.length>held){gates.splice(held,1)[0].resolve(1);await tick();}
      return;
    }
    assert(token<=-2);
    let done=false;bridge.wait(token).then(()=>{done=true;});
    for(let i=0;i<16&&!done;i++){if(gates.length>held)gates.splice(held,1)[0].resolve(1);await tick();}
    assert(done,'draw completed');assert.strictEqual(bridge.call(0x30007,0,token),1);
  };
  const poll=async token=>{await bridge.wait(token);return bridge.call(0x30007,0,token);};
  return {bridge,desc,commands,gates,advance,last,dest,frame,draw,poll,memory,set};
}
(async()=>{
  const f=fixture();
  await f.draw();
  // Present 1 blocks on itself: nothing older exists to show.
  const first=f.bridge.call(0x30002,f.desc,0);assert(first<=-2,'first Present parks');
  await tick();assert.strictEqual(f.last().opcode,OP.PRESENT);
  await f.advance({pixels:f.frame(1)});
  assert.strictEqual(await f.poll(first),0);assert.deepStrictEqual(f.dest(),Array.from(f.frame(1)));
  // Present 2 has nothing older in flight and returns at once; its frame is
  // now the one in flight.
  await f.draw();
  assert.strictEqual(f.bridge.call(0x30002,f.desc,0),0,'second Present does not park');
  await tick();assert.strictEqual(f.last().opcode,OP.PRESENT);assert.strictEqual(f.gates.length,1,'frame 2 is in flight');
  assert.deepStrictEqual(f.dest(),Array.from(f.frame(1)),'nothing published yet');
  // Present 3 parks on frame 2, not on itself.
  await f.draw();
  const third=f.bridge.call(0x30002,f.desc,0);assert(third<=-2,'third Present parks');
  await tick();assert.strictEqual(f.gates.length,2,'frames 2 and 3 are both in flight');
  let ready=false;f.bridge.wait(third).then(()=>{ready=true;});await tick();assert(!ready,'waits for frame 2');
  await f.advance({pixels:f.frame(2)});await tick();assert(ready,'frame 2 completion releases the guest');
  assert.deepStrictEqual(f.dest(),Array.from(f.frame(1)),'publication waits for the guest poll');
  assert.strictEqual(await f.poll(third),0);
  assert.deepStrictEqual(f.dest(),Array.from(f.frame(2)),'frame 2 lands at its own address');
  assert.strictEqual(f.gates.length,1,'frame 3 stays in flight');
  // A different render target: each Present remembers its own destination.
  const other=40000;f.set(f.desc+8,other);
  const fourth=f.bridge.call(0x30002,f.desc,0);assert(fourth<=-2);await tick();
  await f.advance({pixels:f.frame(3)});
  assert.strictEqual(await f.poll(fourth),0);
  assert.deepStrictEqual(f.dest(),Array.from(f.frame(3)),'frame 3 lands where Present 3 pointed');
  assert(new Uint8Array(f.memory,other,16).every(b=>b===0),'not where Present 4 pointed');
  f.set(f.desc+8,32000);
  // Reset drops the frame in flight and blocks the next Present again.
  const rdesc=128;f.set(rdesc+32,2);f.set(rdesc+36,2);
  const reset=f.bridge.call(0x30009,rdesc,7);assert(reset<=-2);await tick();
  await f.advance({pixels:f.frame(4)});await f.advance(1);
  assert.strictEqual(await f.poll(reset),1);
  assert.deepStrictEqual(f.dest(),Array.from(f.frame(3)),'the frame in flight at reset is dropped');
  await f.draw();
  const afterReset=f.bridge.call(0x30002,f.desc,0);assert(afterReset<=-2,'first Present after reset parks');
  await tick();await f.advance({pixels:f.frame(5)});
  assert.strictEqual(await f.poll(afterReset),0);assert.deepStrictEqual(f.dest(),Array.from(f.frame(5)));
  assert.strictEqual(f.bridge.call(0x30002,f.desc,0),0);await tick();
  // A frame that fails in flight is reported at the next call on the device.
  f.gates.shift().reject(new Error('rasterizer fault'));await tick();
  assert.strictEqual(f.bridge.call(0x30002,f.desc,0),-1,'the failed frame surfaces');
  assert.match(String(f.bridge.lastError),/rasterizer fault/);
  await f.bridge.close();

  // Release drops the frame in flight: no late copy into a freed target.
  const g=fixture();
  await g.draw();
  const one=g.bridge.call(0x30002,g.desc,0);await tick();await g.advance({pixels:g.frame(1)});
  assert.strictEqual(await g.poll(one),0);
  assert.strictEqual(g.bridge.call(0x30002,g.desc,0),0);await tick();
  const release=g.bridge.call(0x30004,0,7);assert(release<=-2);await tick();
  await g.advance({pixels:g.frame(2)});await g.advance(1);
  assert.strictEqual(await g.poll(release),1);assert(!g.bridge.devices.has(7));
  assert.deepStrictEqual(g.dest(),Array.from(g.frame(1)),'the dropped frame never lands');
  await g.bridge.close();
  console.log('PASS d3d9 present pipeline');
})().catch(error=>{console.error(error);process.exit(1);});
