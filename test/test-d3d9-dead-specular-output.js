#!/usr/bin/env node
// A vertex shader may write oD1 that nothing reads.
//
// HLSL routinely emits an oD1 write for a pixel shader that never samples v1,
// and Black & White 2's land pass does exactly that: the VS writes bank 5
// index 1 while the paired PS reads only r0, c0..c4 and t0 -- no v# at all.
// The software backend refused the whole draw for it ("only
// position/fog/point-size/diffuse0/texture0..5 outputs are implemented"), and
// because the render queue's error is sticky, one dead write took the render
// worker down and froze the frame. That surfaced the moment vertex shaders
// started compiling at all (374269af); before then nothing was ever bound.
//
// That was first fixed by allowing the write only while it was dead. The value
// is carried for real now (test-d3d9-specular-varying.js pins the linkage), so
// what this file still guards is the narrower claim underneath: a dead oD1
// changes nothing about the picture.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

const W = 8, H = 8;

// vs_1_1: oPos = v0, oD0 = v0, and optionally oD1 = v0.
//   1 = mov, dst 0xc00f0000 = oPos (bank 4 index 0, mask xyzw),
//   0xd00f0000 = oD0 (bank 5 index 0), 0xd00f0001 = oD1 (bank 5 index 1),
//   0x90e40000 = v0 (bank 1 index 0, swizzle xyzw).
const vertexShader = specular => Uint32Array.from([0xfffe0101,
  1, 0xc00f0000, 0x90e40000,
  1, 0xd00f0000, 0x90e40000,
  ...(specular ? [1, 0xd00f0001, 0x90e40000] : []),
  0xffff]);
// ps_1_1: r0 = c0, or r0 = v1 when it should consume specular.
//   0x800f0000 = r0, 0xa0e40000 = c0, 0x90e40001 = v1.
const pixelShader = readsSpecular => Uint32Array.from([0xffff0101,
  1, 0x800f0000, readsSpecular ? 0x90e40001 : 0xa0e40000, 0xffff]);

const snapshot = (specular, readsSpecular) => ({
  primitive: 4, primitiveCount: 1, stride: 16,
  vertices: new Uint8Array(new Float32Array([
    -1, -1, 0.25, 1, 3, -1, 0.25, 1, -1, 3, 0.25, 1]).buffer),
  attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 3, offset: 0 }],
  textures: [],
  vertexShader: vertexShader(specular), pixelShader: pixelShader(readsSpecular),
  pixelConstants: Float32Array.from([1, 0, 0, 1]),
  state: { zenable: false, zwrite: false, cull: 1 },
});

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const device = new Device({ getExports: () => e, getMemory: () => memory.buffer, width: W, height: H });
  try {
    const render = s => { device.clear([0, 0, 0, 1], 1); device.draw(s); return [...device.present().pixels]; };

    // The control: no oD1 at all.
    const want = render(snapshot(false, false));
    assert.ok(want.some((v, i) => i % 4 !== 3 && v !== 0), 'the control triangle must cover pixels');

    // A dead oD1 write is accepted, and changes nothing about the picture --
    // which is the claim, not merely that the draw did not throw. Comparing
    // renders means an oD1 that leaked into the colour would fail here rather
    // than pass quietly.
    assert.deepStrictEqual(render(snapshot(true, false)), want,
      'a vertex shader writing an oD1 nobody reads must draw the same pixels');

    // A pixel shader that reads v1 while the vertex shader writes oD1 is no
    // longer refused: the rasterizer's vertex snapshot carries a second colour
    // varying now, so the value genuinely arrives. What it draws is pinned in
    // test-d3d9-specular-varying.js; here it only has to be legal, and it has
    // to differ from the control, because oD1 = v0 is a position, not the
    // constant the control's pixel shader reads from c0.
    assert.notDeepStrictEqual(render(snapshot(true, true)), want,
      'a consumed oD1 must reach the pixel shader');

    // Reading v1 with nothing producing specular stays legal -- undefined, and
    // the native VM already zero-fills it, so this is the conservative answer
    // rather than a wrong one.
    render(snapshot(false, true));

    // The rest of the output rule is unchanged: oD2 does not exist, and
    // bank 5 index 2 must be refused whoever reads it.
    const beyond = snapshot(false, false);
    beyond.vertexShader = Uint32Array.from([0xfffe0101,
      1, 0xc00f0000, 0x90e40000,
      1, 0xd00f0002, 0x90e40000,
      0xffff]);
    assert.throws(() => device.draw(beyond), /outputs are implemented|native shader validation failed/,
      'there is no oD2');
  } finally { device.destroy(); assert.strictEqual(device.bytes, 0); }

  console.log('PASS test-d3d9-dead-specular-output');
})().catch(error => { console.error(error); process.exit(1); });
