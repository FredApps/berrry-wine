'use strict';
// Actual-WAT private tests. Deliberately no guest COM front-door qualification.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const R=require('../lib/region-map.generated');
const extraWat=['descriptor-adapters.wat','bmp24-loader.wat','bitmap-to-surface.wat','surface-descriptor.wat'].map(f=>fs.readFileSync(path.join(__dirname,'fixtures/vbdd-image-helpers',f),'utf8')).join('\n')+String.raw`
(export "to_native" (func $vbdd_desc_rgb_to_native))
(export "from_native" (func $vbdd_desc_from_native))
(export "load_bmp" (func $vbdd_load_bmp24_wide))
(export "to_surface" (func $vbdd_bitmap_to_native_surface))
(export "release_surface" (func $dx_surface_release))
(export "delete_bitmap" (func $gdi_object_delete_full))
(export "surface_desc" (func $vbdd_surface_get_desc))
(func (export "initialize_dx") (call $init_dx_com_thunks))
(func (export "create_owner") (param $out i32)
 (call $handle_IDirectX7_DirectDrawCreate (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0)))
(func (export "surface_field") (param $obj i32) (param $field i32) (result i32)
 (local $e i32) (local.set $e (call $dx_from_this (local.get $obj)))
 (if (result i32) (i32.eqz (local.get $field)) (then (load.field.memarg DxObject misc1 (local.get $e)))
 (else (if (result i32) (i32.eq (local.get $field) (i32.const 1)) (then (load.field.memarg DxObject pitch (local.get $e)))
 (else (load.field.memarg DxObject bpp (local.get $e)))))))
`;
(async()=>{
 const h=await bootRenderHarness({extraWat,fonts:'none'}),e=h.exports,bytes=new Uint8Array(h.memory.buffer),v=new DataView(h.memory.buffer);
 e.initialize_dx();
 const alloc=n=>{const g=e.guest_alloc(n)>>>0;return {g,w:R.g2w(g,e.get_image_base())};};
 const ownerOut=alloc(4);e.create_owner(ownerOut.g);const owner=v.getUint32(ownerOut.w,true);assert(owner);
 const vb=alloc(240),native=alloc(132);bytes.fill(0xA5,vb.w,vb.w+240);bytes.fill(0xA5,native.w,native.w+132);
 const b=vb.w+4,n=native.w+4,set=(p,o,x)=>v.setUint32(p+o,x,true),get=(p,o)=>v.getUint32(p+o,true);
 bytes.fill(0,b,b+232);set(b,0,232);set(b,4,0x1007);set(b,8,128);set(b,12,128);set(b,72,128);set(b,76,0x40);set(b,104,24);set(b,128,0xff0000);set(b,148,0xff00);set(b,164,255);set(b,200,0x840);
 assert.equal(e.to_native(b,n)>>>0,0);assert.deepEqual([0,4,8,12,72,76,84,88,92,96,104].map(o=>get(n,o)),[124,0x1007,128,128,32,0x40,24,0xff0000,0xff00,255,0x840]);
 assert.equal(get(native.w,0),0xA5A5A5A5);assert.equal(get(n,124),0xA5A5A5A5);
 set(n,24,7);set(n,108,0x222);set(n,112,0x333);set(n,116,0x444);e.from_native(b,n);
 assert.deepEqual([0,72,104,128,148,164,200,204,208,212,224,228].map(o=>get(b,o)),[124,32,24,0xff0000,0xff00,255,0x840,0x222,0x333,0x444,7,7]);
 assert.equal(get(vb.w,0),0xA5A5A5A5);assert.equal(get(b,232),0xA5A5A5A5);
 const before=Buffer.from(bytes.slice(n,n+124));set(b,76,0x200);assert.equal(e.to_native(b,n)>>>0,0x80004001);assert.deepEqual(Buffer.from(bytes.slice(n,n+124)),before);
 const fixture=fs.readFileSync(path.join(__dirname,'fixtures/vbdd-image-helpers/asymmetric.bmp'));
 const mount=(name,data)=>h.hostCtx.vfs.files.set(name.toLowerCase(),{data:new Uint8Array(data),attrs:0x20});
 const wide=text=>{const a=alloc((text.length+1)*2);for(let i=0;i<text.length;i++)v.setUint16(a.w+i*2,text.charCodeAt(i),true);v.setUint16(a.w+text.length*2,0,true);return a.w;};
 mount('c:\\图.bmp',fixture);const bitmap=e.load_bmp(wide('C:\\图.bmp'))>>>0;assert(bitmap,'Actual Unicode VFS lookup and full BMP decode');
 mount('c:\\short.bmp',fixture.subarray(0,fixture.length-1));assert.equal(e.load_bmp(wide('C:\\short.bmp')),0,'Truncated final row rejected');
 const compressed=Buffer.from(fixture);compressed.writeUInt32LE(1,30);mount('c:\\rle.bmp',compressed);assert.equal(e.load_bmp(wide('C:\\rle.bmp')),0,'Unsupported compression rejected');
 assert.equal(e.load_bmp(wide('C:\\missing.bmp')),0,'Missing file rejected');
 // Real source pixels, owned native surface, independent BMP coordinate oracle.
 for(const bpp of [16,24,32]){
  bytes.fill(0,n,n+124);set(n,0,124);set(n,4,0x1007);set(n,8,128);set(n,12,128);set(n,72,32);set(n,76,0x40);set(n,84,bpp);set(n,88,bpp===16?0xf800:0xff0000);set(n,92,bpp===16?0x7e0:0xff00);set(n,96,bpp===16?0x1f:255);set(n,104,0x840);
  const obj=e.to_surface(owner,bitmap,native.g+4)>>>0;assert(obj,'real native surface '+bpp);const bits=e.surface_field(obj,0)>>>0,pitch=e.surface_field(obj,1)>>>0;assert.equal(e.surface_field(obj,2),bpp);
  for(const [x,y] of [[0,0],[127,0],[0,127],[127,127],[31,47]]){
   const s=fixture.readUInt32LE(10)+(127-y)*384+x*3,blue=fixture[s],green=fixture[s+1],red=fixture[s+2],p=bits+y*pitch+x*(bpp/8);
   if(bpp===16){const pack=(c,m)=>Math.round(c*m/255);assert.equal(v.getUint16(p,true),(pack(red,31)<<11)|(pack(green,63)<<5)|pack(blue,31));}
   else assert.deepEqual(Array.from(bytes.slice(p,p+3)),[blue,green,red]);
  }
  assert.equal(e.surface_desc(obj,vb.g+4)>>>0,0);assert.deepEqual([8,12,104].map(o=>get(b,o)),[128,128,bpp]);
  assert.equal(get(vb.w,0),0xA5A5A5A5);assert.equal(get(b,232),0xA5A5A5A5);
  assert.equal(e.surface_desc(obj,0)>>>0,0x80004003);assert.equal(e.surface_desc(obj,0xfffffff0)>>>0,0x80004003);
  assert.equal(e.release_surface(obj),0);
 }
 assert.equal(e.delete_bitmap(bitmap),1);
 console.log('PASS descriptor mapping/canaries/atomic rejection, Unicode BMP/truncation/compression/missing paths, actual16/24/32 pixels and releases');
})().catch(err=>{console.error(err);process.exitCode=1;});
