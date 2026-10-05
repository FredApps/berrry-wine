'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const extraWat=String.raw`
  (func (export "begin") (param $stack i32) (param $cb i32) (param $ctx i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_api_table (call $lookup_api_id "IDirectDraw_EnumDisplayModes")
      (i32.const 0) (i32.const 0) (i32.const 0) (local.get $ctx) (local.get $cb) (i32.const 0)))
  (func (export "resume") (param $sp i32) (param $result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.add (local.get $sp) (i32.const 12)))
    (i32.store (global.get $reg_base) (local.get $result))
    (call $enum_modes_continue))
  (func (export "live") (result i32)
    (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
  (func (export "count") (result i32) (call $enum_mode_dense_count))
`;
(async()=>{
  const {exports:e}=await bootRenderHarness({extraWat,fonts:'none'});
  e.init_dx_com_thunks();
  const stack=e.guest_alloc(2048)+1024, cb=0x12345678, ret=0x22334455, ctx=0x44556677;
  const baseline=e.live();
  const start=(sp,callback=cb,context=ctx,caller=ret)=>{
    e.guest_write32(sp,caller);e.guest_write32(sp+24,0xdeadbeef);
    e.begin(sp,callback,context);
    assert.strictEqual(e.get_eip(),callback);
    assert.strictEqual(e.get_esp(),sp+8);
    assert.strictEqual(e.guest_read32(e.get_esp()+8),context);
    return e.get_esp();
  };
  const outerSp=start(stack), outerDesc=e.guest_read32(outerSp+4);
  const saved=Array.from({length:108},(_,i)=>e.guest_read8(outerDesc+i));
  const innerStack=stack-256, innerSp=start(innerStack,cb+16,ctx+16,ret+16);
  e.resume(innerSp,0);
  assert.strictEqual(e.get_eip(),ret+16);
  assert.strictEqual(e.get_esp(),innerStack+24);
  assert.deepStrictEqual(Array.from({length:108},(_,i)=>e.guest_read8(outerDesc+i)),saved);
  e.resume(outerSp,1);
  assert.strictEqual(e.get_eip(),cb,'outer callback identity survives nesting');
  assert.strictEqual(e.guest_read32(e.get_esp()+8),ctx);
  assert.strictEqual(e.guest_read32(e.get_esp()+4),outerDesc);
  assert.strictEqual(e.guest_read32(outerDesc+84),16,'outer advances from 8 to 16bpp');
  e.resume(e.get_esp(),0);
  assert.strictEqual(e.get_eip(),ret);
  assert.strictEqual(e.live(),baseline,'both nested records released');
  for(let run=0;run<64;run++) {
    start(stack);
    let count=0;
    const modes=[];
    while(e.get_eip()===cb) {
      assert(count++<100,'bounded mode enumeration');
      assert.strictEqual(e.live(),baseline+1);
      const sp=e.get_esp(), desc=e.guest_read32(sp+4);
      assert.strictEqual(e.guest_read32(desc),108);
      modes.push([12,8,84].map(n=>e.guest_read32(desc+n)));
      e.resume(sp,run%2?0:1);
    }
    assert.strictEqual(count,run%2?1:e.count());
    if(!(run%2)) {
      assert(modes.some(m=>m.join(',')==='320,200,8'));
      assert(!modes.some(m=>m[0]===320&&m[1]===200&&m[2]!==8));
      assert(modes.some(m=>m.join(',')==='1920,1080,32'));
    }
    assert.strictEqual(e.get_eip(),ret);
    assert.strictEqual(e.get_esp(),stack+24);
    assert.strictEqual(e.guest_read32(stack+24)>>>0,0xdeadbeef);
    assert.strictEqual(e.live(),baseline,'no descriptor leaks after completion or cancellation');
  }
  console.log('PASS DirectDraw nested mode callbacks, full mode sequence, cancellation and 64 allocation-balanced cycles');
})().catch(error=>{console.error(error);process.exitCode=1;});
