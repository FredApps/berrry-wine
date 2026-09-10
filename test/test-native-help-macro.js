#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const STACK = 0x074ff000, PATH = 0x00480000, MACRO = PATH + 0x1000;
const CODE = PATH + 0x2000, BUFFER = PATH + 0x3000, COUNT = PATH + 0x6000;
const STATE = PATH + 0x6100, THUNK = 0x07500000;
const READ = THUNK + 16, SLEEP = THUNK + 24;
const id = name => apis.find(api => api.name === name).id;
const extraWat = String.raw`
 (func (export "macro_setup") (param $a i32) (param $w i32) (param $read i32) (param $sleep i32)
   (global.set $thunk_guest_base (i32.const 0x07500000))
   (global.set $thunk_guest_end (i32.const 0x07500028))
   (global.set $num_thunks (i32.const 5))
   (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=4 (global.get $THUNK_BASE) (local.get $a))
   (i32.store offset=8 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=12 (global.get $THUNK_BASE) (local.get $w))
   (i32.store offset=16 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=20 (global.get $THUNK_BASE) (local.get $read))
   (i32.store offset=24 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=28 (global.get $THUNK_BASE) (local.get $sleep))
   (i32.store offset=32 (global.get $THUNK_BASE) (i32.const 0xCACA0011))
   (i32.store offset=36 (global.get $THUNK_BASE) (i32.const 0))
   (global.set $font_enum_ret_thunk (i32.const 0x07500020))
   (call $clear_cache))
 (func (export "macro_begin") (param $wide i32)
   (global.set $esp (i32.const 0x074ff000))
   (global.set $eip (i32.add (i32.const 0x07500000) (i32.shl (local.get $wide) (i32.const 3))))
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
 (func (export "macro_epoch") (result i32) (global.get $help_document_epoch))
 (func (export "macro_jobs") (result i32) (global.get $help_macro_api_jobs))
 (func (export "macro_context") (result i32) (global.get $help_macro_api_context))
 (func (export "macro_resolvers") (result i32) (global.get $help_routine_pending))
 (func (export "native_load") (param $path i32) (result i32)
   (call $help_document_load_vfs (call $g2w (local.get $path))))
 (func (export "native_queue") (param $str i32) (param $len i32) (result i32)
   (local $result i32) (local $ga i32) (local $wa i32)
   (local $runs i32) (local $count i32) (local $tokens i32) (local $tc i32) (local $payload i32) (local $pl i32)
   (local.set $runs (global.get $help_view_runs_wa)) (local.set $count (global.get $help_view_run_count))
   (local.set $tokens (global.get $help_view_tokens_wa)) (local.set $tc (global.get $help_view_token_count))
   (local.set $payload (global.get $help_view_payload_wa)) (local.set $pl (global.get $help_view_payload_len))
   (local.set $ga (call $heap_alloc (i32.add (local.get $len) (i32.const 131))))
   (local.set $wa (call $g2w (local.get $ga)))
   (memory.fill (local.get $wa) (i32.const 0) (i32.const 131))
   (i32.store offset=12 (local.get $wa) (i32.const 20)) (i32.store offset=16 (local.get $wa) (i32.const 20))
   (i32.store offset=36 (local.get $wa) (i32.const 1))
   (i32.store offset=64 (local.get $wa) (global.get $HELP_TOKEN_MACRO))
   (i32.store16 offset=129 (local.get $wa) (local.get $len))
   (memory.copy (i32.add (local.get $wa) (i32.const 131)) (call $g2w (local.get $str)) (local.get $len))
   (global.set $help_view_runs_wa (local.get $wa)) (global.set $help_view_run_count (i32.const 1))
   (global.set $help_view_tokens_wa (i32.add (local.get $wa) (i32.const 64))) (global.set $help_view_token_count (i32.const 1))
   (global.set $help_view_payload_wa (i32.add (local.get $wa) (i32.const 128))) (global.set $help_view_payload_len (i32.add (local.get $len) (i32.const 3)))
   (local.set $result (call $help_activate_hotspot_at (i32.const 0) (i32.const 1) (i32.const 1)))
   (global.set $help_view_runs_wa (local.get $runs)) (global.set $help_view_run_count (local.get $count))
   (global.set $help_view_tokens_wa (local.get $tokens)) (global.set $help_view_token_count (local.get $tc))
   (global.set $help_view_payload_wa (local.get $payload)) (global.set $help_view_payload_len (local.get $pl))
   (call $heap_free (local.get $ga)) (local.get $result))
 (func (export "native_seed")
   (global.set $eip (i32.const 0x00490000)) (global.set $esp (i32.const 0x074ff000))
   (global.set $eax (i32.const 0x12345678)) (global.set $ebx (i32.const 0x23456789))
   (global.set $flag_a (i32.const 0x34567890)) (global.set $flag_b (i32.const 0x45678901))
   (global.set $yield_reason (i32.const 7)) (global.set $yield_flag (i32.const 1))
   (global.set $sleep_yielded (i32.const 0)) (global.set $sleep_timeout (i32.const 701))
   (global.set $last_error (i32.const 0x76543210)))
 (func (export "native_df") (result i32) (global.get $df))
 (func (export "native_tags") (result i32) (global.get $fpu_tag))
 (func (export "native_wait_state_clean") (result i32)
   (i32.eqz (i32.or (global.get $message_wait_msg_ptr)
     (i32.or (global.get $vblank_wait_active)
       (i32.or (global.get $vblank_wait_counter) (global.get $vblank_deadline_ms))))))
 (func (export "native_wait_thunk") (param $api i32)
   (i32.store offset=40 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=44 (global.get $THUNK_BASE) (local.get $api))
   (global.set $num_thunks (i32.const 6))
   (global.set $thunk_guest_end (i32.const 0x07500030))
   (global.set $eip (i32.const 0x07500028))
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
 (func (export "native_wait_id") (param $api i32)
   (i32.store offset=44 (global.get $THUNK_BASE) (local.get $api)))
 (func (export "native_is_free") (param $ga i32) (result i32)
   (local $p i32) (local $left i32)
   (local.set $p (global.get $free_list)) (local.set $left (i32.const 10000))
   (block $done (loop $scan
     (br_if $done (i32.eqz (local.get $p)))
     (if (i32.eq (i32.add (local.get $p) (i32.const 4)) (local.get $ga)) (then (return (i32.const 1))))
     (local.set $p (call $gl32 (i32.add (local.get $p) (i32.const 4))))
     (local.set $left (i32.sub (local.get $left) (i32.const 1)))
     (br_if $scan (local.get $left)))) (i32.const 0))
 (func (export "native_advance_epoch")
   (global.set $help_document_epoch (i32.add (global.get $help_document_epoch) (i32.const 1))))
 (func (export "native_dirty_cpu")
   (global.set $df (i32.const 1)) (global.set $fpu_top (i32.const 3))
   (global.set $message_wait_msg_ptr (i32.const 0x00497000))
   (global.set $vblank_wait_active (i32.const 1))
   (global.set $vblank_wait_counter (i32.const 42))
   (global.set $vblank_deadline_ms (i32.const 123456))
   (global.set $fpu_tag (i32.const 255)) (global.set $fpu_raw_tag (i32.const 255)))
 (func (export "native_snapshot") (param $wa i32) (call $guest_context_save (local.get $wa)))

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

function callbackBytes(length, { state = STATE, nested = null, waitHandle = null } = {}) {
  const bytes = [], emit = (...v) => bytes.push(...v), dword = n => emit(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255);
  const inc = address => { emit(0xff, 0x05); dword(address); };
  const storeEax = address => { emit(0xa3); dword(address); };
  const push = n => { emit(0x68); dword(n); };
  const call = address => { emit(0xb8); dword(address); emit(0xff, 0xd0); };
  emit(0x55, 0x89, 0xe5); // push ebp; mov ebp,esp
  inc(state); emit(0x8b, 0x45, 8); storeEax(state + 4);
  emit(0x8b, 0x45, 12); storeEax(state + 8);
  if (waitHandle !== null) { push(50); push(waitHandle); call(THUNK+40); storeEax(state+32); }
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


const {pump}=require('../lib/help-navigation-pump');
const {ThreadManager}=require('../lib/thread-manager');
(async()=>{
 let ticks=1000,tm;
 const h=await bootRenderHarness({fonts:'none',extraWat,extraHostOverrides:{get_ticks:()=>ticks,
  wait_single:(handle,timeout)=>tm.waitSingle(handle,timeout,1),
  wait_multiple:(count,ptr,all,timeout)=>tm.waitMultiple(count,ptr,!!all,timeout,1)}});
 const e=h.exports,vfs=h.hostCtx.vfs;
 const exe=fs.readFileSync(path.join(__dirname,'binaries/notepad.exe'));
 new Uint8Array(h.memory.buffer).set(exe,e.get_staging());assert(e.load_pe(exe.length));
 tm=new ThreadManager({},h.memory,{exports:e},()=>({host:{}}),{now:()=>ticks});
 tm._now=()=>ticks;tm._log=()=>{};
 const write=(p,b)=>b.forEach((v,i)=>e.guest_write8(p+i,v));
 const data=Uint8Array.from({length:9001},(_,i)=>(i*19+7)&255);
 let n=0;
 for(const failure of ['wait-auto','wait-ex','wait-all','wait-timeout','msg-complete','none','data','dll','cancel','epoch','executing-cancel']){
  n++;e.test_help_reset();e.macro_setup(id('WinHelpA'),id('WinHelpW'),id('ReadFile'),id('Sleep'));
  const name='native'+n+'.dll',file='c:\\native'+n+'.hlp';
  const budget=new ChunkCacheBudget({maxBytes:0});
  function mount(name,bytes,kind){
   vfs.setProviderFile(name,{provider:new ChunkCache({size:bytes.length,async readRange(off,len){
    if(failure===kind&&off>=4096)throw Error('injected native '+kind+' failure');
    return bytes.slice(off,off+len);
   }},{chunkSize:4096,maxChunks:1,readAhead:0,budget})});
  }
  mount(file,helpFixture(name),'hlp');mount(vfs._resolvePath(name),dllFixture(name),'dll');mount('c:\\native.bin',data,'data');
  write(PATH,Buffer.from(file+'\0'));e.macro_begin(0);
  let loaded=e.native_load(PATH),loads=0;
  while(loaded===-1){assert(++loads<10);await vfs.fillPendingRead(vfs.pendingRead);loaded=e.native_load(PATH);}
  assert.strictEqual(loaded,1);
  const handle=vfs.createFile('c:\\native.bin',0x80000000,3);
  const macro='Probe("durable string",'+handle+')';
  write(MACRO,Buffer.from(macro+'\0'));write(CODE,callbackBytes(data.length));write(STATE,new Uint8Array(64));
  e.native_seed();e.native_dirty_cpu();
  const isWait=failure.startsWith('wait-'),isMsg=failure==='msg-complete';let event,sem,waitBytes,callbackEvent;
  if(isMsg){
   [0x00490000,0,0,0,50,0].forEach((v,i)=>e.guest_write32(STACK+i*4,v));
   e.native_wait_thunk(id('MsgWaitForMultipleObjects'));e.run(1);
   assert.strictEqual(e.get_esp(),STACK+24,'actual MsgWait completes24bytes before slice yield');
   assert.notStrictEqual(e.get_yield_reason(),1,'current MsgWait implementation has no parked descriptor');
  }
  if(isWait){
   event=tm.createEvent(false,false);sem=tm.createSemaphore(0,1);
   const multiple=failure==='wait-all',extended=failure==='wait-ex';waitBytes=multiple?20:extended?16:12;
   const args=multiple?[0x00490000,2,PATH+0x7000,1,50]:extended?[0x00490000,event,50,0]:[0x00490000,event,50];
   e.guest_write32(PATH+0x7000,event);e.guest_write32(PATH+0x7004,sem);
   args.forEach((v,i)=>e.guest_write32(STACK+i*4,v));
   e.native_wait_thunk(id(multiple?'WaitForMultipleObjects':extended?'WaitForSingleObjectEx':'WaitForSingleObject'));e.run(1);
   assert.strictEqual(e.get_yield_reason(),1,'real wait handler parked');
   assert.strictEqual(e.get_wait_stack_bytes(),waitBytes);
   if(multiple){
    callbackEvent=tm.createEvent(false,false);e.native_wait_id(id('WaitForSingleObject'));
    write(CODE,callbackBytes(data.length,{waitHandle:callbackEvent}));
   }
   tm._mainSleepUntil=0;tm._mainWaitStartedAt=ticks;tm._mainWaitPolls=1000;
  }
  const owner=isWait?tm:{sleepUntil:9000,waitStartedAt:77,waitPolls:11,sleepCount:17};
  const mode=isWait?'mainCooperative':'thread';
  const ownerSnapshot=()=>isWait?{sleep:tm._mainSleepUntil,start:tm._mainWaitStartedAt,polls:tm._mainWaitPolls}:{...owner};
  const originalOwner=ownerSnapshot();
  const cpu=()=>{e.native_snapshot(0x19000000);return new Uint8Array(h.memory.buffer,0x19000000,e.guest_context_size()).slice();};
  const original=cpu(),epoch=e.macro_epoch();
  assert.strictEqual(e.native_queue(MACRO,macro.length),2);
  assert.deepStrictEqual(cpu(),original,'queueing is CPU-neutral');
  if(failure==='epoch'){
   let ready=-1,attempts=0;
   while(ready===-1){assert(++attempts<10);if(vfs.pendingRead)await vfs.fillPendingRead(vfs.pendingRead);ready=e.help_macro_native_prepare();}
   assert(ready>0);const token=e.get_help_macro_native_token();e.native_advance_epoch();
   assert.strictEqual(e.help_macro_native_begin(token),0,'epoch change between prepare and begin rejects stale callback');
   assert.deepStrictEqual(cpu(),original);assert.deepStrictEqual(ownerSnapshot(),originalOwner);
   e.help_navigation_cancel();assert.strictEqual(e.get_help_macro_native_token(),0);
   assert.strictEqual(e.guest_read32(STATE),0);vfs.closeHandle(handle);
   console.log('PASS native macro stale prepared epoch rejected');continue;
  }
  let rounds=0,runs=0,sleeps=0,finished=false;
  while(e.get_help_macro_native_token()){
   assert(++rounds<5000,'native macro must progress');
   const phase=e.get_help_macro_native_phase();
   if(failure==='cancel'&&phase===1){
    await pump({exports:e,vfs,callbackOwner:owner,callbackMode:mode,alive:()=>false});break;
   }
   if(phase===2){
    if(isWait&&runs===0&&failure!=='wait-timeout'){tm.setEvent(event);if(failure==='wait-all')tm.releaseSemaphore(sem,1,0);}
    if(runs===0){assert.strictEqual(e.native_df(),0,'callback enters with clear DF');assert.strictEqual(e.native_tags(),0,'callback enters with empty x87 stack');assert.strictEqual(e.native_wait_state_clean(),1,'callback starts without interrupted message/vblank wait state');}
    e.run(1);runs++;
    if(e.get_yield_reason()===1){
     assert.strictEqual(e.get_wait_handle()>>>0,callbackEvent>>>0,'nested wait names callback event');
     assert.strictEqual(e.get_wait_handles_ptr(),0,'callback single wait cannot inherit original wait-all array');
     assert.strictEqual(e.get_wait_stack_bytes(),12);
     tm.setEvent(callbackEvent);assert.strictEqual(tm.checkMainYield(),false);
     assert.strictEqual(tm.syncView[tm._getSyncIdx(callbackEvent)*4+2],0,'only callback event consumed');
    }
    if(e.get_sleep_yielded()){sleeps++;ticks+=e.get_sleep_timeout();owner.sleepUntil=ticks+e.get_sleep_timeout();owner.sleepCount++;}
    if(isWait&&failure!=='wait-timeout'){
     assert.strictEqual(tm.syncView[tm._getSyncIdx(event)*4+2],1,'original auto-reset signal remains unconsumed during callback');
     if(failure==='wait-all')assert.strictEqual(tm.syncView[tm._getSyncIdx(sem)*4+2],1,'original semaphore count remains unconsumed');
    }
    if(failure==='executing-cancel'&&sleeps){
     // No more run calls after this point: the producer is stopped before
     // process teardown releases the callback's live memory.
     const token=e.get_help_macro_native_token();
     const owned=[112,128,132].map(off=>e.guest_read32(token+off));
     const stopped=cpu(),stoppedOwner={...owner};
     e.help_macro_api_cancel_all();require('../lib/guest-callback-state').cancel(owner);
     assert.deepStrictEqual(cpu(),stopped,'process cancel must not revive interrupted CPU');
     assert.notDeepStrictEqual(cpu(),original);
     assert.deepStrictEqual(owner,stoppedOwner,'process cancel must not restore old deadline');
     owned.forEach(p=>{assert(p);assert.strictEqual(e.native_is_free(p),1,'owned stack/TIB/context released');});
     assert.strictEqual(e.get_help_macro_native_token(),0);
     assert.strictEqual(e.macro_jobs(),0);assert.strictEqual(e.macro_resolvers(),0);
     assert.strictEqual(e.guest_read32(STATE),1);assert.strictEqual(e.guest_read32(STATE+24),0);
     break;
    }
    if(e.get_yield_reason()===12){await vfs.fillPendingRead(vfs.pendingRead);e.clear_yield();}
   }else if(phase===3){
    const parked=cpu();e.run(1);assert.deepStrictEqual(cpu(),parked,'returned callback stays parked until outer pump');
    await pump({exports:e,vfs,callbackOwner:owner,callbackMode:mode});finished=true;
   }else await pump({exports:e,vfs,callbackOwner:owner,callbackMode:mode});
   assert.strictEqual(e.macro_epoch(),epoch,'callback never reloads its source document');
  }
  if(failure!=='executing-cancel'){
   assert.deepStrictEqual(cpu(),original,'outer finish restores exact interrupted CPU');
   assert.deepStrictEqual(ownerSnapshot(),originalOwner,'absolute host sleep/wait deadlines restored without extending them');
  }
  if(isWait||isMsg||failure==='none'||failure==='data'){
   assert(finished);assert.strictEqual(sleeps,130);assert(runs>64);
   assert.strictEqual(e.guest_read32(STATE),1);assert.strictEqual(e.guest_read32(STATE+24),1);
   assert.strictEqual(e.guest_read32(STATE+16),failure==='data'?0:1);
   if(isWait||isMsg||failure==='none'){
    assert.strictEqual(e.guest_read32(COUNT),data.length);
    assert.deepStrictEqual(Uint8Array.from({length:data.length},(_,i)=>e.guest_read8(BUFFER+i)),data);
   }
  }else if(failure!=='executing-cancel')assert.strictEqual(e.guest_read32(STATE),0);
  if(isMsg)assert.strictEqual(e.get_esp(),STACK+24,'native callback does not pop completed MsgWait frame twice');
  if(isWait){
   assert.strictEqual(e.get_yield_reason(),1,'original wait restored before resolution');
   if(failure==='wait-timeout'){
    const decision=tm.resolveWait({waitHandle:e.get_wait_handle(),waitTimeout:e.get_wait_timeout(),waitStackBytes:e.get_wait_stack_bytes()},
      {waitStartedAt:tm._mainWaitStartedAt,waitPolls:tm._mainWaitPolls},{threadId:1});
    assert.deepStrictEqual(decision,{result:0x102,waitStackBytes:12},'elapsed original absolute timeout is not restarted by callback');
   }
   assert.strictEqual(tm.checkMainYield(),false,'original signaled/expired wait completes now');
   assert.strictEqual(e.get_eax(),failure==='wait-timeout'?0x102:0);
   assert.strictEqual(e.get_esp(),STACK+waitBytes,'exact original wait argument cleanup');
   if(failure!=='wait-timeout')assert.strictEqual(tm.syncView[tm._getSyncIdx(event)*4+2],0,'auto-reset event consumed exactly once');
   if(failure==='wait-all')assert.strictEqual(tm.syncView[tm._getSyncIdx(sem)*4+2],0,'wait-all consumes semaphore once');
   if(callbackEvent){assert.strictEqual(e.guest_read32(STATE+32),0,'nested WaitSingle completed');tm.closeSyncHandle(callbackEvent);}
   tm.closeSyncHandle(event);tm.closeSyncHandle(sem);
  }
  assert.strictEqual(e.macro_jobs(),0);assert.strictEqual(e.macro_resolvers(),0);
  assert.strictEqual([...vfs.handles.values()].filter(f=>!f.closed).length,1);
  vfs.closeHandle(handle);assert.strictEqual(budget.bytes,0);
  console.log('PASS native macro '+failure+': '+runs+' slices, '+sleeps+' sleeps, '+(failure==='executing-cancel'?'stopped callback released without CPU/deadline revival':'exact CPU/host-deadline restore'));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
