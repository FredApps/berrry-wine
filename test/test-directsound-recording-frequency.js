'use strict';
const assert = require('assert');
const {createHostImports} = require('../lib/host-imports');
const originalAudioContext = globalThis.AudioContext;
globalThis.AudioContext = undefined;
try {
  const memory = new ArrayBuffer(65536), bytes = new Uint8Array(memory);
  const ptr=4096;
  bytes.set(Array.from({length:100},(_,i)=>i),ptr);
  let now=0; const chunks=[], pumps=[];
  const ctx={getMemory:()=>memory,audioClockMs:()=>now,
    audioTap:()=>({active:true,pcm:c=>chunks.push(c)}),
    registerAudioTapPump:p=>pumps.push(p)};
  const {host}=createHostImports(ctx);
  const id=host.voice_open(1000,1,8);
  host.voice_play_ring(id,ptr,100,20,1);
  now=10;
  host.voice_set_freq(id,2000);
  assert.strictEqual(chunks.length,1,'changing rate flushes old-rate PCM first');
  assert.strictEqual(chunks[0].sampleRate,1000);
  assert.strictEqual(chunks[0].guestStartMs,0,'source offset is not a recording delay');
  assert.deepStrictEqual([...chunks[0].bytes],Array.from({length:10},(_,i)=>20+i));
  now=20; pumps.forEach(p=>p());
  assert.strictEqual(chunks[1].sampleRate,2000);
  assert.strictEqual(chunks[1].guestStartMs,10);
  assert.deepStrictEqual([...chunks[1].bytes],Array.from({length:20},(_,i)=>30+i));
  host.voice_set_freq(id,0);
  assert.strictEqual(chunks.length,2,'no elapsed time adds no chunk');
  now=30; host.voice_stop(id);
  assert.strictEqual(chunks[2].sampleRate,1000);
  assert.strictEqual(chunks[2].guestStartMs,20);
  assert.deepStrictEqual([...chunks[2].bytes],Array.from({length:10},(_,i)=>50+i));

  // Repeated sub-sample edits must not discard the fractional source position.
  chunks.length=0;
  now=100; host.voice_play_ring(id,ptr,100,0,1);
  for(let i=1;i<=10;i++) {
    now=100+i/10;
    host.voice_set_freq(id,i%2?2000:1000);
  }
  now=102; host.voice_stop(id);
  const recorded=chunks.flatMap(c=>[...c.bytes]);
  assert.deepStrictEqual(recorded,[0,1],'1.5 + 1 source samples, no repeated/lost complete frames');
  assert(chunks.every(c=>c.bytes.length>0));

  // One-shot clipping remains in source-byte space after the rate change.
  chunks.length=0; now=200;
  host.voice_play_ring(id,ptr,10,0,0);
  now=204; host.voice_set_freq(id,2000);
  now=220; host.voice_stop(id);
  assert.deepStrictEqual(chunks.flatMap(c=>[...c.bytes]),Array.from({length:10},(_,i)=>i));
  assert.deepStrictEqual(chunks.map(c=>[c.guestStartMs,c.sampleRate,c.bytes.length]),[[200,1000,4],[204,2000,6]]);
  chunks.length=0; now=300;
  const stereo=host.voice_open(1000,2,16);
  host.voice_play_ring(stereo,ptr,100,0,1);
  now=300.25; host.voice_set_freq(stereo,2000);
  assert.strictEqual(chunks.length,0,'no partial stereo frame is published');
  now=301.25; host.voice_stop(stereo);
  assert.deepStrictEqual(chunks.flatMap(c=>[...c.bytes]),Array.from({length:8},(_,i)=>i));
  assert(chunks.every(c=>c.bytes.length%4===0),'interleaved stereo frames stay intact');
  console.log('PASS frozen DirectSound rate boundaries, offsets, fractional progress, original rate and one-shot clipping');
} finally { globalThis.AudioContext=originalAudioContext; }
