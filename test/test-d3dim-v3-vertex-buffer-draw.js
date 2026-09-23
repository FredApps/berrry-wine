#!/usr/bin/env node

'use strict';

// IDirect3DDevice3::DrawPrimitiveVB and ::DrawIndexedPrimitiveVB must draw.
//
// Both were silent-success stubs: they stored S_OK, popped the right number of
// bytes, and rasterized nothing. That shape is invisible to every check we
// have except a picture -- the guest sees a healthy HRESULT, no API is
// unimplemented, no trap fires, and the stack stays balanced -- so the only
// symptom is geometry that never appears.
//
// Diablo II is the app that shows it. Its Direct3D backend batches floor tiles
// through d2direct3d+0x6457 (vtable slot 35, a TRIANGLELIST of 150 indices
// over a vertex buffer it Locks) while sprites and the HUD go through
// DrawPrimitive, which was implemented. So units, text and interface drew
// normally and the ground stayed black -- which reads convincingly as a
// texture or palette bug rather than as a draw call that was thrown away.
//
// An earlier fix (fb397db1) corrected only the *pop arity* of the indexed
// entry: the v3 signature is (primType, lpVB, lpwIndices, dwIndexCount,
// dwFlags), six dwords with `this`, and it had been given the v7 count of
// eight. That stopped the crash and left the empty body behind, so this test
// asserts both halves -- the frame size AND that pixels changed.
//
// The v3 form has no dwStartVertex/dwNumVertices, so the whole buffer is in
// play; the core clamps the vertex count down to the buffer's real capacity.
// Passing a count that needs clamping is therefore part of the contract, and
// the indexed case here relies on it.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_v3vb_seed")
      (param $ddraw_vtbl i32) (param $surface_vtbl i32)
      (param $device_vtbl i32) (param $vb_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl))
    (global.set $DX_VTBL_D3DDEV3 (local.get $device_vtbl))
    (global.set $DX_VTBL_D3DVB (local.get $vb_vtbl)))

  (func (export "test_v3vb_create_surface") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_v3vb_create_device") (param $surface i32) (param $out i32) (result i32)
    (call $d3dim_create_device
      (i32.const 0) (local.get $surface) (local.get $out) (global.get $DX_VTBL_D3DDEV3))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_v3vb_viewport") (param $device i32) (param $desc i32) (result i32)
    (local $vp i32)
    (local.set $vp (call $dx_create_com_obj (i32.const 23) (i32.const 0x54000000)))
    (i32.store offset=8 (call $dx_from_this (local.get $vp)) (local.get $device))
    (call $d3dim_set_current_viewport (local.get $device) (local.get $vp))
    (call $d3dim_viewport_set (local.get $vp) (local.get $desc))
    (local.get $vp))

  ;; IDirect3D3::CreateVertexBuffer(lpVBDesc, lplpVB, dwFlags, pUnkOuter).
  (func (export "test_v3vb_create") (param $desc i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3D3_CreateVertexBuffer
      (i32.const 0) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; IDirect3DVertexBuffer::Lock(dwFlags, lplpData, lpdwSize).
  (func (export "test_v3vb_lock") (param $vb i32) (param $ppData i32) (param $pSize i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DVertexBuffer_Lock
      (local.get $vb) (i32.const 0x21) (local.get $ppData) (local.get $pSize)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; Both v3 VB draws take five arguments plus this, so the sixth dword --
  ;; dwFlags -- lives at esp+24 and the handler must leave esp 28 higher.
  ;; Returning the new esp is what lets the caller check that arity, which is
  ;; the half of this bug that was already fixed once.
  (func (export "test_v3vb_draw_indexed")
      (param $device i32) (param $primType i32) (param $vb i32)
      (param $indices i32) (param $index_count i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $gs32 (i32.const 0x30018) (i32.const 0))
    (call $handle_IDirect3DDevice3_DrawIndexedPrimitiveVB
      (local.get $device) (local.get $primType) (local.get $vb)
      (local.get $indices) (local.get $index_count) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_v3vb_draw")
      (param $device i32) (param $primType i32) (param $vb i32)
      (param $start i32) (param $count i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $gs32 (i32.const 0x30018) (i32.const 0))
    (call $handle_IDirect3DDevice3_DrawPrimitiveVB
      (local.get $device) (local.get $primType) (local.get $vb)
      (local.get $start) (local.get $count) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_v3vb_dib") (param $surface i32) (result i32)
    (i32.load offset=20 (call $dx_from_this (local.get $surface))))
`;

const RT = 32;                 // render target edge, in pixels
const FVF_TLVERTEX = 0x1c4;    // XYZRHW | DIFFUSE | SPECULAR | TEX1
const VB_VERTICES = 4;
const TL_STRIDE = 32;

function makeSurface(wat, desc, out, width, height) {
  for (let i = 0; i < 128; i += 4) wat.guest_write32(desc + i, 0);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 0x1007); // CAPS|HEIGHT|WIDTH|PIXELFORMAT
  wat.guest_write32(desc + 8, height);
  wat.guest_write32(desc + 12, width);
  wat.guest_write32(desc + 72, 32);
  wat.guest_write32(desc + 76, 0x40);  // DDPF_RGB
  wat.guest_write32(desc + 84, 16);    // bpp
  wat.guest_write32(desc + 88, 0xf800);
  wat.guest_write32(desc + 92, 0x07e0);
  wat.guest_write32(desc + 96, 0x001f);
  wat.guest_write32(desc + 104, 0x40);
  assert.strictEqual(wat.test_v3vb_create_surface(desc, out) >>> 0, 0);
  return wat.guest_read32(out) >>> 0;
}

function writeFloat(wat, addr, value) {
  const bits = new ArrayBuffer(4);
  new DataView(bits).setFloat32(0, value, true);
  wat.guest_write32(addr, new DataView(bits).getUint32(0, true));
}

(async () => {
  const h = await bootRenderHarness({ extraWat, width: 640, height: 480 });
  const { exports: wat, memory } = h;
  const mem = new DataView(memory.buffer);

  const desc = 0x410000;
  const out = 0x410100;
  const devOut = 0x410110;
  const vbOut = 0x410120;
  const dataOut = 0x410130;
  const sizeOut = 0x410140;
  const vpDesc = 0x410200;
  const vbDesc = 0x410300;
  const indices = 0x411000;

  wat.test_v3vb_seed(0x51000000, 0x52000000, 0x53000000, 0x55000000);

  const rt = makeSurface(wat, desc, out, RT, RT);
  assert(rt, 'render target was not created');
  assert.strictEqual(wat.test_v3vb_create_device(rt, devOut) >>> 0, 0);
  const device = wat.guest_read32(devOut) >>> 0;
  assert(device, 'device was not created');
  const rtDib = wat.test_v3vb_dib(rt) >>> 0;

  wat.guest_write32(vpDesc, 44); // sizeof(D3DVIEWPORT)
  wat.guest_write32(vpDesc + 4, 0);
  wat.guest_write32(vpDesc + 8, 0);
  wat.guest_write32(vpDesc + 12, RT);
  wat.guest_write32(vpDesc + 16, RT);
  writeFloat(wat, vpDesc + 20, RT / 2);
  writeFloat(wat, vpDesc + 24, RT / 2);
  assert(wat.test_v3vb_viewport(device, vpDesc), 'viewport was not created');

  // D3DVERTEXBUFFERDESC: dwSize, dwCaps, dwFVF, dwNumVertices.
  wat.guest_write32(vbDesc, 16);
  wat.guest_write32(vbDesc + 4, 0);
  wat.guest_write32(vbDesc + 8, FVF_TLVERTEX);
  wat.guest_write32(vbDesc + 12, VB_VERTICES);
  assert.strictEqual(wat.test_v3vb_create(vbDesc, vbOut) >>> 0, 0);
  const vb = wat.guest_read32(vbOut) >>> 0;
  assert(vb, 'vertex buffer was not created');

  assert.strictEqual(wat.test_v3vb_lock(vb, dataOut, sizeOut) >>> 0, 0);
  const vbData = wat.guest_read32(dataOut) >>> 0;
  const vbSize = wat.guest_read32(sizeOut) >>> 0;
  assert(vbData, 'Lock returned no buffer pointer');
  assert.strictEqual(vbSize, VB_VERTICES * TL_STRIDE,
    'buffer size does not match FVF stride x vertex count');

  // Four transformed-and-lit vertices spanning the target, written straight
  // into the locked buffer the way the guest does. rhw must be 1: it is 1/w,
  // and a zero there projects every vertex to the same nonsense coordinate.
  const tlvertex = (i, x, y, color) => {
    const p = vbData + i * TL_STRIDE;
    writeFloat(wat, p + 0, x);
    writeFloat(wat, p + 4, y);
    writeFloat(wat, p + 8, 0.5);
    writeFloat(wat, p + 12, 1.0);
    wat.guest_write32(p + 16, color);
    wat.guest_write32(p + 20, 0);
    writeFloat(wat, p + 24, 0);
    writeFloat(wat, p + 28, 0);
  };
  tlvertex(0, 1, 1, 0xffff0000);
  tlvertex(1, RT - 1, 1, 0xff00ff00);
  tlvertex(2, RT - 1, RT - 1, 0xff0000ff);
  tlvertex(3, 1, RT - 1, 0xffffffff);

  const countDrawn = () => {
    let n = 0;
    for (let i = 0; i < RT * RT; i++) if (mem.getUint16(rtDib + i * 2, true)) n++;
    return n;
  };
  const clearRt = () => {
    for (let i = 0; i < RT * RT; i++) mem.setUint16(rtDib + i * 2, 0, true);
  };

  clearRt();
  assert.strictEqual(countDrawn(), 0, 'render target did not start blank');

  // Indexed: two triangles over the four vertices. dwIndexCount is the fifth
  // argument, and the vertex count is implied -- the core clamps its way to
  // the buffer's capacity from the deliberately over-large value the v3 path
  // hands it.
  // D3D index lists are 16-bit, so pack each pair into one guest dword.
  const indexList = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < indexList.length; i += 2) {
    wat.guest_write32(indices + (i / 2) * 4,
      (indexList[i] & 0xffff) | ((indexList[i + 1] & 0xffff) << 16));
  }

  const espAfterIndexed = wat.test_v3vb_draw_indexed(device, 4, vb, indices, 6) >>> 0;
  assert.strictEqual(espAfterIndexed - 0x30000, 28,
    'DrawIndexedPrimitiveVB popped the wrong frame: the v3 form is 28, not the v7 36');
  const indexedPixels = countDrawn();
  assert(indexedPixels > 0,
    'DrawIndexedPrimitiveVB drew nothing -- the silent-success stub is back');

  clearRt();
  const espAfterDraw = wat.test_v3vb_draw(device, 4, vb, 0, 3) >>> 0;
  assert.strictEqual(espAfterDraw - 0x30000, 28,
    'DrawPrimitiveVB popped the wrong frame');
  assert(countDrawn() > 0,
    'DrawPrimitiveVB drew nothing -- the silent-success stub is back');

  console.log(`PASS  v3 vertex-buffer draws rasterize (${indexedPixels} px indexed)`);
})();
