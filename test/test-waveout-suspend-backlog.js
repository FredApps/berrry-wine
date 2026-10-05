#!/usr/bin/env node
//
// A suspended AudioContext must not accumulate a scheduled backlog.
//
// `AudioContext.currentTime` FREEZES while the context is suspended. The
// waveOut stream scheduler picks each chunk's start as
// `Math.max(ac.currentTime, v.nextTime)` and then advances `v.nextTime` by the
// chunk's duration -- so with the clock stopped, every buffer the guest writes
// is scheduled further and further into a future the context never reaches,
// and none of them play. Resuming pays the whole queue out at once, oldest
// first: on a phone, tapping to bring sound back replayed the last several
// seconds of the game.
//
// Reported on a real iPhone, where the system suspends the context on its own
// (and where the idle watcher in host.js suspends it too). Real hardware does
// not hear audio it was not playing, so the fix has two halves and both are
// asserted here: don't schedule into a stopped clock, and drop whatever was
// already queued when it starts again.

'use strict';

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  console.log(`  ok   ${label}`);
  checks++;
};

class FakeParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
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
    this.stopped = false;
  }
  start(time, offset) {
    this.startedAt = time;
    this.owner.started.push({ time, offset, source: this });
  }
  stop() {
    this.stopped = true;
    if (this.onended) this.onended();
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.destination = new FakeNode();
    this.state = 'running';
    this.started = [];
    this.resumeCalls = 0;
  }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createStereoPanner() { const n = new FakeNode(); n.pan = new FakeParam(0); return n; }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  resume() {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

const oldAudioContext = globalThis.AudioContext;
globalThis.AudioContext = FakeAudioContext;

(async () => {
  console.log('waveOut stream across an AudioContext suspend');

  const memory = new ArrayBuffer(64 * 1024);
  const pcm = new Uint8Array(memory);
  const ptr = 0x1000;
  // 8-bit mono at 8000Hz: 800 bytes is exactly 100ms of audio per submit.
  const CHUNK = 800;
  pcm.fill(200, ptr, ptr + CHUNK);

  const ctx = { getMemory: () => memory };
  const { host } = createHostImports(ctx);
  const voice = host.voice_open(8000, 1, 8);

  const voices = ctx._voices;
  host.voice_write_stream(voice, ptr, CHUNK);
  const ac = voices._ac;
  ok(!!ac && ac.state === 'running', 'the first submit creates a running context');
  ok(ac.started.length === 1, 'and schedules that buffer');

  // Advance the clock the way a real running context does, then stop it.
  ac.currentTime += 0.1;
  ac.state = 'suspended';
  const startedWhileDown = ac.started.length;
  const frozenNow = ac.currentTime;

  // Two seconds of guest audio submitted into a stopped clock.
  for (let i = 0; i < 20; i++) host.voice_write_stream(voice, ptr, CHUNK);

  ok(ac.currentTime === frozenNow, 'a suspended context really does freeze currentTime');
  ok(ac.started.length === startedWhileDown,
    'twenty submits into a suspended context schedule NOTHING -- ' +
    'the backlog that used to replay on resume is never built');

  const v = voices._map[voice];
  ok(v.bytesWritten === 21 * CHUNK,
    "the guest's own byte clock still advances, so waveOutGetPosition stays honest");

  // Prove the old failure mode is what this prevents: had those chunks been
  // scheduled, each one would have been queued a further 100ms past a clock
  // that never moved -- two full seconds of audio waiting at a `when` in the
  // past by the time the context came back.
  ok(v.nextTime <= frozenNow + 1e-9,
    'and nextTime has not run away ahead of the frozen clock');

  // ---- resume ---------------------------------------------------------
  // Something did get scheduled before the suspend. Put the context back and
  // check that stale source is dropped rather than played.
  const preResume = ac.started[0].source;
  ok(!preResume.stopped, 'the pre-suspend source is still live going in');

  ac.currentTime += 5;            // five seconds of wall clock spent suspended
  await ac.resume();
  voices._resyncAfterResume();

  ok(preResume.stopped,
    'resuming stops the source that was scheduled before the suspend -- ' +
    'five seconds stale is not what the player should hear first');
  ok(v.streamChunks.length === 0, 'and the queued chunks are dropped, not replayed');
  ok(v.nextTime === ac.currentTime, 'the voice clock is rebased on the new now');
  ok(v.streamStartTime === null,
    'streamStartTime is cleared so the next submit re-derives it from its byte offset');

  // ---- and audio after the resume is live ------------------------------
  const afterResume = ac.started.length;
  host.voice_write_stream(voice, ptr, CHUNK);
  ok(ac.started.length === afterResume + 1, 'the next submit schedules normally again');
  ok(ac.started[afterResume].time >= ac.currentTime - 1e-9,
    'at the current time, not behind it -- the first thing heard is the newest audio');

  console.log(`\nPASS  ${checks}/${checks} checks passed`);
})().catch(error => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  globalThis.AudioContext = oldAudioContext;
});
