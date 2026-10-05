#!/usr/bin/env node

'use strict';

// A LOOPING DirectSound buffer is a ring. Play() with a play cursor set part
// way into it starts there and wraps through the WHOLE buffer; it does not
// play "cursor..end" and then repeat that tail.
//
// SimGolf is what this cost. Miles resyncs its mixer several times a second
// with Stop / SetCurrentPosition / Play, and the host used to build the loop
// buffer out of `len - startOff` bytes only. GetCurrentPosition then reported
// a cursor modulo that shrinking tail, Miles set the next position from it,
// and the tail collapsed: 25 bytes, then 12, then 1 byte of 22kHz PCM looped
// forever — the "sound is glitching" report.
//
// A one-shot Play is the opposite case and must keep playing offset..end.

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');

class FakeParam {
  constructor(value = 0) { this.value = value; }
}

class FakeNode {
  connect(node) { return node; }
  disconnect() {}
}

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
  constructor(owner) {
    super();
    this.owner = owner;
    this.playbackRate = new FakeParam(1);
    this.loop = false;
    this.starts = [];
    this.stops = [];
  }
  start(time, offset) { this.starts.push({ time, offset }); this.owner.started.push(this); }
  stop(time) { this.stops.push(time); if (this.onended) this.onended(); }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 3;
    this.destination = new FakeNode();
    this.state = 'running';
    this.started = [];
  }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createStereoPanner() { const n = new FakeNode(); n.pan = new FakeParam(0); return n; }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  resume() {}
}

const RATE = 8000;   // 8-bit mono, so one byte is one sample and one frame
const LEN = 64;      // the whole ring
const START = 48;    // a play cursor three quarters of the way through it

const oldAudioContext = globalThis.AudioContext;

// ── 1. The browser path: the source covers the whole ring, started at the
//       guest's cursor.
globalThis.AudioContext = FakeAudioContext;
try {
  const memory = new ArrayBuffer(64 * 1024);
  const pcm = new Uint8Array(memory);
  const ptr = 0x1000;
  for (let i = 0; i < LEN; i++) pcm[ptr + i] = 1 + i;

  const ctx = { getMemory: () => memory };
  const { host } = createHostImports(ctx);
  const voice = host.voice_open(RATE, 1, 8);
  host.voice_play_ring(voice, ptr, LEN, START, 1);

  const ac = ctx._audioCtx;
  assert.strictEqual(ac.started.length, 1, 'the looping ring should start one source');
  const src = ac.started[0];
  assert.strictEqual(src.loop, true, 'a DSBPLAY_LOOPING ring must loop');
  assert.strictEqual(src.buffer.length, LEN,
    'the loop buffer must be the whole ring, not the tail after the cursor');
  assert(Math.abs(src.starts[0].offset - START / RATE) < 1e-9,
    'playback must begin at the guest play cursor');

  // The bytes before the cursor are the ones the loop wraps onto, so they have
  // to be in the buffer at all.
  const data = src.buffer.getChannelData(0);
  assert(Math.abs(data[0] - ((1 - 128) / 128)) < 1e-6,
    'byte 0 of the ring must survive into the loop buffer');
  assert(Math.abs(data[LEN - 1] - ((LEN - 128) / 128)) < 1e-6,
    'the last byte of the ring must survive into the loop buffer');
  console.log('PASS  a looping ring plays the whole buffer from the guest cursor');
} finally {
  globalThis.AudioContext = oldAudioContext;
}

// ── 2. The cursor the guest reads back wraps modulo the ring, starting at the
//       position it asked for. This is the feedback loop that collapsed.
try {
  globalThis.AudioContext = undefined;
  const memory = new ArrayBuffer(64 * 1024);
  const pcm = new Uint8Array(memory);
  const ptr = 0x1000;
  for (let i = 0; i < LEN; i++) pcm[ptr + i] = 1 + i;

  let guestMs = 0;
  const ctx = { getMemory: () => memory, audioClockMs: () => guestMs };
  const { host } = createHostImports(ctx);
  const voice = host.voice_open(RATE, 1, 8);
  host.voice_play_ring(voice, ptr, LEN, START, 1);

  assert.strictEqual(host.voice_get_pos(voice) >>> 0, START,
    'the cursor starts where the guest set it');
  guestMs = 1;                       // 8 bytes at 8000 bytes/s
  assert.strictEqual(host.voice_get_pos(voice) >>> 0, START + 8,
    'the cursor advances from the guest cursor, not from zero');
  guestMs = 4;                       // 32 bytes: past the end of the ring
  assert.strictEqual(host.voice_get_pos(voice) >>> 0, (START + 32) % LEN,
    'the cursor wraps modulo the whole ring, never modulo the tail');
  assert.strictEqual(host.voice_is_playing(voice), 1,
    'a looping ring never retires');
  console.log('PASS  the reported play cursor wraps modulo the whole ring');

  // A one-shot keeps the old meaning: play what is left after the cursor.
  const oneShot = host.voice_open(RATE, 1, 8);
  host.voice_play_ring(oneShot, ptr, LEN, START, 0);
  assert.strictEqual(host.voice_get_pos(oneShot) >>> 0, 0,
    'a one-shot cursor is relative to the segment it was given');
  guestMs += 1;                      // 8 bytes of the 16 remaining
  assert.strictEqual(host.voice_get_pos(oneShot) >>> 0, 8,
    'a one-shot cursor advances to the end of the segment');
  assert.strictEqual(host.voice_is_playing(oneShot), 1,
    'the one-shot is still inside its 16 bytes');
  guestMs += 2;                      // past the end
  assert.strictEqual(host.voice_is_playing(oneShot), 0,
    'a one-shot still stops at the end of the buffer');
  console.log('PASS  a one-shot still plays only the cursor-to-end segment');
} finally {
  globalThis.AudioContext = oldAudioContext;
}

console.log('PASS  DirectSound looping rings wrap instead of collapsing to their tail');
