#!/usr/bin/env node
// A TL vertex's sz is only a depth value. With ZENABLE and ZWRITEENABLE both
// off it decides nothing, and the software rasterizer ignores it; WebGL still
// clips anything outside [0,1]. The DX SDK Flip3DTL sample draws its cube at
// sz=300 with the z buffer off, so on ?d3dim-gpu every triangle vanished
// while the software arm drew it. lib/d3dim-gpu.js must clamp sz into range
// when depth is off, and must leave it alone when a depth test is in play.
'use strict';
const assert = require('assert');
const { D3DIMGpu, OPCODES } = require('../lib/d3dim-gpu');

const memory = new ArrayBuffer(0x10000);
const dv = new DataView(memory);
const DESC = 0x1000, VERTS = 0x2000, CALL = 0x3000;

function run(zenable, zwrite, zs) {
  new Uint8Array(memory).fill(0);
  const f = [];
  f[0] = 0x4000; f[1] = 640; f[2] = 480; f[3] = 16; f[4] = 1280; f[5] = 0x8000; f[6] = 1;
  f[16] = zenable; f[17] = 4; f[18] = zwrite; f[27] = 1; f[28] = 2;
  for (let i = 0; i < 33; i++) dv.setUint32(DESC + i * 4, f[i] | 0, true);
  zs.forEach((z, i) => {
    const o = VERTS + i * 32;
    dv.setFloat32(o, 10 * i, true); dv.setFloat32(o + 4, 20 + i, true);
    dv.setFloat32(o + 8, z, true); dv.setFloat32(o + 12, 1, true);
    dv.setUint32(o + 16, 0xff808080, true);
  });
  dv.setUint32(CALL, 0x5000, true);      // device
  dv.setUint32(CALL + 4, 4, true);       // triangle list
  dv.setUint32(CALL + 8, 3, true);       // TL vertex
  dv.setUint32(CALL + 12, VERTS, true);  // guest address (identity-mapped here)
  dv.setUint32(CALL + 16, zs.length, true);
  const draws = [];
  const gpu = new D3DIMGpu({
    getExports: () => ({ d3dim_gpu_describe: () => DESC, guest_to_wasm: a => a }),
    getMemory: () => memory,
    createCanvas: () => null,
    onError: message => { throw new Error(message); },
  });
  // No WebGL here: a target whose device records what it is handed.
  const target = { width: 640, height: 480, bpp: 16, dib: 0x8000, check: false, textureKeys: new Set(),
    device: { draw: d => draws.push(d) } };
  gpu._target = () => target;
  assert.strictEqual(gpu.call(OPCODES.DRAW, CALL), 1, 'the draw is taken, not declined');
  assert.strictEqual(draws.length, 1);
  const out = new DataView(draws[0].vertices.buffer);
  return zs.map((_, i) => out.getFloat32(i * 32 + 8, true));
}

// Depth off: sz = 300 (Flip3DTL), negative and in-range values all land in [0,1].
const off = run(0, 0, [300, -2, 0.25]);
assert.deepStrictEqual(off, [1, 0, 0.25], `depth-off sz clamps into range: ${off}`);

// Depth test on: sz is the depth value and is passed through untouched.
const on = run(1, 1, [300, -2, 0.25]);
assert.deepStrictEqual(on, [300, -2, 0.25], `depth-on sz is unchanged: ${on}`);

// Depth write only still needs the real value.
const writeOnly = run(0, 1, [1.5, 0.5, 0.75]);
assert.deepStrictEqual(writeOnly, [1.5, 0.5, 0.75], `zwrite-only sz is unchanged: ${writeOnly}`);

console.log('test-d3dim-gpu-depthless-z: OK');
