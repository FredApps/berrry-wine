'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const apis=require('../src/api_table.json');
const extraWat=String.raw`
 (func (export "create") (param $v i32) (result i32)
   (if (i32.eq (local.get $v) (i32.const 1)) (then (return (call $dx_create_com_obj (i32.const 23) (global.get $DX_VTBL_D3DVP1)))))
   (if (i32.eq (local.get $v) (i32.const 2)) (then (return (call $dx_create_com_obj (i32.const 23) (global.get $DX_VTBL_D3DVP2)))))
   (call $dx_create_com_obj (i32.const 23) (global.get $DX_VTBL_D3DVP3)))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $p i32) (param $iid i32) (param $out i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (i32.store (global.get $reg_base) (i32.const 0xdeadbeef))
   (call $dispatch_api_table (local.get $id) (local.get $p) (local.get $iid) (local.get $out)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
 (func (export "refs") (param $p i32) (result i32) (load.field DxObject refcount (call $dx_from_this (local.get $p))))
 (func (export "release") (param $p i32) (result i32) (call $dx_com_release_basic (local.get $p)))
 (func (export "span_cursor") (result i32) (global.get $guest_span_cursor))
`;
(async()=>{
 const {exports:e}=await bootRenderHarness({extraWat,fonts:'none'});e.init_dx_com_thunks();
 const sp=e.guest_alloc(128),iid=e.guest_alloc(16),out=e.guest_alloc(4);
 const versions=[1,2,3], guids=[
   [0x4417c146,0x11cf33ad,0x00006f81,0x6e1520c0],
   [0x93281500,0x11d08cf8,0xa000ab89,0x294105c9],
   [0xb0ab3b61,0x11d133d7,0xc00081a9,0x74b1d74f],
 ], unknown=[0,0,0xc0,0x46000000],ddraw=[0x6c14db80,0x11cea733,0x200021a5,0x60e50baf];
 const write=(p,words)=>words.forEach((n,i)=>e.guest_write32(p+i*4,n));
 const query=(v,p,g=iid,o=out)=>{
   e.guest_write32(sp+16,0xdeadbeef);
   const name='IDirect3DViewport'+(v===1?'':v)+'_QueryInterface';
   const hr=e.invoke(apis.find(a=>a.name===name).id,sp,p,g,o)>>>0;
   assert.strictEqual(e.get_esp(),sp+16);assert.strictEqual(e.guest_read32(sp+16)>>>0,0xdeadbeef);
   return hr;
 };
 const vtables=versions.map(v=>{const p=e.create(v),vt=e.guest_read32(p);e.release(p);return vt;});
 for(const v of versions) {
   const p=e.create(v),original=e.guest_read32(p);
   // Clear has the same four-argument ABI on all three interfaces. A no-op
   // clear must still write its HRESULT, not return the incoming EAX poison.
   const clearName='IDirect3DViewport'+(v===1?'':v)+'_Clear';
   e.guest_write32(sp+20,0x12345678);
   assert.strictEqual(e.invoke(apis.find(a=>a.name===clearName).id,sp,p,0,0)>>>0,0,clearName+' HRESULT');
   assert.strictEqual(e.get_esp(),sp+20,clearName+' stdcall');
   assert.strictEqual(e.guest_read32(sp+20),0x12345678,clearName+' stack guard');
   write(iid,ddraw);e.guest_write32(out,0xdeadbeef);
   assert.strictEqual(query(v,p),0x80004002,'complete unrelated interface rejected');
   assert.strictEqual(e.guest_read32(out),0);assert.strictEqual(e.refs(p),1);
   write(iid,[0x4417c144,0x11cf33ad,0x00006f81,0x6e1520c0]);
   assert.strictEqual(query(v,p),0x80004002,'material IID cannot cross the shared child-family core');
   assert.strictEqual(e.guest_read32(out),0);assert.strictEqual(e.refs(p),1);
   for(const words of [...guids,unknown,ddraw]) for(let word=0;word<4;word++) {
     const forged=words.slice();forged[word]^=0x01000000;write(iid,forged);
     e.guest_write32(out,0xdeadbeef);
     assert.strictEqual(query(v,p),0x80004002,'reject full-GUID mismatch');
     assert.strictEqual(e.guest_read32(out),0);assert.strictEqual(e.refs(p),1);
   }
   assert.strictEqual(query(v,p,iid,0),0x80004003);
   e.guest_write32(out,0xdeadbeef);assert.strictEqual(query(v,p,0),0x80004003);
   assert.strictEqual(e.guest_read32(out),0);assert.strictEqual(e.refs(p),1);
   for(let target=0;target<versions.length;target++) {
     write(iid,guids[target]);assert.strictEqual(query(v,p),0);
     const view=e.guest_read32(out);assert.strictEqual(e.refs(p),2);
     assert.strictEqual(e.guest_read32(view),vtables[target],'requested viewport ABI');
     assert.strictEqual(e.guest_read32(p),original,'upgrades do not mutate original vtable');
     write(iid,unknown);assert.strictEqual(query(versions[target],view),0);
     assert.strictEqual(e.guest_read32(out),p,'one controlling viewport IUnknown');
     assert.strictEqual(e.release(p),2);assert.strictEqual(e.release(view),1);
   }
   assert.strictEqual(e.release(p),0);
 }
 // Deliberately interleave sparse backing so a crossing IID is not affine.
 const base=0x32000000;
 for(const p of [base,base+0x10000,base+4096])e.test_virtual_map_commit(p,4096);
 assert.notStrictEqual(e.guest_to_wasm(base+4096),e.guest_to_wasm(base)+4096);
 const sparseIid=base+4090,sparseOut=base+4094,p=e.create(3),cursor=e.span_cursor();
 for(let n=0;n<64;n++) {
   write(sparseIid,guids[1]);
   assert.strictEqual(query(3,p,sparseIid,out),0);assert.strictEqual(e.release(e.guest_read32(out)),1);
   assert.strictEqual(e.span_cursor(),cursor,'temporary GUID span released');
   write(iid,unknown);assert.strictEqual(query(3,p,iid,sparseOut),0);
   assert.strictEqual(e.guest_read32(sparseOut),p);assert.strictEqual(e.release(p),1);
 }
 assert.strictEqual(e.release(p),0);
 console.log('PASS D3D viewport full GUIDs: 60 corruptions, 9 identity upgrades, nulls, sparse GUID/output and balanced refs/spans');
})().catch(error=>{console.error(error);process.exitCode=1;});
