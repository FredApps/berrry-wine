'use strict';
const assert=require('assert');
const {createHostImports}=require('../lib/host-imports');
(async()=>{
 const memory=new ArrayBuffer(512*1024),dv=new DataView(memory);let clock=0,status='busy';const calls=[],messages=[],events=[];
 const owner={kind:'cooperative',exports:{}};
 const ctx={getMemory:()=>memory,audioClockMs:()=>clock,waveCallbackOwner:owner,
  exports:{post_message_q:(...args)=>{messages.push(args);return 1;}},
  offerWaveCallback:async item=>{calls.push({submission:item.submission,handle:item.handle,hdr:item.waveHdrGA});return {status};}};
 const {host}=createHostImports(ctx);host.set_event=h=>{events.push(h);return 1;};
 const open=(type,callback=0x401000)=>host.wave_out_open(22050,1,16,type,callback,123);
 const schedule=(h,wa,ga,bytes=0)=>{dv.setUint32(wa+16,0x12,true);if(bytes)host.wave_out_write(h,0x30000,bytes);host.wave_out_schedule_done(h,wa,ga,bytes);};
 const h=open(3);schedule(h,0x21000,0x501000,44100);schedule(h,0x22000,0x502000,44100);
 assert.equal(ctx.waveFunctionDoneQueue.length,0);host.wave_out_reset(h);
 assert.equal(ctx.waveFunctionDoneQueue.length,2,'reset returns both headers as real notifications');
 assert.equal(dv.getUint32(0x21010,true),3);assert.equal(dv.getUint32(0x22010,true),3);
 await ctx.pumpWaveCallbacks();assert.equal(ctx.waveFunctionDoneQueue.length,2,'busy callback retained');
 assert.equal(calls.length,1,'busy head preserves order');
 status='accepted';await ctx.pumpWaveCallbacks();assert.equal(ctx.waveFunctionDoneQueue.length,0);
 const before=calls.length;clock=5000;ctx.pumpAudioCompletions();await ctx.pumpWaveCallbacks();assert.equal(calls.length,before,'old due entries cannot duplicate reset callbacks');
 schedule(h,0x21000,0x501000);const first=ctx.waveFunctionDoneQueue[0].submission;
 schedule(h,0x21000,0x501000);assert.equal(ctx.waveFunctionDoneQueue.length,2);assert.notEqual(ctx.waveFunctionDoneQueue[1].submission,first,'header reuse has distinct submission identity');
 await ctx.pumpWaveCallbacks();assert.equal(ctx.waveFunctionDoneQueue.length,0);
 schedule(h,0x21000,0x501000);host.wave_out_close(h);await ctx.pumpWaveCallbacks();assert.equal(ctx.waveFunctionDoneQueue.length,0,'close retires undispatched notifications');
 const windowHandle=open(1,0x10002);schedule(windowHandle,0x23000,0x503000);assert.deepEqual(messages.at(-1),[0x10002,0x3bd,windowHandle,0x503000]);
 const eventHandle=open(5,0xe0001);schedule(eventHandle,0x24000,0x504000);assert.equal(events.at(-1),0xe0001,'event callback preserved');
 const noCallback=open(0,0);schedule(noCallback,0x25000,0x505000);assert.equal(ctx.waveFunctionDoneQueue.length,0);
 const other=open(3),pending=open(3);let admit,entered;const entry=new Promise(r=>entered=r);let admitted=0;
 ctx.offerWaveCallback=async()=>{admitted++;entered();await new Promise(r=>admit=r);return {status:'accepted'};};
 schedule(pending,0x27000,0x507000);const pump=ctx.pumpWaveCallbacks();await entry;
 host.wave_out_close(other);admit();await pump;
 assert.equal(ctx.waveFunctionDoneQueue.length,0,'other-stream close must not clone and retain accepted completion');
 ctx.offerWaveCallback=async()=>{admitted++;return {status:'accepted'};};await ctx.pumpWaveCallbacks();assert.equal(admitted,1,'accepted completion offered exactly once across concurrent close');
 const final=open(3);schedule(final,0x26000,0x506000);ctx.retireWaveCallbacks();assert.equal(ctx.waveFunctionDoneQueue.length,0);assert.equal(ctx.waveRegistrations.size,0);
 console.log('PASS actual host queue reset/reuse/busy/order/close/process retirement and WINDOW/EVENT/NULL semantics');
})().catch(e=>{console.error(e);process.exitCode=1;});
