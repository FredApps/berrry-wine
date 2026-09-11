#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {bootRenderHarness}=require('./render-helper');
const extraWat=String.raw`
 (func (export "capacity_table") (result i32) (global.get $GDI_BITMAP_FONT_TABLE))
 (func (export "capacity_lru") (result i32) (global.get $GDI_BITMAP_FONT_LRU))
 (func (export "capacity_clock") (result i32) (global.get $gdi_bitmap_font_clock))
 (func (export "capacity_remove_added")
   (drop (call $gdi_bitmap_font_remove_hash (call $gdi_bitmap_font_path_hash (global.get $GDI_BITMAP_FONT_MS_SANS_PATH)))))
 (func (export "capacity_legacy") (param $data i32) (param $size i32) (result i32)
   (call $gdi_bitmap_font_add_buffer (call $w2g (global.get $GDI_BITMAP_FONT_TERMINAL_PATH))
     (local.get $data) (local.get $size)))
`;
const system=fs.readFileSync(path.join(__dirname,'../fonts/System.fon'));
function firstStrike(bytes){
 const ne=bytes.readUInt32LE(0x3c);assert.strictEqual(bytes.readUInt16LE(ne),0x454e);
 let p=ne+bytes.readUInt16LE(ne+36);const shift=bytes.readUInt16LE(p);p+=2;
 while(bytes.readUInt16LE(p)){
  const type=bytes.readUInt16LE(p),count=bytes.readUInt16LE(p+2);p+=8;
  for(let i=0;i<count;i++,p+=12)if(type===0x8008){
   const start=bytes.readUInt16LE(p)*2**shift,length=bytes.readUInt16LE(p+2)*2**shift;
   const strike=bytes.subarray(start,start+length);assert([0x200,0x300].includes(strike.readUInt16LE()));return strike;
  }
 }
 throw Error('System.fon has no FNT resource');
}
const strike=firstStrike(system);
function repeated(count,{malformedLast=false}={}){
 const resource=0x80,tableEnd=resource+2+8+count*12+8,payload=(tableEnd+15)&~15;
 assert(payload+strike.length<65536,'shift-zero fixture extent fits NE resource fields');
 const b=Buffer.alloc(payload+strike.length);b.writeUInt16LE(0x5a4d);b.writeUInt32LE(0x40,0x3c);
 b.writeUInt16LE(0x454e,0x40);b.writeUInt16LE(resource-0x40,0x40+36);
 b.writeUInt16LE(0,resource);b.writeUInt16LE(0x8008,resource+2);b.writeUInt16LE(count,resource+4);
 for(let i=0;i<count;i++){
  const p=resource+10+i*12;b.writeUInt16LE(payload,p);b.writeUInt16LE(malformedLast&&i===count-1?1:strike.length,p+2);
  b.writeUInt16LE(0x8001+i,p+6);
 }
 strike.copy(b,payload);return b;
}
(async()=>{
 const h=await bootRenderHarness({fonts:'none',extraWat}),e=h.exports;
 const exe=fs.readFileSync(path.join(__dirname,'binaries/notepad.exe'));
 new Uint8Array(h.memory.buffer).set(exe,e.get_staging());assert(e.load_pe(exe.length));
 const memory=new Uint8Array(h.memory.buffer),view=new DataView(h.memory.buffer);
 function snapshot(){
  const table=e.capacity_table(),records=memory.slice(table,table+48*64),owned=[];
  for(let i=0;i<48;i++)if(view.getUint32(table+i*64,true)){
   const p=view.getUint32(table+i*64+8,true),n=view.getUint32(table+i*64+12,true);owned.push([i,memory.slice(p,p+n)]);
  }
  return {records,owned,lru:memory.slice(e.capacity_lru(),e.capacity_lru()+48*4),clock:e.capacity_clock()};
 }
 function install(index,bytes,legacy=false){
  const ga=e.guest_alloc(bytes.length);assert(ga);
  try{bytes.forEach((b,i)=>e.guest_write8(ga+i,b));return legacy?e.capacity_legacy(ga,bytes.length):e.stock_font_install(index,ga,bytes.length);}
  finally{e.guest_free(ga);}
 }
 const initial=install(0,system);assert(initial>0);assert.strictEqual(e.stock_font_state(0),2);
 const count=e.test_gdi_bitmap_font_count(),remaining=48-count,original=snapshot();assert(remaining>1);
 for(const requested of [remaining+1,49,2000]){
  assert.strictEqual(install(1,repeated(requested)),0,'over-capacity stock install must fail without replacing existing strikes');
  assert.deepStrictEqual(snapshot(),original,'even repeated resources leave the registry unchanged');
 }
 assert.strictEqual(e.stock_font_state(1),0);assert.strictEqual(e.stock_font_state(0),2);
 assert.strictEqual(e.test_gdi_bitmap_font_count(),count);assert.deepStrictEqual(snapshot(),original,'overflow preserves records, strike bytes and LRU');
 console.log('PASS over-capacity stock transaction preserves original System records/bytes/state/LRU');
 const hugeNe=Buffer.from(repeated(1));hugeNe.writeUInt32LE(0xfffffff0,0x3c);
 const wrapped=Buffer.from(repeated(1));wrapped.writeUInt16LE(24,0x80);wrapped.writeUInt16LE(256,0x8a);wrapped.writeUInt16LE(1,0x8c);
 const truncated=repeated(1).subarray(0,0x90);
 const one=repeated(1),unterminated=Buffer.concat([one,one.subarray(0x80,0x80+22)]);
 unterminated.writeUInt16LE(one.length-0x40,0x40+36);
 for(const [name,bytes] of [['huge e_lfanew',hugeNe],['overflowing resource units',wrapped],['truncated resource table',truncated],['unterminated type table',unterminated]]){
  assert.strictEqual(install(1,bytes),0,name+' must reject without trap/partial publication');
  assert.strictEqual(e.stock_font_state(1),0);assert.deepStrictEqual(snapshot(),original,name+' leaves original registry unchanged');
 }
 console.log('PASS malformed NE offsets/resource-unit overflow/truncation/missing terminator reject without mutation');
 assert.strictEqual(install(1,repeated(2,{malformedLast:true})),0,'malformed later FNT cannot publish earlier valid resource');
 assert.strictEqual(e.stock_font_state(1),0);assert.strictEqual(e.test_gdi_bitmap_font_count(),count);
 assert.deepStrictEqual(snapshot(),original,'malformed resource rolls back new records and LRU');
 console.log('PASS malformed later resource rolls back complete stock transaction');
 // Leave exactly one strike-sized allocation free: validation succeeds and
 // the first copy allocates, but the second must fail and roll the first back.
 const fontSize=strike.readUInt32LE(2)||strike.length;
 const reserved=e.test_dib_alloc(fontSize);assert(reserved);
 const pressure=[];let block;
 try{
  while((block=e.test_dib_alloc(65536)))pressure.push(block);
  while((block=e.test_dib_alloc(4096)))pressure.push(block);
  e.test_dib_free(reserved);
  assert.strictEqual(install(1,repeated(2)),0,'allocation failure cannot publish partial font');
  assert.strictEqual(e.stock_font_state(1),0);
  assert.deepStrictEqual(snapshot(),original,'allocation rollback preserves original records, bytes, LRU and clock');
  const recovered=e.test_dib_alloc(fontSize);assert(recovered,'failed install releases its first strike allocation');
  e.test_dib_free(recovered);
 }finally{for(const pointer of pressure)e.test_dib_free(pointer);}
 console.log('PASS second-strike allocation failure rolls back records and storage without touching LRU');
 const exactSource=repeated(remaining);
 // Put the resource table last, ending at exactly the two-byte TYPE0 marker.
 const exact=Buffer.concat([exactSource,exactSource.subarray(0x80,0x80+2+8+remaining*12+2)]);
 exact.writeUInt16LE(exactSource.length-0x40,0x40+36);
 assert.strictEqual(install(1,exact),remaining,'exact capacity with two-byte final TYPE0 succeeds');
 assert.strictEqual(e.test_gdi_bitmap_font_count(),48);assert.strictEqual(e.stock_font_state(1),2);
 const fitted=snapshot();for(const [i,bytes] of original.owned){
  assert.deepStrictEqual(fitted.records.slice(i*64,(i+1)*64),original.records.slice(i*64,(i+1)*64));
  assert.deepStrictEqual(fitted.owned.find(([index])=>index===i)[1],bytes);
 }
 console.log('PASS exact-fit stock transaction fills remaining slots without replacing originals');
 e.capacity_remove_added();assert.strictEqual(e.test_gdi_bitmap_font_count(),count);
 assert.strictEqual(install(4,repeated(2,{malformedLast:true}),true),0,'AddFontResource rejects the complete malformed transaction even when space is available');
 console.log('PASS add-buffer rejects malformed later resources without partial registration');
})().catch(error=>{console.error(error);process.exitCode=1;});
