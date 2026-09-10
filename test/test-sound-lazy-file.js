#!/usr/bin/env node
'use strict';
const assert = require('assert');
const {bootRenderHarness} = require('./render-helper');
const {ChunkCache} = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const STACK=0x110100, PATH=0x120000, THUNK=0x200000;
const extraWat = String.raw`
 (func (export "sound_begin") (param $id i32) (param $stack i32)
   (global.set $thunk_guest_base (i32.const 0x200000))
   (global.set $thunk_guest_end (i32.const 0x200008))
   (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
   (global.set $esp (local.get $stack)) (global.set $eip (i32.const 0x200000))
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
 (func (export "sound_resume")
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
   (call $run (i32.const 2)))
 (func (export "sound_eax") (result i32) (global.get $eax))
 (func (export "sound_esp") (result i32) (global.get $esp))
 (func (export "sound_pending") (result i32) (global.get $sound_file_pending))
`;
(async()=>{
 let h; const played=[];
 h=await bootRenderHarness({fonts:'none',extraWat,extraHostOverrides:{
   play_sound:(ptr,len)=>{played.push(new Uint8Array(h.memory.buffer,ptr,len).slice());return 77;},
   voice_close:()=>0, voice_is_playing:()=>0,
 }});
 const e=h.exports,vfs=h.hostCtx.vfs;
 const peer=await bootRenderHarness({fonts:'none',extraWat,memory:h.memory});
 let opens=0,closes=0,reads=0;
 const create=vfs.createFile.bind(vfs),close=vfs.closeHandle.bind(vfs);
 vfs.createFile=(...args)=>{opens++;return create(...args);};
 vfs.closeHandle=(...args)=>{closes++;return close(...args);};
 const wav=Buffer.alloc(12332,0x80);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);
 function mount(fail=false,invalid=false){
   const payload=new Uint8Array(wav);if(invalid)payload[0]=0;
   const provider=new ChunkCache({size:payload.length,readRange:async(off,len)=>{
     reads++;if(fail&&off>=4096)throw new Error('injected read failure');return payload.slice(off,off+len);
   }},{chunkSize:4096,maxChunks:1,readAhead:0});
   vfs.setProviderFile('c:\\sound.wav',{provider});
 }
 function begin(name='PlaySoundA',path=PATH,flags=0x20000,stack=STACK){
   const wide=name==='PlaySoundW';
   const encoded=Buffer.from('c:\\sound.wav\0',wide?'utf16le':'latin1');
   encoded.forEach((b,i)=>e.guest_write8(PATH+i,b));
   e.sound_begin(apis.find(a=>a.name===name).id,stack);
   const args=name==='sndPlaySoundA'?[path,flags]:[path,0,flags];
   [0,...args].forEach((v,i)=>e.guest_write32(stack+i*4,v));
 }
 async function finish(pop){
   let parks=0;
   for(;;){
     e.sound_resume();if(e.get_yield_reason()!==12)break;
     assert(++parks<10);assert.strictEqual(e.sound_esp(),STACK);assert.strictEqual(e.get_eip(),THUNK);
     await vfs.fillPendingRead(vfs.pendingRead);
   }
   assert.strictEqual(e.sound_esp(),STACK+pop);assert.strictEqual(e.sound_pending(),0);
   return parks;
 }
 for(const name of ['PlaySoundA','PlaySoundW','sndPlaySoundA']){
   mount();const before=[opens,closes,reads,played.length];begin(name);
   const parks=await finish(name==='sndPlaySoundA'?12:16);
   assert.strictEqual(e.sound_eax(),1);assert.strictEqual(opens-before[0],1);assert.strictEqual(closes-before[1],1);
   assert.strictEqual(played.length-before[3],1);assert.deepStrictEqual(played.at(-1),new Uint8Array(wav));
   assert.strictEqual(reads-before[2],4);assert.strictEqual(parks,4);
 }
 for(const [fail,invalid] of [[true,false],[false,true]]){
   mount(fail,invalid);const count=played.length,c=closes;begin();await finish(16);
   assert.strictEqual(e.sound_eax(),0);assert.strictEqual(played.length,count);assert.strictEqual(closes,c+1);
 }
 mount();begin();e.sound_resume();assert.strictEqual(e.get_yield_reason(),12);
 const canceled=e.sound_pending(),c=closes,o=opens,count=played.length;
 begin('PlaySoundA',0,0,STACK+0x4000);e.sound_resume();
 assert.strictEqual(e.sound_eax(),1);assert.strictEqual(closes,c+1);
 assert.strictEqual(e.guest_read32(canceled+28),0,'stop immediately frees pending WAV allocation');
 begin();await finish(16);
 assert.strictEqual(e.sound_eax(),0);assert.strictEqual(opens,o,'canceled retry cannot reopen');
 assert.strictEqual(played.length,count);assert.strictEqual(closes,c+1);
 mount();begin();e.sound_resume();assert.strictEqual(e.get_yield_reason(),12);
 const peerCanceled=e.sound_pending(),peerOpens=opens,peerCloses=closes,peerPlayed=played.length;
 const p=peer.exports,peerStack=STACK+0x6000;
 p.sound_begin(apis.find(a=>a.name==='PlaySoundA').id,peerStack);
 [0,0,0,0].forEach((value,i)=>p.guest_write32(peerStack+i*4,value));
 p.sound_resume();assert.strictEqual(p.sound_eax(),1);
 assert.strictEqual(p.sound_pending(),0,'peer has no local continuation to cancel');
 assert.strictEqual(e.sound_pending(),peerCanceled);
 begin();await finish(16);
 assert.strictEqual(e.sound_eax(),0,'peer Stop invalidates original pending generation');
 assert.strictEqual(opens,peerOpens);assert.strictEqual(closes,peerCloses+1);
 assert.strictEqual(played.length,peerPlayed);
 console.log('PASS real two-instance shared-memory Stop generation cancels peer pending WAV without reopening or playback');
 console.log('PASS lazy sound: A/W/legacy staged reads, one handle, bounded cache progress, byte-exact one-shot playback, faults, invalid WAV and stop cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
