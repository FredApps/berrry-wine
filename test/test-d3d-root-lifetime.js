'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const apis=require('../src/api_table.json');
const extraWat=String.raw`
  (func (export "create") (param $v i32) (result i32)
    (if (i32.eq (local.get $v) (i32.const 1))
      (then (return (call $dx_create_com_obj (i32.const 8) (global.get $DX_VTBL_D3D)))))
    (if (i32.eq (local.get $v) (i32.const 2))
      (then (return (call $dx_create_com_obj (i32.const 9) (global.get $DX_VTBL_D3D2)))))
    (if (i32.eq (local.get $v) (i32.const 3))
      (then (return (call $dx_create_com_obj (i32.const 9) (global.get $DX_VTBL_D3D3)))))
    (call $dx_create_com_obj (i32.const 9) (global.get $DX_VTBL_D3D7)))
  (func (export "invoke") (param $id i32) (param $sp i32)
      (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b)
      (local.get $c) (local.get $d) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "refs") (param $p i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $p))))
  (func (export "kind") (param $p i32) (result i32)
    (load.field DxObject type (call $dx_from_this (local.get $p))))
  (func (export "live") (result i32)
    (i32.sub (global.get $heap_stat_allocs) (global.get $heap_stat_frees)))
`;
(async()=>{
  const {exports:e}=await bootRenderHarness({extraWat,fonts:'none'});
  e.init_dx_com_thunks();
  const sp=e.guest_alloc(128), out=e.guest_alloc(4);
  const root=v=>'IDirect3D'+(v===1?'':v);
  const call=(name,args,pop)=>{
    e.guest_write32(sp+pop,0xdeadbeef);
    const result=e.invoke(apis.find(a=>a.name===name).id,sp,...args.concat([0,0,0,0]).slice(0,4))>>>0;
    assert.strictEqual(e.get_esp(),sp+pop,name+' stdcall cleanup');
    assert.strictEqual(e.guest_read32(sp+pop)>>>0,0xdeadbeef,name+' stack guard');
    return result;
  };
  for(const v of [1,2,3,7]) {
    const p=e.create(v);
    assert.strictEqual(call(root(v)+'_AddRef',[p],8),2,'D3D'+v+' AddRef changes state');
    assert.strictEqual(e.refs(p),2);
    assert.strictEqual(call(root(v)+'_Release',[p],8),1);
    assert.notStrictEqual(e.kind(p),0);
    assert.strictEqual(call(root(v)+'_Release',[p],8),0);
    assert.strictEqual(e.kind(p),0,'final release retires root');
  }
  for(const v of [2,3,7]) for(const parentFirst of [false,true]) {
    const p=e.create(v), baseline=e.live(), name=root(v);
    const devName='IDirect3DDevice'+v;
    assert.strictEqual(call(name+'_CreateDevice',[p,0,0,out],v===3?24:20),0);
    const dev=e.guest_read32(out);
    assert(dev);assert.strictEqual(e.refs(p),2,'device retains creator');
    if(parentFirst)assert.strictEqual(call(name+'_Release',[p],8),1);
    assert.strictEqual(call(devName+'_GetDirect3D',[dev,out],12),0);
    const queried=e.guest_read32(out);
    assert.strictEqual(e.guest_read32(queried+4),e.guest_read32(p+4),'GetDirect3D returns creator slot');
    assert.strictEqual(call(name+'_Release',[queried],8),parentFirst?1:2);
    assert.strictEqual(call(devName+'_AddRef',[dev],8),2);
    assert.strictEqual(call(devName+'_Release',[dev],8),1);
    assert.strictEqual(e.refs(p),parentFirst?1:2,'nonfinal device release retains parent');
    assert.strictEqual(call(devName+'_Release',[dev],8),0);
    assert.strictEqual(e.kind(dev),0);
    if(parentFirst)assert.strictEqual(e.kind(p),0,'last device retires creator');
    else {
      assert.strictEqual(e.refs(p),1,'caller-owned parent survives device');
      assert.strictEqual(call(name+'_Release',[p],8),0);
    }
    assert.strictEqual(e.live(),baseline,'device state freed');
  }
  console.log('PASS D3D1/2/3/7 root lifetimes and six device-parent release-order cases');
})().catch(error=>{console.error(error);process.exitCode=1;});
