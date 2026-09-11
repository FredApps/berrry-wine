#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
  const methods=['SetMaterial','GetMaterial','SetLight','GetLight','LightEnable','GetLightEnable',
    'BeginStateBlock','EndStateBlock','GetRenderState'];
  const {exports:e,memory}=await bootRenderHarness({fonts:'none',extraWat:`
    (func (export "device") (param $out i32) (result i32)
      (local $d i32)
      (call $d3dim_create_device (i32.const 0) (i32.const 0) (local.get $out) (global.get $DX_VTBL_D3DDEV9))
      (local.set $d (call $gl32 (local.get $out)))
      (store.field DxObject type (call $dx_from_this (local.get $d)) (i32.const 20))
      (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
      (call $d3d9_default_output (local.get $d) (i32.const 0)) (local.get $d))
    (func (export "state") (param $d i32) (result i32) (call $d3d9_program_state (local.get $d)))
    (func (export "free_head") (result i32) (global.get $free_list))
    ${[...methods.map(n=>['IDirect3DDevice9',n]),...['Capture','Apply','Release'].map(n=>['IDirect3DStateBlock9',n]),
      ['IDirect3DDevice9','Release']].map(([type,n])=>`
      (func (export "${type}_${n}") (param $a i32) (param $b i32) (param $c i32) (result i32)
        (global.set $esp (i32.const 0x074ff000))
        (call $handle_${type}_${n} (local.get $a) (local.get $b) (local.get $c) (i32.const 0) (i32.const 0) (i32.const 0))
        (global.get $eax))`).join('\n')}
  `});
  e.init_dx_com_thunks();
  const out=0x00409000,source=out+128,copy=out+384,d=e.device(out),invalid=0x8876086c;
  const call=(n,...args)=>e['IDirect3DDevice9_'+n](d,...args)>>>0;
  const block=(n,...args)=>e['IDirect3DStateBlock9_'+n](...args)>>>0;
  const read=p=>e.guest_read32(p)>>>0,bytes=(p,n)=>new Uint8Array(memory.buffer,e.guest_to_wasm(p),n);
  const floats=(p,n)=>new Float32Array(memory.buffer,e.guest_to_wasm(p),n);
  for(const [rs,value] of [[137,1],[139,0],[141,1],[142,1],[143,0],[145,1],[146,2],[147,0],[148,0]]){
    assert.strictEqual(call('GetRenderState',rs,out),0);assert.strictEqual(read(out),value);
  }
  bytes(copy,68).fill(0xcc);assert.strictEqual(call('GetMaterial',copy),0);
  assert(bytes(copy,68).every(v=>v===0),'documented default material is all zero');
  floats(source,17).set(Array.from({length:17},(_,i)=>i/32));const material=bytes(source,68).slice();
  assert.strictEqual(call('SetMaterial',source),0);bytes(source,68).fill(0);
  assert.strictEqual(call('GetMaterial',copy),0);assert.deepStrictEqual(bytes(copy,68),material);
  assert.strictEqual(e.get_esp()>>>0,0x074ff00c);
  for(const p of [0,0xfffffff0]){
    assert.strictEqual(call('SetMaterial',p),invalid);assert.strictEqual(call('GetMaterial',p),invalid);
    assert.strictEqual(call('SetLight',7,p),invalid);assert.strictEqual(call('GetLight',7,p),invalid);
  }
  assert.strictEqual(call('GetLight',7,copy),invalid);assert.strictEqual(call('GetLightEnable',7,out),invalid);
  assert.strictEqual(call('LightEnable',7,0),0,'disabling an unknown index also creates its default');
  assert.strictEqual(call('GetLight',7,copy),0);assert.strictEqual(read(copy),3);
  assert.strictEqual(call('GetLightEnable',7,out),0);assert.strictEqual(read(out),0);
  const index=0xf1234567;
  assert.strictEqual(call('LightEnable',index,37),0);assert.strictEqual(call('GetLightEnable',index,out),0);assert(read(out));
  assert.strictEqual(call('GetLight',index,copy),0);
  assert.strictEqual(read(copy),3);assert.deepStrictEqual(Array.from(floats(copy+4,4)),[1,1,1,0]);
  assert.deepStrictEqual(Array.from(floats(copy+64,3)),[0,0,1]);
  assert(bytes(copy+16,48).every(v=>v===0));assert(bytes(copy+76,28).every(v=>v===0));
  bytes(source,104).set(bytes(copy,104));floats(source+4,1)[0]=.25;
  const light=bytes(source,104).slice();assert.strictEqual(call('SetLight',index,source),0);bytes(source,104).fill(0);
  assert.strictEqual(call('GetLight',index,copy),0);assert.deepStrictEqual(bytes(copy,104),light);
  assert.strictEqual(call('GetLightEnable',index,out),0);assert(read(out),'SetLight preserves enable');
  assert.strictEqual(call('SetLight',index,source),invalid,'invalid type is rejected before mutation');
  assert.strictEqual(call('GetLight',index,copy),0);assert.deepStrictEqual(bytes(copy,104),light);
  for(const type of [1,2]){
    bytes(source,104).set(light);e.guest_write32(source,type);
    assert.strictEqual(call('SetLight',type,source),0);assert.strictEqual(call('GetLight',type,copy),0);
    assert.strictEqual(read(copy),type);assert.strictEqual(call('GetLightEnable',type,out),0);
    assert.strictEqual(read(out),0,'new SetLight does not enable its light');
  }
  assert.strictEqual(call('BeginStateBlock'),0);
  bytes(source,104).set(light);floats(source+4,1)[0]=.75;
  assert.strictEqual(call('SetLight',index,source),0);
  assert.strictEqual(call('GetLight',index,copy),0);assert.deepStrictEqual(bytes(copy,104),light);
  assert.strictEqual(call('EndStateBlock',out),0);const definition=read(out);
  assert.strictEqual(block('Apply',definition),0);assert.strictEqual(call('GetLight',index,copy),0);
  assert.strictEqual(floats(copy+4,1)[0],.75);assert.strictEqual(call('GetLightEnable',index,out),0);assert(read(out));
  bytes(source,104).set(light);assert.strictEqual(call('SetLight',index,source),0);
  assert.strictEqual(block('Capture',definition),0);
  floats(source+4,1)[0]=.5;assert.strictEqual(call('SetLight',index,source),0);
  assert.strictEqual(block('Apply',definition),0);assert.strictEqual(call('GetLight',index,copy),0);
  assert.deepStrictEqual(bytes(copy,104),light);assert.strictEqual(block('Release',definition),0);
  assert.strictEqual(call('BeginStateBlock'),0);
  floats(source,17).fill(.5);assert.strictEqual(call('SetMaterial',source),0);
  assert.strictEqual(call('LightEnable',index,0),0);
  assert.strictEqual(call('LightEnable',0xffffffff,1),0,'recorded undefined light creates its default in block only');
  assert.strictEqual(call('GetLight',0xffffffff,copy),invalid);
  assert.strictEqual(call('GetLightEnable',index,out),0);assert(read(out));
  assert.strictEqual(call('GetMaterial',copy),0);assert.deepStrictEqual(bytes(copy,68),material);
  assert.strictEqual(call('EndStateBlock',out),0);const b=read(out);
  assert.strictEqual(block('Apply',b),0);
  assert.strictEqual(call('GetMaterial',copy),0);assert(floats(copy,17).every(v=>v===.5));
  assert.strictEqual(call('GetLightEnable',index,out),0);assert.strictEqual(read(out),0);
  assert.strictEqual(call('GetLight',index,copy),0);assert.deepStrictEqual(bytes(copy,104),light,'enable-only block preserves definition');
  assert.strictEqual(call('GetLightEnable',0xffffffff,out),0);assert(read(out));
  assert.strictEqual(call('LightEnable',index,1),0);assert.strictEqual(block('Capture',b),0);
  assert.strictEqual(call('LightEnable',index,0),0);assert.strictEqual(block('Apply',b),0);
  assert.strictEqual(call('GetLightEnable',index,out),0);assert(read(out));
  const blockHead=read(b+22312),liveHead=read(e.state(d)+21996);
  assert(blockHead&&liveHead&&blockHead!==liveHead,'block owns detached light nodes');
  const freed=p=>{let q=e.free_head()>>>0;for(let i=0;q&&i<1000;i++,q=read(q+4))if(q===p-4)return true;return false;};
  assert.strictEqual(block('Release',b),0);assert(freed(blockHead));
  assert.strictEqual(e.IDirect3DDevice9_Release(d),0);assert(freed(liveHead));
  console.log('PASS native D3D9 material/light state: defaults, DWORD indices, copies, getters, selective blocks and retirement');
})().catch(error=>{console.error(error);process.exitCode=1;});
