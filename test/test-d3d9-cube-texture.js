#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
 const {exports:e}=await bootRenderHarness({fonts:'none',extraWat:`
 (func (export "device") (param $out i32) (result i32)
   (local $d i32)
   (call $d3dim_create_device (i32.const 0) (i32.const 0) (local.get $out) (global.get $DX_VTBL_D3DDEV9))
   (local.set $d (call $gl32 (local.get $out)))
   (store.field DxObject misc1 (call $dx_from_this (local.get $d)) (call $d3d9_program_alloc))
   (local.get $d))
 (func (export "create") (param $d i32) (param $size i32) (param $levels i32) (param $usage i32) (param $out i32) (param $format i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (i32.const 1))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $out))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (i32.const 0))
   (call $handle_IDirect3DDevice9_CreateCubeTexture (local.get $d) (local.get $size) (local.get $levels)
     (local.get $usage) (select (local.get $format) (i32.const 21) (local.get $format)) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
 (func (export "surface_unlock") (param $s i32) (result i32)
   (call $d3d9_texture_surface_unlock (local.get $s)) (i32.load offset=0 (global.get $reg_base)))
 (func (export "surface_release") (param $s i32) (result i32)
   (call $d3d9_texture_surface_release (local.get $s)))
 (func (export "QueryInterface") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_QueryInterface (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "AddRef") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_AddRef (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "Release") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_Release (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetDevice") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetDevice (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "SetPriority") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_SetPriority (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetPriority") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetPriority (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "PreLoad") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_PreLoad (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetType") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetType (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "SetLOD") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_SetLOD (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetLOD") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetLOD (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetLevelCount") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetLevelCount (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetLevelDesc") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetLevelDesc (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "GetCubeMapSurface") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_GetCubeMapSurface (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "LockRect") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_LockRect (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "UnlockRect") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_UnlockRect (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
(func (export "AddDirtyRect") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $f i32) (param $g i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
   (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $g))
   (call $handle_IDirect3DCubeTexture9_AddDirtyRect (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $f) (i32.const 0))
   (i32.load offset=0 (global.get $reg_base)))
 `});
 e.init_dx_com_thunks();
 const out=0x00409000,d=e.device(out),read=p=>e.guest_read32(p)>>>0,write=(p,v)=>e.guest_write32(p,v);
 const invalid=0x8876086c;
 for(const [size,levels,usage] of [[0,1,0],[2049,1,0],[4,4,0],[4,1,1],[4,1,1024]])
   {assert.strictEqual(e.create(d,size,levels,usage,out)>>>0,invalid);assert.strictEqual(read(out),0);}
 assert.strictEqual(e.create(d,4,0,0,out),0); const t=read(out);
 assert.strictEqual(e.get_esp()>>>0,0x074ff024);
 assert.strictEqual(e.GetType(t),5);assert.strictEqual(e.GetLevelCount(t),3);
 const addresses=new Set(),surfaces=[];
 for(let face=0;face<6;face++)for(let level=0;level<3;level++){
   assert.strictEqual(e.GetLevelDesc(t,level,out),0);const size=4>>level;
   assert.strictEqual(read(out+24),size);assert.strictEqual(read(out+28),size);
   assert.strictEqual(e.GetCubeMapSurface(t,face,level,out),0);const s=read(out);surfaces.push(s);
   assert.strictEqual(e.GetCubeMapSurface(t,face,level,out),0);assert.strictEqual(read(out),s);
   assert.strictEqual(e.surface_release(s),1);
   assert.strictEqual(e.LockRect(t,face,level,out,0,0),0);const bits=read(out+4);
   assert.strictEqual(e.get_esp()>>>0,0x074ff01c);
   assert.strictEqual(read(out),size*4);assert(!addresses.has(bits));addresses.add(bits);
   write(bits,0xff000000+face*16+level);
   assert.strictEqual(e.LockRect(t,face,level,out,0,0)>>>0,invalid);
   assert.strictEqual(e.surface_unlock(s),0);
   assert.strictEqual(e.UnlockRect(t,face,level)>>>0,invalid);
   assert.strictEqual(e.LockRect(t,face,level,out,0,16),0);assert.strictEqual(read(read(out+4)),0xff000000+face*16+level);
   assert.strictEqual(e.UnlockRect(t,face,level),0);
   assert.strictEqual(e.get_esp()>>>0,0x074ff010);
 }
 for(const [face,level] of [[6,0],[-1,0],[0,3],[5,3]]){
   assert.strictEqual(e.LockRect(t,face,level,out,0,0)>>>0,invalid);
   assert.strictEqual(e.GetCubeMapSurface(t,face,level,out)>>>0,invalid);assert.strictEqual(read(out),0);
 }
 assert.strictEqual(e.GetLevelDesc(t,3,out)>>>0,invalid);
 assert.strictEqual(e.AddDirtyRect(t,6,0)>>>0,invalid);
 assert.strictEqual(e.SetLOD(t,99),0);assert.strictEqual(e.GetLOD(t),2);
 const iid=out+64;
 const guid=words=>words.forEach((v,i)=>write(iid+i*4,v));
 guid([0xfff32f81,0x473ad953,0xd6932392,0x3fa9ab52]);
 assert.strictEqual(e.QueryInterface(t,iid,out),0);assert.strictEqual(read(out),t);e.Release(t);
 guid([0x85c31227,0x4f003de5,0x1af13a9b,0xb5188cc3]);
 assert.strictEqual(e.QueryInterface(t,iid,out)>>>0,0x80004002);assert.strictEqual(read(out),0);
 assert.strictEqual(e.Release(t),surfaces.length,'surfaces retain parent');
 for(const s of surfaces)assert.strictEqual(e.surface_release(s),0);
 for(const [format,blockBytes] of [[0x31545844,8],[0x35545844,16]]){
   assert.strictEqual(e.create(d,4,0,0,out,format),0);const compressed=read(out),seen=new Set();
   for(let face=0;face<6;face++)for(let level=0;level<3;level++){
     assert.strictEqual(e.LockRect(compressed,face,level,out,0,0),0);
     assert.strictEqual(read(out),blockBytes);const bits=read(out+4);
     assert.ok(!seen.has(bits));seen.add(bits);write(bits,face*16+level);
     assert.strictEqual(e.UnlockRect(compressed,face,level),0);
   }
   for(let face=0;face<6;face++)for(let level=0;level<3;level++){
     assert.strictEqual(e.LockRect(compressed,face,level,out,0,16),0);
     assert.strictEqual(read(read(out+4)),face*16+level);
     assert.strictEqual(e.UnlockRect(compressed,face,level),0);
   }
   assert.strictEqual(e.Release(compressed),0);
 }
 console.log('PASS cube six-face mip storage, COM identity/lifetime, aliases, lock state and ABI');
})().catch(error=>{console.error(error);process.exitCode=1;});
