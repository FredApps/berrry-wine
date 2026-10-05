'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat=String.raw`
  (export "frame_deliver" (func $win16_dde_deliver))
  (export "frame_valid" (func $win16_dde_frame_valid))
  (export "frame_base" (func $win16_dde_base))
  (export "frame_ask" (func $win16_dde_ask_slot))
  (func (export "frame_setup")
    (local $p i32)
    (local.set $p (call $win16_dde_conv_slot
      (i32.sub (call $win16_dde_conv_alloc (i32.const 1) (i32.const 1)) (i32.const 1))))
    (i32.store offset=8 (local.get $p) (i32.const 0x0a000002))
    (i32.store offset=12 (local.get $p) (i32.const 1))
    (local.set $p (call $win16_dde_pending_slot))
    (i32.store (local.get $p) (i32.const 1))
    (i32.store offset=8 (local.get $p) (i32.const 1))
    (i32.store offset=16 (local.get $p) (global.get $DDE_WAIT_XACT)))
`;
(async()=>{
  const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat});
  e.frame_setup();
  const bytes=new Uint8Array(memory.buffer),v=new DataView(memory.buffer);
  const wa=e.guest_to_wasm(e.guest_alloc(1024));
  const state=()=>Buffer.from(bytes.slice(e.frame_base()+0x9000,e.frame_base()+0xf000));
  const initial=state(), failures=[];
  const cases=[
    ['short header',6,[65,0],2,27],
    ['truncated POKE',6,[65,0],20,30],
    ['truncated DATA',5,[65,0],20,30],
    ['truncated EXECUTE',7,[65,0],20,30],
    ['truncated ADVDATA',10,[65,0],20,30],
    ['wrapped length',7,[65,0],0xffffffff,30],
    ['over capacity',5,Array(257).fill(0),257,285],
    ['unterminated item',6,[65,65],2,30],
    ['unterminated request',4,[65,65],2,30],
    ['unterminated advise',8,[65,65],2,30],
    ['unterminated update',10,[65,65],2,30],
    ['unterminated command',7,[65,65],2,30],
    ['missing topic',1,[0],1,29],
    ['unterminated topic',1,[0,65],2,30],
    ['short ACK',9,[0,128,0],3,31],
    ['wrong magic',6,[65,0],2,30,0],
    ['unknown type',11,[0],1,29],
    ['name past scanner limit',6,[...Array(129).fill(65),0],130,158],
  ];
  for(const [name,type,payload,len,n,magic=0x31454444] of cases){
    bytes.fill(0,wa,wa+1024); // NULs just beyond the received extent must not count.
    [magic,type,0x0a000002,1,1,len,1].forEach((x,i)=>v.setUint32(wa+i*4,x,true));
    bytes.set(payload,wa+28);
    assert.strictEqual(e.frame_valid(wa,n),0,name);
    e.frame_deliver(wa,n);
    if(!state().equals(initial)) failures.push(name);
    bytes.set(initial,e.frame_base()+0x9000);
  }
  assert.deepStrictEqual(failures,[],'malformed frames must not mutate DDE state');
  // Bounded memory inputs must be rejected without a Wasm out-of-bounds trap.
  for(const [p,n] of [[memory.buffer.byteLength-4,28],[0xfffffff0,64],[wa,0xffffffff]]) e.frame_deliver(p,n);
  assert.deepStrictEqual(state(),initial);
  // Largest inline command, empty binary DATA, and a complete ACK remain valid.
  for(const [type,payload] of [[7,[...Array(255).fill(65),0]],[5,[]],[9,[0,128,0,0]],[1,[0,0]]]) {
    [0x31454444,type,0x0a000002,1,1,payload.length,1].forEach((x,i)=>v.setUint32(wa+i*4,x,true));
    bytes.set(payload,wa+28);
    assert.strictEqual(e.frame_valid(wa,28+payload.length),1,`valid type ${type}`);
  }
  // A valid POKE remains accepted; this must not be a drop-all validator.
  [0x31454444,6,0x0a000002,1,1,3,1].forEach((x,i)=>v.setUint32(wa+i*4,x,true));
  bytes.set([65,0,42],wa+28);
  e.frame_deliver(wa,31);
  assert.strictEqual(v.getUint32(e.frame_ask(0),true),1);
  console.log(`PASS ${cases.length} malformed DDE frames, address bounds and valid POKE control`);
})().catch(error=>{console.error(error);process.exitCode=1;});
