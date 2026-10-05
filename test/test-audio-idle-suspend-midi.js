#!/usr/bin/env node
//
// The AudioContext is suspended after AUDIO_IDLE_SUSPEND_MS of "silence", and
// what counted as silence was decided by _isAudioHot() -- which has terms for
// waveOut, CD audio and looping DirectSound voices and had NONE for MIDI or
// MCI. So a MIDI song longer than ten seconds had its AudioContext suspended
// out from under it mid-playback, and a sequencer that schedules its notes
// ahead (TinySynth 0.85s, the oscillator fallback schedules the WHOLE song up
// front) has no way to notice or recover.
//
// The fix is a SPLIT, not a new term in _isAudioHot(), and that distinction is
// the point of this file. _isAudioHot() does double duty: it also selects a
// short interpreter quantum for the emulator (the audioHot branch in the run
// loop), which exists so a guest streaming PCM refills its buffers promptly.
// MIDI refills nothing. Folding MIDI into _isAudioHot() would have throttled
// every MIDI app's emulator quantum for no benefit at all, so liveness moved
// to _audioNeedsContext() and _isAudioHot() was left exactly as it was.
//
// Both halves are asserted below: MIDI/MCI must keep the context, and MIDI/MCI
// must NOT make _isAudioHot() true.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  console.log(`  ok   ${label}`);
  checks++;
};

// ---- minimal Web Audio stubs ----------------------------------------------
class FakeParam { constructor(v = 0) { this.value = v; } setValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeNode { connect(n) { return n; } disconnect() {} }
class FakeOscillator extends FakeNode {
  constructor(owner) { super(); this.owner = owner; this.frequency = new FakeParam(440); }
  start() { this.owner.started.push(this); } stop() {}
}
class FakeBufferSource extends FakeNode {
  constructor(owner) { super(); this.owner = owner; this.playbackRate = new FakeParam(1); }
  start() { this.owner.started.push(this); } stop() {}
}
class FakeBuffer {
  constructor(ch, len, rate) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = rate;
    this.duration = rate ? len / rate : 0;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  getChannelData(c) { return this.data[c]; }
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 10; this.destination = new FakeNode();
    this.state = 'running'; this.started = []; this.sampleRate = 44100;
  }
  createGain() { const g = new FakeNode(); g.gain = new FakeParam(1); return g; }
  createOscillator() { return new FakeOscillator(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createBuffer(c, l, r) { return new FakeBuffer(c, l, r); }
  createStereoPanner() { const n = new FakeNode(); n.pan = new FakeParam(0); return n; }
  createDynamicsCompressor() { return new FakeNode(); }
  createConvolver() { return new FakeNode(); }
  createPeriodicWave(real, imag) { return { real, imag }; }
  resume() { this.state = 'running'; }
  suspend() { this.state = 'suspended'; }
  close() { this.state = 'closed'; }
}

// Format 0, one track, 96 ticks/quarter: note-on middle C, note-off, end.
const oneNoteMidi = Uint8Array.from([
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0d,
  0x00, 0x90, 0x3c, 0x64,
  0x60, 0x80, 0x3c, 0x00,
  0x00, 0xff, 0x2f, 0x00,
]);

// ---- the two predicates, lifted from host.js ------------------------------
// host.js is a browser file; pulling the two methods out keeps this a test of
// the real source rather than of a transcription of it.
function loadPredicates() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
  const grab = (name) => {
    const m = source.match(new RegExp(`\\n  ${name}\\(\\)\\s*\\{[\\s\\S]*?\\n  \\}`));
    assert(m, `${name}() not found in host.js -- was it renamed?`);
    return m[0].trim();
  };
  const holder = new Function(`return { ${grab('_isAudioHot')}, ${grab('_audioNeedsContext')} };`)();
  return holder;
}

const P = loadPredicates();

// A stand-in for the WineAssembly instance the two methods run against.
function hostStub(shared, nowMs) {
  return {
    _sharedAudio: shared,
    hostCtx: { sharedAudio: shared },
    _audioSchedulerNow: () => nowMs,
    _isAudioHot: P._isAudioHot,
    _audioNeedsContext: P._audioNeedsContext,
  };
}

const oldAudioContext = globalThis.AudioContext;
const oldWindow = globalThis.window;
const oldSetInterval = globalThis.setInterval;
const windowListeners = {};
globalThis.AudioContext = FakeAudioContext;
globalThis.window = {
  addEventListener(type, fn) {
    (windowListeners[type] = windowListeners[type] || []).push(fn);
  },
};
// The sequencer arms a 100ms pump; this test never advances time, so keep the
// process from being held open by it.
globalThis.setInterval = () => 0;

try {
  console.log('audio idle-suspend must not cut off MIDI');

  const mem = new WebAssembly.Memory({ initial: 2 });
  const u8 = new Uint8Array(mem.buffer);
  const writeStr = (ptr, s) => {
    for (let i = 0; i < s.length; i++) u8[ptr + i] = s.charCodeAt(i);
    u8[ptr + s.length] = 0;
  };
  writeStr(0x100, 'sequencer');
  writeStr(0x120, 'song.mid');

  const shared = {};
  const ctx = {
    getMemory: () => mem.buffer,
    sharedAudio: shared,
    readFile: (p) => (p.toLowerCase() === 'song.mid' ? oneNoteMidi : null),
  };
  const { host } = createHostImports(ctx);
  if (windowListeners.pointerdown) windowListeners.pointerdown[0]();

  const NOW = 50_000;

  // ---- baseline: nothing playing -----------------------------------------
  ok(P._audioNeedsContext.call(hostStub(shared, NOW)) === false,
    'an idle host needs no AudioContext (the suspend path still works)');

  // ---- MCI sequencer playing ---------------------------------------------
  const id = host.mci_open(0x100, 0x120, 0x2000);
  const dev = ctx._mci.devices.get(id);
  ok(!!dev && dev.type === 'sequencer', 'MCI opened the .mid as a sequencer device');

  host.mci_command(id, 0x0806 /* MCI_PLAY */, 0, 0);
  ok(dev.state === 'playing', 'the sequencer device reports itself playing');

  ok(shared.mci && shared.mci.devices && shared.mci.devices.size > 0,
    'MCI device table lives on sharedAudio, where the host predicate can see it');

  ok(P._audioNeedsContext.call(hostStub(shared, NOW)) === true,
    'a PLAYING MIDI sequencer keeps the AudioContext alive');

  // THE REGRESSION GUARD. MIDI must not select the short interpreter quantum.
  ok(P._isAudioHot.call(hostStub(shared, NOW)) === false,
    'a playing MIDI sequencer does NOT make _isAudioHot() true ' +
    '(that would throttle the emulator quantum for no benefit)');

  // ---- stopped again ------------------------------------------------------
  host.mci_command(id, 0x0808 /* MCI_STOP */, 0, 0);
  ok(dev.state !== 'playing', 'MCI stop leaves the device not playing');
  ok(P._audioNeedsContext.call(hostStub(shared, NOW)) === false,
    'once playback stops the context may idle-suspend again');

  // ---- real-time midiOut note stream --------------------------------------
  // midi_out_open RETURNS the handle; deviceId 0 is MIDI_MAPPER.
  const outHandle = host.midi_out_open(0, 0, 0, 0);
  ok(outHandle !== 0, 'midiOutOpen returns a device handle');

  // 0x90 = note-on ch0, note 60, velocity 100
  host.midi_out_short_msg(outHandle, 0x90 | (60 << 8) | (100 << 16));
  ok((shared.midiHotUntilMs || 0) > 0,
    'a midiOut note-on marks MIDI hot on the shared audio state');

  const atNoteOn = hostStub(shared, shared.midiHotUntilMs - 1);
  ok(P._audioNeedsContext.call(atNoteOn) === true,
    'a real-time midiOut note stream keeps the AudioContext alive');
  ok(P._isAudioHot.call(atNoteOn) === false,
    'a midiOut note stream does NOT make _isAudioHot() true either');

  const afterWindow = hostStub(shared, shared.midiHotUntilMs + 1);
  ok(P._audioNeedsContext.call(afterWindow) === false,
    'the MIDI hot window expires, so a silent open device cannot pin the context forever');

  // ---- waveOut still behaves exactly as before ----------------------------
  shared.waveOutHotUntilMs = NOW + 5000;
  const hot = hostStub(shared, NOW);
  ok(P._isAudioHot.call(hot) === true, 'waveOut still drives _isAudioHot()');
  ok(P._audioNeedsContext.call(hot) === true, 'and _audioNeedsContext() is a superset of it');

  console.log(`\nPASS  ${checks}/${checks} checks passed`);
} finally {
  globalThis.AudioContext = oldAudioContext;
  globalThis.window = oldWindow;
  globalThis.setInterval = oldSetInterval;
}
