#!/usr/bin/env node
// A non-finite vertex culls its own triangles; it does not fail the draw.
//
// $d3d_software_prepare_step used to refuse the whole draw when any post-vertex
// -shading position (or point size) was not finite -- one `br_if $failure` over
// |x|,|y|,|z|,|w| <= FLT_MAX, collapsing into the same bare -1 every other
// refusal returns. That is the wrong granularity twice over. A NaN position is
// a property of ONE vertex, and real hardware does not fail a draw call for it:
// every ordering comparison against NaN is false, so the triangle covers no
// samples and the rest of the batch rasterizes normally.
//
// The cost of the old behaviour was total, not cosmetic, because the producer's
// queue error is sticky (lib/d3d-command-stream.js): one refused draw ends
// rendering for the whole run. Measured on Black & White 2's land pass -- the
// draw captured at command 9233 is 56 vertices, 28 triangles, and exactly four
// floats in it are NaN (the Y of vertices 48-51, one quad's worth). Zeroing
// those four floats and replaying made the identical draw succeed, which is
// what identified this as the whole of the third blocker.
//
// So the vertex stage now marks the vertex (the first reserved word of its
// 144-byte record) and $d3d_software_clip_range drops any triangle that
// references a marked one. What this pins is both halves: the draw survives,
// AND the tainted triangle really is absent rather than rasterized as garbage.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/d3d9-software-backend');

// Two clip-space triangles, side by side, each covering a known half of the
// target: the left one at x in [-1,0), the right at x in (0,1]. `nan` names
// which of the six vertices gets a NaN Y.
const pair = ({ nan = -1 } = {}) => {
  const stride = 20, corners = [
    [-0.9, -0.9], [-0.9, 0.9], [-0.1, -0.9],     // left triangle
    [0.1, -0.9], [0.1, 0.9], [0.9, -0.9],        // right triangle
  ];
  const vertices = new Uint8Array(corners.length * stride);
  const view = new DataView(vertices.buffer);
  corners.forEach(([x, y], j) => {
    const at = j * stride;
    [x, j === nan ? NaN : y, 0.5, 1].forEach((c, k) => view.setFloat32(at + k * 4, c, true));
    vertices.set([255, 255, 255, 255], at + 16);
  });
  return { primitive: 4, primitiveCount: 2, stride, vertices, textures: [],
    attributes: [{ register: 0, usage: 0, usageIndex: 0, type: 3, offset: 0 },
      { register: 1, usage: 10, usageIndex: 0, type: 4, offset: 16 }],
    vertexShader: new Uint32Array([0xfffe0101,
      1, 0xc00f0000, 0x90e40000, 1, 0xd00f0000, 0x90e40001, 0xffff]),
    pixelShader: new Uint32Array([0xffff0101, 1, 0x800f0000, 0x90e40000, 0xffff]),
    state: { cull: 1, zenable: false } };
};

const W = 32, H = 32;
// Lit pixels in the left and right halves of the frame, counted separately so
// "the draw did not fail" and "the bad triangle is gone" are distinct readings.
const halves = pixels => {
  let left = 0, right = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (pixels[(y * W + x) * 4] === 0) continue;
    if (x < W / 2) left++; else right++;
  }
  return { left, right };
};

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  const d = new Device({ width: W, height: H, getExports: () => e, getMemory: () => memory.buffer });
  try {
    // The control: both triangles are ordinary, both halves are covered.
    d.clear([0, 0, 0, 1], 1);
    d.draw(pair());
    const clean = halves(d.present().pixels);
    assert.ok(clean.left > 0 && clean.right > 0,
      `the control must cover both halves: ${JSON.stringify(clean)}`);

    // The case B&W2 hits. One vertex of the LEFT triangle is NaN.
    d.clear([0, 0, 0, 1], 1);
    assert.doesNotThrow(() => d.draw(pair({ nan: 1 })),
      'a NaN vertex must not fail the draw');
    const tainted = halves(d.present().pixels);
    assert.strictEqual(tainted.left, 0,
      `the triangle with the NaN vertex must cover nothing: ${JSON.stringify(tainted)}`);
    assert.strictEqual(tainted.right, clean.right,
      `the other triangle must be unaffected: ${JSON.stringify(tainted)} vs ${JSON.stringify(clean)}`);

    // And the mirror image, so the answer is not "the first triangle is
    // dropped" or "everything after a NaN is dropped".
    d.clear([0, 0, 0, 1], 1);
    d.draw(pair({ nan: 4 }));
    const other = halves(d.present().pixels);
    assert.strictEqual(other.right, 0, `the right triangle is the dropped one now: ${JSON.stringify(other)}`);
    assert.strictEqual(other.left, clean.left, `and the left one is intact: ${JSON.stringify(other)}`);

    // Infinity is refused on the same grounds as NaN -- the finite test is
    // |c| <= FLT_MAX, not c === c.
    d.clear([0, 0, 0, 1], 1);
    const inf = pair();
    new DataView(inf.vertices.buffer).setFloat32(1 * inf.stride + 4, Infinity, true);
    assert.doesNotThrow(() => d.draw(inf), 'an infinite vertex must not fail the draw either');
    assert.strictEqual(halves(d.present().pixels).left, 0, 'and its triangle is dropped');

    // The device is still healthy afterwards -- the property the sticky queue
    // error makes load-bearing, and the whole reason this is not a refusal.
    d.clear([0, 0, 0, 1], 1);
    d.draw(pair());
    assert.deepStrictEqual(halves(d.present().pixels), clean,
      'an ordinary draw after a NaN one renders exactly as before');
  } finally { d.destroy(); assert.strictEqual(d.bytes, 0); }

  console.log('PASS test-d3d9-nan-vertex');
})().catch(error => { console.error(error); process.exit(1); });
