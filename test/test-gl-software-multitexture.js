#!/usr/bin/env node
'use strict';

// src/09a8g-gl-raster.wat -- ARB_multitexture unit 1 on the software GL path.
//
// The frontend advertises ARB_multitexture (Warcraft III's menu text needs
// it), and the WebGL backend combines unit 1 after unit 0 with MODULATE or
// REPLACE. The software path tracked unit 1's binding and otherwise dropped
// it, so a lightmapped surface drew fullbright. Unit 1 now samples at its own
// coordinates (vertex +48, perspective-divided per pixel) and combines after
// unit 0, before fog.
//
// A quad over the whole view: unit 0 is one pink texel, unit 1 is white|blue
// with s running 0..1 left to right, so the left half samples white and the
// right half blue.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { CALL_INDEX } = require('../lib/gl-compat.js');

const MODELVIEW = 0x1700, PROJECTION = 0x1701;
const VERT_BYTES = 56, VERT_FLOATS = 14;
const VP = 32;
const GL_TEXTURE_2D = 0x0DE1, TEXTURE0 = 0x84C0, TEXTURE1 = 0x84C1;
const PINK = 0xFFFF8080, DARK_BLUE = 0xFF000080, BLUE = 0xFF0000FF;

async function main() {
  const { exports: e, memory } = await bootRenderHarness();
  const guestBase = e.get_guest_base() >>> 0, imageBase = e.get_image_base() >>> 0;
  const toWasm = guest => guestBase + (guest >>> 0) - imageBase;
  const verts = toWasm(e.guest_alloc(VERT_BYTES * 3));
  const stack = toWasm(e.guest_alloc(64));

  const glCall = (op, ...args) => {
    const words = new Int32Array(memory.buffer, stack, 16);
    words.fill(0);
    args.forEach((v, i) => { words[1 + i] = v; });
    e.gl_sw_observe(op, stack);
  };

  const words = new Int32Array(memory.buffer, stack, 16);
  words.fill(0);
  words.set([0, 0, 0, VP, VP], 0);
  e.gl_mtx_observe(CALL_INDEX.glViewport, stack);
  e.gl_mtx_set_mode(MODELVIEW);
  e.gl_mtx_load_identity();
  e.gl_mtx_set_mode(PROJECTION);
  e.gl_mtx_load_identity();
  e.gl_mtx_ortho(-1, 1, -1, 1, -1, 1);
  e.gl_sw_set_enabled(1);

  const quad = () => {
    const tri = pts => {
      pts.forEach(([x, y], i) => {
        const f = new Float32Array(memory.buffer, verts + i * VERT_BYTES, VERT_FLOATS);
        f.fill(0);
        // position, white colour, unit 0 st, normal, unit 1 st
        f.set([x, y, 0, 1, 1, 1, 1, 0.5, 0.5, 0, 0, 1, (x + 1) / 2, 0.5]);
      });
      e.gl_sw_emit_triangles(verts, 3);
    };
    tri([[-1, -1], [1, -1], [1, 1]]);
    tri([[-1, -1], [1, 1], [-1, 1]]);
  };

  const texture = (name, rgb, width) => {
    const texels = e.guest_alloc(16) >>> 0;
    new Uint8Array(memory.buffer, toWasm(texels), rgb.length).set(rgb);
    glCall(CALL_INDEX.glBindTexture, GL_TEXTURE_2D, name);
    glCall(CALL_INDEX.glPixelStorei, 0x0CF5, 1);
    glCall(CALL_INDEX.glTexImage2D, GL_TEXTURE_2D, 0, 0x1907, width, 1, 0, 0x1907, 0x1401, texels);
    glCall(CALL_INDEX.glTexParameteri, GL_TEXTURE_2D, 0x2800, 0x2600);  // MAG_FILTER NEAREST
    glCall(CALL_INDEX.glTexParameteri, GL_TEXTURE_2D, 0x2801, 0x2600);  // MIN_FILTER NEAREST
  };

  // Unit 0: pink, MODULATE (the default) by white vertices.
  texture(3, [255, 128, 128], 1);
  glCall(CALL_INDEX.glEnable, GL_TEXTURE_2D);
  // Unit 1: white | blue, left disabled for now.
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE1);
  texture(4, [255, 255, 255, 0, 0, 255], 2);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE0);

  const pixel = x => {
    const entry = e.gl_sw_entry() >>> 0;
    const u16 = o => new Uint16Array(memory.buffer.slice(entry + o, entry + o + 2))[0];
    const dib = new Int32Array(memory.buffer.slice(entry + 20, entry + 24))[0] >>> 0;
    return new Uint32Array(memory.buffer.slice(dib, dib + u16(18) * u16(14)))[
      (VP / 2) * (u16(18) / 4) + x] >>> 0;
  };
  const hex = v => `0x${v.toString(16)}`;
  const LEFT = VP / 4, RIGHT = (3 * VP) / 4;
  const expect = (left, right, what) => {
    quad();
    assert.strictEqual(pixel(LEFT), left, `${what}: left half ${hex(pixel(LEFT))}`);
    assert.strictEqual(pixel(RIGHT), right, `${what}: right half ${hex(pixel(RIGHT))}`);
  };

  expect(PINK, PINK, 'unit 1 disabled');

  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE1);
  glCall(CALL_INDEX.glEnable, GL_TEXTURE_2D);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE0);
  expect(PINK, DARK_BLUE, 'unit 1 MODULATE (white keeps unit 0, blue darkens it)');

  // REPLACE on unit 1 takes its texel whole. Unit 0's env must not change.
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE1);
  glCall(CALL_INDEX.glTexEnvi, 0x2300, 0x2200, 0x1E01);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE0);
  expect(0xFFFFFFFF, BLUE, 'unit 1 REPLACE');

  // glPushAttrib(GL_ENABLE_BIT) saves unit 1's enable; the pop restores it.
  glCall(CALL_INDEX.glPushAttrib, 0x2000);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE1);
  glCall(CALL_INDEX.glDisable, GL_TEXTURE_2D);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE0);
  expect(PINK, PINK, 'unit 1 disabled inside the push');
  glCall(CALL_INDEX.glPopAttrib);
  expect(0xFFFFFFFF, BLUE, 'glPopAttrib restores unit 1');

  // Disabling unit 1 does not disable unit 0.
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE1);
  glCall(CALL_INDEX.glDisable, GL_TEXTURE_2D);
  glCall(CALL_INDEX.glActiveTextureARB, TEXTURE0);
  expect(PINK, PINK, 'unit 1 off again, unit 0 still textured');

  console.log('PASS software GL texture unit 1: MODULATE, REPLACE, push/pop, independent of unit 0');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
