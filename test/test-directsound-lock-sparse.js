#!/usr/bin/env node
'use strict';
// Real CreateSoundBuffer/Lock handlers and allocator, including low-heap spill.
// No guest instruction execution, REP fixture, renderer, or audio benchmark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {compileSrcWasm} = require('./compile-src');
const {createHostImports} = require('../lib/host-imports');
const {REGIONS} = require('../lib/region-map.generated');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
  (func (export "test_ds_call") (param $id i32) (param $a i32) (param $b i32)
      (param $c i32) (param $d i32) (param $e i32) (param $stack i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b)
      (local.get $c) (local.get $d) (local.get $e) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_ds_backing") (param $this i32) (result i32)
    (load.field DxObject misc1 (call $dx_from_this (local.get $this))))
  (func (export "test_inverse") (param $wa i32) (result i32)
    (call $w2g (local.get $wa)))
`;
async function run({beforeSource, wasmOutput} = {}) {
  const sourceProof = [];
  const wasm = compileSrcWasm((file, source) => {
    if (file === '09a8-handlers-directx.wat' && beforeSource) source = fs.readFileSync(beforeSource, 'utf8');
    if (file === '13-exports.wat') source += '\n' + extraWat;
    sourceProof.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex')});
    return source;
  });
  if (wasmOutput) {
    fs.writeFileSync(wasmOutput, wasm);
    fs.writeFileSync(wasmOutput + '.sources.json', JSON.stringify(sourceProof,null,2));
  }
  const memory = new WebAssembly.Memory({initial:8192,maximum:8192,shared:true});
  function imports() {
    const result = createHostImports({getMemory:()=>memory.buffer,renderer:null,resourceJson:{}});
    result.host.memory = memory;
    Object.assign(result.host,{create_thread:()=>0,exit_thread:()=>0,terminate_thread:()=>0,
      create_event:()=>0,set_event:()=>0,reset_event:()=>0,wait_single:()=>0,wait_multiple:()=>0,
      com_create_instance:()=>0x80004002});
    return result;
  }
  const module = await WebAssembly.compile(wasm);
  // Instantiate both BEFORE initialization, so data segments cannot reset live state.
  const one = await WebAssembly.instantiate(module, imports());
  const two = await WebAssembly.instantiate(module, imports());
  const e = one.exports, e2 = two.exports;
  const exe = fs.readFileSync('test/binaries/calc.exe');
  new Uint8Array(memory.buffer).set(exe,e.get_staging());
  assert(e.load_pe(exe.length),'real fixture initializes process and thunks');
  const imageBase=e.get_image_base()>>>0;
  e2.init_thread(1,imageBase,e.get_code_start(),e.get_code_end(),e.get_thunk_base(),e.get_thunk_end(),e.get_num_thunks(),0);
  const stack=e.guest_alloc(128)>>>0,out=e.guest_alloc(32)>>>0,desc=e.guest_alloc(36)>>>0,format=e.guest_alloc(20)>>>0;
  const read=p=>e.guest_read32(p)>>>0,write=(p,v)=>e.guest_write32(p,v);
  function call(owner,name,args,pop) {
    write(stack,0x12345678);
    args.forEach((v,i)=>write(stack+4+i*4,v));
    write(stack+pop,0xcafebabe);
    const result=owner.test_ds_call(apis.find(a=>a.name===name).id,...Array.from({length:5},(_,i)=>args[i]||0),stack)>>>0;
    assert.equal(owner.get_esp()>>>0,stack+pop,name+' exact stdcall cleanup');
    assert.equal(read(stack+pop),0xcafebabe,'stack sentinel');
    return result;
  }
  assert.equal(call(e,'DirectSoundCreate',[0,out,0],16),0);
  const root=read(out);
  [0x00010001,44100,88200,0x00100002,0].forEach((v,i)=>write(format+i*4,v));
  function create(size) {
    [20,0,size,0,format].forEach((v,i)=>write(desc+i*4,v));
    assert.equal(call(e,'IDirectSound_CreateSoundBuffer',[root,desc,out,0],20),0);
    return read(out);
  }
  function verify(owner,obj,size,offset,requested,flags,label) {
    for(let i=0;i<4;i++)write(out+i*4,0xdeadbeef);
    assert.equal(call(owner,'IDirectSoundBuffer_Lock',[obj,offset,requested,out,out+4,out+8,out+12,flags],36),0);
    const backing=e.test_ds_backing(obj)>>>0,base=e.test_inverse(backing)>>>0;
    const normalized=offset%size,total=flags&2?size:Math.min(requested,size);
    const n1=Math.min(total,size-normalized),n2=total-n1;
    assert.deepEqual([read(out+4),read(out+12)],[n1,n2],label+' lengths');
    assert.equal(read(out),base+normalized,label+' first pointer');
    assert.equal(read(out+8),n2?base:0,label+' wrap pointer');
    assert.equal(owner.guest_to_wasm(read(out))>>>0,backing+normalized,label+' first backing roundtrip');
    const dv=new DataView(memory.buffer);
    for(const [p,n,wa,value] of [[read(out),n1,backing+normalized,0x13572468],[read(out+8),n2,backing,0x24681357]]) {
      if(n<4)continue;
      owner.guest_write32(p,value);assert.equal(dv.getUint32(wa,true),value,label+' writes exact backing');
      owner.guest_write32(p+n-4,value^0x11111111);assert.equal(dv.getUint32(wa+n-4,true),(value^0x11111111)>>>0,label+' final byte extent');
    }
    return base;
  }
  function cases(obj,size,label) {
    for(const owner of [e,e2]) {
      verify(owner,obj,size,0,size,0,label+' full');
      verify(owner,obj,size,12,64,0,label+' offset');
      verify(owner,obj,size,size-16,64,0,label+' ring wrap');
      verify(owner,obj,size,size+12,size*2,0,label+' modulo and clamp');
      verify(owner,obj,size,0,1,2,label+' ENTIREBUFFER');
    }
  }
  const direct=create(4096),directBacking=e.test_ds_backing(direct)>>>0;
  assert(directBacking<REGIONS.VIRTUAL_BACKING_BASE.base,'first buffer direct');
  cases(direct,4096,'direct');
  let spill=0,allocations=0;
  for(;allocations<80;allocations++) {
    spill=e.guest_alloc(1024*1024)>>>0;assert(spill,'allocator exhaustion must not fake sparse pointer');
    const wa=e.guest_to_wasm(spill)>>>0;
    if(wa>=REGIONS.VIRTUAL_BACKING_BASE.base&&wa<REGIONS.VIRTUAL_BACKING_BASE.end)break;
  }
  assert(allocations<80,'real low heap spills into sparse backing');
  const size=344762;
  // A failed 1MiB low reservation can leave a smaller usable arena tail.
  // Consume it through real buffer creation, rather than rewriting allocator state.
  let sparse=0,backing=0,tailBuffers=0;
  for(;tailBuffers<16;tailBuffers++) {
    sparse=create(size);backing=e.test_ds_backing(sparse)>>>0;
    if(backing>=REGIONS.VIRTUAL_BACKING_BASE.base&&backing<REGIONS.VIRTUAL_BACKING_BASE.end)break;
  }
  assert(tailBuffers<16,'DS backing truly sparse after bounded real allocations');
  cases(sparse,size,'sparse');
  const result={passed:true,directAndSparse:true,instances:2,cases:20,allocations:allocations+1,
    wasmSha256:crypto.createHash('sha256').update(wasm).digest('hex'),beforeSource:beforeSource||null};
  console.log(JSON.stringify(result));return result;
}
if(require.main===module) {
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  run({beforeSource:get('--before-source'),wasmOutput:get('--wasm-output')}).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={run};
