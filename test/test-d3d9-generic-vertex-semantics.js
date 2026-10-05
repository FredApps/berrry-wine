#!/usr/bin/env node
// A programmable vertex program reads its inputs by REGISTER, not by meaning.
//
// The linkage step used to insist every vertex attribute land in one of the
// fixed lanes it knew -- POSITION0, COLOR0/1, PSIZE, TEXCOORD0..5 -- and
// refused the draw otherwise. Black & White 2's terrain declaration is nine
// attributes over a 100-byte stride that are ALL usage POSITION, usageIndex
// 0..8, with a vs_1_1 declaring them as dcl_position v0..v8: perfectly legal,
// and refused. One refused draw poisons the command queue, so every following
// PRESENT failed with "earlier render command failed" and the picture froze
// after the land click.
//
// So for a programmable VS any semantic without a fixed lane now gets its own
// appended ABI5 lane. This pins that the data ARRIVES -- the colour is read
// from POSITION6, a semantic that has no lane of its own -- and that the
// eleven-lane native cap is still enforced.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

const W = 8, H = 8, STRIDE = 100;

// B&W2's terrain declaration, verbatim from the captured draw.
const ATTRIBUTES = [
  { register: 0, usage: 0, usageIndex: 0, type: 2, offset: 0 },
  { register: 1, usage: 0, usageIndex: 1, type: 2, offset: 12 },
  { register: 2, usage: 0, usageIndex: 5, type: 2, offset: 24 },
  { register: 3, usage: 0, usageIndex: 6, type: 2, offset: 36 },
  { register: 4, usage: 0, usageIndex: 7, type: 2, offset: 48 },
  { register: 5, usage: 0, usageIndex: 8, type: 2, offset: 60 },
  { register: 6, usage: 0, usageIndex: 2, type: 1, offset: 72 },
  { register: 7, usage: 0, usageIndex: 3, type: 7, offset: 80 },
  { register: 8, usage: 0, usageIndex: 4, type: 2, offset: 88 },
];
// One more of the same shape, to push the lane count past the native cap.
const TENTH = { register: 9, usage: 0, usageIndex: 9, type: 1, offset: 92 };

// dcl_position<n> v<reg>: opcode 31, the usage dword, then the v register.
const dcl = (usageIndex, register) => [31, 0x80000000 | (usageIndex << 16), 0x900f0000 | register];

// oPos = v0, oD0 = v3 (POSITION6 -- a semantic with no lane of its own), and a
// dead read of every remaining register so all nine are linked at once.
const vertexShader = extra => Uint32Array.from([0xfffe0101,
  ...[0, 1, 5, 6, 7, 8, 2, 3, 4].flatMap((usageIndex, register) => dcl(usageIndex, register)),
  ...(extra ? dcl(9, 9) : []),
  1, 0xc00f0000, 0x90e40000,
  1, 0xd00f0000, 0x90e40003,
  ...[1, 2, 4, 5, 6, 7, 8, ...(extra ? [9] : [])].flatMap(r => [1, 0x800f0001, 0x90e40000 | r]),
  0xffff]);
// ps_1_1: r0 = v0, the diffuse varying.
const pixelShader = Uint32Array.from([0xffff0101, 1, 0x800f0000, 0x90e40000, 0xffff]);

const vertices = () => {
  const bytes = new Uint8Array(3 * STRIDE), view = new DataView(bytes.buffer);
  [[-1, -1], [3, -1], [-1, 3]].forEach(([x, y], i) => {
    const at = i * STRIDE;
    view.setFloat32(at, x, true); view.setFloat32(at + 4, y, true); view.setFloat32(at + 8, 0.25, true);
    // POSITION6 at +36 carries the colour: opaque green after the w default.
    view.setFloat32(at + 36, 0, true); view.setFloat32(at + 40, 1, true); view.setFloat32(at + 44, 0, true);
  });
  return bytes;
};

const snapshot = extra => ({
  primitive: 4, primitiveCount: 1, stride: STRIDE, vertices: vertices(),
  attributes: extra ? [...ATTRIBUTES, TENTH] : ATTRIBUTES,
  textures: [], vertexShader: vertexShader(extra), pixelShader,
  state: { zenable: false, zwrite: false, cull: 1 },
});

// B&W2's village declaration, verbatim from the captured draw. oD0 is taken
// from the NORMAL (0,1) so the picture proves that lane arrived: green.
const VILLAGE_STRIDE = 32;
const village = () => {
  const bytes = new Uint8Array(3 * VILLAGE_STRIDE), view = new DataView(bytes.buffer);
  [[-1, -1], [3, -1], [-1, 3]].forEach(([x, y], i) => {
    const at = i * VILLAGE_STRIDE;
    view.setFloat32(at, x, true); view.setFloat32(at + 4, y, true); view.setFloat32(at + 8, 0.25, true);
    view.setFloat32(at + 12, 0, true); view.setFloat32(at + 16, 1, true);   // NORMAL0, FLOAT2
    view.setUint32(at + 24, 0xff3366cc, true);                              // COLOR0, D3DCOLOR
  });
  return {
    primitive: 4, primitiveCount: 1, stride: VILLAGE_STRIDE, vertices: bytes,
    attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 2, offset: 0 },
      { register: 1, usage: 3, usageIndex: 0, type: 1, offset: 12 },
      { register: 2, usage: 5, usageIndex: 0, type: 6, offset: 20 },
      { register: 3, usage: 10, usageIndex: 0, type: 4, offset: 24 },
      { register: 4, usage: 5, usageIndex: 1, type: 6, offset: 28 }],
    textures: [], pixelShader,
    vertexShader: Uint32Array.from([0xfffe0101,
      ...dcl(0, 0), 31, 0x80000003, 0x900f0001, 31, 0x80000005, 0x900f0002,
      31, 0x8000000a, 0x900f0003, 31, 0x80010005, 0x900f0004,
      1, 0xc00f0000, 0x90e40000,
      1, 0xd00f0000, 0x90e40001,
      ...[2, 3, 4].flatMap(r => [1, 0x800f0001, 0x90e40000 | r]),
      0xffff]),
    state: { zenable: false, zwrite: false, cull: 1 },
  };
};

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const device = new Device({ getExports: () => e, getMemory: () => memory.buffer, width: W, height: H });
  try {
    device.clear([0, 0, 0, 1], 1);
    device.draw(snapshot(false));
    const pixels = [...device.present().pixels];
    for (let i = 0; i < W * H; i++)
      assert.deepStrictEqual(pixels.slice(i * 4, i * 4 + 4), [0, 255, 0, 255],
        `pixel ${i} must carry the colour declared as POSITION6`);

    // A NORMAL declared FLOAT2. Under fixed function a normal is lit and its
    // type has to make sense as one; a programmable program just reads four
    // floats out of the lane. B&W2's village pass is exactly this declaration
    // -- POSITION0 FLOAT3, NORMAL0 FLOAT2, TEXCOORD0 SHORT2, COLOR0 D3DCOLOR,
    // TEXCOORD1 SHORT2 over a 32-byte stride -- and refusing it killed the
    // render worker mid-run.
    device.clear([0, 0, 0, 1], 1);
    device.draw(village());
    const lit = [...device.present().pixels];
    for (let i = 0; i < W * H; i++)
      assert.deepStrictEqual(lit.slice(i * 4, i * 4 + 4), [0, 255, 0, 255],
        `pixel ${i} must carry the FLOAT2 NORMAL through its own lane`);

    // Ten generic semantics need twelve native lanes; eleven is the cap.
    assert.throws(() => device.draw(snapshot(true)), /exceeds eleven/,
      'the native vertex input cap is still enforced');
  } finally { device.destroy(); assert.strictEqual(device.bytes, 0); }

  console.log('PASS test-d3d9-generic-vertex-semantics');
})().catch(error => { console.error(error); process.exit(1); });
