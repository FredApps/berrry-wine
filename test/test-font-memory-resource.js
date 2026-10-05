#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
  const {exports:w,memory}=await bootRenderHarness({extraWat:`
    (func (export "add_memory_font") (param i32 i32 i32 i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_AddFontMemResourceEx (local.get 0) (local.get 1) (local.get 2)
        (local.get 3) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "remove_memory_font") (param i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_RemoveFontMemResourceEx (local.get 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "memory_face") (param i32) (result i32)
      (call $tt_mem_face (call $g2w (local.get 0)) (i32.const 400) (i32.const 0)))
    (func (export "face_data") (param i32) (result i32) (call $tt_face_data (local.get 0)))
    (func (export "enum_name") (param i32) (result i32) (call $tt_enum_face_name (local.get 0)))
  `});
  const bytes=new Uint8Array(memory.buffer),wa=p=>w.guest_to_wasm(p)>>>0;
  const font=fs.readFileSync(path.join(__dirname,'../fonts/wine/marlett.ttf'));
  const input=w.guest_alloc(font.length)>>>0;bytes.set(font,wa(input));
  const out=w.guest_alloc(8)>>>0,name=w.guest_alloc(64)>>>0;
  bytes.set(Buffer.from('Marlett\0'),wa(name));
  const enumerate=()=>{const names=[];for(let i=0;i<200;i++){
    const p=w.enum_name(i)>>>0;if(!p)break;
    let s='';for(let j=0;j<64&&bytes[p+j];j++)s+=String.fromCharCode(bytes[p+j]);names.push(s);
  }return names;};
  const before=enumerate();
  for(const args of [[0,font.length,0,out],[input,11,0,out],[input,font.length,1,out],
    [input,font.length,0,0],[0xfffffff0,64,0,out],[input,0x400001,0,out]]) {
    assert.strictEqual(w.add_memory_font(...args),0);
    assert.strictEqual(w.get_esp()>>>0,0x074ff014);
  }
  w.guest_write32(out,0xa5a5a5a5);w.guest_write32(out+4,0x12345678);
  const handle=w.add_memory_font(input,font.length,0,out)>>>0;assert(handle);
  assert.strictEqual(w.guest_read32(out),1);assert.strictEqual(w.guest_read32(out+4),0x12345678);
  const face=w.memory_face(name);assert(face>=0);
  assert.deepStrictEqual(enumerate(),before,'memory font does not enter enumeration');
  bytes.fill(0,wa(input),wa(input)+font.length);
  assert.deepStrictEqual(Buffer.from(bytes.slice(w.face_data(face),w.face_data(face)+font.length)),font,
    'the font owns an independent byte copy');
  const strike=w.test_tt_strike_ensure(wa(name),-16,400,0)>>>0;
  assert(strike,'copied memory font rasterizes through the existing strike provider');
  assert.strictEqual(w.add_memory_font(input,font.length,0,out),0,'malformed bytes rejected');
  assert.strictEqual(w.remove_memory_font(handle+1),0);
  assert.strictEqual(w.remove_memory_font(handle),1);
  assert.strictEqual(w.get_esp()>>>0,0x074ff008);
  assert.strictEqual(w.memory_face(name),-1,'removed font no longer selected');
  assert.strictEqual(w.remove_memory_font(handle),0,'stale handle rejected');
  assert(w.face_data(face),'existing realization retains its cached source');
  console.log('PASS memory font: copied bytes, rasterization, private enumeration, validation and removal');
})().catch(e=>{console.error(e);process.exitCode=1;});
