'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
  (export "execute_data_slot" (func $win16_dde_data_slot))
  (export "execute_ask_slot" (func $win16_dde_ask_slot))
  (export "execute_deliver" (func $win16_dde_deliver))
  (func (export "execute_error") (result i32)
    (i32.load (call $win16_dde_error_slot)))
  (func (export "execute_setup") (param $data i32)
    (local $p i32)
    (call $win16_seg_set (i32.const 1) (local.get $data) (i32.const 65535) (i32.const 0) (i32.const 0))
    (global.set $WIN16_THUNK_SEL (i32.const 15))
    (local.set $p (call $win16_dde_conv_slot
      (i32.sub (call $win16_dde_conv_alloc (i32.const 1) (i32.const 1)) (i32.const 1))))
    (i32.store offset=8 (local.get $p) (i32.const 0x0a000001))
    (i32.store offset=12 (local.get $p) (i32.const 1)))
  (func (export "execute_call") (param $sp i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $win16_DdeClientTransaction))
  (func (export "execute_finish")
    (global.set $win16_dde_cb_item (i32.const 0))
    (call $win16_dde_ask_finish (i32.const 0)))
`;
(async()=>{
  let memory;
  const frames=[];
  const h=await bootRenderHarness({fonts:'none',extraWat,extraHostOverrides:{
    net_frame_send:(wa,n)=>{frames.push(Buffer.from(new Uint8Array(memory.buffer,wa,n)));return 1;},
  }});
  const e=h.exports; memory=h.memory;
  const bytes=new Uint8Array(memory.buffer), view=new DataView(memory.buffer);
  const data=e.guest_alloc(256), stack=e.guest_alloc(64), input=e.guest_alloc(512);
  const command=Buffer.from('['+'X'.repeat(125)+']\0');
  bytes.set(command,e.guest_to_wasm(data));
  e.execute_setup(data);
  const failures=[];
  for(const timeout of [1000,0xffffffff]) {
    e.set_vlan_local_ip(0x0a000001);
    // Pascal frame: return IP:CS, result*, timeout, type, format, item,
    // conversation, byte count, data offset:selector.
    const words=[0,15,0,0,timeout&65535,timeout>>>16,0x4050,0,0,0,1,0,command.length,0,0,15];
    words.forEach((v,i)=>view.setUint16(e.guest_to_wasm(stack)+i*2,v,true));
    e.guest_write32(stack+32,0xdeadbeef);
    frames.length=0;
    e.execute_call(stack);
    assert.strictEqual(e.get_esp()>>>0,stack+32);
    assert.strictEqual(e.guest_read32(stack+32)>>>0,0xdeadbeef);
    assert.strictEqual(frames.length,1);
    const frame=frames[0];
    if(!frame.subarray(28).equals(command)) failures.push(`${timeout}: sender lost command bytes`);
    assert.strictEqual(frame.readUInt32LE(4),7);
    e.set_vlan_local_ip(0x0a000002);
    bytes.set(frame,e.guest_to_wasm(input));
    e.execute_deliver(e.guest_to_wasm(input),frame.length);
    const ask=e.execute_ask_slot(0), handle=view.getUint32(ask+24,true);
    assert.strictEqual(view.getUint32(ask+4,true),0x4050);
    if(view.getUint32(ask+20,true)!==0) failures.push(`${timeout}: command incorrectly passed as HSZ`);
    if(!handle) failures.push(`${timeout}: callback has no command data handle`);
    else {
      const slot=e.execute_data_slot(handle-0x100);
      assert.strictEqual(view.getUint32(slot+4,true),command.length);
      assert.deepStrictEqual(Buffer.from(bytes.slice(slot+8,slot+8+command.length)),command);
      e.execute_finish();
      assert.strictEqual(view.getUint32(slot,true),0);
    }
    if(!handle)e.execute_finish();
  }
  assert.deepStrictEqual(failures,[]);
  // The bounded wire must refuse overlong commands, never execute a prefix.
  for(const count of [257,0xffffffff]) {
    frames.length=0;
    view.setUint32(e.guest_to_wasm(stack)+24,count,true);
    e.execute_call(stack);
    assert.strictEqual(frames.length,0);
    assert.strictEqual(e.execute_error(),0x4007);
    assert.strictEqual(e.get_esp()>>>0,stack+32);
    assert.strictEqual(e.guest_read32(stack+32)>>>0,0xdeadbeef);
  }
  console.log('PASS Win16 EXECUTE synchronous/asynchronous command transport, callback data and stack cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
