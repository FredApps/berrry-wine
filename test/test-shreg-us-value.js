'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const observations = require('./fixtures/win98-shreg-us-value/observations.json');
const cases = [
  ['Both',0,16,0], ['Both',1,16,0], ['Both',2,16,0], ['MachineOnly',0,16,0],
  [null,0,16,0], ['Both',0,0,0,true], ['Both',0,2,0], ['Both',0,2,4],
  ['Sized',0,4,0], ['Sized',0,4,4], ['BothTooLarge',0,4,0], ['BothTooLarge',0,4,4],
  ['UserOnlyLarge',0,4,0], ['UserOnlyLarge',0,4,4], ['Both',0,2,1],
  ['Absent',0,16,0], ['Absent',0,16,4],
  ['Absent',0,16,0,false,true], ['Absent',0,0,4,false,true],
  ['Absent',0,2,4,false,true], ['Absent',0,4,4,false,true], ['Absent',0,16,4,false,true],
];
const extraWat = String.raw`
  (func (export "query") (param $stack i32) (result i32)
    (global.set $last_error (i32.const 0x5a5aa55a))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (call $lookup_api_id "SHRegGetUSValueA")
      (call $gl32 (i32.add (local.get $stack) (i32.const 4)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 8)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 12)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 16)))
      (call $gl32 (i32.add (local.get $stack) (i32.const 20))) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "last_error") (result i32) (global.get $last_error))
`;
(async () => {
  const { exports: e, host } = await bootRenderHarness({ fonts: 'none', extraWat });
  const alloc = n => e.guest_alloc(n) >>> 0;
  const wa = p => e.guest_to_wasm(p) >>> 0;
  const put = (p, bytes) => bytes.forEach((b,i) => e.guest_write8(p+i,b));
  const string = text => { const b = Buffer.from(text+'\0'); const p=alloc(b.length);put(p,b);return p; };
  const keyText = 'Software\\WineAssemblySHRegUSReference';
  const key = string(keyText), keyOut = alloc(4), data = alloc(8);
  for (const [root,user] of [[0x80000001,true],[0x80000002,false]]) {
    assert.strictEqual(host.reg_create_key(root,wa(key),keyOut,0,0),0);
    const handle=e.guest_read32(keyOut)>>>0;
    const values=[['Both',4],['Sized',user?8:4],['BothTooLarge',user?8:6], [null,4],
      [user?'UserOnlyLarge':'MachineOnly',user?8:4]];
    put(data,Array.from({length:8},(_,i)=>(user?0x10:0x20)+i));
    for(const [name,size] of values) assert.strictEqual(host.reg_set_value(handle,name?wa(string(name)):0,3,data,size,0),0);
    host.reg_close_key(handle);
  }
  // Map adjacent guest pages with another allocation interposed in backing.
  let sparseIndex=0;
  const sparse=()=>{
    const base=0x30000000+sparseIndex++*0x10000;
    for(const addr of [base,base+0x8000,base+4096]) assert.strictEqual(e.test_virtual_map_commit(addr,4096)>>>0,addr);
    assert.notStrictEqual(wa(base+4096),wa(base)+4096);
    return base+4094;
  };
  const failures=[];
  for(const layout of ['heap','sparse']) {
    const ptr=n=>layout==='heap'?alloc(n):sparse();
    const stack=ptr(40), type=ptr(4), size=ptr(4), output=ptr(16), fallback=ptr(8);
    const path=ptr(128), value=ptr(64);
    for(const [i,options] of cases.entries()) {
      const [name,ignore,capacity,defaultSize,queryOnly=false,missing=false]=options;
      put(path,Buffer.from(keyText+(missing?'\\Missing':'')+'\0'));
      if(name!==null)put(value,Buffer.from(name+'\0'));
      put(output,Array(16).fill(0xa5));put(fallback,Array.from({length:8},(_,j)=>0xd0+j));
      e.guest_write32(type,0x12345678);e.guest_write32(size,capacity);
      e.guest_write32(stack+36,0xdeadbeef);
      [path,name===null?0:value,type,queryOnly?0:output,size,ignore,defaultSize?fallback:0,defaultSize]
        .forEach((a,j)=>e.guest_write32(stack+4+j*4,a));
      const ret=e.query(stack)>>>0;
      const actual={name:observations[i].name,ret,type:e.guest_read32(type)>>>0,size:e.guest_read32(size)>>>0,
        last:e.last_error()>>>0,data:Buffer.from(Array.from({length:16},(_,j)=>e.guest_read8(output+j))).toString('hex')};
      try {
        assert.deepStrictEqual(actual,observations[i]);
        assert.strictEqual(e.get_esp()>>>0,stack+36);
        assert.strictEqual(e.guest_read32(stack+36)>>>0,0xdeadbeef);
      } catch(error) { failures.push(`${layout}/${actual.name}: ${error.message}`); }
    }
  }
  assert.deepStrictEqual(failures,[]);
  // Transport extension beyond the small native fixture: no 16/64-KiB copy
  // cap, and a huge declared capacity must not trigger a huge allocation.
  const length=70000, large=alloc(length), largeName=string('Large');
  const expected=Buffer.from(Array.from({length},(_,i)=>(i*17+3)&255));
  put(large,expected);
  assert.strictEqual(host.reg_create_key(0x80000002,wa(key),keyOut,0,0),0);
  const handle=e.guest_read32(keyOut)>>>0;
  assert.strictEqual(host.reg_set_value(handle,wa(largeName),3,large,length,0),0);
  host.reg_close_key(handle);
  const base=0x38000000;
  for(let offset=0;offset<length+4096;offset+=4096) {
    for(const addr of [base+offset,0x39000000+offset]) assert.strictEqual(e.test_virtual_map_commit(addr,4096)>>>0,addr);
  }
  assert.notStrictEqual(wa(base+4096),wa(base)+4096);
  const output=base+4094,stack=alloc(40),type=alloc(4),size=alloc(4);
  for(const capacity of [length,0xffffffff]) {
    e.guest_write32(size,capacity);e.guest_write8(output+length,0xa5);
    [key,largeName,type,output,size,1,0,0].forEach((a,i)=>e.guest_write32(stack+4+i*4,a));
    assert.strictEqual(e.query(stack),0);
    assert.strictEqual(e.guest_read32(size)>>>0,length);
    assert.strictEqual(e.guest_read32(type),3);
    assert.deepStrictEqual(Buffer.from(Array.from({length},(_,i)=>e.guest_read8(output+i))),expected);
    assert.strictEqual(e.guest_read8(output+length),0xa5);
    assert.strictEqual(e.get_esp()>>>0,stack+36);
  }
  console.log('PASS SHRegGetUSValueA: 22 native cases on heap/sparse, plus 70KB sparse payload and oversized capacity');
})().catch(error=>{console.error(error);process.exitCode=1;});
