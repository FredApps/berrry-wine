'use strict';
const assert=require('node:assert/strict');
const {compileSrcWasm}=require('./compile-src');
const sigs=require('../lib/host-import-sigs.generated.json').sigs;
const extra=String.raw`
  (func (export "bstr_alloc") (param $src i32) (param $len i32) (result i32)
    (call $handle_SysAllocStringLen (local.get $src) (local.get $len)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "bstr_realloc") (param $slot i32) (param $src i32) (param $len i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00480000))
    (call $gs32 (i32.const 0x00480000) (i32.const 0x00401000))
    (call $gs32 (i32.const 0x00480004) (local.get $slot))
    (call $gs32 (i32.const 0x00480008) (local.get $src))
    (call $gs32 (i32.const 0x0048000c) (local.get $len))
    ;; Actual resolved API thunk, append-only API id. Before the fix the
    ;; generated dispatch has no such handler and traps, as the guest did.
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (i32.const 4475))
    (call $win32_dispatch (i32.const 0))
    (i32.load (global.get $reg_base)))
`;
(async()=>{
  const bytes=compileSrcWasm((name,s)=>name==='13-exports.wat'?s+'\n'+extra:s);
  const memory=new WebAssembly.Memory({initial:8192,maximum:32768,shared:true}),host={memory};
  for(const [name,sig]of Object.entries(sigs))host[name]=sig.results?.length?()=>0:()=>{};
  const e=(await WebAssembly.instantiate(bytes,{host})).instance.exports;
  e.init_thread(0,0x400000,0,0,0,0,0);e.heap_init(0x500000);
  const src=0x403000,slot=0x404000,values=[65,0,66,0xd83d,0xde00];
  values.forEach((v,i)=>{e.guest_write8(src+i*2,v&255);e.guest_write8(src+i*2+1,v>>>8);});
  const read16=p=>e.guest_read8(p)|(e.guest_read8(p+1)<<8);
  const old=e.bstr_alloc(src,values.length)>>>0;assert(old);e.guest_write32(slot,old);
  assert.equal(e.bstr_realloc(slot,old+2,3),1,'self-aliasing slice reallocates through real dispatch');
  const b=e.guest_read32(slot)>>>0;assert.notEqual(b,old);assert.equal(e.guest_read32(b-4),6);
  assert.deepEqual([0,1,2].map(i=>read16(b+i*2)),values.slice(1,4));assert.equal(read16(b+6),0);
  assert.equal(e.get_esp()>>>0,0x480010,'stdcall pops return plus all three arguments');
  assert.equal(e.bstr_realloc(slot,src,0xffffffff),0,'overflow fails before allocation/copy');
  assert.equal(e.guest_read32(slot)>>>0,b,'failure retains original pointer');assert.equal(read16(b+2),66,'failure retains original content');
  assert.equal(e.bstr_realloc(slot,src,0x3ffffff5),0,'valid length reaches heap allocation and fails in the 512MiB fixture');
  assert.equal(e.guest_read32(slot)>>>0,b,'heap allocation failure retains original pointer');
  assert.equal(read16(b+2),66,'heap allocation failure retains original content');
  assert.equal(e.bstr_realloc(slot,0,8),1,'NULL source allocates an uninitialized counted string');
  const uninit=e.guest_read32(slot)>>>0;assert.equal(e.guest_read32(uninit-4),16);assert.equal(read16(uninit+16),0);
  assert.equal(e.bstr_realloc(slot,src,0),1,'zero length remains a valid empty BSTR');
  const empty=e.guest_read32(slot)>>>0;assert(empty);assert.equal(e.guest_read32(empty-4),0);assert.equal(read16(empty),0);
  e.guest_write32(slot,0);assert.equal(e.bstr_realloc(slot,src,values.length),1,'NULL old BSTR supports initial allocation');
  const fresh=e.guest_read32(slot)>>>0;assert.deepEqual(values.map((_,i)=>read16(fresh+i*2)),values);
  console.log('PASS BSTR reallocation: real dispatch, aliased/embedded-NUL UTF16, terminator, NULL source/old, zero length, overflow preservation, stdcall');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
