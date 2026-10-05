#!/usr/bin/env node
//
// The worklet DSP, tested without a browser.
//
// `lib/audio-voice-worklet.js` is written to be loadable both by
// audioWorklet.addModule() and by require(), which is what makes this a test of
// the shipped code rather than of a copy of it. Everything here calls the real
// renderVoice()/readDesc()/WineVoiceProcessor.
//
// What is actually being asserted is the property the AudioBufferSourceNode
// path could not have: a rewrite of the ring under the play cursor is picked up
// with NO splice, so there is no seam to get wrong. The bug fixed in c9cc772d
// was a mis-sampled splice offset; here there is no offset to sample.

'use strict';

const assert = require('assert');
const path = require('path');
const {
  DESC, FLAGS, readDesc, renderVoice, sampleAt, WineVoiceProcessor,
} = require('../lib/audio-voice-worklet');

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  console.log(`  ok   ${label}`);
  checks++;
};

// ---- a control block + a wasm-memory stand-in ------------------------------
const SLOTS = 4;
const control = new SharedArrayBuffer(SLOTS * DESC.STRIDE * 4);
const i32 = new Int32Array(control);
const f32 = new Float32Array(control);
const memory = new ArrayBuffer(64 * 1024);
const u8 = new Uint8Array(memory);

const PTR = 0x1000;
const RATE = 22050;

function writeDesc(slot, fields) {
  const base = slot * DESC.STRIDE;
  Atomics.add(i32, base + DESC.SEQ, 1);          // odd: write in progress
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'freqRatio') f32[base + DESC.FREQ_RATIO] = v;
    else i32[base + DESC[k]] = v;
  }
  Atomics.add(i32, base + DESC.SEQ, 1);          // even again: readable
}

function descOf(slot) {
  const out = {};
  assert.ok(readDesc(i32, f32, slot * DESC.STRIDE, out), 'descriptor read');
  return out;
}

console.log('AudioWorklet voice DSP');

// ---- sample decoding --------------------------------------------------------
u8[PTR] = 0;            // 8-bit unsigned silence-floor
u8[PTR + 1] = 128;      // 8-bit unsigned zero
u8[PTR + 2] = 255;
ok(Math.abs(sampleAt(u8, PTR, 1, 0, 1, 8) - 0) < 1e-9,
  '8-bit PCM is decoded as UNSIGNED (0x80 is silence, not full scale)');
ok(sampleAt(u8, PTR, 0, 0, 1, 8) === -1, '8-bit 0x00 is negative full scale');

// 16-bit little-endian, signed
u8[PTR + 16] = 0x00; u8[PTR + 17] = 0x80;     // -32768
u8[PTR + 18] = 0xFF; u8[PTR + 19] = 0x7F;     // +32767
ok(sampleAt(u8, PTR + 16, 0, 0, 1, 16) === -1, '16-bit 0x8000 decodes to -1');
ok(Math.abs(sampleAt(u8, PTR + 16, 1, 0, 1, 16) - 0.999969) < 1e-5,
  '16-bit 0x7FFF decodes to just under +1');

// ---- a looping ring, rendered across quanta ---------------------------------
// A 16-frame ring at exactly the context rate, so one output frame is one ring
// frame and every index is checkable by hand.
const RING_FRAMES = 16;
for (let i = 0; i < RING_FRAMES; i++) u8[PTR + i] = 128 + i;   // 0, 1/128, 2/128 ...

writeDesc(0, {
  FLAGS: FLAGS.ACTIVE | FLAGS.PLAYING | FLAGS.LOOPING,
  PTR, LEN: RING_FRAMES, RATE, CHANNELS: 1, BITS: 8,
  freqRatio: 1, START_BYTE: 0, EPOCH: 1,
});

const d = descOf(0);
const outL = new Float32Array(8);
const state = { cursor: 0, ended: false };

state.cursor = renderVoice(state, u8, d, outL, null, 8, RATE);
ok(Math.abs(outL[0] - 0) < 1e-6 && Math.abs(outL[7] - 7 / 128) < 1e-6,
  'the first quantum renders ring frames 0..7 in order');
ok(state.cursor === 8, 'the cursor advances exactly one frame per output frame at 1:1');

state.cursor = renderVoice(state, u8, d, outL, null, 8, RATE);
ok(Math.abs(outL[0] - 8 / 128) < 1e-6 && Math.abs(outL[7] - 15 / 128) < 1e-6,
  'the second quantum continues at frame 8 with NO gap and NO repeat');
ok(state.cursor === 16, 'the cursor reaches the end of the ring');

state.cursor = renderVoice(state, u8, d, outL, null, 8, RATE);
ok(Math.abs(outL[0] - 0) < 1e-6,
  'a looping ring wraps to frame 0 without a splice');

// ---- THE POINT: rewriting the ring mid-playback is picked up immediately ----
// This is what AudioBufferSourceNode structurally cannot do. A node acquires
// its buffer at start(); mutating the source bytes afterwards changes nothing,
// which is why the old path had to splice two nodes at a shared `when` and why
// mis-sampling that `when` replayed 5ms on every refresh.
state.cursor = 0;
for (let i = 0; i < RING_FRAMES; i++) u8[PTR + i] = 128 - i;   // the guest rewrites it
state.cursor = renderVoice(state, u8, d, outL, null, 8, RATE);
ok(Math.abs(outL[3] - (-3 / 128)) < 1e-6,
  'a guest rewrite of the ring is audible on the very next quantum (no splice, no seam)');

// ---- resampling -------------------------------------------------------------
for (let i = 0; i < RING_FRAMES; i++) u8[PTR + i] = 128 + i;
const half = { cursor: 0, ended: false };
// Ring rate == context rate, but SetFrequency doubled it: two ring frames per
// output frame.
const fastDesc = Object.assign({}, d, { freqRatio: 2 });
half.cursor = renderVoice(half, u8, fastDesc, outL, null, 8, RATE);
ok(Math.abs(half.cursor - 16) < 1e-9,
  'SetFrequency x2 consumes two ring frames per output frame');
ok(Math.abs(outL[1] - 2 / 128) < 1e-6, 'and the samples are the doubled-stride ones');

// A context running faster than the PCM interpolates rather than stepping.
const slow = { cursor: 0, ended: false };
slow.cursor = renderVoice(slow, u8, d, outL, null, 8, RATE * 2);
ok(Math.abs(slow.cursor - 4) < 1e-9, 'a 2x context rate consumes half a ring frame per output frame');
ok(Math.abs(outL[1] - 0.5 / 128) < 1e-6, 'intermediate positions are linearly interpolated');

// ---- a one-shot ends, and says so -------------------------------------------
writeDesc(1, {
  FLAGS: FLAGS.ACTIVE | FLAGS.PLAYING,          // no LOOPING
  PTR, LEN: RING_FRAMES, RATE, CHANNELS: 1, BITS: 8,
  freqRatio: 1, START_BYTE: 0, EPOCH: 1,
});
const oneShot = descOf(1);
const shotState = { cursor: 12, ended: false };
const shotOut = new Float32Array(8);
renderVoice(shotState, u8, oneShot, shotOut, null, 8, RATE);
ok(shotState.ended === true, 'a one-shot that runs off the end reports ended');
ok(shotOut[3] !== 0 && shotOut[4] === 0 && shotOut[7] === 0,
  'the tail of the final quantum is silence, not wrapped audio');

// ---- stereo -----------------------------------------------------------------
const SPTR = 0x3000;
for (let i = 0; i < 8; i++) { u8[SPTR + i * 2] = 128 + i; u8[SPTR + i * 2 + 1] = 128 - i; }
writeDesc(2, {
  FLAGS: FLAGS.ACTIVE | FLAGS.PLAYING | FLAGS.LOOPING,
  PTR: SPTR, LEN: 16, RATE, CHANNELS: 2, BITS: 8,
  freqRatio: 1, START_BYTE: 0, EPOCH: 1,
});
const st = descOf(2);
const sL = new Float32Array(4); const sR = new Float32Array(4);
renderVoice({ cursor: 0, ended: false }, u8, st, sL, sR, 4, RATE);
ok(Math.abs(sL[2] - 2 / 128) < 1e-6 && Math.abs(sR[2] - (-2 / 128)) < 1e-6,
  'interleaved stereo is de-interleaved to the two output channels');

// Mono source into a stereo output duplicates rather than leaving R silent.
const mL = new Float32Array(4); const mR = new Float32Array(4);
renderVoice({ cursor: 0, ended: false }, u8, d, mL, mR, 4, RATE);
ok(mR[2] === mL[2] && mR[2] !== 0, 'a mono source feeds both output channels');

// ---- the seqlock ------------------------------------------------------------
// A descriptor caught mid-write must NOT be handed back as valid, because a
// half-written PTR/LEN pair points the audio thread at arbitrary memory.
const base3 = 3 * DESC.STRIDE;
i32[base3 + DESC.SEQ] = 1;                      // odd == writer inside
const torn = { valid: false };
ok(readDesc(i32, f32, base3, torn) === false,
  'a descriptor with a write in progress is refused, not read half-updated');
ok(torn.valid !== true, 'and the caller is not told it has a valid copy');

i32[base3 + DESC.SEQ] = 2;
ok(readDesc(i32, f32, base3, torn) === true, 'once the writer leaves, the read succeeds');

// ---- the processor, end to end ----------------------------------------------
// No AudioWorkletProcessor base class exists in Node, which the module handles;
// this exercises the real process() including the epoch re-seek and the cursor
// publish that GetCurrentPosition will read.
const proc = new WineVoiceProcessor({
  processorOptions: { control, memory, slot: 0, contextRate: RATE },
});
const pL = new Float32Array(8);
ok(proc.process([], [[pL]]) === true, 'a playing looping voice keeps its node alive');
ok(Math.abs(pL[0] - 0) < 1e-6 && Math.abs(pL[7] - 7 / 128) < 1e-6,
  'process() renders from the descriptor it was pointed at');
ok(i32[DESC.CURSOR] === 8,
  'the worklet publishes a REAL play cursor (8 bytes in) for GetCurrentPosition');
ok(i32[DESC.ACK_EPOCH] === 1, 'and acknowledges the epoch it seeked to');

// A bumped epoch re-seeks, which is what Play(from N) and SetCurrentPosition do.
writeDesc(0, { START_BYTE: 4, EPOCH: 2 });
proc.process([], [[pL]]);
ok(Math.abs(pL[0] - 4 / 128) < 1e-6, 'bumping the epoch re-seeks to START_BYTE');
ok(i32[DESC.ACK_EPOCH] === 2, 'and the new epoch is acknowledged');

// A stopped voice renders silence but stays alive -- Stop/Play must not need a
// new node, or Stop-then-Play would reintroduce exactly the splice this design
// removes.
writeDesc(0, { FLAGS: FLAGS.ACTIVE | FLAGS.LOOPING });   // PLAYING cleared
pL.fill(7);
ok(proc.process([], [[pL]]) === true, 'a stopped voice keeps its node (Play must not re-splice)');
ok(pL[0] === 7, 'and it writes nothing at all -- the host hands over zeroed buffers');

// A finished one-shot releases its node for good. This is the CPU-safety rule:
// node lifetime tracks playback, not the voice record, so an app that beeps
// once pays for one buffer's worth of process() calls and nothing after.
const shotProc = new WineVoiceProcessor({
  processorOptions: { control, memory, slot: 1, contextRate: RATE },
});
let alive = true;
for (let i = 0; i < 4 && alive; i++) alive = shotProc.process([], [[new Float32Array(8)]]);
ok(alive === false,
  'a finished one-shot returns false, so process() is never called for it again');

console.log(`\nPASS  ${checks}/${checks} checks passed`);
