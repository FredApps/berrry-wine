#!/usr/bin/env node
'use strict';

// A GL backend that refuses a non-default depth range must not silently lose
// it. @node-3d/webgl (the --headless-gl backend) rejects even a valid
// glDepthRange(0,0.5) with GL_INVALID_OPERATION and leaves the range at [0,1].
//
// That is fatal to GoldSrc's gl_ztrick, which NEVER clears the depth buffer and
// instead alternates glDepthFunc(LEQUAL)+glDepthRange(0,0.5) with
// GEQUAL+glDepthRange(1,0.5), so every frame's depth values beat the previous
// frame's by construction. Drop the range and both phases write the full 0..1
// range and fight each other's leftovers -- so BOTH render partially. That is
// the tell: a missing depth CLEAR would break only the GEQUAL phase and give
// alternating good/bad frames, while a dropped depth RANGE gives a stable
// half-drawn scene. Half-Life Uplink rendered a few near-plane polygons over
// black for exactly this reason (docs/re-notes/half-life-uplink.md).
//
// The fix folds the range into clip space, since it is just an affine map on z:
//   d = ((f-n)/2)*z_ndc + (n+f)/2   is reproduced against a fixed [0,1] driver
//   range by pre-transforming  z' = (f-n)*z + (n+f-1)*w.
// This test pins that arithmetic, and pins that a backend which DOES honour
// depthRange is left on the original path.

const assert = require('assert');
const { FixedFunctionGL, constants: GL } = require('../lib/gl-compat');

function makeBackend({ honoursDepthRange }) {
  let range = [0, 1];
  const backend = {
    gl: {
      ARRAY_BUFFER: 0x8892, STREAM_DRAW: 0x88E0, FLOAT: 0x1406,
      TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
      NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR: 0x2601, REPEAT: 0x2901,
      TRIANGLES: 4, NO_ERROR: 0, DEPTH_RANGE: 0x0B70,
      depthRange(n, f) { if (honoursDepthRange) range = [n, f]; },
      getParameter() { return range; },
      getError() { return 0; },
    },
    uniforms: new Map(), depthRanges: [],
    createProgram() { return { attributes: { aPosition: 0 }, uniforms: {} }; },
    createBuffer() { return {}; },
    updateBuffer() {}, useProgram() {}, bindTexture() {}, draw() {},
    createTexture() { return {}; }, setTextureParameter() {},
    setCapability() {}, setPolygonOffset() {}, destroy() {},
    setUniform(_p, name, _kind, value) { this.uniforms.set(name, value); },
    setDepthRange(n, f) { this.depthRanges.push([n, f]); },
  };
  return backend;
}

// Force one draw so _applyUniforms runs and publishes uProjection.
function drawOnce(gl) {
  gl.enqueuePacked(4, new Float32Array(14 * 3));
  gl.flushPendingDraw();
}

// --- backend that ignores depthRange: the range must be folded in ------------
{
  const backend = makeBackend({ honoursDepthRange: false });
  const gl = new FixedFunctionGL(backend);
  assert.strictEqual(gl.depthRangeEmulated, true,
    'a backend that ignores glDepthRange must be detected by the probe');

  for (const [near, far] of [[0, 0.5], [1, 0.5]]) {
    gl.setDepthRange(near, far);
    drawOnce(gl);
    const projection = backend.uniforms.get('uProjection');
    assert(projection, 'uProjection must be published');

    // Projection is identity here, so the folded row 2 IS the transform.
    const scale = far - near, bias = near + far - 1;
    assert(Math.abs(projection[10] - scale) < 1e-6,
      `z scale for [${near},${far}] expected ${scale}, got ${projection[10]}`);
    assert(Math.abs(projection[14] - bias) < 1e-6,
      `z bias for [${near},${far}] expected ${bias}, got ${projection[14]}`);

    // And the window depth must match real GL's mapping at every depth.
    for (const z of [-1, -0.5, 0, 0.5, 1]) {
      const folded = projection[10] * z + projection[14];
      const emulated = 0.5 * folded + 0.5;          // driver stuck at [0,1]
      const reference = ((far - near) / 2) * z + (near + far) / 2;
      assert(Math.abs(emulated - reference) < 1e-6,
        `window depth at z=${z} for [${near},${far}]:`
        + ` folded ${emulated} != real GL ${reference}`);
      // Nothing may fall outside the clip volume that would not have already.
      assert(folded >= -1 - 1e-6 && folded <= 1 + 1e-6,
        `folded clip z ${folded} escaped [-1,1] for [${near},${far}]`);
    }
  }

  assert.strictEqual(backend.depthRanges.length, 0,
    'an ignoring backend must not be asked for a depth range it cannot set');
}

// --- backend that honours depthRange: leave the original path alone ----------
{
  const backend = makeBackend({ honoursDepthRange: true });
  const gl = new FixedFunctionGL(backend);
  assert.strictEqual(gl.depthRangeEmulated, false,
    'a backend that honours glDepthRange must not be emulated');

  gl.setDepthRange(0, 0.5);
  drawOnce(gl);
  assert.deepStrictEqual(backend.depthRanges[backend.depthRanges.length - 1], [0, 0.5],
    'an honouring backend must receive the range directly');
  const projection = backend.uniforms.get('uProjection');
  assert(Math.abs(projection[10] - 1) < 1e-6 && Math.abs(projection[14] - 0) < 1e-6,
    'projection must be untouched when the driver applies the range itself');

  // Reversed ranges stay on the existing negate-and-sort path.
  gl.setDepthRange(1, 0.5);
  drawOnce(gl);
  assert.deepStrictEqual(backend.depthRanges[backend.depthRanges.length - 1], [0.5, 1],
    'a reversed range must be submitted sorted');
  const reversed = backend.uniforms.get('uProjection');
  assert(Math.abs(reversed[10] + 1) < 1e-6,
    'the reversed path must negate clip z');
}

console.log('opengl depth-range fold: OK');
