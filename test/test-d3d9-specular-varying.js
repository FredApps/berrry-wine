#!/usr/bin/env node
// The second colour varying: oD1 is produced, interpolated and read as v1.
//
// The software rasterizer carried ONE colour varying, so a vertex shader that
// wrote oD1 and a pixel shader that read v1 could not be linked -- the draw was
// refused rather than served zero, because zero would have been silently wrong.
// Black & White 2's terrain pass is exactly that pair: its vertex shader ends
// `mov oD1.xyzw` and its pixel shader is `mov r0.xyz, v1` / `mov r0.w, c0.w`,
// so the land is painted BY the interpolated specular colour and serving zero
// would have painted it black.
//
// This pins the linkage end to end rather than the absence of a refusal: the
// same pixel shader is rendered twice, once with a vertex shader writing oD1
// and once without, and only the first may show the colour.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

const W = 8, H = 8;

// vs_1_1: oPos = v0, oD0 = v0, and optionally oD1 = v1 (the COLOR0 attribute).
//   0xc00f0000 = oPos, 0xd00f0000 = oD0, 0xd00f0001 = oD1,
//   0x90e40000 = v0, 0x90e40001 = v1.
const vertexShader = specular => Uint32Array.from([0xfffe0101,
  1, 0xc00f0000, 0x90e40000,
  1, 0xd00f0000, 0x90e40000,
  ...(specular ? [1, 0xd00f0001, 0x90e40001] : []),
  0xffff]);
// ps_1_1, B&W2's terrain shader verbatim: r0.xyz = v1, r0.w = c0.w.
//   0x80070000 = r0.xyz, 0x80080000 = r0.w, 0x90e40001 = v1, 0xa0ff0000 = c0.w.
const pixelShader = Uint32Array.from([0xffff0101,
  1, 0x80070000, 0x90e40001,
  1, 0x80080000, 0xa0ff0000, 0xffff]);

// Position float4 then COLOR0 float4, one green vertex colour on all three so
// the interpolated value is a constant and the assertion is exact.
const vertices = () => {
  const data = new Float32Array(3 * 8);
  [[-1, -1], [3, -1], [-1, 3]].forEach(([x, y], i) =>
    data.set([x, y, 0.25, 1, 0, 1, 0, 1], i * 8));
  return new Uint8Array(data.buffer);
};

const snapshot = specular => ({
  primitive: 4, primitiveCount: 1, stride: 32, vertices: vertices(),
  attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 3, offset: 0 },
    { register: 1, usage: 10, usageIndex: 0, type: 3, offset: 16 }],
  textures: [],
  vertexShader: vertexShader(specular), pixelShader,
  pixelConstants: Float32Array.from([0, 0, 0, 1]),
  state: { zenable: false, zwrite: false, cull: 1 },
});

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const device = new Device({ getExports: () => e, getMemory: () => memory.buffer, width: W, height: H });
  try {
    const render = s => { device.clear([0, 0, 0, 1], 1); device.draw(s); return [...device.present().pixels]; };

    // The whole 8x8 is covered by the oversized triangle, so every pixel is
    // the interpolated specular colour -- opaque green, alpha from c0.w.
    const lit = render(snapshot(true));
    for (let i = 0; i < W * H; i++)
      assert.deepStrictEqual(lit.slice(i * 4, i * 4 + 4), [0, 255, 0, 255],
        `pixel ${i} must carry the interpolated oD1`);

    // Same pixel shader with nothing producing specular: v1 is undefined and
    // the VM's zero-filled input register is the conservative answer, so the
    // triangle comes out black. This is the control that proves the green
    // above travelled through the varying rather than from anywhere else.
    const dark = render(snapshot(false));
    for (let i = 0; i < W * H; i++)
      assert.deepStrictEqual(dark.slice(i * 4, i * 4 + 4), [0, 0, 0, 255],
        `pixel ${i} must be black when no vertex shader writes oD1`);

    // oD2 does not exist and must still be refused.
    const beyond = snapshot(true);
    beyond.vertexShader = Uint32Array.from([0xfffe0101,
      1, 0xc00f0000, 0x90e40000,
      1, 0xd00f0002, 0x90e40000,
      0xffff]);
    assert.throws(() => device.draw(beyond), /outputs are implemented|native shader validation failed/,
      'there is no oD2');
  } finally { device.destroy(); assert.strictEqual(device.bytes, 0); }

  console.log('PASS test-d3d9-specular-varying');
})().catch(error => { console.error(error); process.exit(1); });
