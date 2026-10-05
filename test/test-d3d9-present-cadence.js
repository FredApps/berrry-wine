'use strict';
const assert=require('assert');
const {Bridge}=require('../lib/d3d9-host');
const {CommandQueue,OPCODES}=require('../lib/d3d-command-stream');
(async()=>{
 const callbacks=new Map();let next=1,frames=0;
 const oldRAF=global.requestAnimationFrame,oldCancel=global.cancelAnimationFrame;
 global.requestAnimationFrame=fn=>{const id=next++;callbacks.set(id,fn);return id;};
 global.cancelAnimationFrame=id=>callbacks.delete(id);
 const frame=async()=>{frames++;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(frames*17));await new Promise(r=>setImmediate(r));};
 try{
  const bridge=new Bridge({backend:'software'}),effects=[],entry={};
  const execute=command=>{effects.push([command.opcode,frames]);return {value:command.payload.value,complete:true};};
  entry.queue=new CommandQueue({deviceId:1,consumer:{execute:c=>bridge._consume(entry,c,execute)}});
  const first=bridge._submit(entry,OPCODES.PRESENT,{interval:0,value:10});
  const draw=bridge._submit(entry,OPCODES.DRAW,{value:20});
  const second=bridge._submit(entry,OPCODES.PRESENT,{interval:1,value:30});
  assert.deepStrictEqual(effects,[],'waiting Present keeps subsequent effects ordered');
  assert.strictEqual(entry.queue.completed,0);
  await frame();assert.strictEqual(await first,10);assert.strictEqual(await draw,20);
  assert.deepStrictEqual(effects,[[OPCODES.PRESENT,1],[OPCODES.DRAW,1]]);
  assert.strictEqual(entry.queue.completed,2,'second Present has not crossed its display boundary');
  await frame();assert.strictEqual(await second,30);
  assert.strictEqual(bridge._submit(entry,OPCODES.PRESENT,{interval:0x80000000,value:40}),40,'IMMEDIATE remains synchronous');
  const pending=bridge._submit(entry,OPCODES.PRESENT,{interval:0,value:50});
  const token=bridge._result(entry,pending);assert(token<=-2);
  await bridge.close();await assert.rejects(pending,/cancelled/);await new Promise(r=>setImmediate(r));
  assert.strictEqual(callbacks.size,0);assert.strictEqual(entry.queue.inflight,0,'cancelled cadence retires command snapshots');
  assert.deepStrictEqual(effects.at(-1),[OPCODES.PRESENT,2],'cancel never executes cancelled Present');
  console.log('PASS presentation cadence: DEFAULT/ONE display boundaries, ordered effects, IMMEDIATE and cancellation retirement');
 }finally{global.requestAnimationFrame=oldRAF;global.cancelAnimationFrame=oldCancel;}
})().catch(e=>{console.error(e);process.exitCode=1;});
