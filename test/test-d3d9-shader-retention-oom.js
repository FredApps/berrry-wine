#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {compileSrcWasm}=require('./compile-src');
const {createHostImports}=require('../lib/host-imports');
const IR=require('../lib/d3d-shader-ir');
(async()=>{
 const allocation='(local.set $retained (call $heap_alloc (i32.add (i32.add (local.get $length) (i32.const 24)) (local.get $ir_bytes))))';
 const injected='(local.set $retained (call $test_finalize_alloc (i32.add (i32.add (local.get $length) (i32.const 24)) (local.get $ir_bytes)) (local.get $shader) (local.get $ir)))';
 const extra=`
 (global $test_fail_finalize (mut i32) (i32.const 1))
 (global $test_private_shader (mut i32) (i32.const 0))
 (global $test_private_ir (mut i32) (i32.const 0))
 (func $test_finalize_alloc (param $size i32) (param $shader i32) (param $ir i32) (result i32)
   (global.set $test_private_shader (local.get $shader))
   (global.set $test_private_ir (i32.load (i32.sub (local.get $ir) (i32.const 12))))
   (if (global.get $test_fail_finalize) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $size)))
 (func (export "set_failure") (param i32) (global.set $test_fail_finalize (local.get 0)))
 (func (export "private_shader") (result i32) (global.get $test_private_shader))
 (func (export "private_ir") (result i32) (global.get $test_private_ir))
 (func (export "ir_live") (result i32) (global.get $d3d_ir_live_bytes))
 (func (export "free_head") (result i32) (global.get $free_list))
 (func (export "new_device") (result i32) (local $device i32)
   (local.set $device (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
   (store.field DxObject misc1 (call $dx_from_this (local.get $device)) (call $d3d9_program_alloc))
   (local.get $device))
 (func (export "refs") (param $device i32) (result i32)
   (load.field DxObject refcount (call $dx_from_this (local.get $device))))
 (func (export "create_shader") (param $device i32) (param $code i32) (param $out i32) (result i32)
   (call $d3d9_shader_create (local.get $device) (local.get $code) (local.get $out) (i32.const 0xfffe0101))
   (global.get $eax))
 (func (export "release_shader") (param $shader i32) (result i32)
   (call $handle_IDirect3DShader9_Release (local.get $shader) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
   (global.get $eax))`;
 let patched=0;
 const wasm=compileSrcWasm((file,source)=>{
  if(file==='09ad-handlers-d3d9.wat'){
   assert.strictEqual(source.split(allocation).length,2,'fault targets exactly the production final allocation');patched++;
   return source.replace(allocation,injected);
  }
  return file==='13-exports.wat'?source+'\n'+extra:source;
 });assert.strictEqual(patched,1);
 const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
 const ctx={getMemory:()=>memory.buffer},imports=createHostImports(ctx);imports.host.memory=memory;
 const {instance}=await WebAssembly.instantiate(wasm,imports),e=instance.exports;ctx.exports=e;
 const device=e.new_device(),code=e.guest_alloc(20)>>>0,out=e.guest_alloc(4)>>>0;
 const tokens=[0xfffe0101,1,0xc00f0000,0x90e40000,0xffff];tokens.forEach((n,i)=>e.guest_write32(code+i*4,n));
 const freeBlocks=()=>{const blocks=new Map();let p=e.free_head()>>>0;
  for(let i=0;p;i++){assert(i<1000,'bounded acyclic free list');assert(!blocks.has(p),'no double free');blocks.set(p,e.guest_read32(p)>>>0);p=e.guest_read32(p+4)>>>0;}return blocks;};
 const refs=e.refs(device);
 for(let attempt=0;attempt<3;attempt++){
  e.guest_write32(out,0xdeadbeef);assert.strictEqual(e.create_shader(device,code,out)>>>0,0x8007000e);
  assert.strictEqual(e.guest_read32(out),0,'failed publication clears output');assert.strictEqual(e.refs(device),refs,'no parent reference acquired');
  assert.strictEqual(e.ir_live(),0,'temporary validator IR released');
  const blocks=freeBlocks(),privateShader=e.private_shader()>>>0,privateIR=e.private_ir()>>>0;
  assert(privateShader&&privateIR&&privateShader!==privateIR);
  assert(blocks.get(privateShader-4)>=44,'private bytecode allocation is freed');
  assert(blocks.get(privateIR-4)>=176,'private validator allocation is freed');
 }
 e.set_failure(0);assert.strictEqual(e.create_shader(device,code,out),0,'valid retry succeeds after OOM cleanup');
 const shader=e.guest_read32(out)>>>0,wa=e.guest_to_wasm(shader)>>>0,ir=IR.read(memory.buffer,wa+44);
 assert.strictEqual(ir.version,tokens[0]);assert.strictEqual(e.refs(device),refs+1);assert.strictEqual(e.ir_live(),0);
 assert.deepStrictEqual(Array.from(new Uint32Array(memory.buffer,wa+24,5)),tokens);
 assert.strictEqual(e.release_shader(shader),0);assert.strictEqual(e.refs(device),refs);
 assert(freeBlocks().get(shader-4)>=44+ir.nativeBytes.length,'successful retry retires contiguous allocation');
 console.log('PASS retained shader final-allocation OOM: OUT0, unchanged refs, both temporaries freed, no IR leak/double free, valid retry');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
