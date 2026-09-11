#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const {Bridge}=require('../lib/d3d9-host');
const {CommandQueue}=require('../lib/d3d-command-stream');
(async()=>{
  let finishes=0,failed=false;
  const {exports:e}=await bootRenderHarness({fonts:'none',extraHostOverrides:{gpu_gl_call:(op,ptr,device)=>{
    if(op===0x3000a)return 0;
    assert.strictEqual(op,0x30006);assert(device);finishes++;return failed?0:1;
  }},extraWat:`
    (func (export "device") (param $out i32) (result i32)
      (local $d i32)
      (call $d3dim_create_device (i32.const 0) (i32.const 0) (local.get $out) (global.get $DX_VTBL_D3DDEV9))
      (local.set $d (call $gl32 (local.get $out)))
      (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
      (local.get $d))
    (func (export "create") (param $d i32) (param $type i32) (param $out i32) (result i32)
      (call $d3d9_query_create (local.get $d) (local.get $type) (local.get $out)) (global.get $eax))
    (func (export "device_refs") (param $d i32) (result i32)
      (load.field DxObject refcount (call $dx_from_this (local.get $d))))
    ${['QueryInterface','AddRef','Release','GetDevice','GetType','GetDataSize','Issue','GetData'].map(n=>`
    (func (export "${n}") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
      (global.set $esp (i32.const 0x074ff000))
      (call $handle_IDirect3DQuery9_${n} (local.get $a) (local.get $b) (local.get $c) (local.get $d) (i32.const 0) (i32.const 0))
      (global.get $eax))`).join('\n')}
  `});
  e.init_dx_com_thunks();
  const out=0x00409000,d=e.device(out),read=p=>e.guest_read32(p)>>>0;
  assert.strictEqual(e.create(d,8,0),0);assert.strictEqual(e.device_refs(d),1);
  assert.strictEqual(e.create(d,9,out)>>>0,0x8876086a);assert.strictEqual(read(out),0);
  assert.strictEqual(e.create(d,8,out),0);const q=read(out);
  assert.strictEqual(e.device_refs(d),2);assert.strictEqual(e.GetType(q),8);assert.strictEqual(e.GetDataSize(q),4);
  assert.strictEqual(e.GetData(q,0,0,0),0,'new query is signaled');
  assert.strictEqual(e.Issue(q,2)>>>0,0x8876086c,'EVENT does not support BEGIN');assert.strictEqual(finishes,0);
  assert.strictEqual(e.Issue(q,1),0);assert.strictEqual(finishes,1);
  assert.strictEqual(e.get_esp()>>>0,0x074ff00c);
  e.guest_write32(out,0);e.guest_write32(out+4,0xdeadbeef);
  assert.strictEqual(e.GetData(q,out,4,1),0);assert.strictEqual(read(out),1);assert.strictEqual(read(out+4),0xdeadbeef);
  assert.strictEqual(e.get_esp()>>>0,0x074ff014);
  for(const [ptr,size,flags] of [[out,3,0],[0,4,0],[out,4,2]])assert.strictEqual(e.GetData(q,ptr,size,flags)>>>0,0x8876086c);
  const iid=out+32;[0xd9771460,0x4f26a695,0xb827d3bb,0xcc41b540].forEach((v,i)=>e.guest_write32(iid+i*4,v));
  assert.strictEqual(e.QueryInterface(q,iid,out),0);assert.strictEqual(read(out),q);assert.strictEqual(e.Release(q),1);
  failed=true;assert.strictEqual(e.Issue(q,1)>>>0,0x88760868);
  e.guest_write32(out,0x12345678);assert.strictEqual(e.GetData(q,out,4,0)>>>0,0x88760868);assert.strictEqual(read(out),0x12345678);
  assert.strictEqual(e.Release(q),0);assert.strictEqual(e.device_refs(d),1);
  const bridge=new Bridge({});let actualFinish=0;
  assert.strictEqual(bridge.call(0x30006,0,7),1,'CPU-only device has no outstanding GPU work');
  const entry={device:{gpu:{gl:{isContextLost:()=>false},finish(){actualFinish++;}}}};
  entry.queue=new CommandQueue({deviceId:7,consumer:{execute:command=>bridge._execute(entry,command)}});
  bridge.devices.set(7,entry);
  assert.strictEqual(bridge.call(0x30006,0,7),1);assert.strictEqual(actualFinish,1);
  assert.strictEqual(entry.queue.completed,entry.queue.submitted,'EVENT completes through the command queue');
  bridge.devices.get(7).device.gpu.finish=()=>{throw Error('lost');};
  assert.strictEqual(bridge.call(0x30006,0,7),0,'failed GPU barrier is not reported complete');
  console.log('PASS D3D9 EVENT query lifetime, ABI, completion barrier and failure propagation');
})().catch(error=>{console.error(error);process.exitCode=1;});
