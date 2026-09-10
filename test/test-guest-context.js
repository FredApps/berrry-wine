#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');

// Independent architectural inventory: never derive the tested fields from
// the serializer implementation (an omitted production field must fail here).
const i32 = `eax ecx edx ebx esp ebp esi edi eip
 flag_op flag_a flag_b flag_res flag_sign_shift saved_cf df eflags_extra code16
 sreg_es sreg_cs sreg_ss sreg_ds seg_base_es seg_base_cs seg_base_ss seg_base_ds fs_base
 fpu_top fpu_cw fpu_sw fpu_tag fpu_raw_tag yield_flag yield_reason sleep_yielded sleep_timeout
 current_thunk_eip handler_set_eip message_wait_msg_ptr wait_handle wait_handles_ptr wait_all
 wait_timeout wait_stack_bytes cs_wait_addr cs_wait_owner cs_wait_spins cs_park_pending
 cs_resume_esp_delta vblank_wait_active vblank_wait_counter vblank_deadline_ms
 spin_deadline_ms clock_spin_parked_value clock_spin_parked_valid loadlib_name_ptr last_error`.split(/\s+/);
const values = Array.from({length:8},(_,i)=>`fpu_value${i}`);
const i64 = [...Array.from({length:8},(_,i)=>`fpu_raw${i}`),
 ...Array.from({length:8},(_,i)=>`mm${i}`),
 ...Array.from({length:8},(_,i)=>[`xmm${i}l`,`xmm${i}h`]).flat()];
const fields = [...i32.map(name=>({name,type:'i32'})),...values.map(name=>({name,type:'f64'})),...i64.map(name=>({name,type:'i64'}))];
let extra = String.raw`
 (func (export "save_context") (param $wa i32) (call $guest_context_save (local.get $wa)))
 (func (export "restore_context") (param $wa i32) (call $guest_context_restore (local.get $wa)))
 (func (export "context_size") (result i32) (global.get $GUEST_CONTEXT_SIZE))
 (func (export "can_interrupt") (result i32) (call $guest_context_can_interrupt))
 (func (export "discard_cache") (call $clear_cache))
`;
for(const {name,type} of fields){
 const wire=type==='f64'?'i64':type;
 const read=type==='f64'?`(i64.reinterpret_f64 (global.get $${name}))`:`(global.get $${name})`;
 const write=type==='f64'?`(f64.reinterpret_i64 (local.get $v))`:'(local.get $v)';
 extra+=`(func (export "ctx_get_${name}") (result ${wire}) ${read})\n`;
 extra+=`(func (export "ctx_set_${name}") (param $v ${wire}) (global.set $${name} ${write}))\n`;
}
const binary=compileSrcWasm((file,source)=>file==='13-exports.wat'?source+extra:source);
const module_=new WebAssembly.Module(binary);
const memory=new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
const imports={host:{memory}};
for(const imp of WebAssembly.Module.imports(module_))if(imp.kind==='function')(imports[imp.module]||={})[imp.name]=()=>0;
const a=new WebAssembly.Instance(module_,imports).exports;
const b=new WebAssembly.Instance(module_,imports).exports;
a.init_thread(0,0x400000,0,0,0,0,0);b.init_thread(1,0x400000,0,0,0,0,0);
const bits=[0x8000000000000000n,0x7ff8123456789abcn,0xfff8fedcba987654n,0x0000000000000001n,
 0x7ff0000000000000n,0xfff0000000000000n,0x3ff4000000000000n,0xdeadbeef12345678n];
function seed(e,salt){
 fields.forEach(({name,type},i)=>e['ctx_set_'+name](type==='i32'?(0x81230000+i*71+salt)|0:
   BigInt.asIntN(64,bits[i%bits.length]^BigInt(salt))));
}
const snapshot=e=>Object.fromEntries(fields.map(({name})=>[name,e['ctx_get_'+name]() ]));
seed(a,0);seed(b,57);
const originalA=snapshot(a),originalB=snapshot(b),size=a.context_size();
assert(size>0&&size<=4096);
// These buffers are deliberately WASM addresses, not guest addresses.
const wa=0x19000000,wb=wa+size+32,bytes=new Uint8Array(memory.buffer);
bytes.fill(0xa5,wa-16,wb+size+16);
a.save_context(wa);b.save_context(wb);
assert.deepStrictEqual(snapshot(a),originalA,'save is observational');
assert.deepStrictEqual(snapshot(b),originalB,'second instance save is observational');
const savedA=bytes.slice(wa,wa+size),savedB=bytes.slice(wb,wb+size);
seed(a,811);a.discard_cache();a.restore_context(wa);
assert.deepStrictEqual(snapshot(a),originalA,'all CPU fields restore exact bits after callback/cache clear');
assert.deepStrictEqual(snapshot(b),originalB,'restoring A never mutates B');
seed(b,901);b.discard_cache();b.restore_context(wb);
assert.deepStrictEqual(snapshot(b),originalB,'all second-instance fields restore exact bits');
assert.deepStrictEqual(snapshot(a),originalA,'restoring B never mutates A');
assert.deepStrictEqual(bytes.slice(wa,wa+size),savedA,'restore does not consume caller-owned frame');
assert.deepStrictEqual(bytes.slice(wb,wb+size),savedB);
for(const off of [wa-16,wa+size,wb-16,wb+size])assert(bytes.slice(off,off+16).every(b=>b===0xa5),'frame canary');
console.log(`PASS exact ${fields.length}-field CPU contexts: registers/lazy flags/segments/waits/x87 NaN and -0 bits/raw i64/MMX/XMM, cache clear, two shared-memory instances`);
