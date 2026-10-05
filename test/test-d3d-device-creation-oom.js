'use strict';
const assert=require('assert');
const {compileSrcWasm}=require('./compile-src');
const {createHostImports}=require('../lib/host-imports');
const apis=require('../src/api_table.json');
const extra=String.raw`
 (global $test_fail (mut i32) (i32.const 0))
 (global $test_obj_attempts (mut i32) (i32.const 0))
 (func $test_device_state_alloc (param $size i32) (result i32)
   (if (i32.eq (global.get $test_fail) (i32.const 1)) (then (return (i32.const 0))))
   (call $heap_alloc (local.get $size)))
 (func $test_device_obj_alloc (param $type i32) (param $vtbl i32) (result i32)
   (global.set $test_obj_attempts (i32.add (global.get $test_obj_attempts) (i32.const 1)))
   (if (i32.eq (global.get $test_fail) (i32.const 2)) (then (return (i32.const 0))))
   (call $dx_create_com_obj (local.get $type) (local.get $vtbl)))
 (func (export "fail") (param $mode i32)
   (global.set $test_fail (local.get $mode)) (global.set $test_obj_attempts (i32.const 0)))
 (func (export "attempts") (result i32) (global.get $test_obj_attempts))
 (func (export "parent") (result i32)
   (call $dx_create_com_obj (i32.const 9) (global.get $DX_VTBL_D3D3)))
 (func (export "refs") (param $p i32) (result i32)
   (load.field DxObject refcount (call $dx_from_this (local.get $p))))
 (func (export "state") (param $p i32) (result i32)
   (i32.load offset=16 (call $dx_from_this (local.get $p))))
 (func (export "live_heap") (result i32)
   (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
 (func (export "live_dx") (result i32)
   (local $i i32) (local $n i32)
   (loop $scan
     (if (i32.load (i32.add (global.get $DX_OBJECTS) (i32.mul (local.get $i) (global.get $DX_ENTRY_SIZE))))
       (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br_if $scan (i32.lt_u (local.get $i) (global.get $DX_MAX))))
   (local.get $n))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $p i32) (param $out i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $p) (i32.const 0)
     (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
 (func (export "release_device") (param $p i32) (result i32) (call $d3dim_device_release (local.get $p)))
`;
(async()=>{
 let patched=0;
 const wasm=compileSrcWasm((file,source)=>{
   if(file==='09ab-handlers-d3dim-core.wat') {
     const start=source.indexOf('  (func $d3dim_create_device ');
     const end=source.indexOf('  (func $d3dim_get_direct3d ',start);
     let body=source.slice(start,end);
     for(const [from,to] of [
       ['(call $heap_alloc (i32.const 4096))','(call $test_device_state_alloc (i32.const 4096))'],
       ['(call $dx_create_com_obj (i32.const 20) (local.get $vtbl))','(call $test_device_obj_alloc (i32.const 20) (local.get $vtbl))'],
     ]) {
       assert.strictEqual(body.split(from).length,2,'one production allocation site');
       body=body.replace(from,to);patched++;
     }
     return source.slice(0,start)+body+source.slice(end);
   }
   return file==='13-exports.wat'?source+'\n'+extra:source;
 });assert.strictEqual(patched,2);
 const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
 const ctx={getMemory:()=>memory.buffer},imports=createHostImports(ctx);imports.host.memory=memory;
 const {instance}=await WebAssembly.instantiate(wasm,imports),e=instance.exports;ctx.exports=e;
 e.init_dx_com_thunks();
 const p=e.parent(),out=e.guest_alloc(4),sp=e.guest_alloc(128);
 const heap=e.live_heap(),objects=e.live_dx(),refs=e.refs(p);
 for(const v of [2,3,7]) for(const mode of [1,2]) for(let repeat=0;repeat<4;repeat++) {
   const id=apis.find(a=>a.name===`IDirect3D${v}_CreateDevice`).id,pop=v===3?24:20;
   e.fail(mode);e.guest_write32(out,0xdeadbeef);e.guest_write32(sp+pop,0xdeadbeef);
   assert.strictEqual(e.invoke(id,sp,p,out)>>>0,mode===1?0x8007000e:0x80004005,'allocation failure is not success');
   assert.strictEqual(e.guest_read32(out),0,'no published partial device');
   assert.strictEqual(e.refs(p),refs,'no retained creator after failure');
   assert.strictEqual(e.live_heap(),heap,'no leaked state');
   assert.strictEqual(e.live_dx(),objects,'no leaked object');
   assert.strictEqual(e.attempts(),mode===1?0:1,'state failure must not consume a permanent DX slot');
   assert.strictEqual(e.get_esp(),sp+pop);
   assert.strictEqual(e.guest_read32(sp+pop)>>>0,0xdeadbeef);
   e.fail(0);
   assert.strictEqual(e.invoke(id,sp,p,out),0,'retry succeeds');
   const dev=e.guest_read32(out);assert(dev&&e.state(dev));
   assert.strictEqual(e.refs(p),refs+1);
   assert.strictEqual(e.release_device(dev),0);
   assert.strictEqual(e.refs(p),refs);assert.strictEqual(e.live_heap(),heap);assert.strictEqual(e.live_dx(),objects);
 }
 console.log('PASS D3D2/3/7 creation: 24 allocation failures, no publication/leaks/slot consumption, 24 valid retries');
})().catch(error=>{console.error(error);process.exitCode=1;});
