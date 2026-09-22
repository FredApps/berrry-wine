'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
  (export "dde_data_slot" (func $win16_dde_data_slot))
  (export "dde_ask_slot" (func $win16_dde_ask_slot))
  (export "dde_deliver" (func $win16_dde_deliver))
  (func (export "dde_setup") (result i32)
    (local $slot i32)
    (local.set $slot (call $win16_dde_conv_slot
      (i32.sub (call $win16_dde_conv_alloc (i32.const 1) (i32.const 1)) (i32.const 1))))
    (i32.store offset=8 (local.get $slot) (i32.const 0x0a000002))
    (i32.store offset=12 (local.get $slot) (i32.const 1))
    (global.get $DDE_HDR))
  (func (export "dde_finish") (param $i i32)
    (global.set $win16_dde_cb_item (local.get $i))
    (call $win16_dde_ask_finish (i32.const 0)))
`;
(async () => {
  const { exports:e, memory } = await bootRenderHarness({ fonts:'none', extraWat });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const hdr = e.dde_setup();
  const frame = e.guest_to_wasm(e.guest_alloc(1024));
  const count = () => Array.from({length:16}, (_,i)=>view.getUint32(e.dde_data_slot(i),true)).filter(Boolean).length;
  const send = type => {
    bytes.fill(0,frame,frame+1024);
    [0x31454444,type,0x0a000002,1,1,7,1].forEach((v,i)=>view.setUint32(frame+i*4,v,true));
    bytes.set([105,116,101,109,0,0x41,0x42],frame+hdr);
    e.dde_deliver(frame,hdr+7);
  };
  const failures=[];
  for(const type of [8,7]) {
    for(let i=0;i<32;i++) { send(type); e.dde_finish(0); }
    if(count()!==0) failures.push(`type ${type}: ${count()} leaked data handles`);
    // Isolate each case, even on the old broken implementation.
    for(let i=0;i<16;i++) view.setUint32(e.dde_data_slot(i),0,true);
  }
  for(const type of [6,10]) {
    for(let i=0;i<4;i++) send(type);
    assert.strictEqual(count(),4,`type ${type}: four queued callbacks own four handles`);
    for(let i=0;i<32;i++) send(type);
    if(count()!==4) failures.push(`type ${type} queue overflow: ${count()} handles for four callbacks`);
    for(let i=0;i<4;i++) {
      const h=view.getUint32(e.dde_ask_slot(i)+24,true);
      const slot=e.dde_data_slot(h-0x100);
      assert.strictEqual(view.getUint32(slot+4,true),2);
      assert.deepStrictEqual([...bytes.slice(slot+8,slot+10)],[0x41,0x42]);
      e.dde_finish(i);
    }
    if(count()!==0) failures.push(`type ${type} callback completion: ${count()} handles remain`);
    for(let i=0;i<16;i++) view.setUint32(e.dde_data_slot(i),0,true);
  }
  assert.deepStrictEqual(failures,[]);
  for(let i=0;i<64;i++) { send(i%2?6:10); assert.strictEqual(count(),1); e.dde_finish(0); assert.strictEqual(count(),0); }
  console.log('PASS DDE non-data transactions, queue rejection, payload and repeated callback reclamation');
})().catch(error=>{ console.error(error); process.exitCode=1; });
