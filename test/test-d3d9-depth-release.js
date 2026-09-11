#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {bootRenderHarness}=require('./render-helper');
const id=require('../src/api_table.json').find(a=>a.name==='IDirect3DSurface9_Release').id;
const resetId=require('../src/api_table.json').find(a=>a.name==='IDirect3DDevice9_Reset').id;
const bytes=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
(async()=>{
  let ready=false,submits=0,polls=0,retired=0,pendingOpcode=0x30004,completion=1;
  const{exports:e,memory,module,host}=await bootRenderHarness({fonts:'none',extraHostOverrides:{gpu_gl_call(op){
    if(op===pendingOpcode){submits++;return -29;}
    if(op===0x30007){polls++;return ready?completion:-29;}
    if(op===0x30008)retired++;
    return 1;
  }},extraWat:`
    (func (export "depth_serial") (result i32) (call $d3d9_depth_next_serial))
    (func (export "depth_exhaust") (i32.atomic.store (global.get $D3D9_DEPTH_SERIAL) (i32.const -2)))
    (func (export "temporary_depth") (result i32)
      (local $p i32) (local $serial i32)
      (local.set $p (call $d3d9_depth_new (i32.const 0) (i32.const 8) (i32.const 8) (i32.const 80) (i32.const 0) (i32.const 0)))
      (if (i32.eqz (local.get $p)) (then (return (i32.const 0))))
      (local.set $serial (i32.load offset=36 (call $g2w (local.get $p))))
      (call $heap_free (local.get $p)) (local.get $serial))
    (func (export "make_device") (param $pp i32) (param $out i32) (result i32)
      (global.set $esp (i32.const 0x07000000))
      (call $gs32 (i32.add (global.get $esp) (i32.const 24)) (local.get $pp))
      (call $gs32 (i32.add (global.get $esp) (i32.const 28)) (local.get $out))
      (call $handle_IDirect3D9_CreateDevice (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 1) (i32.const 0) (i32.const 0)) (global.get $eax))
    (func (export "make_depth") (param $d i32) (result i32)
      (call $d3d9_depth_new (local.get $d) (i32.const 8) (i32.const 8) (i32.const 80) (i32.const 0) (i32.const 1)))
    (func (export "get_backbuffer") (param $d i32) (param $out i32) (result i32)
      (global.set $esp (i32.const 0x07000000))
      (call $handle_IDirect3DDevice9_GetBackBuffer (local.get $d) (i32.const 0) (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0))
      (global.get $eax))
    (func (export "bind_depth") (param $d i32) (param $s i32)
      (call $d3d9_depth_binding (local.get $d) (local.get $s) (i32.const 0)))
    (func (export "release_surface") (param $s i32) (result i32) (call $d3d9_depth_release (local.get $s)))
    (func (export "release_device") (param $d i32) (result i32)
      (global.set $esp (i32.const 0x07000000))
      (call $handle_IDirect3DDevice9_Release (local.get $d) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)) (global.get $eax))
    (func (export "refs") (param $d i32) (result i32)
      (load.field DxObject refcount (call $dx_from_this (local.get $d))))
    (func (export "thunk") (result i32)
      (call $gl32 (call $init_com_vtable (i32.const ${id}) (i32.const 1))))
    (func (export "reset_thunk") (result i32)
      (call $gl32 (call $init_com_vtable (i32.const ${resetId}) (i32.const 1))))
    (func (export "target_width") (param $d i32) (result i32)
      (load.field DxObject width (call $d3ddev_rt_entry (local.get $d))))
    (func (export "target_bits") (param $d i32) (result i32)
      (load.field DxObject misc1 (call $d3ddev_rt_entry (local.get $d))))
    (func (export "start") (param $code i32)
      (global.set $esp (i32.const 0x07000000)) (call $gs32 (global.get $esp) (i32.const 0)) (global.set $eip (local.get $code)))
  `});
  const pe=fs.readFileSync(path.join(__dirname,'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(pe,e.get_staging());assert(e.load_pe(pe.length));e.init_dx_com_thunks();
  const alloc=n=>e.guest_alloc(n)>>>0,read=p=>e.guest_read32(p)>>>0;
  const pp=alloc(64),out=alloc(4),marker=alloc(4),code=alloc(64);
  new Uint8Array(memory.buffer,e.guest_to_wasm(pp),64).fill(0);
  [8,8,21,1,0,0,1,1,1].forEach((v,i)=>e.guest_write32(pp+i*4,v));
  assert.strictEqual(e.make_device(pp,out),0);const device=read(out),surface=e.make_depth(device)>>>0;assert(surface);
  e.bind_depth(device,surface);assert.strictEqual(e.refs(device),2);
  assert.strictEqual(e.release_device(device),1);assert.strictEqual(submits,0);
  e.guest_write32(marker,0xdeadbeef);
  new Uint8Array(memory.buffer).set([0x68,...bytes(surface),0xb8,...bytes(e.thunk()),0xff,0xd0,0xa3,...bytes(marker),0xc3],e.guest_to_wasm(code));
  e.clear_yield();e.start(code);e.run(1000);
  assert.strictEqual(e.get_yield_reason(),16);assert.strictEqual(e.get_d3d_render_token(),-29);
  assert.strictEqual(read(marker),0xdeadbeef);assert.strictEqual(read(surface+4),1,'last child remains alive while device release is parked');
  assert.strictEqual(e.refs(device),1);const esp=e.get_esp();
  e.clear_yield();e.run(1000);assert.strictEqual(e.get_esp(),esp);assert.strictEqual(read(surface+4),1);
  ready=true;e.clear_yield();for(let i=0;i<20&&e.get_eip();i++)e.run(1000);
  assert.strictEqual(e.get_eip(),0);assert.strictEqual(e.get_esp()>>>0,0x07000004);
  assert.strictEqual(read(marker),0);assert.strictEqual(submits,1);assert(polls>=2);assert.strictEqual(retired,1);
  assert.strictEqual(e.get_d3d_render_token(),0);
  assert.strictEqual(e.make_device(pp,out),0);const resetDevice=read(out),oldTarget=e.target_bits(resetDevice);
  [16,10,21,1,0,0,1,1,1,1,80].forEach((v,i)=>e.guest_write32(pp+i*4,v));
  pendingOpcode=0x30009;ready=false;const before=submits;
  e.guest_write32(marker,0xdeadbeef);
  const resetCode=alloc(64);
  new Uint8Array(memory.buffer).set([0x68,...bytes(pp),0x68,...bytes(resetDevice),0xb8,...bytes(e.reset_thunk()),0xff,0xd0,0xa3,...bytes(marker),0xc3],e.guest_to_wasm(resetCode));
  e.clear_yield();e.start(resetCode);e.run(1000);
  assert.strictEqual(e.get_yield_reason(),16);assert.strictEqual(read(marker),0xdeadbeef);
  assert.strictEqual(e.target_width(resetDevice),8);assert.strictEqual(e.target_bits(resetDevice),oldTarget,'pending Reset retains canonical target');
  const resetESP=e.get_esp();e.guest_write32(pp,999);e.guest_write32(pp+4,999);
  e.clear_yield();e.run(1000);assert.strictEqual(e.get_esp(),resetESP);assert.strictEqual(e.target_width(resetDevice),8);
  ready=true;e.clear_yield();for(let i=0;i<20&&e.get_eip();i++)e.run(1000);
  assert.strictEqual(read(marker),0);assert.strictEqual(e.get_esp()>>>0,0x07000004);
  assert.strictEqual(e.target_width(resetDevice),16,'Reset owns its original presentation snapshot');
  assert.notStrictEqual(e.target_bits(resetDevice),oldTarget);assert.strictEqual(submits,before+1);
  assert.strictEqual(read(pp),0);assert.strictEqual(read(pp+4),0);
  pendingOpcode=0;assert.strictEqual(e.release_device(resetDevice),0);
  new Uint8Array(memory.buffer,e.guest_to_wasm(pp),64).fill(0);
  [8,8,21,1,0,0,1,1].forEach((v,i)=>e.guest_write32(pp+i*4,v));
  assert.strictEqual(e.make_device(pp,out),0);const unbindDevice=read(out),unbindSurface=e.make_depth(unbindDevice)>>>0;
  e.bind_depth(unbindDevice,unbindSurface);const retireBefore=retired;
  assert.strictEqual(e.release_surface(unbindSurface),0);assert.strictEqual(retired,retireBefore,'bound surface remains backend-owned');
  e.bind_depth(unbindDevice,0);assert.strictEqual(retired,retireBefore+1,'final unbind emits exactly one backend identity release');
  e.bind_depth(unbindDevice,0);assert.strictEqual(retired,retireBefore+1,'repeated NULL bind cannot release the identity twice');
  assert.strictEqual(e.release_device(unbindDevice),0);assert.strictEqual(retired,retireBefore+1);
  // Actual x86 caller must not return while final backbuffer retirement is
  // pending, and an asynchronous failure must leave both owners retryable.
  assert.strictEqual(e.make_device(pp,out),0);const backDevice=read(out);
  assert.strictEqual(e.get_backbuffer(backDevice,out),0);const backSurface=read(out);
  assert.strictEqual(e.refs(backDevice),2);assert.strictEqual(e.refs(backSurface),2);
  assert.strictEqual(e.release_device(backDevice),1);
  pendingOpcode=0x30004;completion=-1;ready=false;
  const backCode=alloc(64),backSubmits=submits,backPixels=e.target_bits(backDevice);
  new Uint8Array(memory.buffer).set([0x68,...bytes(backSurface),0xb8,...bytes(e.thunk()),0xff,0xd0,0xa3,...bytes(marker),0xc3],e.guest_to_wasm(backCode));
  for(const expected of[2,0]){
    ready=false;e.guest_write32(marker,0xdeadbeef);e.clear_yield();e.start(backCode);e.run(1000);
    assert.strictEqual(e.get_yield_reason(),16);assert.strictEqual(e.get_d3d_render_token(),-29);
    const parkedESP=e.get_esp();assert.strictEqual(read(marker),0xdeadbeef);
    assert.strictEqual(e.refs(backDevice),1);assert.strictEqual(e.refs(backSurface),2);
    assert.strictEqual(e.target_bits(backDevice),backPixels,'parked release keeps canonical pixels');
    e.clear_yield();e.run(1000);assert.strictEqual(e.get_esp(),parkedESP);
    assert.strictEqual(e.refs(backDevice),1);assert.strictEqual(e.refs(backSurface),2);
    ready=true;e.clear_yield();for(let i=0;i<20&&e.get_eip();i++)e.run(1000);
    assert.strictEqual(e.get_eip(),0);assert.strictEqual(e.get_esp()>>>0,0x07000004);
    assert.strictEqual(read(marker),expected);assert.strictEqual(e.get_d3d_render_token(),0);
    if(expected===2){
      assert.strictEqual(e.refs(backDevice),1);assert.strictEqual(e.refs(backSurface),2);
      assert.strictEqual(e.target_bits(backDevice),backPixels,'failed completion preserves native storage');
      completion=1;
    }
  }
  assert.strictEqual(submits,backSubmits+2,'exactly one submission per failed/successful attempt');
  const sibling=(await WebAssembly.instantiate(module,{host})).exports;
  sibling.d3dim_worker_init(0x400000);
  const allocated1=e.temporary_depth()>>>0,allocated2=sibling.temporary_depth()>>>0;
  assert(allocated1);assert.strictEqual(allocated2,allocated1+1,'two instances allocate distinct depth identities after Reset');
  const serial1=e.depth_serial()>>>0,serial2=sibling.depth_serial()>>>0,serial3=e.depth_serial()>>>0;
  assert.strictEqual(serial2,serial1+1,'second WASM instance observes the shared identity sequence');
  assert.strictEqual(serial3,serial2+1,'instance creation cannot reset existing depth identities');
  e.depth_exhaust();assert.strictEqual(sibling.depth_serial()>>>0,0xffffffff);
  assert.strictEqual(e.depth_serial(),0);assert.strictEqual(sibling.depth_serial(),0,'exhaustion never wraps or reuses identities');
  console.log('PASS actual x86 depth/backbuffer Release and Reset: parked ownership, delayed failure/retry, immutable resize transaction, one submission and balanced RET');
})().catch(error=>{console.error(error);process.exitCode=1;});
