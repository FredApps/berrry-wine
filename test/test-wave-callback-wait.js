#!/usr/bin/env node
'use strict';
// Private actual-source regression. Explicit compile grant is required.
const assert=require('assert'),fs=require('fs'),path=require('path');

const root=path.resolve(__dirname,'..');
const {compileSrcWasm}=require(path.join(root,'test/compile-src'));
const {createHostImports}=require(path.join(root,'lib/host-imports'));

const extra=String.raw`
  (func (export "wave_test_wait") (param $reason i32)
    (global.set $mm_timer_resume_yield (i32.const 7))
    (global.set $yield_reason (local.get $reason))
    (global.set $yield_flag (i32.const 1))
    (global.set $wait_handle (i32.const 123))
    (global.set $wait_handles_ptr (i32.const 0))
    (global.set $wait_all (i32.const 0))
    (global.set $wait_timeout (i32.const -1))
    (global.set $wait_stack_bytes (i32.const 12)))
  (func (export "wave_test_perturb_wait")
    (global.set $wait_handle (i32.const 999))
    (global.set $wait_handles_ptr (i32.const 888))
    (global.set $wait_all (i32.const 1))
    (global.set $wait_timeout (i32.const 777))
    (global.set $wait_stack_bytes (i32.const 24)))
  (func (export "wave_test_register") (param $cb i32)
    (i32.store (region.addr $WAVE_OUT_SHARED 4) (local.get $cb))
    (i32.store (region.addr $WAVE_OUT_SHARED 8) (i32.const 456))
    (i32.store (region.addr $WAVE_OUT_SHARED 12) (i32.const 3)))
`;
(async()=>{
 const bytes=compileSrcWasm((file,source)=>{
   const s=source;
   return file==='13-exports.wat'?s+'\n'+extra:s;
 });
 const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
 const ctx={getMemory:()=>memory.buffer};const imports=createHostImports(ctx);
 Object.assign(imports.host,{memory,log:()=>{},log_i32:()=>{},get_ticks:()=>1000});
 const e=(await WebAssembly.instantiate(bytes,imports)).instance.exports;ctx.exports=e;
 const exe=fs.readFileSync(path.join(root,'test/binaries/notepad.exe'));
 new Uint8Array(memory.buffer).set(exe,e.get_staging());assert(e.load_pe(exe.length));
 const alloc=n=>e.guest_alloc(n)>>>0;
 const stack=alloc(8192)+4096,out=alloc(4),cb=alloc(32),resume=alloc(16);
 const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,n>>>24];
 // Actual guest callback increments once and stdcall-returns through CACA000A.
 new Uint8Array(memory.buffer).set([0xff,0x05,...u32(out),0xc2,20,0],e.guest_to_wasm(cb));
 new Uint8Array(memory.buffer).set([0xc3],e.guest_to_wasm(resume));
 e.set_esp(stack);e.guest_write32(stack,0);e.set_eip(resume);e.wave_test_register(cb);
 const tls=e.get_tls_slots(),fsBase=e.get_fs_base();
 for(const reason of [2,5,7,13]){e.wave_test_wait(reason);assert.equal(e.fire_wave_out_callback(17,19),0,'unsupported yield must retain callback');assert.equal(e.get_eip(),resume);}
 e.wave_test_wait(1);
 assert.equal(e.fire_wave_out_callback(17,19),1,'owning parked interpreter admits legitimate callback');
 assert.equal(e.fire_wave_out_callback(17,19),0,'nested delivery refused');
 assert.equal(e.get_tls_slots(),tls,'waveOut retains caller TLS');
 // A callback may overwrite this tuple through another wait before returning.
 // This setup export perturbs data only; actual callback entry/return stays production WAT.
 e.wave_test_perturb_wait();e.run(10000);
 assert.equal(e.guest_read32(out),1,'actual guest callback executed exactly once');
 assert.equal(e.get_eip(),resume,'original owner remains parked, not executed after callback');
 assert.equal(e.get_esp(),stack);assert.equal(e.get_yield_reason(),1);
 assert.equal(e.get_wait_handle(),123);assert.equal(e.get_wait_handles_ptr(),0);
 assert.equal(e.get_wait_timeout()>>>0,0xffffffff);assert.equal(e.get_wait_stack_bytes(),12);
 assert.equal(e.get_tls_slots(),tls);assert.equal(e.get_fs_base(),fsBase);
 assert.equal(e.is_mm_timer_callback_active(),0);
 console.log('PASS actual WAT wave callback wait/return/TLS boundary; Worker and real semaphore tests remain required');
})().catch(e=>{console.error(e);process.exitCode=1;});
