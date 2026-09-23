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
//   - PROJECTING THROUGH A NEGATIVE W. Dividing by a negative w mirrors
//     geometry about the origin and draws a convincing wrong picture. A
//     triangle wholly behind the near plane must be DROPPED and counted; one
//     straddling it must be CLIPPED and its visible part drawn.
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
  const putVertex = (i, x, y, z, r, g, b, a, s = 0, t = 0) => {
    const f = new Float32Array(memory.buffer, verts + i * VERT_BYTES, VERT_FLOATS);
    f.fill(0);
    f[0] = x; f[1] = y; f[2] = z;
    f[3] = r; f[4] = g; f[5] = b; f[6] = a;
    f[7] = s; f[8] = t;
  };
  const triangle = (pts, colour) => {
    pts.forEach(([x, y, z, s, t], i) => putVertex(i, x, y, z, ...colour, s, t));
    e.gl_sw_emit_triangles(verts, 3);
  };

  // One GL call through the state observer the encoder calls, arguments laid
  // out as the guest's stdcall frame: argument i at 4 + 4*i. A number that is
  // not an integer is written as a GLfloat.
  const glCall = (op, ...args) => {
    const words = new Int32Array(memory.buffer, stack, 16);
    const floats = new Float32Array(memory.buffer, stack, 16);
    words.fill(0);
    args.forEach((v, i) => {
      if (Number.isInteger(v)) words[1 + i] = v; else floats[1 + i] = v;
    });
    e.gl_sw_observe(op, stack);
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
  assert.strictEqual(i32(28), 4, 'draws land in the offscreen back buffer');
  const front = e.gl_sw_front() >>> 0;
  assert.notStrictEqual(front, 0, 'a front buffer was created with it');
  assert.strictEqual(new Int32Array(memory.buffer.slice(front + 28, front + 32))[0], 1,
    'the front is flagged primary, so a --png capture finds it');
  assert.ok(e.gl_sw_slot() >= 0, 'gl_sw_slot names a DX slot once a target exists');
  const frontDib = new Int32Array(memory.buffer.slice(front + 20, front + 24))[0] >>> 0;
  const frontPixels = () => new Uint32Array(memory.buffer.slice(frontDib, frontDib + pitch * h));
  assert.ok(frontPixels().every(v => v === 0), 'nothing is shown before SwapBuffers');

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
  // The first triangle is counter-clockwise in GL's window; this one runs up
  // the left edge first, so it is clockwise.
  const CW = [[-0.4, -0.9, 0], [-0.4, -0.1, 0], [0.4, -0.1, 0]];
  const before = e.gl_sw_triangles();
  triangle(CW, [0, 1, 0, 1]);
  assert.strictEqual(e.gl_sw_triangles(), before + 1,
    'a clockwise triangle draws too -- GL_CULL_FACE is off by default');
  let green = 0;
  const after = new Uint32Array(memory.buffer.slice(dib, dib + pitch * h));
  for (const v of after) if ((v >>> 0) === 0xFF00FF00) green++;
  assert.ok(green > 150, `the second winding painted ${green} pixels, expected hundreds`);

  // --- SwapBuffers is what makes the back buffer visible ------------------
  glCall(CALL_INDEX.gpuPresent);
  assert.strictEqual(e.gl_sw_presents(), 1, 'one present counted');
  assert.deepStrictEqual(Array.from(frontPixels()), Array.from(after),
    'SwapBuffers copies the back buffer to the front');

  // --- GL_CULL_FACE, with GL's defaults: cull BACK, front is CCW ----------
  const GL_CULL_FACE = 0x0B44, GL_TEXTURE_2D = 0x0DE1, GL_DEPTH_TEST = 0x0B71;
  glCall(CALL_INDEX.glEnable, GL_CULL_FACE);
  const beforeCull = e.gl_sw_triangles();
  triangle(CW, [0, 1, 0, 1]);
  assert.strictEqual(e.gl_sw_culled(), 1, 'a clockwise triangle is a back face and is culled');
  triangle([[-0.4, 0.1, 0], [0.4, 0.1, 0], [0.4, 0.9, 0]], [1, 0, 0, 1]);
  assert.strictEqual(e.gl_sw_triangles(), beforeCull + 1, 'a counter-clockwise one is drawn');
  // Cull state saved and restored by glPushAttrib(GL_POLYGON_BIT)/glPopAttrib.
  glCall(CALL_INDEX.glPushAttrib, 0x8);
  glCall(CALL_INDEX.glDisable, GL_CULL_FACE);
  glCall(CALL_INDEX.glPopAttrib);
  triangle(CW, [0, 1, 0, 1]);
  assert.strictEqual(e.gl_sw_culled(), 2, 'glPopAttrib(GL_POLYGON_BIT) restored GL_CULL_FACE');
  glCall(CALL_INDEX.glDisable, GL_CULL_FACE);

  // Everything below draws in the whole viewport, untranslated.
  e.gl_mtx_set_mode(MODELVIEW);
  e.gl_mtx_load_identity();
  e.gl_mtx_set_mode(PROJECTION);
  const back = () => new Uint32Array(memory.buffer.slice(dib, dib + pitch * h));
  const quad = (z, colour, st = true) => {
    triangle([[-1, -1, z, 0, 0.5], [1, -1, z, 1, 0.5], [1, 1, z, 1, 0.5]], colour);
    triangle([[-1, -1, z, 0, 0.5], [1, 1, z, 1, 0.5], [-1, 1, z, 0, 0.5]], colour);
  };

  // --- a texture uploaded through glTexImage2D, sampled NEAREST -----------
  // 2x1 RGB, blue then yellow, with UNPACK_ALIGNMENT 1 so the row is 6
  // bytes. GL_REPLACE puts the texel on screen unmodulated, and the opaque
  // internal format forces alpha to 0xFF.
  const texels = e.guest_alloc(8) >>> 0;
  new Uint8Array(memory.buffer, toWasm(texels), 6).set([0, 0, 255, 255, 255, 0]);
  glCall(CALL_INDEX.glClear, 0x4000);
  glCall(CALL_INDEX.glBindTexture, GL_TEXTURE_2D, 7);
  glCall(CALL_INDEX.glPixelStorei, 0x0CF5, 1);
  glCall(CALL_INDEX.glTexImage2D, GL_TEXTURE_2D, 0, 0x1907, 2, 1, 0, 0x1907, 0x1401, texels);
  assert.strictEqual(e.gl_sw_tex_uploads(), 1, 'the upload was accepted');
  glCall(CALL_INDEX.glTexParameteri, GL_TEXTURE_2D, 0x2800, 0x2600);  // MAG_FILTER NEAREST
  glCall(CALL_INDEX.glTexEnvi, 0x2300, 0x2200, 0x1E01);                // REPLACE
  glCall(CALL_INDEX.glEnable, GL_TEXTURE_2D);
  quad(0, [1, 1, 1, 1]);
  let px = back();
  const pick = (x, y) => px[(y * pitch) / 4 + x] >>> 0;
  assert.strictEqual(pick(VP / 4, VP / 2), 0xFF0000FF,
    `the left half samples texel 0 (blue); got 0x${pick(VP / 4, VP / 2).toString(16)}`);
  assert.strictEqual(pick(VP * 3 / 4, VP / 2), 0xFFFFFF00,
    `the right half samples texel 1 (yellow); got 0x${pick(VP * 3 / 4, VP / 2).toString(16)}`);
  // An unsupported type is refused and counted, not guessed at.
  glCall(CALL_INDEX.glTexImage2D, GL_TEXTURE_2D, 0, 0x1908, 2, 1, 0, 0x1908, 0x1406, texels);
  assert.strictEqual(e.gl_sw_tex_unsupported(), 1, 'a GL_FLOAT upload is counted as unsupported');
  glCall(CALL_INDEX.glDisable, GL_TEXTURE_2D);

  // --- the depth test ------------------------------------------------------
  // ortho(-1,1,-1,1,-1,1) maps eye z=+0.5 to window depth 0.25 and z=-0.5
  // to 0.75, so the green quad is nearer and the later red one must lose.
  glCall(CALL_INDEX.glEnable, GL_DEPTH_TEST);
  glCall(CALL_INDEX.glClear, 0x4100);
  quad(0.5, [0, 1, 0, 1]);
  quad(-0.5, [1, 0, 0, 1]);
  px = back();
  assert.strictEqual(pick(VP / 2, VP / 2), 0xFF00FF00,
    `the nearer green quad survives the farther red one; got 0x${pick(VP / 2, VP / 2).toString(16)}`);
  glCall(CALL_INDEX.glDisable, GL_DEPTH_TEST);
  quad(-0.5, [1, 0, 0, 1]);
  px = back();
  assert.strictEqual(pick(VP / 2, VP / 2), 0xFFFF0000, 'with GL_DEPTH_TEST off the later quad wins');

  // --- the alpha test --------------------------------------------------------
  // glAlphaFunc(GL_GREATER, 0.5): a quad with vertex alpha 0.25 is rejected
  // whole, and one with alpha 0.75 is not. Written against a raw-value
  // i32.and that once made this test impossible to switch on.
  glCall(CALL_INDEX.glEnable, 0x0BC0);
  glCall(CALL_INDEX.glAlphaFunc, 0x204, 0.5);
  quad(0, [0, 0, 1, 0.25]);
  px = back();
  assert.strictEqual(pick(VP / 2, VP / 2), 0xFFFF0000, 'alpha 0.25 fails GL_GREATER 0.5');
  quad(0, [0, 0, 1, 0.75]);
  px = back();
  assert.strictEqual(pick(VP / 2, VP / 2) & 0xFFFFFF, 0x0000FF, 'alpha 0.75 passes it');
  glCall(CALL_INDEX.glDisable, 0x0BC0);

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

  // --- a triangle straddling the near plane is clipped, not dropped --------
  // A floor running from eye z=-0.5 (in front of the eye, short of near=1)
  // out to z=-10: the visible part covers the bottom-centre of the view,
  // from the bottom edge (y=-1 at the near plane) up to ndc y=-0.1. Before
  // near clipping this whole triangle was dropped -- Half-Life's corridor
  // floor lost a wedge at every step.
  glCall(CALL_INDEX.glDisable, 0x0B44);
  const beforeStraddle = e.gl_sw_triangles();
  triangle([[-5, -1, -0.5], [5, -1, -0.5], [0, -1, -10]], [0, 1, 0, 1]);
  assert.ok(e.gl_sw_triangles() > beforeStraddle, 'the visible part of a straddling triangle is drawn');
  assert.strictEqual(e.gl_sw_clipped(), 1, 'and nothing more is counted as dropped');
  px = back();
  // ndc y=-0.5 is GL row VP/4, surface row 3*VP/4.
  assert.strictEqual(pick(VP / 2, VP * 3 / 4) & 0xFFFFFF, 0x00FF00,
    `the floor shows below the horizon; got 0x${pick(VP / 2, VP * 3 / 4).toString(16)}`);

  console.log('PASS test-gl-software-raster');
}

main().catch(err => { console.error(err); process.exit(1); });
