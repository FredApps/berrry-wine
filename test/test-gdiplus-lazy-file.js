#!/usr/bin/env node
'use strict';
const assert=require('assert');
const {bootRenderHarness}=require('./render-helper');
const {ChunkCache,ChunkCacheBudget}=require('../lib/byte-provider');
const apis=require('../src/api_table.json');
const STACK=0x110100,PATH=0x120000,OUT=0x121000,MARKER=0x12345678;
const extraWat=String.raw`
 (func (export "gdip_begin") (param $out i32)
  (global.set $thunk_guest_base (i32.const 0x200000))
  (global.set $thunk_guest_end (i32.const 0x200008))
  (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
  (global.set $esp (i32.const 0x110100)) (global.set $eip (i32.const 0x200000))
  (call $gs32 (global.get $esp) (i32.const 0))
  (call $gs32 (i32.add (global.get $esp) (i32.const 4)) (i32.const 0x120000))
  (call $gs32 (i32.add (global.get $esp) (i32.const 8)) (local.get $out)))
 (func (export "gdip_api_id") (param $id i32)
  (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id)))
 (func (export "gdip_reframe") (param $stack i32) (param $out i32) (param $ret i32)
  (global.set $esp (local.get $stack)) (global.set $eip (i32.const 0x200000))
  (call $gs32 (local.get $stack) (local.get $ret))
  (call $gs32 (i32.add (local.get $stack) (i32.const 4)) (i32.const 0x120000))
  (call $gs32 (i32.add (local.get $stack) (i32.const 8)) (local.get $out)))
 (func (export "gdip_resume")
  (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
  (call $run (i32.const 2)))
 (func (export "gdip_eax") (result i32) (global.get $eax))
 (func (export "gdip_esp") (result i32) (global.get $esp))
 (func (export "gdip_pending") (result i32) (global.get $gdip_image_pending))
 (func (export "gdip_dispose") (param $object i32) (call $heap_free (local.get $object)))
`;
(async()=>{
 const h=await bootRenderHarness({fonts:'none',extraWat}),e=h.exports,vfs=h.hostCtx.vfs;
 const path='c:\\image-é.png';
 Buffer.from(path+'\0','utf16le').forEach((b,i)=>e.guest_write8(PATH+i,b));
 let opens=0,closes=0;const create=vfs.createFile.bind(vfs),close=vfs.closeHandle.bind(vfs);
 vfs.createFile=(name,...args)=>{assert.strictEqual(name,path);opens++;return create(name,...args);};
 vfs.closeHandle=(...args)=>{closes++;return close(...args);};
 function png(width,height){const data=Buffer.alloc(8192);data.writeUInt32LE(0x474e5089);data.write('IHDR',12);data.writeUInt32BE(width,16);data.writeUInt32BE(height,20);return data;}
 async function run(data,expected,width,height,fail=false){
  const budget=new ChunkCacheBudget({maxBytes:0}),calls=[];
  const cache=new ChunkCache({size:data.length,readRange:async(off,len)=>{
   calls.push([off,len]);if(fail)throw Error('unreadable image');return new Uint8Array(data.slice(off,off+len));
  }},{budget,chunkSize:16,readAhead:0});
  vfs.setProviderFile(path,{provider:cache});
  const opened=opens,closed=closes;
  e.gdip_begin(OUT);e.gdip_api_id(apis.find(a=>a.name==='GdipLoadImageFromFile').id);e.guest_write32(OUT,MARKER);
  e.gdip_resume();
  if(data.length){
   assert.strictEqual(e.get_yield_reason(),12);assert.strictEqual(e.gdip_esp(),STACK);
   assert.strictEqual(e.guest_read32(OUT),MARKER);const frame=e.gdip_pending();assert(frame);
   e.gdip_resume();assert.strictEqual(e.gdip_pending(),frame);assert.strictEqual(opens,opened+1);assert.strictEqual(closes,closed);
   assert.strictEqual(e.guest_read32(OUT),MARKER);
   await vfs.fillPendingRead(vfs.pendingRead);
   e.gdip_resume();
  }
  assert.strictEqual(e.get_yield_reason(),0);assert.strictEqual(e.gdip_esp(),STACK+12);
  assert.strictEqual(e.gdip_eax(),expected);assert.strictEqual(e.gdip_pending(),0);
  assert.strictEqual(opens,opened+1);assert.strictEqual(closes,closed+1);
  assert.strictEqual(budget.bytes,0);
  assert(calls.every(([off,len])=>off+len<=4096),'only the first4KiB may be read');
  if(expected===0){const object=e.guest_read32(OUT);assert.notStrictEqual(object,MARKER);
   assert.strictEqual(e.guest_read32(object+4),width);assert.strictEqual(e.guest_read32(object+8),height);e.gdip_dispose(object);
  }else assert.strictEqual(e.guest_read32(OUT),MARKER,'failed load cannot publish placeholder');
 }
 await run(png(320,200),0,320,200);
 await run(png(65535,65535),0,65535,65535);
 const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,17,8,0,240,1,64]);
 await run(jpeg,0,320,240);
 await run(png(1,1),1,0,0,true);
 await run(Buffer.alloc(0),13);
 await run(Buffer.alloc(7),13);
 // Separate nested frames own separate handles. Complete the non-head first.
 const nestedData=png(12,34),nestedCache=new ChunkCache({size:nestedData.length,
  readRange:async(off,len)=>new Uint8Array(nestedData.slice(off,off+len))},
  {budget:new ChunkCacheBudget({maxBytes:0}),chunkSize:16,readAhead:0});
 vfs.setProviderFile(path,{provider:nestedCache});
 e.gdip_begin(OUT);e.gdip_resume();const outer=e.gdip_pending(),outerRead=vfs.pendingRead;
 e.gdip_reframe(STACK+0x4000,OUT+4,0);e.gdip_resume();const inner=e.gdip_pending(),innerRead=vfs.pendingRead;
 assert.notStrictEqual(inner,outer);assert.strictEqual(e.guest_read32(inner),outer);
 await vfs.fillPendingRead(outerRead);e.gdip_begin(OUT);e.gdip_resume();
 assert.strictEqual(e.gdip_eax(),0);assert.strictEqual(e.gdip_pending(),inner);assert.strictEqual(e.guest_read32(inner),0);
 e.gdip_dispose(e.guest_read32(OUT));
 await vfs.fillPendingRead(innerRead);e.gdip_reframe(STACK+0x4000,OUT+4,0);e.gdip_resume();
 assert.strictEqual(e.gdip_eax(),0);assert.strictEqual(e.gdip_pending(),0);e.gdip_dispose(e.guest_read32(OUT+4));
 // A reused call frame with changed output OR return address discards its old owner.
 for(const changedReturn of [false,true]){
  e.gdip_begin(OUT);e.gdip_resume();const beforeClose=closes;
  e.gdip_reframe(STACK,changedReturn?OUT:OUT+4,changedReturn?0x55:0);e.gdip_resume();
  assert.strictEqual(e.get_yield_reason(),12);assert.strictEqual(closes,beforeClose+1);
  // Replace the test's non-executable return address with a terminal one;
  // that is another deliberate frame replacement and must also clean up.
  if(changedReturn){e.gdip_begin(OUT);e.gdip_resume();assert.strictEqual(closes,beforeClose+2);}
  await vfs.fillPendingRead(vfs.pendingRead);e.gdip_resume();
  assert.strictEqual(e.gdip_eax(),0);assert.strictEqual(e.gdip_pending(),0);
  e.gdip_dispose(e.guest_read32(changedReturn?OUT:OUT+4));
 }
 vfs.files.delete(vfs._normPath(path));e.gdip_begin(OUT);e.guest_write32(OUT,MARKER);e.gdip_resume();
 assert.strictEqual(e.gdip_eax(),10);assert.strictEqual(e.guest_read32(OUT),MARKER);
 const before=opens;e.gdip_begin(0);e.gdip_resume();assert.strictEqual(e.gdip_eax(),2);assert.strictEqual(opens,before);
 console.log('PASS GDI+ lazy file: UTF16 path, zero-cache bounded header completion, repeated misses, dimensions, faults/EOF, no premature output and handle cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
