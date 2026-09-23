'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const apis=require('../src/api_table.json');
const extraWat=String.raw`
  (func (export "begin") (param $id i32) (param $sp i32) (param $cb i32) (param $ctx i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $dispatch_api_table (local.get $id) (i32.const 0) (local.get $cb) (local.get $ctx)
      (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "resume") (param $sp i32) (param $version i32) (param $result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (local.get $sp)
      (select (i32.const 20) (i32.const 28) (i32.eq (local.get $version) (i32.const 7)))))
    (i32.store (global.get $reg_base) (local.get $result))
    (call $d3d_enum_devices_continue))
  (func (export "live") (result i32)
    (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
`;
(async()=>{
  const {exports:e}=await bootRenderHarness({extraWat,fonts:'none'});e.init_dx_com_thunks();
  const stack=e.guest_alloc(2048)+1024, cb=0x12345678, ctx=0x22334455, ret=0x33445566;
  const versions=[1,2,3,7], baseline=e.live();
  const id=v=>apis.find(a=>a.name===`IDirect3D${v===1?'':v}_EnumDevices`).id;
  const start=(v,sp=stack,callback=cb,context=ctx,caller=ret)=>{
    e.guest_write32(sp,caller);e.guest_write32(sp+16,0xdeadbeef);
    e.begin(id(v),sp,callback,context);
    assert.strictEqual(e.get_eip(),callback);
    assert.strictEqual(e.get_esp(),sp+16-(v===7?24:32));
    return e.get_esp();
  };
  const string=p=>{let s='';for(let i=0;i<32;i++){const b=e.guest_read8(p+i);if(!b)return s;s+=String.fromCharCode(b);}throw Error('unterminated');};
  const payload=(v,sp)=>{
    const name=e.guest_read32(sp+(v===7?8:12));
    const context=e.guest_read32(sp+(v===7?16:24));
    return {name:string(name),context};
  };
  for(const outer of versions) for(const inner of versions) {
    const sp=start(outer), before=payload(outer,sp);
    const inside=start(inner,stack-256,cb+16,ctx+16,ret+16);
    e.resume(inside,inner,0);
    assert.strictEqual(e.get_eip(),ret+16);
    assert.deepStrictEqual(payload(outer,sp),before);
    e.resume(sp,outer,1);
    assert.strictEqual(e.get_eip(),cb,'outer callback restored after nested version '+inner);
    assert.strictEqual(payload(outer,e.get_esp()).context,ctx);
    e.resume(e.get_esp(),outer,0);
    assert.strictEqual(e.get_eip(),ret);
    assert.strictEqual(e.get_esp(),stack+16);
  }
  assert.strictEqual(e.live(),baseline,'all nested payload allocations released');
  for(const version of versions) for(let cycle=0;cycle<24;cycle++) {
    start(version);const names=[];
    while(e.get_eip()===cb) {
      assert(names.length<4);
      assert.strictEqual(e.live(),baseline+1,'all payloads share one owned allocation');
      const sp=e.get_esp(), item=payload(version,sp);
      assert.strictEqual(item.context,ctx);names.push(item.name);
      if(version!==7) {
        const guid=e.guest_read32(sp+4), hw=e.guest_read32(sp+16), hel=e.guest_read32(sp+20);
        assert.strictEqual(e.guest_read32(hw),252);assert.strictEqual(e.guest_read32(hel),252);
        assert.strictEqual(e.guest_read32(guid)>>>0,{ramp:0xf2086b20,rgb:0xa4665c60,hal:0x84e63de0}[item.name]);
        assert.strictEqual(e.guest_read32(hw+8),item.name==='hal'?2:0);
        assert.strictEqual(e.guest_read32(hel+8),item.name==='hal'?0:item.name==='ramp'?1:2);
      } else {
        const caps=e.guest_read32(sp+12);
        if(item.name==='hal')assert.strictEqual(e.guest_read32(caps),0x8aea0);
      }
      e.resume(sp,version,cycle%2?0:1);
    }
    const expected=version===7?['hal','rgb']:version===3?['rgb','hal']:['ramp','rgb','hal'];
    assert.deepStrictEqual(names,cycle%2?expected.slice(0,1):expected);
    assert.strictEqual(e.get_eip(),ret);assert.strictEqual(e.get_esp(),stack+16);
    assert.strictEqual(e.guest_read32(stack+16)>>>0,0xdeadbeef);
    assert.strictEqual(e.live(),baseline);
  }
  console.log('PASS D3D1/2/3/7 device enumeration: 16 nested pairs, payloads, ordering, ABI and 96 balanced cycles');
})().catch(error=>{console.error(error);process.exitCode=1;});
