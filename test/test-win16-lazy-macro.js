#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const PATH=0x00480000, CODE=PATH+0x2000, BUFFER=PATH+0x3000, COUNT=PATH+0x6000, STATE=PATH+0x6100;
let READ, SLEEP;
const STACK=0x110100, RETURN=0x103456;
const extraWat = String.raw`
 (func (export "setup") (param $read i32) (param $sleep i32) (result i32)
   (local $offset i32) (local $slot i32)
   (local.set $offset (i32.shl (global.get $num_thunks) (i32.const 3)))
   (local.set $slot (i32.add (global.get $THUNK_BASE) (local.get $offset)))
   (i32.store (local.get $slot) (i32.const 0x80000001))
   (i32.store offset=4 (local.get $slot) (local.get $read))
   (i32.store offset=8 (local.get $slot) (i32.const 0x80000001))
   (i32.store offset=12 (local.get $slot) (local.get $sleep))
   (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 2)))
   (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
   (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
   (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
   (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
   (global.set $code16 (i32.const 1))
   (call $win16_set_sreg (i32.const 1) (global.get $WIN16_THUNK_SEL))
   (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
   (call $win16_set_sreg (i32.const 3) (call $win16_index_to_sel (i32.const 2)))
   (call $win16_set_sreg (i32.const 0) (call $win16_index_to_sel (i32.const 1)))
   (global.set $eip (i32.const 0x120080))
   (i32.store (i32.add (global.get $WIN16_THUNK_TABLE) (i32.const 0x80)) (i32.const 0x000200ab))
   (global.set $esp (i32.const 0x110100))
   (call $gs16 (i32.const 0x110100) (i32.const 0x3456))
   (call $gs16 (i32.const 0x110102) (call $win16_index_to_sel (i32.const 1)))
   (call $gs16 (i32.const 0x110104) (i32.const 0x800))
   (call $gs16 (i32.const 0x110106) (call $win16_index_to_sel (i32.const 2)))
   (call $gs16 (i32.const 0x110108) (i32.const 0x0102))
   (call $gs16 (i32.const 0x11010a) (i32.const 0x400))
   (call $gs16 (i32.const 0x11010c) (call $win16_index_to_sel (i32.const 2)))
   (call $gs16 (i32.const 0x11010e) (i32.const 0))
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
   (call $clear_cache)
   (i32.add (global.get $thunk_guest_base) (local.get $offset)))
 (func (export "return_thunk") (result i32) (global.get $font_enum_ret_thunk))
 (func (export "fs") (result i32) (global.get $fs_base))
 (func (export "is_free") (param $ga i32) (result i32)
   (local $p i32) (local $left i32)
   (local.set $p (global.get $free_list)) (local.set $left (i32.const 10000))
   (block $done (loop $scan
     (br_if $done (i32.eqz (local.get $p)))
     (if (i32.eq (i32.add (local.get $p) (i32.const 4)) (local.get $ga)) (then (return (i32.const 1))))
     (local.set $p (call $gl32 (i32.add (local.get $p) (i32.const 4))))
     (local.set $left (i32.sub (local.get $left) (i32.const 1)))
     (br_if $scan (local.get $left)))) (i32.const 0))
 (func (export "image_size") (param $ga i32) (param $size i32) (result i32)
   (call $help_ne_dll_image_size (call $g2w (local.get $ga)) (local.get $size)))
 (func (export "reserve_image") (param $size i32) (result i32)
   (call $help_ne_reserve_dll_image (local.get $size)))
 (func (export "mode") (result i32) (global.get $code16))
 (func (export "jobs") (result i32) (global.get $help_macro_api_jobs))
 (func (export "context") (result i32) (global.get $help_macro_api_context))
 (func (export "resolvers") (result i32) (global.get $help_routine_pending))
 (func (export "epoch") (result i32) (global.get $help_document_epoch))
 (func (export "seg") (param $n i32) (result i32)
   (if (i32.eqz (local.get $n)) (then (return (global.get $sreg_es))))
   (if (i32.eq (local.get $n) (i32.const 1)) (then (return (global.get $sreg_cs))))
   (if (i32.eq (local.get $n) (i32.const 2)) (then (return (global.get $sreg_ss))))
   (global.get $sreg_ds))
 (func (export "base") (param $n i32) (result i32)
   (if (i32.eqz (local.get $n)) (then (return (global.get $seg_base_es))))
   (if (i32.eq (local.get $n) (i32.const 1)) (then (return (global.get $seg_base_cs))))
   (if (i32.eq (local.get $n) (i32.const 2)) (then (return (global.get $seg_base_ss))))
   (global.get $seg_base_ds))
`;
// Replace only the fixed-size |SYSTEM payload; all original directory/topic
// offsets remain valid. The fixture really registers Probe during HLP parsing.
function helpFixture(dllName) {
  const b = Buffer.from(fs.readFileSync(path.join(__dirname, 'binaries/help/freecell.hlp')));
  const internal = 1211, size = b.readUInt32LE(internal + 4), start = internal + 9;
  assert.strictEqual(b.readUInt16LE(start), 0x036c);
  let pos = start + 12;
  function record(type, bytes) {
    b.writeUInt16LE(type, pos); b.writeUInt16LE(bytes.length, pos + 2);
    bytes.copy(b, pos + 4); pos += 4 + bytes.length;
  }
  b.fill(0, pos, start + size);
  record(1, Buffer.from('Macro fixture\0'));
  record(3, Buffer.alloc(4));
  record(4, Buffer.from(`RegisterRoutine("${dllName}","Probe","SI")\0`));
  // Unknown tagged padding remains structurally valid, unlike raw zero tails.
  record(0x7ffe, Buffer.alloc(start + size - pos - 4));
  assert.strictEqual(pos, start + size);
  return b;
}

// A real PE32 DLL export, not a mocked resolver. Its position-independent
// trampoline jumps to the synthetic x86 callback in the test process.
function dllFixture(name, target = CODE) {
  assert(Buffer.byteLength(name) < 16, 'DLL name must fit before the export-name slot');
  const b = Buffer.alloc(0x2400), pe = 0x80, opt = pe + 24, sec = opt + 0xe0;
  b.writeUInt16LE(0x5a4d); b.writeUInt32LE(pe, 0x3c);
  b.writeUInt32LE(0x4550, pe); b.writeUInt16LE(0x14c, pe + 4);
  b.writeUInt16LE(1, pe + 6); b.writeUInt16LE(0xe0, pe + 20); b.writeUInt16LE(0x210e, pe + 22);
  b.writeUInt16LE(0x10b, opt); b.writeUInt32LE(0x400, opt + 4);
  b.writeUInt32LE(0x1000, opt + 16); b.writeUInt32LE(0x1000, opt + 20);
  b.writeUInt32LE(0x10000000, opt + 28); b.writeUInt32LE(0x1000, opt + 32);
  b.writeUInt32LE(0x200, opt + 36); b.writeUInt32LE(0x2000, opt + 56);
  b.writeUInt32LE(0x200, opt + 60); b.writeUInt16LE(2, opt + 68); b.writeUInt32LE(16, opt + 92);
  b.writeUInt32LE(0x1100, opt + 96); b.writeUInt32LE(0x80, opt + 100);
  b.write('.text\0\0\0', sec); b.writeUInt32LE(0x400, sec + 8); b.writeUInt32LE(0x1000, sec + 12);
  b.writeUInt32LE(0x400, sec + 16); b.writeUInt32LE(0x200, sec + 20); b.writeUInt32LE(0x60000020, sec + 36);
  Buffer.from([0xb8, 1, 0, 0, 0, 0xc2, 12, 0]).copy(b, 0x200); // DllMain
  b[0x210] = 0xb8; b.writeUInt32LE(target, 0x211); b[0x215] = 0xff; b[0x216] = 0xe0;
  b.writeUInt32LE(0x1150, 0x30c); b.writeUInt32LE(1, 0x310); b.writeUInt32LE(1, 0x314);
  b.writeUInt32LE(1, 0x318); b.writeUInt32LE(0x1128, 0x31c);
  b.writeUInt32LE(0x1130, 0x320); b.writeUInt32LE(0x1138, 0x324);
  b.writeUInt32LE(0x1010, 0x328); b.writeUInt32LE(0x1160, 0x330); b.writeUInt16LE(0, 0x338);
  b.write(name + '\0', 0x350); b.write('Probe\0', 0x360);
  return b;
}

function callbackBytes(length, { state = STATE, nested = null } = {}) {
  const bytes = [], emit = (...v) => bytes.push(...v), dword = n => emit(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255);
  const inc = address => { emit(0xff, 0x05); dword(address); };
  const storeEax = address => { emit(0xa3); dword(address); };
  const push = n => { emit(0x68); dword(n); };
  const call = address => { emit(0xb8); dword(address); emit(0xff, 0xd0); };
  emit(0x55, 0x89, 0xe5); // push ebp; mov ebp,esp
  inc(state); emit(0x8b, 0x45, 8); storeEax(state + 4);
  emit(0x8b, 0x45, 12); storeEax(state + 8);
  if (nested) {
    push(nested.macro); push(0x0102); push(nested.path); push(0x5555);
    call(THUNK + (nested.wide ? 8 : 0)); storeEax(state + 28);
  }
  const loop = bytes.length;
  push(1); call(SLEEP); inc(state + 12);
  emit(0x81, 0x3d); dword(state + 12); dword(130);
  emit(0x0f, 0x82); dword(loop - (bytes.length + 4));
  push(0); push(COUNT); push(length); push(BUFFER); emit(0xff, 0x75, 12); call(READ);
  storeEax(state + 16);
  emit(0x8b, 0x45, 8, 0x8b, 0x00); storeEax(state + 20);
  inc(state + 24); emit(0xb8); dword(1); emit(0x5d, 0xc2, 8, 0);
  return Uint8Array.from(bytes);
}


(async()=>{
 let ticks=1000;
 const h=await bootRenderHarness({fonts:'none',extraWat,extraHostOverrides:{get_ticks:()=>ticks}});
 const e=h.exports,vfs=h.hostCtx.vfs;
 const exe=fs.readFileSync(path.join(__dirname,'binaries/win98-16bit/WINMINE.EXE'));
 assert.strictEqual(exe.readUInt16LE(exe.readUInt32LE(0x3c)),0x454e,'real NE fixture');
 new Uint8Array(h.memory.buffer).set(exe,e.get_staging()); assert(e.load_pe(exe.length)>=0);
 assert.strictEqual(e.mode(),1,'real NE startup selects Win16 mode');
 assert(e.return_thunk(),'NE startup must initialize the generic typed callback return thunk');
 const write=(p,b)=>b.forEach((v,i)=>e.guest_write8(p+i,v));
 const staging=Uint8Array.from(new Uint8Array(h.memory.buffer,e.get_staging(),exe.length));
 const unchangedStaging=()=>assert.deepStrictEqual(new Uint8Array(h.memory.buffer,e.get_staging(),exe.length),staging,'NE resource staging survives PE macro loads');
 const validation=dllFixture('bounds.dll');
 write(CODE,validation); assert.strictEqual(e.image_size(CODE,validation.length),0x2000);
 const oversized=Buffer.from(validation);oversized.writeUInt32LE(0x7fffffff,0x80+24+56);
 write(CODE,oversized);assert.strictEqual(e.image_size(CODE,oversized.length),0);
 const escape=Buffer.from(validation);escape.writeUInt32LE(0x2000,0x80+24+0xe0+12);
 write(CODE,escape);assert.strictEqual(e.image_size(CODE,escape.length),0);
 assert.strictEqual(e.reserve_image(0x7fffffff),0,'oversized reservation must fail');
 unchangedStaging();
 const payload=Uint8Array.from({length:9001},(_,i)=>(i*19+7)&255);
 const frame=()=>Array.from({length:16},(_,i)=>e.guest_read8(STACK+i));
 let caseId=0;
 for(const failure of ['none','data','dll','cancel','executing-cancel']){
  caseId++; e.test_help_reset();
  READ=e.setup(apis.find(a=>a.name==='ReadFile').id,apis.find(a=>a.name==='Sleep').id); SLEEP=READ+8;
  const name='p16'+caseId+'.dll', file='c:\\macro16'+caseId+'.hlp';
  const budget=new ChunkCacheBudget({maxBytes:0}), opens=[];
  function mount(name,bytes,kind){
   vfs.setProviderFile(name,{provider:new ChunkCache({size:bytes.length,async readRange(off,len){
    if(failure===kind&&off>=4096)throw Error('injected '+kind+' failure');
    return bytes.slice(off,off+len);
   }},{chunkSize:4096,maxChunks:1,readAhead:0,budget})});
  }
  mount(file,helpFixture(name),'hlp');mount(vfs._resolvePath(name),dllFixture(name),'dll');
  mount('c:\\macro16.bin',payload,'data');
  const create=vfs.createFile.bind(vfs);
  vfs.createFile=(...args)=>{opens.push(args[0]);return create(...args);};
  const handle=vfs.createFile('c:\\macro16.bin',0x80000000,3);
  write(0x110400,Buffer.from(file+'\0'));write(0x110800,Buffer.from('Probe("durable string",'+handle+')\0'));
  write(CODE,callbackBytes(payload.length));write(STATE,new Uint8Array(64));
  write(BUFFER,new Uint8Array(payload.length).fill(0xa5));e.guest_write32(COUNT,0xa5a5a5a5);
  e.guest_write32(STACK+16,0xfaceb00c);
  const original=frame(),segs=[0,1,2,3].map(n=>e.seg(n)),bases=[0,1,2,3].map(n=>e.base(n)),oldFs=e.fs();
  let runs=0,sleeps=0,parks=0,canceled=false,epoch=null;
  while(e.get_eip()!==RETURN){
   assert(++runs<5000,'Win16 owned macro must progress');
   e.run(1);
   if(!e.mode()&&e.jobs()){
    const job=e.jobs(),stack=e.guest_read32(job+112)>>>0,tib=e.guest_read32(job+128)>>>0;
    assert(stack&&tib);assert.strictEqual(e.fs()>>>0,tib);
    assert.strictEqual(e.guest_read32(tib),-1);
    assert.strictEqual(e.guest_read32(tib+4)>>>0,stack+65536);
    assert.strictEqual(e.guest_read32(tib+8)>>>0,stack);
    assert.strictEqual(e.guest_read32(tib+0x18)>>>0,tib);
    assert(e.guest_read32(tib+0x2c),'callback TIB owns a TLS array');
    assert(e.get_esp()>=stack&&e.get_esp()<stack+65536,'flat callback stays in owned stack');
   }
   assert.deepStrictEqual(frame(),original,'Pascal input frame is never callback scratch');
   if(e.guest_read32(STATE)){
    assert.strictEqual(e.guest_read32(STATE),1);
    if(epoch===null)epoch=e.epoch();
    assert.strictEqual(e.epoch(),epoch,'callback retry must not reload HLP');
   }
   if(e.get_sleep_yielded()){sleeps++;ticks+=e.get_sleep_timeout();}
   if(failure==='executing-cancel'&&sleeps){
    const job=e.jobs(),ownedStack=e.guest_read32(job+112),ownedTib=e.guest_read32(job+128);
    e.help_macro_api_cancel_all();
    assert.strictEqual(e.is_free(ownedStack),1,'executing cancellation frees callback stack');
    assert.strictEqual(e.is_free(ownedTib),1,'executing cancellation frees callback TIB');
    canceled=true;break;
   }
   if(e.get_yield_reason()===12){
    parks++;assert(vfs.pendingRead);
    if(e.mode()){
     assert.strictEqual(e.get_esp(),STACK);
     assert.deepStrictEqual([0,1,2,3].map(n=>e.seg(n)),segs);
     assert.deepStrictEqual([0,1,2,3].map(n=>e.base(n)),bases);
    }else{
     assert(e.get_esp()<STACK||e.get_esp()>=STACK+65536,'callback uses a distinct stack');
    }
    if(failure==='cancel'&&e.jobs()){
     e.help_macro_api_cancel_all();assert.strictEqual(vfs.pendingRead,null);canceled=true;break;
    }
    await vfs.fillPendingRead(vfs.pendingRead);e.clear_yield();
   }
  }
  assert.strictEqual(e.jobs(),0);assert.strictEqual(e.context(),0);assert.strictEqual(e.resolvers(),0);
  unchangedStaging();
  assert.strictEqual(e.guest_read32(STACK+16)>>>0,0xfaceb00c);
  if(!canceled){
   assert.strictEqual(e.fs(),oldFs,'original Win16 FS restored');
   assert.strictEqual(e.get_esp(),STACK+16,'far return plus twelve Pascal argument bytes');
   assert.strictEqual(e.mode(),1);assert.strictEqual(e.base(1),0x100000);
   assert.strictEqual(e.seg(1),segs[0]);
   for(const n of [0,2,3]){assert.strictEqual(e.seg(n),segs[n]);assert.strictEqual(e.base(n),bases[n]);}
   assert.strictEqual(e.get_esp()-e.base(2),0x110,'SS:SP restored exactly');
   assert.strictEqual(e.get_eip()-e.base(1),0x3456,'CS:IP restored exactly');
   assert.strictEqual(e.get_eax(),failure==='dll'?0:1);
  }
  if(failure==='none'||failure==='data'){
   assert.strictEqual(sleeps,130);assert(runs>64);
   assert.strictEqual(e.guest_read32(STATE+24),1);
   assert.strictEqual(e.guest_read32(STATE+8)>>>0,handle>>>0);
   assert.strictEqual(e.guest_read32(STATE+20)>>>0,Buffer.from('dura').readUInt32LE());
   assert.strictEqual(e.guest_read32(STATE+16),failure==='data'?0:1);
   if(failure==='none'){
    assert.strictEqual(e.guest_read32(COUNT),payload.length);
    assert.deepStrictEqual(Uint8Array.from({length:payload.length},(_,i)=>e.guest_read8(BUFFER+i)),payload);
   }
  }else if(failure==='executing-cancel'){
   assert.strictEqual(e.guest_read32(STATE),1);assert.strictEqual(e.guest_read32(STATE+24),0);
  }else assert.strictEqual(e.guest_read32(STATE),0);
  assert.strictEqual(opens.filter(p=>p===file).length,1);
  assert.strictEqual(opens.filter(p=>p===name).length,1);
  assert.strictEqual([...vfs.handles.values()].filter(f=>!f.closed).length,1);
  assert.strictEqual(budget.bytes,0);vfs.closeHandle(handle);vfs.createFile=create;
  console.log('PASS USER171 lazy macro '+failure+': '+runs+' slices, '+sleeps+' sleeps, '+parks+' parks');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
