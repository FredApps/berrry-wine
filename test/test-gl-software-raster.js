#!/usr/bin/env node
'use strict';

// src/09a8g-gl-raster.wat -- the first thing that RASTERIZES a GL draw in WAT
// with no JS in the path. It transforms the 56-byte GL vertices of a packed
// draw record, projects them, and hands the triangle to the D3DIM rasterizer
// writing into a DxObject surface.
//
// WHAT THIS TEST IS FOR. Everything that can go wrong in this lowering
// produces a picture, not a crash, and most of the pictures are plausible:
//
//   - THE Y FLIP. GL's window origin is bottom-left; a DIB surface's is
//     top-left. Get it wrong and every scene still renders, upside down, and
//     a symmetric test model cannot tell. So the triangle below sits in ONE
//     CORNER of clip space and the assertion is about which corner of the
//     surface it lands in.
//   - THE MATRIX ORDER. mvp = projection * modelview, and the reverse is a
//     product that still projects geometry -- just the wrong geometry. The
//     modelview here carries a translation, which is what makes the two
//     orders differ; an identity modelview would pass either way and so
//     would be worse than no test at all.
//   - READING THE SELECTED STACK. The lowering wants the modelview and the
//     projection BY NAME. A build that reads "the current matrix" is correct
//     only while an app leaves GL_MODELVIEW selected, so this runs with
//     PROJECTION left selected, exactly as test-gl-dfx1-transform.js does.
//   - INHERITING D3D'S CULL DEFAULT. GL_CULL_FACE is off by default in GL;
//     D3D's default is D3DCULL_CCW, which 8b227b5c made this emulator honour.
//     A lowering that routed through $d3dim_draw_tl_triangle would silently
//     discard half of every model, so both windings are drawn below.
//   - PROJECTING THROUGH A NEGATIVE W. Near-plane clipping is not built yet.
//     Dividing by a negative w mirrors geometry about the origin and draws a
//     convincing wrong picture, so such triangles must be DROPPED and counted.
//
// Pixel colour is deliberately asserted only as zero / non-zero plus one
// equality against what the surface actually holds: the point of the test is
// the geometry, and the 32bpp store belongs to $viewport_fill_rect.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { CALL_INDEX } = require('../lib/gl-compat.js');

const MODELVIEW = 0x1700, PROJECTION = 0x1701;
const VERT_BYTES = 56, VERT_FLOATS = 14;
const VP = 64; // viewport is VP x VP, so a surface of the same size

async function main() {
  const { exports: e, memory } = await bootRenderHarness();
  const guestBase = e.get_guest_base() >>> 0, imageBase = e.get_image_base() >>> 0;
  const toWasm = guest => guestBase + (guest >>> 0) - imageBase;

  // --- somewhere to put three GL vertices -------------------------------
  const verts = toWasm(e.guest_alloc(VERT_BYTES * 3));
  const stack = toWasm(e.guest_alloc(64));

  // One 14-float GL vertex: x,y,z, r,g,b,a, s0,t0, nx,ny,nz, s1,t1
  // (src/09a8c-gl-encoder.wat:134, mirrored as VERTEX_FLOATS in
  // lib/gl-command-stream.js).
  const putVertex = (i, x, y, z, r, g, b, a) => {
    const f = new Float32Array(memory.buffer, verts + i * VERT_BYTES, VERT_FLOATS);
    f.fill(0);
    f[0] = x; f[1] = y; f[2] = z;
    f[3] = r; f[4] = g; f[5] = b; f[6] = a;
  };
  const triangle = (pts, colour) => {
    pts.forEach(([x, y, z], i) => putVertex(i, x, y, z, ...colour));
    e.gl_sw_emit_triangles(verts, 3);
  };

  // --- glViewport, through the observer the encoder really uses ---------
  const setViewport = (x, y, w, h) => {
    const words = new Int32Array(memory.buffer, stack, 16);
    words.fill(0);
    words.set([0, x, y, w, h], 0); // argument i lives at offset 4 + i*4
    e.gl_mtx_observe(CALL_INDEX.glViewport, stack);
  };
  setViewport(0, 0, VP, VP);

  // --- a GL state whose matrix order matters ----------------------------
  // The modelview translates +0.5 in x. Swap the product order and that
  // translation is applied in the wrong space, which moves the triangle.
  e.gl_mtx_set_mode(MODELVIEW);
  e.gl_mtx_load_identity();
  e.gl_mtx_translate(0.5, 0, 0);
  e.gl_mtx_set_mode(PROJECTION);
  e.gl_mtx_load_identity();
  e.gl_mtx_ortho(-1, 1, -1, 1, -1, 1);
  assert.strictEqual(e.gl_mtx_selected(), 1,
    'the test means to draw while PROJECTION is the selected stack');
  assert.strictEqual(e.gl_mtx_untrusted(), 0, 'mirror is trusted before the draw');

  // --- disabled is inert -------------------------------------------------
  assert.strictEqual(e.gl_sw_enabled(), 0, 'the path is off unless a host asks');
  triangle([[-0.4, 0.1, 0], [0.4, 0.1, 0], [0.4, 0.9, 0]], [1, 0, 0, 1]);
  assert.strictEqual(e.gl_sw_triangles(), 0, 'a disabled path rasterizes nothing');
  assert.strictEqual(e.gl_sw_entry(), 0, 'and allocates no surface');

  // --- one triangle in the TOP-RIGHT of clip space ----------------------
  // After the modelview's +0.5 the x range is 0.1..0.9 and y is 0.1..0.9, so
  // in GL's bottom-left-origin window this is the top-right corner.
  e.gl_sw_set_enabled(1);
  triangle([[-0.4, 0.1, 0], [0.4, 0.1, 0], [0.4, 0.9, 0]], [1, 0, 0, 1]);
  assert.strictEqual(e.gl_sw_triangles(), 1, 'one triangle rasterized');
  assert.strictEqual(e.gl_sw_clipped(), 0, 'nothing was in front of the eye plane');

  const entry = e.gl_sw_entry() >>> 0;
  assert.notStrictEqual(entry, 0, 'a render target was created');
  const u16 = o => new Uint16Array(memory.buffer.slice(entry + o, entry + o + 2))[0];
  const i32 = o => new Int32Array(memory.buffer.slice(entry + o, entry + o + 4))[0];
  const [w, h, bpp, pitch, dib] = [u16(12), u16(14), u16(16), u16(18), i32(20) >>> 0];
  assert.strictEqual(w, VP, 'surface width follows the viewport');
  assert.strictEqual(h, VP, 'surface height follows the viewport');
  assert.strictEqual(bpp, 32, 'surface is 32bpp');
  assert.strictEqual(i32(28), 1, 'flagged primary, so a --png capture finds it');

  const pixels = new Uint32Array(memory.buffer.slice(dib, dib + pitch * h));
  const at = (x, y) => pixels[(y * pitch) / 4 + x];
  const lit = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) lit.push([x, y]);

  assert.ok(lit.length > 150,
    `expected a few hundred lit pixels for a 0.8x0.8 clip-space triangle, got ${lit.length}`);

  // THE Y FLIP, and the half of clip space the triangle is in. y=0.1..0.9 in
  // GL is the TOP of the window, which is the LOW row indices of a top-down
  // DIB; x=0.1..0.9 is the right half, which is the high column indices.
  const maxY = Math.max(...lit.map(p => p[1])), minX = Math.min(...lit.map(p => p[0]));
  assert.ok(maxY < h / 2,
    `every lit pixel should be in the top half of the surface (y < ${h / 2});`
    + ` the lowest reached y=${maxY}. A y that runs the other way is the flip bug.`);
  assert.ok(minX >= w / 2 - 2,
    `every lit pixel should be in the right half (x >= ${w / 2 - 2});`
    + ` the leftmost was x=${minX}. A leftward triangle means the modelview`
    + ` translation went in on the wrong side of the product.`);
  assert.strictEqual(at(2, h - 3), 0, 'the opposite corner stays background');

  // The colour the rasterizer actually stored, pinned once so a later change
  // to the 32bpp store is visible here rather than only in a screenshot.
  const sample = at(...lit[Math.floor(lit.length / 2)]);
  // The 32bpp store keeps the D3DCOLOR's alpha byte, so opaque red is
  // 0xFFFF0000 in the surface, not 0x00FF0000.
  assert.strictEqual(sample >>> 0, 0xFFFF0000,
    `an opaque red vertex should store as 0xFFFF0000; got 0x${(sample >>> 0).toString(16)}`);

  // --- the opposite winding draws too ------------------------------------
  // Inheriting D3D's D3DCULL_CCW default would drop exactly one of these.
  const before = e.gl_sw_triangles();
  triangle([[-0.4, -0.9, 0], [0.4, -0.1, 0], [-0.4, -0.1, 0]], [0, 1, 0, 1]);
  assert.strictEqual(e.gl_sw_triangles(), before + 1,
    'a clockwise triangle draws too -- GL_CULL_FACE is off by default');
  let green = 0;
  const after = new Uint32Array(memory.buffer.slice(dib, dib + pitch * h));
  for (const v of after) if ((v >>> 0) === 0xFF00FF00) green++;
  assert.ok(green > 150, `the second winding painted ${green} pixels, expected hundreds`);

  // --- behind the eye is dropped, not mirrored ---------------------------
  // A frustum with near=1 puts z=0 geometry at w=0, which has no screen
  // position at all.
  e.gl_mtx_set_mode(PROJECTION);
  e.gl_mtx_load_identity();
  e.gl_mtx_frustum(-1, 1, -1, 1, 1, 100);
  const drawn = e.gl_sw_triangles();
  triangle([[-0.4, 0.1, 0], [0.4, 0.1, 0], [0.4, 0.9, 0]], [0, 0, 1, 1]);
  assert.strictEqual(e.gl_sw_triangles(), drawn,
    'a triangle at the eye plane must not be rasterized');
  assert.strictEqual(e.gl_sw_clipped(), 1, 'and must be counted as dropped');

  console.log('PASS test-gl-software-raster');
}

main().catch(err => { console.error(err); process.exit(1); });
