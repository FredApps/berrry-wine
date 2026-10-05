#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
  const {exports:w}=await bootRenderHarness({fonts:'none',extraWat:`
    (func (export "key_name_w") (param i32 i32 i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetKeyNameTextW (local.get 0) (local.get 1) (local.get 2)
        (i32.const 0) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
  `});
  const out=w.guest_alloc(128)>>>0;
  for(const [scan,name] of [[1,'Esc'],[0x0e,'Backspace'],[0x10,'Q'],[0x1e,'A'],
    [0x39,'Space'],[0x3a,'Caps Lock'],[0x3b,'F1'],[0x58,'F12'],[0x47,'Num 7']]) {
    for(const size of [1,2,5,64]) {
      for(let i=0;i<128;i++)w.guest_write8(out+i,0xa5);
      const expected=name.slice(0,size-1),n=w.key_name_w(scan<<16,out,size);
      assert.strictEqual(n,expected.length);
      let actual='';for(let i=0;i<n;i++)actual+=String.fromCharCode(w.guest_read32(out+i*2)&0xffff);
      assert.strictEqual(actual,expected);assert.strictEqual(w.guest_read32(out+n*2)&0xffff,0);
      assert.strictEqual(w.guest_read8(out+(n+1)*2),0xa5,'bounded UTF-16 output');
      assert.strictEqual(w.get_esp()>>>0,0x074ff010);
    }
  }
  for(const size of [0,-1])assert.strictEqual(w.key_name_w(0,out,size),0);
  assert.strictEqual(w.key_name_w(0,0,10),0);
  console.log('PASS Unicode key names: existing US mapping, truncation, terminator and stdcall');
})().catch(e=>{console.error(e);process.exitCode=1;});
