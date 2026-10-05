#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
(async () => {
  let hostValidationCalls = 0;
  const { exports: e } = await bootRenderHarness({fonts:'none',
    extraHostOverrides:{gpu_gl_call:opcode=>{
      if(opcode===0x30000)hostValidationCalls++;
      throw new Error('shader creation must not require host graphics');
    }}, extraWat:`
      (func (export "native_shader_device") (result i32)
        (local $d i32)
        (local.set $d (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
        (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
        (local.get $d))
      (func (export "native_shader_create") (param $d i32) (param $code i32) (param $out i32) (param $pixel i32) (result i32)
        (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
        (if (local.get $pixel)
          (then (call $handle_IDirect3DDevice9_CreatePixelShader (local.get $d) (local.get $code)
            (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)))
          (else (call $handle_IDirect3DDevice9_CreateVertexShader (local.get $d) (local.get $code)
            (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0))))
        (i32.load offset=0 (global.get $reg_base)))
    `});
  e.init_dx_com_thunks();
  const device=e.native_shader_device(),code=e.guest_alloc(24),out=e.guest_alloc(4);
  for(const pixel of [0,1]){
    const words=[pixel?0xffff0101:0xfffe0101,1,pixel?0x800f0000:0xc00f0000,0x90e40000,0xffff];
    words.forEach((v,i)=>e.guest_write32(code+i*4,v));
    assert.strictEqual(e.native_shader_create(device,code,out,pixel),0);
    assert.strictEqual(e.get_esp()>>>0,0x074ff010);
    const shader=e.guest_read32(out)>>>0;
    assert(shader); assert.strictEqual(e.guest_read32(shader+16),20);
    assert.deepStrictEqual(words.map((_,i)=>e.guest_read32(shader+24+i*4)>>>0),words);
    e.guest_write32(code+4,254);
    assert.strictEqual(e.guest_read32(shader+28),1,'caller mutation cannot change retained shader');
    assert.strictEqual(e.native_shader_create(device,code,out,pixel)>>>0,0x8876086c);
    assert.strictEqual(e.guest_read32(out),0);
    words.forEach((v,i)=>e.guest_write32(code+i*4,v));
    assert.strictEqual(e.native_shader_create(device,code,out,1-pixel)>>>0,0x8876086c,'stage mismatch');
    for(const bad of [0,code+1,0xffffffff])
      assert.strictEqual(e.native_shader_create(device,bad,out,pixel)>>>0,0x8876086c);
  }
  assert.strictEqual(hostValidationCalls,0);
  console.log('PASS D3D9 native shader creation: no host graphics, owned bytecode, stage/errors and ABI');
})().catch(error=>{console.error(error);process.exitCode=1;});
