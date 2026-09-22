#!/usr/bin/env node

'use strict';

// The DirectSound ring queue (lib/host-audio.js _ringDelayFor): in a page, a
// SMALL looping ring (under 100ms, fmod's 80ms ring in Moorhuhn 2) is played
// from a queue of the spans each Unlock wrote, 10ms behind their arrival and
// back to back, instead of from the ring itself. A large ring is left alone,
// and `?audio-delay=off` turns the queue off.

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');

class FakeParam { constructor(value = 0) { this.value = value; } }
class FakeNode { connect(node) { return node; } disconnect() { this.disconnected = true; } }
class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.data[channel]; }
}
class FakeSource extends FakeNode {
  constructor(owner) { super(); this.owner = owner; this.playbackRate = new FakeParam(1); this.loop = false; this.starts = []; }
  start(time, offset) { this.starts.push({ time, offset }); this.owner.started.push(this); }
  stop() { this.stopped = true; if (this.onended) this.onended(); }
}
class FakeAudioContext {
  constructor() { this.currentTime = 3; this.destination = new FakeNode(); this.state = 'running'; this.started = []; }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createStereoPanner() { const n = new FakeNode(); n.pan = new FakeParam(0); return n; }
  createAnalyser() { throw new Error('analyser not needed'); }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  resume() {}
}

const RATE = 22050;          // 8-bit mono: one byte per frame
const SMALL = 64 * 20;       // 1280 bytes = 58ms, a queued ring
const LARGE = RATE * 3 / 2;  // 1.5s, played from the ring as before

const oldAudioContext = globalThis.AudioContext;
const oldLocation = globalThis.location;
globalThis.AudioContext = FakeAudioContext;

const boot = (search) => {
  globalThis.location = { search };
  const memory = new ArrayBuffer(256 * 1024);
  const ctx = { getMemory: () => memory };
  const { host } = createHostImports(ctx);
  return { ctx, host, pcm: new Uint8Array(memory) };
};

try {
  // --- small ring, default: queued ---
  {
    const { ctx, host, pcm } = boot('');
    const ptr = 0x1000;
    pcm.fill(128, ptr, ptr + SMALL);
    const voice = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(voice, ptr, SMALL, 0, 1);
    const ac = ctx._voices._ac;
    const ring = ac.started[0];
    assert(ring && ring.loop, 'Play starts the looping ring source');

    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    const v = ctx._voices._map[voice];
    assert(v.delayQ, 'a ring under 100ms is queued by default');
    assert.strictEqual(v.delayQ.delaySec, 0.010, 'with 10ms of slack');
    assert(ring.disconnected, 'the ring source keeps running as the clock, silently');
    assert.strictEqual(ac.started.length, 1, 'the first Unlock only snapshots the ring');

    // fmod writes one 320-byte block, then the next.
    pcm.fill(200, ptr, ptr + 320);
    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    assert.strictEqual(ac.started.length, 2, 'a written span becomes one queued source');
    const a = ac.started[1];
    assert.strictEqual(a.buffer.length, 320, 'exactly the span that changed');
    assert(Math.abs(a.starts[0].time - (ac.currentTime + 0.010)) < 1e-9, 'played 10ms behind its arrival');

    pcm.fill(50, ptr + 320, ptr + 640);
    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    const b = ac.started[2];
    assert.strictEqual(b.buffer.length, 320);
    assert(Math.abs(b.starts[0].time - (a.starts[0].time + 320 / RATE)) < 1e-9,
      'the next span plays back to back with the last');
    assert.strictEqual(v.delayQ.stats.underruns, 0);

    // The cursor runs on the AudioContext clock, and never backwards.
    ac.currentTime += 0.01;
    const pos = host.voice_get_pos(voice) >>> 0;
    assert.strictEqual(pos, Math.floor((ac.currentTime - v.playStart) * RATE) % SMALL,
      'cursor from the AudioContext clock');
    ctx.deadlineLagMs = () => 5;
    assert.strictEqual(host.voice_get_pos(voice) >>> 0, pos,
      'a lagging deadline clock cannot move a cursor a reader already saw backwards');
    ac.currentTime += 0.02;
    const later = host.voice_get_pos(voice) >>> 0;
    assert.strictEqual(later, Math.floor((ac.currentTime - 0.005 - v.playStart) * RATE) % SMALL,
      'the deadline clock lag is taken off the audible cursor');
  }

  // --- large ring: the ring plays itself ---
  {
    const { ctx, host, pcm } = boot('');
    const ptr = 0x1000;
    pcm.fill(128, ptr, ptr + LARGE);
    const voice = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(voice, ptr, LARGE, 0, 1);
    pcm.fill(200, ptr, ptr + 320);
    host.voice_play_ring(voice, ptr, LARGE, 0, 2);
    assert(!ctx._voices._map[voice].delayQ, 'a 1.5s ring is not queued');
    assert.strictEqual(ctx._voices._ac.started.length, 2, 'Unlock refreshes the ring source in place');
  }

  // --- ?audio-delay=off, and a forced setting ---
  {
    const { ctx, host, pcm } = boot('?audio-delay=off');
    const ptr = 0x1000;
    pcm.fill(128, ptr, ptr + SMALL);
    const voice = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(voice, ptr, SMALL, 0, 1);
    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    assert(!ctx._voices._map[voice].delayQ, '?audio-delay=off plays even a small ring as is');
  }
  {
    const { ctx, host, pcm } = boot('?audio-delay=40');
    const ptr = 0x1000;
    pcm.fill(128, ptr, ptr + LARGE);
    const voice = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(voice, ptr, LARGE, 0, 1);
    host.voice_play_ring(voice, ptr, LARGE, 0, 2);
    const q = ctx._voices._map[voice].delayQ;
    assert(q && q.delaySec === 0.04, '?audio-delay=MS queues every looping ring with MS of slack');
  }

  // --- a suspended context queues nothing; a backlog is trimmed ---
  {
    const { ctx, host, pcm } = boot('');
    const ptr = 0x1000;
    pcm.fill(128, ptr, ptr + SMALL);
    const voice = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(voice, ptr, SMALL, 0, 1);
    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    const ac = ctx._voices._ac;
    const v = ctx._voices._map[voice];
    const before = ac.started.length;

    // Autoplay policy: suspended until the first click, clock standing still,
    // while the guest keeps mixing. None of it may wait in the queue.
    ac.state = 'suspended';
    for (let i = 0; i < 20; i++) {
      pcm.fill(i + 1, ptr + (i % 4) * 320, ptr + (i % 4) * 320 + 320);
      host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    }
    assert.strictEqual(ac.started.length, before, 'nothing queued while the context is suspended');
    ac.state = 'running';
    pcm.fill(99, ptr, ptr + 320);
    host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    const first = ac.started[ac.started.length - 1];
    assert(Math.abs(first.starts[0].time - (ac.currentTime + 0.010)) < 1e-9,
      'the first write after resume plays at the slack, not behind a backlog');

    // A mixer running ahead of the clock (the clock does not move here):
    // the lead is held to slack + 150ms by stopping spans not yet started.
    for (let i = 0; i < 40; i++) {
      const at = ((i + 1) % 4) * 320;
      pcm.fill(150 + (i % 50), ptr + at, ptr + at + 320);
      host.voice_play_ring(voice, ptr, SMALL, 0, 2);
    }
    const q = v.delayQ;
    assert(q.stats.trims > 0, 'a backlog is trimmed');
    assert(q.next - ac.currentTime <= 0.010 + 0.150 + 320 / RATE + 1e-9,
      `lead stays bounded (${((q.next - ac.currentTime) * 1000).toFixed(1)}ms)`);
    assert(ac.started.some(src => src.stopped), 'trimmed spans are stopped');
  }

  console.log('PASS  small DirectSound rings play from a 10ms Unlock queue; large rings and ?audio-delay=off do not; suspended contexts queue nothing; lead capped');
} finally {
  globalThis.AudioContext = oldAudioContext;
  if (oldLocation === undefined) delete globalThis.location;
  else globalThis.location = oldLocation;
}
