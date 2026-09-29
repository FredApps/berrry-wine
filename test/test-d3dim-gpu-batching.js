#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { D3DIMGpu, OPCODES } = require('../lib/d3dim-gpu');

function fixture(batchDraws = true) {
  const memory = new ArrayBuffer(0x10000), dv = new DataView(memory);
  const desc = 0x1000, vertices = 0x2000, call = 0x3000, rt = 0x4000, dib = 0x8000;
  const fields = [rt, 4, 4, 32, 16, dib, 1];
  fields.forEach((v, i) => dv.setUint32(desc + i * 4, v, true));
  dv.setUint32(desc + 17 * 4, 8, true);
  dv.setUint32(desc + 19 * 4, 1, true); // transparent draws must retain order
  dv.setUint32(desc + 20 * 4, 5, true);
  dv.setUint32(desc + 21 * 4, 6, true);
  dv.setUint32(desc + 27 * 4, 1, true);
  dv.setUint32(desc + 28 * 4, 2, true);
  [0x5000, 4, 3, vertices, 3].forEach((v, i) => dv.setUint32(call + i * 4, v, true));
  const events = [], draws = [];
  let fail = false;
  const target = { rt, width: 4, height: 4, bpp: 32, pitch: 16, format: 1,
    dib, check: false, textureKeys: new Set(), device: {
      draw(draw) {
        if (fail) throw new Error('injected failure');
        events.push('draw'); draws.push({...draw, vertices:draw.vertices.slice()});
      }, clear() { events.push('clear'); }, releaseTextures() {},
      gpu: { bindImplicitTarget() {}, gl: { RGBA: 1, UNSIGNED_BYTE: 2,
        readPixels(...args) { events.push('read'); args[6].fill(0); } } },
    } };
  const gpu = new D3DIMGpu({ getMemory: () => memory,
    getExports: () => ({ d3dim_gpu_describe: () => desc, guest_to_wasm: a => a }),
    createCanvas: () => null, batchDraws, onError: () => {} });
  gpu._target = () => target;
  gpu.targets.set(rt, target);
  const draw = (x, color = 0x80ff0000) => {
    for (let i = 0; i < 3; i++) {
      const p = vertices + i * 32;
      dv.setFloat32(p, x + i, true); dv.setFloat32(p + 4, i, true);
      dv.setFloat32(p + 8, 0.5, true); dv.setFloat32(p + 12, 1, true);
      dv.setUint32(p + 16, color, true);
    }
    return gpu.call(OPCODES.DRAW, call);
  };
  return { gpu, target, dv, desc, call, draw, draws, events, fail: () => { fail = true; } };
}

const f = fixture();
assert.equal(f.draw(0), 1); // first shape is validated synchronously
assert.equal(f.draw(10, 0x8000ff00), 1);
assert.equal(f.draw(20, 0x800000ff), 1);
assert.equal(f.draws.length, 1);
f.dv.setFloat32(0x2000, 999, true); // guest reuses the borrowed input buffer
f.gpu.fence();
assert.deepEqual(f.events, ['draw', 'draw', 'read']);
assert.equal(f.draws[1].primitiveCount, 2);
const v = new DataView(f.draws[1].vertices.buffer);
assert.equal(v.getFloat32(0, true), 10);
assert.equal(v.getFloat32(96, true), 20);
assert.equal(v.getUint32(16, true), 0x8000ff00);
assert.equal(v.getUint32(112, true), 0x80ff0000, 'transparent primitive order is preserved');
assert.equal(f.gpu.stats.drawCalls, 3);
assert.equal(f.gpu.stats.draws, 2);
assert.equal(f.gpu.stats.mergedDraws, 1);

// A scoped CPU access issues buffered GPU work, but reads back only targets
// whose backing bytes overlap. The remaining dirty target keeps WAT pending.
const scoped = fixture();
scoped.draw(1); scoped.draw(2);
assert(scoped.gpu.pendingDraw);
assert.equal(scoped.gpu.call(OPCODES.FENCE, 0x9000, 1), 2);
assert.equal(scoped.gpu.pendingDraw, null, 'scoped fence submits queued draws');
assert.deepEqual(scoped.events, ['draw', 'draw'], 'unrelated range triggers no readback');
assert.equal(scoped.gpu.call(OPCODES.FENCE, 0, 0), 1);
assert.deepEqual(scoped.events, ['draw', 'draw', 'read'], 'global fence materializes remaining target');


// A state change flushes the old batch before validating/submitting the new.
f.draw(30);
f.dv.setUint32(f.desc + 19 * 4, 0, true);
f.draw(40);
assert.equal(new DataView(f.draws.at(-2).vertices.buffer).getFloat32(0, true), 30);
assert.equal(f.draws.at(-2).state.blend, true);
assert.equal(f.draws.at(-1).state.blend, false);

// Even an early rejection must finish earlier accepted draws before fallback.
f.draw(50);
f.dv.setUint32(f.call + 4, 1, true);
assert.equal(f.draw(60), 0);
assert.equal(f.gpu.pendingDraw, null);
assert.equal(new DataView(f.draws.at(-1).vertices.buffer).getFloat32(0, true), 50);

// Texture release and a clear are ordering barriers, even a declined clear.
f.dv.setUint32(f.call + 4, 4, true);
f.draw(70);
f.gpu._releaseTexture({key:'old', watch:{release(){f.events.push('release');}}});
assert.deepEqual(f.events.slice(-2), ['draw', 'release']);
f.draw(80); f.draw(90);
f.dv.setUint32(0x5000, 0, true); // no owned target: clear returns to software
assert.equal(f.gpu.call(OPCODES.CLEAR, 0x5000), 0);
assert.equal(f.gpu.pendingDraw, null);

// A size limit flushes whole primitives and never changes their total count.
const bounded = fixture();
for (let i = 0; i < 1400; i++) bounded.draw(i);
bounded.gpu.fence();
assert.equal(bounded.draws.reduce((n, d) => n + d.primitiveCount, 0), 1400);
assert(bounded.draws.every(d => d.vertices.byteLength <= 65536));
assert(bounded.draws.length < 10);

// Context loss after deferred calls cannot silently drop those accepted calls.
const broken = fixture(); broken.draw(0); broken.draw(1); broken.fail();
assert.throws(() => broken.gpu.fence(), /deferred GPU draw failed/);
assert.equal(broken.gpu.stats.errors, 1);

// Shutdown reports lost accepted draws, but still releases every resource.
const stopping = fixture(); stopping.draw(0); stopping.draw(1); stopping.fail();
const released = [];
stopping.gpu.textures.set(1, {
  watch: { release() { released.push('texture'); throw new Error('cleanup failure'); } },
  paletteWatch: { release() { released.push('palette'); } }
});
stopping.target.watch = { release() { released.push('target'); } };
stopping.target.device.destroy = () => released.push('device');
assert.throws(() => stopping.gpu.stop(), /deferred GPU draw failed/);
assert.deepEqual(released, ['texture', 'palette', 'target', 'device']);
assert.equal(stopping.gpu.pendingDraw, null);
assert.equal(stopping.gpu.targets.size, 0);
assert.equal(stopping.gpu.textures.size, 0);
assert.equal(stopping.gpu.pendingReleases.length, 0);

// A deterministic clock isolates submission cost: charge a fallback-triggered
// flush once, and charge an external fence flush once as well.
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
let clock = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
try {
  const timed = fixture();
  const submit = timed.target.device.draw;
  timed.target.device.draw = draw => { clock += 5; return submit(draw); };
  timed.draw(0); timed.draw(1);
  assert.equal(timed.gpu.stats.drawMs, 5);
  timed.dv.setUint32(timed.call + 4, 1, true);
  assert.equal(timed.draw(2), 0);
  assert.equal(timed.gpu.stats.drawMs, 10, 'fallback flush submission time is counted once');
  timed.dv.setUint32(timed.call + 4, 4, true);
  timed.draw(3); timed.gpu.fence();
  assert.equal(timed.gpu.stats.drawMs, 15, 'external fence submission time is counted once');
  assert.equal(timed.gpu.stats.submitMs, 15);
} finally {
  if (performanceDescriptor) Object.defineProperty(globalThis, 'performance', performanceDescriptor);
  else delete globalThis.performance;
}

const immediate = fixture(false); immediate.draw(0); immediate.draw(1);
assert.equal(immediate.draws.length, 2);
assert.equal(immediate.gpu.pendingDraw, null);
console.log('PASS D3DIM batching: owned vertices, transparency order, state/fallback/release/clear barriers, bound and failure');
