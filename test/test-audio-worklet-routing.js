#!/usr/bin/env node
//
// WHAT MAY AND MAY NOT REACH THE AUDIOWORKLET.
//
// An AudioWorklet calls process() every 128 frames for as long as its node is
// connected -- 344 times a second at 44.1kHz, forever. That is the right price
// for a game whose DirectSound mixer rewrites a ring five times a second, and
// completely the wrong price for Minesweeper, which beeps twice an hour.
//
// So this file is the enforcement of the CPU-safety rules in
// lib/audio-worklet-host.js, written before any of it ran on a phone:
//
//   Rule 1  a one-shot Play() instantiates NO AudioWorkletNode.  <-- the point
//   Rule 2  the worklet module is not fetched until something qualifies
//   Rule 3  a node dies with the playback, not with the voice record
//   Rule 4  no shared memory => no routing (a private copy would be worse than
//           the splice it replaces, because a guest rewrite would be silent)
//
// These rules carry more weight than they did when this path was opt-in: the
// worklet is now the DEFAULT, so Rule 1 is the only thing standing between
// Minesweeper and a process() callback it will never stop paying for. It is
// asserted below against a ctx with no flag set at all -- the shipping config.

'use strict';

const assert = require('assert');
const { createWorkletRouter } = require('../lib/audio-worklet-host');
const { createHostImports } = require('../lib/host-imports');

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  console.log(`  ok   ${label}`);
  checks++;
};

// ---- stubs that COUNT what gets constructed --------------------------------
const counters = { workletNodes: 0, bufferSources: 0, addModule: 0 };

class FakeParam { constructor(v = 0) { this.value = v; } }
class FakeNode {
  connect(n) { return n; }
  disconnect() {}
}
class FakeBuffer {
  constructor(ch, len, rate) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = rate;
    this.duration = len / rate;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  getChannelData(c) { return this.data[c]; }
}
class FakeSource extends FakeNode {
  constructor() { super(); counters.bufferSources++; this.playbackRate = new FakeParam(1); this.loop = false; }
  start() {} stop() {}
}
class FakeWorkletNode extends FakeNode {
  constructor(ac, name, opts) {
    super();
    counters.workletNodes++;
    this.processorName = name;
    this.options = opts;
  }
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 5;
    this.destination = new FakeNode();
    this.state = 'running';
    this.sampleRate = 44100;
    let resolveModule;
    this._moduleGate = new Promise((r) => { resolveModule = r; });
    this._resolveModule = resolveModule;
    this.audioWorklet = {
      addModule: (url) => { counters.addModule++; this.moduleUrl = url; return this._moduleGate; },
    };
  }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createStereoPanner() { const n = new FakeNode(); n.pan = new FakeParam(0); return n; }
  createBufferSource() { return new FakeSource(); }
  createBuffer(c, l, r) { return new FakeBuffer(c, l, r); }
  resume() {}
}

const saved = {
  AudioContext: globalThis.AudioContext,
  AudioWorkletNode: globalThis.AudioWorkletNode,
};
globalThis.AudioContext = FakeAudioContext;
globalThis.AudioWorkletNode = FakeWorkletNode;

const RATE = 22050;
const RING = 4096;
const PTR = 0x2000;

// The guest arena has to be SHARED for routing to be legal at all (Rule 4).
function makeCtx(opts = {}) {
  const Buf = opts.shared === false ? ArrayBuffer : SharedArrayBuffer;
  const memory = new Buf(64 * 1024);
  const pcm = new Uint8Array(memory);
  for (let i = 0; i < RING; i++) pcm[PTR + i] = (i * 31) & 0xFF;
  const sharedAudio = {};
  const ctx = { getMemory: () => memory, sharedAudio };
  if (opts.audioWorklet !== undefined) ctx.audioWorklet = opts.audioWorklet;
  const { host } = createHostImports(ctx);
  return { ctx, host, sharedAudio, memory };
}

async function settleModule(ctx) {
  const ac = ctx._voices._ac;
  if (ac) { ac._resolveModule(); await ac._moduleGate; }
  // the .then() that flips moduleState to 'ready' is one more microtask out
  await Promise.resolve();
}

(async () => {
  console.log('AudioWorklet routing rules');

  // ===== ON BY DEFAULT, and the way back ===================================
  // The splice path is not merely a slower alternative -- an AudioBufferSource
  // cannot be rewound or mutated, so it can only FAKE a ring rewrite, and the
  // ring position at the splice boundary is a quantity that can be computed
  // wrong. So the worklet is the default and the splice is the fallback, not
  // the other way round.
  {
    counters.workletNodes = 0; counters.addModule = 0;
    const { ctx, host } = makeCtx();                    // no ctx.audioWorklet
    const id = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(id, PTR, RING, 0, 1);          // a LOOPING ring
    ok(counters.addModule === 1,
      'with no flag set at all, a looping ring routes to the worklet by DEFAULT');
    ok(!!ctx._voices._map[id].currentSrc,
      'and still sounds on the old path until the module resolves');
    await settleModule(ctx);
    host.voice_play_ring(id, PTR, RING, 0, 1);
    ok(counters.workletNodes === 1, 'then takes its worklet node with no flag involved');
  }
  {
    counters.workletNodes = 0; counters.addModule = 0;
    const { ctx, host } = makeCtx({ audioWorklet: false });   // the opt-OUT
    const id = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(id, PTR, RING, 0, 1);
    ok(counters.addModule === 0 && counters.workletNodes === 0,
      'ctx.audioWorklet === false is the way back to the splice path');
    ok(!!ctx._voices._map[id].currentSrc, 'which still works');
  }

  // ===== RULE 1: a one-shot never reaches the worklet =======================
  {
    counters.workletNodes = 0; counters.addModule = 0;
    const { ctx, host } = makeCtx();        // NO flag: exactly what ships
    const id = host.voice_open(RATE, 1, 8);

    host.voice_play_ring(id, PTR, RING, 0, 0);          // loop = 0: one-shot
    await settleModule(ctx);
    host.voice_play_ring(id, PTR, RING, 0, 0);          // again, module now ready
    host.voice_play_ring(id, PTR, RING, 128, 0);        // and from an offset

    ok(counters.workletNodes === 0,
      'RULE 1: a one-shot Play() instantiates NO AudioWorkletNode, flag on or not');
    ok(counters.addModule === 0,
      'RULE 2: a one-shot does not even trigger the module fetch');
    ok(ctx._voices._map[id].workletSlot === null ||
       ctx._voices._map[id].workletSlot === undefined,
      'and it holds no descriptor slot');
  }

  // ===== a looping ring DOES route =========================================
  let loopingCtx, loopingHost, loopingId;
  {
    counters.workletNodes = 0; counters.bufferSources = 0; counters.addModule = 0;
    const { ctx, host } = makeCtx({ audioWorklet: true });
    loopingCtx = ctx; loopingHost = host;
    const id = loopingId = host.voice_open(RATE, 1, 8);

    host.voice_play_ring(id, PTR, RING, 0, 1);
    ok(counters.addModule === 1,
      'RULE 2: the FIRST qualifying looping ring is what fetches the module');
    ok(counters.workletNodes === 0,
      'and until it resolves the voice falls back to the old path rather than going silent');
    ok(counters.bufferSources === 1, 'so a buffer source is what actually sounds meanwhile');

    await settleModule(ctx);

    host.voice_play_ring(id, PTR, RING, 0, 1);
    ok(counters.workletNodes === 1, 'once the module is ready the looping ring gets a worklet node');
    const v = ctx._voices._map[id];
    ok(v.workletNode && Number.isInteger(v.workletSlot), 'the voice records its node and slot');
    ok(v.workletNode.processorName === 'wine-voice', 'it is the wine-voice processor');
    ok(v.workletNode.options.processorOptions.memory === ctx.getMemory(),
      'the worklet is handed the LIVE guest arena, not a copy');

    // ===== the refresh is a descriptor write, not a splice ==================
    const before = counters.workletNodes;
    const sourcesBefore = counters.bufferSources;
    for (let i = 0; i < 20; i++) host.voice_play_ring(id, PTR, RING, 0, 2);
    ok(counters.workletNodes === before,
      'twenty Unlock refreshes create ZERO additional nodes (there is no splice to get wrong)');
    ok(counters.bufferSources === sourcesBefore,
      'and zero additional buffer sources');

    // The cursor now comes from the thing making the sound.
    const router = ctx.sharedAudio.voiceWorkletRouter;
    const i32 = new Int32Array(router.controlBuffer);
    const base = v.workletSlot * router.DESC.STRIDE;
    Atomics.store(i32, base + router.DESC.CURSOR, 777);
    ok(host.voice_get_pos(id) === 777,
      'GetCurrentPosition reports the cursor the WORKLET published, not one derived from a clock');
  }

  // ===== RULE 3: the node dies with the playback ============================
  {
    const v = loopingCtx._voices._map[loopingId];
    const router = loopingCtx.sharedAudio.voiceWorkletRouter;
    ok(router.activeSlots() === 1, 'one descriptor slot is in use while it plays');
    loopingHost.voice_stop(loopingId);
    ok(!v.workletNode, 'RULE 3: Stop disconnects the node instead of leaving it rendering silence');
    ok(router.activeSlots() === 0, 'and returns the descriptor slot');

    const i32 = new Int32Array(router.controlBuffer);
    ok(i32[0 * router.DESC.STRIDE + router.DESC.FLAGS] === 0,
      'the released descriptor is cleared, so a stale PTR cannot be rendered');
  }

  // ===== RULE 4: no shared memory, no routing ==============================
  {
    counters.workletNodes = 0;
    const { ctx, host } = makeCtx({ audioWorklet: true, shared: false });
    const id = host.voice_open(RATE, 1, 8);
    host.voice_play_ring(id, PTR, RING, 0, 1);
    await settleModule(ctx);
    host.voice_play_ring(id, PTR, RING, 0, 1);
    ok(counters.workletNodes === 0,
      'RULE 4: a non-shared guest arena refuses routing (a private copy would be silently stale)');
    ok(!!ctx._voices._map[id].currentSrc, 'and the voice still sounds, on the old path');
  }

  // ===== the router itself, on the gates a host cannot easily reach =========
  {
    const router = createWorkletRouter({ maxVoices: 2 });
    const ac = new FakeAudioContext();
    const mem = new SharedArrayBuffer(1024);
    const v = { rate: RATE, channels: 1, bits: 8, gain: null };

    ok(router.enabled({}) === true, 'the router is ON for a ctx that says nothing');
    ok(router.enabled({ audioWorklet: false }) === false, 'and off only when opted out');
    ok(router.enabled({ audioWorklet: true }) === true, 'and on when opted in explicitly');

    const on = { audioWorklet: true };
    ok(router.canRoute(on, ac, v, 0, mem) === false, 'canRoute refuses loop=0');
    ok(router.canRoute(on, ac, v, 1, mem) === true, 'and accepts a looping ring');
    ok(router.canRoute(on, ac, v, 1, new ArrayBuffer(16)) === false,
      'and refuses a non-shared arena');
    ok(router.canRoute(on, null, v, 1, mem) === false, 'and refuses with no AudioContext');
    ok(router.canRoute(on, ac, { rate: 0, channels: 1, bits: 8 }, 1, mem) === false,
      'and refuses a voice with no format');

    // Slot exhaustion must degrade to the old path, never throw.
    router.ensureModule(ac);
    ac._resolveModule();
    await ac._moduleGate; await Promise.resolve();
    const a = { rate: RATE, channels: 1, bits: 8 };
    const b = { rate: RATE, channels: 1, bits: 8 };
    const c = { rate: RATE, channels: 1, bits: 8 };
    ok(router.route(on, ac, a, mem, 0, 64, 0, 1) === true, 'first voice routes');
    ok(router.route(on, ac, b, mem, 0, 64, 0, 1) === true, 'second voice routes');
    ok(router.route(on, ac, c, mem, 0, 64, 0, 1) === false,
      'a third voice past the slot limit falls back rather than failing');
    router.release(a);
    ok(router.route(on, ac, c, mem, 0, 64, 0, 1) === true,
      'and routes once a slot is freed');
  }

  console.log(`\nPASS  ${checks}/${checks} checks passed`);
})().then(
  () => { globalThis.AudioContext = saved.AudioContext; globalThis.AudioWorkletNode = saved.AudioWorkletNode; },
  (err) => {
    globalThis.AudioContext = saved.AudioContext;
    globalThis.AudioWorkletNode = saved.AudioWorkletNode;
    console.error(err);
    process.exit(1);
  });
