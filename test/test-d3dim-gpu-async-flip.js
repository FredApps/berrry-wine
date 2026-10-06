#!/usr/bin/env node
'use strict';

// A queued Flip on a WebGL2 target: the back buffer's readback goes into a
// pixel-pack buffer behind a fence sync instead of a synchronous readPixels,
// the flip chain's DIBs swap in draw order, and the pixels land in the DIB
// they were read from only when something fences those bytes. Measured on
// Deus Ex's D3DDrv: the synchronous readback was 28 ms of every present.

const assert = require('assert');
const { D3DIMGpu, OPCODES } = require('../lib/d3dim-gpu');

function fixture({ asyncFlip = true, version = 2, own = true } = {}) {
  const memory = new ArrayBuffer(0x10000), dv = new DataView(memory), u8 = new Uint8Array(memory);
  const front = 0x1000, back = 0x1040, flipDesc = 0x1100, dibA = 0x8000, dibB = 0x9000;
  dv.setUint32(front + 20, dibB, true);   // front entry's DIB
  dv.setUint32(back + 20, dibA, true);    // back entry's DIB: the render target
  dv.setUint32(flipDesc, front, true);
  dv.setUint32(flipDesc + 4, back, true);
  u8.fill(0x11, dibA, dibA + 64);
  u8.fill(0x22, dibB, dibB + 64);

  const events = [];
  let packBound = null, pbo = null;
  const PIXEL_PACK_BUFFER = 0x88eb;
  const gl = {
    RGBA: 1, UNSIGNED_BYTE: 2, PIXEL_PACK_BUFFER, STREAM_READ: 3, SYNC_GPU_COMMANDS_COMPLETE: 4,
    createBuffer() { return { data: null }; },
    deleteBuffer() {},
    bindBuffer(target, buf) { assert.equal(target, PIXEL_PACK_BUFFER); packBound = buf; },
    bufferData(target, size) { packBound.data = new Uint8Array(size); pbo = packBound; },
    readPixels(x, y, w, h, fmt, type, dst) {
      // The GPU frame: every pixel R=0x10 G=0x20 B=0x30 A=0xff (RGBA bytes).
      const fill = out => { for (let i = 0; i < out.length; i += 4) out.set([0x10, 0x20, 0x30, 0xff], i); };
      if (typeof dst === 'number') { events.push('read-async'); assert(packBound); fill(packBound.data); }
      else { events.push('read-sync'); fill(dst); }
    },
    fenceSync() { events.push('fence-sync'); return { sync: true }; },
    deleteSync() { events.push('delete-sync'); },
    flush() {},
    getBufferSubData(target, offset, dst) { events.push('collect'); dst.set(pbo.data.subarray(0, dst.length)); },
  };
  const exports = {
    d3dim_worker_flip(f, b) {
      events.push('swap');
      const t = dv.getUint32(f + 20, true);
      dv.setUint32(f + 20, dv.getUint32(b + 20, true), true);
      dv.setUint32(b + 20, t, true);
    },
    page_watch_write() {},
  };
  const gpu = new D3DIMGpu({ getMemory: () => memory, getExports: () => exports,
    createCanvas: () => null, asyncFlip, onError: () => {} });
  const target = { rt: back, width: 4, height: 4, bpp: 32, pitch: 16, format: 1,
    dib: dibA, dirty: true, colorDirtyBounds: null, check: false, textureKeys: new Set(),
    device: { gpu: { version, gl, bindImplicitTarget() {} } } };
  if (own) gpu.targets.set(back, target);
  return { gpu, dv, u8, events, flipDesc, front, back, dibA, dibB, target };
}

// DIB bytes for one 32-bit pixel converted from RGBA (0x10,0x20,0x30): B G R A.
const PIXEL = [0x30, 0x20, 0x10, 0xff];

{
  const f = fixture();
  assert.equal(f.gpu.call(OPCODES.FLIP, f.flipDesc), 1, 'a WebGL2 target queues the flip');
  assert.deepEqual(f.events, ['read-async', 'fence-sync', 'swap'],
    'the readback goes to a pixel-pack buffer, then the chain swaps; no client-memory read');
  assert.equal(f.dv.getUint32(f.front + 20, true), f.dibA, 'the drawn DIB is the front now');
  assert.equal(f.dv.getUint32(f.back + 20, true), f.dibB);
  assert.deepEqual(Array.from(f.u8.subarray(f.dibA, f.dibA + 4)), [0x11, 0x11, 0x11, 0x11],
    'the pixels are not in the DIB until something fences it');
  assert.equal(f.target.dirty, false, 'the in-flight read owns that frame, not a later fence');

  // A fence on unrelated bytes leaves the read in flight and keeps WAT pending.
  assert.equal(f.gpu.call(OPCODES.FENCE, 0xa000, 64), 2);
  assert(!f.events.includes('collect'));

  // Presenting the front (a fence ranged to its DIB) collects it.
  f.gpu.call(OPCODES.FENCE, f.dibA, 64);
  assert.deepEqual(f.events.slice(-2), ['collect', 'delete-sync']);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(Array.from(f.u8.subarray(f.dibA + i * 4, f.dibA + i * 4 + 4)), PIXEL,
      `pixel ${i} arrived in the DIB it was read from`);
  }
  assert.deepEqual(Array.from(f.u8.subarray(f.dibB, f.dibB + 4)), [0x22, 0x22, 0x22, 0x22],
    'the new back buffer is untouched');
  assert.equal(f.gpu.stats.asyncFlips, 1);
  assert.equal(f.gpu.stats.asyncReads, 1);
  assert.equal(f.gpu.stats.syncs, 1);

  // Nothing is collected twice: a later global fence finds no in-flight read.
  const n = f.events.length;
  f.gpu.call(OPCODES.FENCE, 0, 0);
  assert(!f.events.slice(n).includes('collect'));
}

{
  // A global fence (zero length) collects an in-flight read too.
  const f = fixture();
  f.gpu.call(OPCODES.FLIP, f.flipDesc);
  f.gpu.call(OPCODES.FENCE, 0, 0);
  assert(f.events.includes('collect'));
  assert.deepEqual(Array.from(f.u8.subarray(f.dibA, f.dibA + 4)), PIXEL);
}

// Everything else keeps the synchronous Flip: WAT fences and swaps itself.
assert.equal(fixture({ asyncFlip: false }).gpu.call(OPCODES.FLIP, 0x1100), 0, 'not opted in');
assert.equal(fixture({ version: 1 }).gpu.call(OPCODES.FLIP, 0x1100), 0, 'WebGL1 has no pixel-pack buffer');
assert.equal(fixture({ own: false }).gpu.call(OPCODES.FLIP, 0x1100), 0, 'a back buffer this executor does not own');

console.log('PASS  D3DIM WebGL2 Flip queues its readback and collects it at the next fence of those bytes');
