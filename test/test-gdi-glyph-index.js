#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {bootRenderHarness}=require('./render-helper');
(async()=>{
 const extraWat=`
 (func (export "index_gid") (param $face i32) (param $code i32) (result i32)
   (call $tt_glyph_index (call $tt_face_data (local.get $face)) (call $tt_face_size (local.get $face)) (local.get $code)))
 (func (export "index_entry") (param $face i32) (param $gid i32) (param $ppem i32) (result i32)
   (call $tt_glyph_ensure (local.get $face) (local.get $gid) (local.get $ppem)))
 (func (export "index_advance") (param $face i32) (param $gid i32) (param $ppem i32) (result i32)
   (call $tt_gdi_index_width (local.get $face) (local.get $ppem) (local.get $gid)))`;
 const {exports:e,memory,hostCtx}=await bootRenderHarness({extraWat}),bytes=new Uint8Array(memory.buffer);
 // The normal harness mounts ANSI-subset fonts. Use the shipped full face to
 // exercise glyphs outside that subset, before the native face is opened.
 hostCtx.vfs.files.set('c:\\windows\\fonts\\arial.ttf',{data:new Uint8Array(fs.readFileSync(path.join(__dirname,'../fonts/liberation/LiberationSans-Regular.ttf'))),attrs:0x20});
 const alloc=n=>e.guest_alloc(n)>>>0,wa=p=>e.guest_to_wasm(p)>>>0;
 const name=alloc(32);for(let i=0;i<5;i++)e.guest_write16(name+i*2,'Arial'.charCodeAt(i));
 const font=e.test_call_CreateFontW(-16,400,0,name),dc=e.test_call_CreateCompatibleDC(0);
 const bmi=alloc(40),out=alloc(4),width=64,height=32;
 for(const [o,n]of[[0,40],[4,width],[8,-height]])e.guest_write32(bmi+o,n);
 e.guest_write16(bmi+12,1);e.guest_write16(bmi+14,32);
 const bitmap=e.test_call_CreateDIBSection(0,bmi,out);e.test_call_SelectObject(dc,bitmap);e.test_call_SelectObject(dc,font);
 const pixels=wa(e.guest_read32(out)),faceName=alloc(8);bytes.set(Buffer.from('Arial\0'),wa(faceName));
 const face=e.test_tt_face_for_logfont(wa(faceName),400,0),ppem=e.test_tt_face_ppem(face,-16);
 assert(face>=0);const text=alloc(8),gidText=alloc(8),rect=alloc(16),dx=alloc(16);
 [0,0,width,height].forEach((n,i)=>e.guest_write32(rect+i*4,n));
 e.test_gdi_dc_set_field(dc,28,1,2);e.test_gdi_dc_set_field(dc,20,0,0);e.test_gdi_dc_set_field(dc,24,0xffffff,0xffffff);
 e.test_gdi_dc_set_field(dc,32,1,0);
 const reset=()=>{bytes.fill(255,pixels,pixels+width*height*4);for(let i=3;i<width*height*4;i+=4)bytes[pixels+i]=0;e.test_gdi_dc_set_field(dc,12,3,0);e.test_gdi_dc_set_field(dc,16,2,0);};
 const capture=()=>bytes.slice(pixels,pixels+width*height*4);
 for(const code of[65,103,233]){
  const gid=e.index_gid(face,code);assert(gid);e.guest_write16(gidText,gid);e.guest_write16(text,code);
  reset();assert.strictEqual(e.test_call_ExtTextOutW(dc,0,0,0,0,text,1),1);const expected=capture(),advance=e.test_gdi_dc_get_field(dc,12,0);
  assert(expected.some((v,i)=>i%4!==3&&v===0),'reference has glyph pixels');
  for(const wide of[false,true])for(const flags of[0,2,4,6])for(const r of[0,rect]){
   reset();assert.strictEqual(e[wide?'test_call_ExtTextOutW':'test_call_ExtTextOutA'](dc,0,0,16|flags,r,gidText,1),1);
   assert.deepStrictEqual(capture(),expected,`direct gid${gid} code${code} W${wide} flags${flags} rect${!!r}`);
   assert.strictEqual(e.test_gdi_dc_get_field(dc,12,0),advance,'direct glyph advance drives TA_UPDATECP');
  }
 }
 // Address the face directly, without needing any cmap entry for the glyph.
 let gid=0,entry=0;for(let candidate=256;candidate<512;candidate++){
  const value=e.index_entry(face,candidate,ppem);if(e.test_tt_entry_width(value)&&e.test_tt_entry_height(value)){gid=candidate;entry=value;break;}}
 assert(gid>255,'font exposes an inked glyph above255');assert(entry);
 e.guest_write16(gidText,gid);reset();assert.strictEqual(e.test_call_ExtTextOutA(dc,0,0,16,0,gidText,1),1);
 const glyphPixels=capture(),gw=e.test_tt_entry_width(entry),gh=e.test_tt_entry_height(entry),left=e.test_tt_entry_left(entry),top=e.test_tt_entry_top(entry),ascent=e.test_tt_face_metric(face,ppem,1);
 let ink=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const gx=x-3-left,gy=y-2-ascent+top,expected=gx>=0&&gy>=0&&gx<gw&&gy<gh?e.test_tt_entry_pixel(entry,gx,gy):0;
  assert.strictEqual(glyphPixels[(y*width+x)*4],expected?0:255,'direct cache bitmap equals compositor pixels');ink+=!!expected;
 }assert(ink>0);assert.strictEqual(e.test_gdi_dc_get_field(dc,12,0),3+e.index_advance(face,gid,ppem));
 const firstGid=e.index_gid(face,65);e.guest_write16(gidText,firstGid);e.guest_write16(gidText+2,gid);
 reset();assert.strictEqual(e.test_call_ExtTextOutA(dc,0,0,16,0,gidText,2),1);const pair=capture(),pairCP=e.test_gdi_dc_get_field(dc,12,0);
 reset();assert.strictEqual(e.test_call_ExtTextOutW(dc,0,0,16,0,gidText,2),1);assert.deepStrictEqual(capture(),pair,'A/W both consume WORD glyph arrays');assert.strictEqual(e.test_gdi_dc_get_field(dc,12,0),pairCP);
 [13,2,17,-1].forEach((n,i)=>e.guest_write32(dx+i*4,n));reset();
 assert.strictEqual(e.test_call_ExtTextOutAWithDx(dc,99,99,16|0x2000,0,gidText,2,dx),1);
 assert.strictEqual(e.test_gdi_dc_get_field(dc,12,0),33,'ETO_PDY explicit horizontal advances');assert.strictEqual(e.test_gdi_dc_get_field(dc,16,0),3,'ETO_PDY vertical advances');
 assert(capture().some((v,i)=>i%4!==3&&v===0));
 reset();e.guest_write16(gidText,firstGid);const empty=capture();
 assert.strictEqual(e.test_call_BeginPath(dc),1);assert.strictEqual(e.test_call_ExtTextOutA(dc,0,0,16,0,gidText,1),1);
 assert.strictEqual(e.test_call_EndPath(dc),1);assert.deepStrictEqual(capture(),empty,'glyph path records without painting');
 assert(e.test_call_GetPath(dc,0,0,0)>0,'direct glyph ink is captured by existing path machinery');
 assert.strictEqual(e.test_call_AbortPath(dc),1);
 reset();e.guest_write16(gidText,65535);const before=capture();assert.strictEqual(e.test_call_ExtTextOutA(dc,0,0,18,rect,gidText,1),0);
 assert.deepStrictEqual(capture(),before,'bad index does not paint background');assert.strictEqual(e.test_gdi_dc_get_field(dc,12,0),3);
 console.log('PASS direct TrueType WORD glyph indices: A/W native-oracle flags, pixels/advance, >255 cache pixels and atomic invalid-index rejection');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
