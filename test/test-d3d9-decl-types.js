#!/usr/bin/env node
// Every D3DDECLTYPE decodes to the same colour its FLOAT4 spelling does.
//
// The software backend used to read exactly two shapes of vertex attribute:
// four little-endian float32s, or D3DCOLOR's four bytes over 255. Everything
// else -- UBYTE4, the SHORT/USHORT normalized forms, UDEC3/DEC3N and the two
// half-float types -- was refused before it ever got here, by a `type > 4`
// test in $d3d9_declaration_create that returned NULL and recorded nothing.
// A game using one of them lost the draw with no error raised anywhere; Black
// & White 2's land pass is measured doing exactly that.
//
// So the property worth pinning is not "the new types are accepted" but "they
// decode to the RIGHT numbers". Each case below encodes one known colour in
// one type and asserts the rendered pixel equals what the SAME colour renders
// to as a FLOAT4, which makes a wrong scale factor or a swapped component fail
// rather than pass. Comparing against the FLOAT4 render rather than against a
// literal keeps the test about the decode: the backend's own channel order
// cancels out of both sides.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

const W = 16, H = 16;
// Chosen so the byte encodings are exact: 51/255 = 0.2 and 102/255 = 0.4, and
// every value is representable as a half. All four components differ, so a
// test that passed with them permuted would have to be actively unlucky.
const COLOR = [0.2, 0.4, 1, 0.6];
const BYTES = COLOR.map(c => Math.round(c * 255));

const half = value => {                       // float -> IEEE 754 binary16 bits
  if (value === 0) return 0;
  const sign = value < 0 ? 0x8000 : 0, v = Math.abs(value);
  const exponent = Math.floor(Math.log2(v));
  const mantissa = Math.round((v / 2 ** exponent - 1) * 1024);
  return sign | ((exponent + 15) << 10) | (mantissa & 0x3ff);
};

// One encoder per D3DDECLTYPE under test: how many bytes it writes, and how to
// write the four colour components into them.
// One case per D3DDECLTYPE under test: the colour it carries, the type's own
// enum value, how many bytes it occupies and how to write that colour into
// them. `color` is what a correct decode must produce, and is rendered as a
// FLOAT4 to get the expected pixels.
const FLOAT4 = (v, at, color) => color.forEach((c, i) => v.setFloat32(at + i * 4, c, true));
const CASES = {
  FLOAT4: { type: 3, bytes: 16, color: COLOR, write: FLOAT4 },
  D3DCOLOR: { type: 4, bytes: 4, color: BYTES.map(b => b / 255),
    write: (v, at) => BYTES.forEach((c, i) => v.setUint8(at + i, c)) },
  UBYTE4N: { type: 8, bytes: 4, color: BYTES.map(b => b / 255),
    write: (v, at) => BYTES.forEach((c, i) => v.setUint8(at + i, c)) },
  SHORT4N: { type: 10, bytes: 8, color: COLOR,
    write: (v, at) => COLOR.forEach((c, i) => v.setInt16(at + i * 2, Math.round(c * 32767), true)) },
  USHORT4N: { type: 12, bytes: 8, color: COLOR,
    write: (v, at) => COLOR.forEach((c, i) => v.setUint16(at + i * 2, Math.round(c * 65535), true)) },
  FLOAT16_4: { type: 16, bytes: 8, color: COLOR,
    write: (v, at) => COLOR.forEach((c, i) => v.setUint16(at + i * 2, half(c), true)) },
  // The narrow types write only the components they carry; the rest keep the
  // register's default, which for a colour register is 1. So each case below
  // names the full four-component colour a correct decode leaves behind, and
  // the components it does NOT write are 1 on purpose.
  SHORT2: { type: 6, bytes: 4, color: [0, 1, 1, 1],
    write: (v, at) => [0, 1].forEach((c, i) => v.setInt16(at + i * 2, c, true)) },
  // SHORT4 with usage POSITION is what Black & White 2's land pass asks for --
  // the element measured in drive36 against the old `type > 4` gate.
  SHORT4: { type: 7, bytes: 8, color: [0, 1, 0, 1],
    write: (v, at) => [0, 1, 0, 1].forEach((c, i) => v.setInt16(at + i * 2, c, true)) },
  UDEC3: { type: 13, bytes: 4, color: [0, 1, 1, 1],
    write: (v, at) => v.setUint32(at, 0 | (1 << 10) | (1 << 20), true) },
  // DEC3N's 10 bits are signed and scaled by 511, so 511 is +1 and 1022 is -1.
  DEC3N: { type: 14, bytes: 4, color: [1, -1, 0, 1],
    write: (v, at) => v.setUint32(at, 511 | (1022 << 10) | (0 << 20), true) },
  // UBYTE4 is NOT normalized -- it delivers 0..255 as-is, so its bytes are
  // already-in-range values. Feeding it BYTES would clamp to white and hide a
  // missing /255 somewhere else.
  UBYTE4: { type: 5, bytes: 4, color: [0, 1, 1, 1],
    write: (v, at) => [0, 1, 1, 1].forEach((c, i) => v.setUint8(at + i, c)) },
};

// A triangle that covers the whole target, flat-shaded from its vertices.
const triangle = ({ type, bytes, write, color }) => {
  const stride = 12 + bytes, corners = [[-3, -1], [1, -1], [1, 3]];
  const vertices = new Uint8Array(corners.length * stride);
  const view = new DataView(vertices.buffer);
  corners.forEach(([x, y], j) => {
    const at = j * stride;
    [x, y, 0.5].forEach((c, k) => view.setFloat32(at + k * 4, c, true));
    write(view, at + 12, color);
  });
  return { primitive: 4, primitiveCount: 1, stride, vertices, textures: [],
    attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 2, offset: 0 },
      { register: 1, usage: 10, usageIndex: 0, type, offset: 12 }],
    vertexShader: new Uint32Array([0xfffe0101,
      1, 0xc00f0000, 0x90e40000, 1, 0xd00f0000, 0x90e40001, 0xffff]),
    pixelShader: new Uint32Array([0xffff0101, 1, 0x800f0000, 0x90e40000, 0xffff]),
    state: { cull: 1, zenable: false } };
};

// The position attribute is FLOAT3, so a triangle that renders nothing means
// the colour element broke the draw rather than the colour being wrong.
const centre = pixels => {
  const at = ((H >> 1) * W + (W >> 1)) * 4;
  return [...pixels.slice(at, at + 4)];
};

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const d = new Device({ width: W, height: H, getExports: () => e, getMemory: () => memory.buffer });
  try {
    // What the colour renders to when spelled as plain floats -- once per
    // distinct colour, since not every case carries the same one.
    const control = color => {
      d.clear([0, 0, 0, 1], 1);
      d.draw(triangle({ ...CASES.FLOAT4, color }));
      return centre(d.present().pixels);
    };

    for (const [name, encoding] of Object.entries(CASES)) {
      const want = control(encoding.color);
      assert.notDeepStrictEqual(want, [0, 0, 0, 255],
        `${name}'s control colour must be distinguishable from the cleared target`);
      d.clear([0, 0, 0, 1], 1);
      assert.doesNotThrow(() => d.draw(triangle(encoding)), `${name} must not fail the draw`);
      const got = centre(d.present().pixels);
      assert.deepStrictEqual(got, want, `${name} decoded to ${got}, expected ${want}`);
    }

    // The gate still holds where the backend genuinely cannot read: an element
    // reaching past the stride is a malformed draw, not a new type.
    const short = triangle(CASES.FLOAT16_4);
    short.attributes[1].offset = short.stride - 4;
    assert.throws(() => d.draw(short), /invalid vertex attribute/,
      'an element running past the vertex stride is still refused');
  } finally { d.destroy(); assert.strictEqual(d.bytes, 0); }

  console.log('PASS test-d3d9-decl-types');
})().catch(error => { console.error(error); process.exit(1); });
