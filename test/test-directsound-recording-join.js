'use strict';
// A looping DirectSound ring that started before the recorder went live must
// still be recorded once it does. Only Play used to attach the tap, so Diablo
// II's menu theme -- begun by Storm's streaming thread during the intro, then
// kept going by Unlock refreshes -- recorded as silence, which read as "the
// menu plays no music" until the ring itself was dumped.
const assert = require('assert');
const {createHostImports} = require('../lib/host-imports');
const originalAudioContext = globalThis.AudioContext;
globalThis.AudioContext = undefined;
try {
  const memory = new ArrayBuffer(65536), bytes = new Uint8Array(memory);
  const ptr = 4096;
  bytes.set(Array.from({length: 100}, (_, i) => i), ptr);
  let now = 0, recording = false;
  const chunks = [], pumps = [];
  const ctx = {getMemory: () => memory, audioClockMs: () => now,
    audioTap: () => (recording ? {active: true, pcm: c => chunks.push(c)} : null),
    registerAudioTapPump: p => pumps.push(p)};
  const {host} = createHostImports(ctx);
  const id = host.voice_open(1000, 1, 8);    // 1000 bytes/s: 1 byte per ms

  // Started while nothing records.
  host.voice_play_ring(id, ptr, 100, 0, 1);
  now = 30;
  pumps.forEach(p => p());
  assert.strictEqual(chunks.length, 0, 'nothing is recorded before the recorder starts');

  // The recorder starts; the pump joins the live ring at its cursor (30).
  recording = true;
  pumps.forEach(p => p());
  now = 40;
  pumps.forEach(p => p());
  assert.deepStrictEqual(chunks.flatMap(c => [...c.bytes]), Array.from({length: 10}, (_, i) => 30 + i),
    'the pump records the ring from where it audibly is');
  assert.strictEqual(chunks[0].guestStartMs, 30, 'on the guest clock it actually played at');

  // The guest rewrites the ring (Unlock refresh): later output is the new content.
  bytes.set(Array.from({length: 100}, (_, i) => 200 - i), ptr);
  host.voice_play_ring(id, ptr, 100, 0, 2);
  now = 45;
  pumps.forEach(p => p());
  assert.deepStrictEqual([...chunks[chunks.length - 1].bytes], [160, 159, 158, 157, 156],
    'a refresh after joining swaps in the rewritten ring');

  // A second ring started unrecorded is joined by its first refresh, too.
  recording = false;
  const id2 = host.voice_open(1000, 1, 8);
  host.voice_play_ring(id2, ptr, 100, 0, 1);
  now = 60;
  recording = true;
  chunks.length = 0;
  host.voice_play_ring(id2, ptr, 100, 0, 2);
  now = 65;
  host.voice_stop(id2);
  assert(chunks.some(c => c.bytes.length === 5), 'a refresh joins an untapped live ring');
  console.log('PASS DirectSound rings started before the recorder are joined at their live cursor');
} finally { globalThis.AudioContext = originalAudioContext; }
