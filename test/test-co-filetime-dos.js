#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
  const {exports:w}=await bootRenderHarness({fonts:'none',extraWat:`
    (func (export "co_dos") (param i32 i32 i32) (result i32)
      (global.set $esp (i32.const 0x074ff000))
      (call $handle_CoFileTimeToDosDateTime (local.get 0) (local.get 1)
        (local.get 2) (i32.const 0) (i32.const 0) (i32.const 0)) (global.get $eax))
  `});
  const input=w.guest_alloc(8)>>>0,out=w.guest_alloc(8)>>>0;
  const setTime=s=>{const t=(BigInt(Date.parse(s))+11644473600000n)*10000n;
    w.guest_write32(input,Number(t&0xffffffffn));w.guest_write32(input+4,Number(t>>32n));};
  for(const [date,expectedDate,expectedTime] of [
    ['1980-01-01T00:00:00Z',33,0],
    ['2004-02-29T13:27:59Z',(24<<9)|(2<<5)|29,(13<<11)|(27<<5)|29],
    ['2107-12-31T23:59:58Z',(127<<9)|(12<<5)|31,(23<<11)|(59<<5)|29]]) {
    setTime(date);w.guest_write32(out,0xa5a5a5a5);w.guest_write32(out+4,0x12345678);
    assert.strictEqual(w.co_dos(input,out,out+2),1);
    assert.strictEqual(w.guest_read32(out)&0xffff,expectedDate);
    assert.strictEqual(w.guest_read32(out)>>>16,expectedTime);
    assert.strictEqual(w.guest_read32(out+4),0x12345678);
    assert.strictEqual(w.get_esp()>>>0,0x074ff010);
  }
  for(const date of ['1979-12-31T23:59:58Z','2108-01-01T00:00:00Z']) {
    setTime(date);w.guest_write32(out,0x12345678);
    assert.strictEqual(w.co_dos(input,out,out+2),0);assert.strictEqual(w.guest_read32(out),0x12345678);
  }
  setTime('2000-01-01T00:00:00Z');
  for(const args of [[0,out,out+2],[input,0,out+2],[input,out,0],
    [0xfffffffc,out,out+2],[input,0xffffffff,out+2],[input,out,0xffffffff]]) {
    w.guest_write32(out,0x12345678);assert.strictEqual(w.co_dos(...args),0);
    assert.strictEqual(w.guest_read32(out),0x12345678);assert.strictEqual(w.get_esp()>>>0,0x074ff010);
  }
  console.log('PASS CoFileTimeToDosDateTime: local-DLL wrapper contract, FAT boundaries, leap day and pointer validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
