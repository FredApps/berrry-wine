#!/usr/bin/env node
'use strict';

// IDirect3DDevice7::Load(this, lpDestTex, lpDestPoint, lpSrcTex, lprcSrcRect,
// dwFlags) is six stdcall dwords. Our handler used to pop seven and copy
// nothing: Deus Ex's D3DDrv uploads every texture through it, and the extra
// dword left its SetTexture epilogue restoring a garbage EBX, so the next
// SetTexture got a NULL FTextureInfo and asserted "Pool". The whole-texture
// form must also copy every level of the mip chain, not only level 0.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_d7l_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))
  (func (export "test_d7l_create_surface") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_d7l_dib") (param $surface i32) (result i32)
    (i32.load offset=20 (call $dx_from_this (local.get $surface))))
  (func (export "test_d7l_next") (param $surface i32) (result i32)
    (load.field DxObject misc0 (call $dx_from_this (local.get $surface))))
  (func (export "test_d7l_set_esp") (param $v i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $v)))
  (func (export "test_d7l_get_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_d7l_load") (param $dst i32) (param $src i32)
    (call $handle_IDirect3DDevice7_Load
      (i32.const 0) (local.get $dst) (i32.const 0) (local.get $src) (i32.const 0)
      (i32.const 0)))
`;

function makeMipTexture(wat, desc, out, size) {
  for (let i = 0; i < 128; i += 4) wat.guest_write32(desc + i, 0);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 0x1007); // CAPS|HEIGHT|WIDTH|PIXELFORMAT
  wat.guest_write32(desc + 8, size);
  wat.guest_write32(desc + 12, size);
  wat.guest_write32(desc + 72, 32);
  wat.guest_write32(desc + 76, 0x40);  // DDPF_RGB
  wat.guest_write32(desc + 84, 16);
  wat.guest_write32(desc + 88, 0xf800);
  wat.guest_write32(desc + 92, 0x07e0);
  wat.guest_write32(desc + 96, 0x001f);
  wat.guest_write32(desc + 104, 0x401008); // TEXTURE|MIPMAP|COMPLEX
  assert.strictEqual(wat.test_d7l_create_surface(desc, out) >>> 0, 0);
  return wat.guest_read32(out) >>> 0;
}

const levels = (wat, top) => {
  const out = [];
  for (let s = top; s; s = wat.test_d7l_next(s) >>> 0) out.push(s);
  return out;
};

(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: wat, memory } = h;
  const mem = new DataView(memory.buffer);
  const desc = 0x410000;
  const out = 0x410100;
  const STACK = 0x00420000;

  wat.test_d7l_seed(0x51000000, 0x52000000);
  const src = makeMipTexture(wat, desc, out, 4);
  const dst = makeMipTexture(wat, desc, out + 4, 4);
  const srcLevels = levels(wat, src);
  const dstLevels = levels(wat, dst);
  assert.strictEqual(srcLevels.length, 3, '4x4 pyramid is 4x4, 2x2, 1x1');
  assert.strictEqual(dstLevels.length, 3);

  // A distinct 16-bit value per level in the source; the destination is zero.
  const sizes = [4, 2, 1];
  srcLevels.forEach((s, level) => {
    const dib = wat.test_d7l_dib(s) >>> 0;
    for (let i = 0; i < sizes[level] * sizes[level]; i++) {
      mem.setUint16(dib + i * 2, 0x1111 * (level + 1), true);
    }
  });

  for (let i = 0; i < 32; i += 4) wat.guest_write32(STACK + i, 0);
  wat.test_d7l_set_esp(STACK);
  wat.test_d7l_load(dst, src);
  assert.strictEqual((wat.test_d7l_get_esp() >>> 0) - STACK, 4 + 6 * 4,
    'Load pops its return address and six dwords (this included)');

  dstLevels.forEach((d, level) => {
    const dib = wat.test_d7l_dib(d) >>> 0;
    for (let i = 0; i < sizes[level] * sizes[level]; i++) {
      assert.strictEqual(mem.getUint16(dib + i * 2, true), 0x1111 * (level + 1),
        `level ${level} texel ${i} was copied`);
    }
  });

  console.log('PASS IDirect3DDevice7::Load: 28-byte stdcall pop, every mip level copied');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
