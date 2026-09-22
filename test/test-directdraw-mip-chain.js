#!/usr/bin/env node
'use strict';

// A mipmapped DirectDraw texture is a chain, not one surface: level N answers
// GetAttachedSurface(DDSCAPS_TEXTURE|DDSCAPS_MIPMAP) with level N+1, and that
// is how a renderer walks down to upload each level. Half-Life's hw.dll does
// exactly that and ignores the HRESULT -- on real hardware the chain always
// exists -- so a missing attachment is not an error it reports. It is a NULL it
// then calls Lock through, which killed the guest a long way from the
// CreateSurface that never built the levels.
//
// This pins the chain: the levels exist, each halves and bottoms out at 1x1,
// each has its own backing bits, and the request the renderer actually makes is
// the one that finds them.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const DDSD_CAPS = 0x0001;
const DDSD_HEIGHT = 0x0002;
const DDSD_WIDTH = 0x0004;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x00020000;
const DDSCAPS_TEXTURE = 0x00001000;
const DDSCAPS_MIPMAP = 0x00400000;
const DDSCAPS_COMPLEX = 0x00000008;
// What hw.dll asks for when it walks down a level.
const WALK_CAPS = DDSCAPS_TEXTURE | DDSCAPS_MIPMAP;

const extraWat = String.raw`
  (func (export "mip_seed") (param $base i32) (param $extended i32)
    (global.set $DX_VTBL_DDRAW (local.get $base))
    ;; A created surface must have a non-NULL interface vtable as in the
    ;; initialized runtime, even though this test calls handlers directly.
    (global.set $DX_VTBL_DDSURF2 (local.get $extended))
    (global.set $DX_VTBL_DDRAW2 (local.get $extended)))

  (func (export "mip_create_ddraw") (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_DirectDrawCreate
      (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "mip_create_surface")
      (param $ddraw i32) (param $ddsd i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $ddsd) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; GetAttachedSurface(this, lpDDSCaps, lplpDDAttachedSurface) -- the caps
  ;; structure is passed by pointer, which is the shape hw.dll uses.
  (func (export "mip_get_attached")
      (param $surface i32) (param $caps i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_GetAttachedSurface
      (local.get $surface) (local.get $caps) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "mip_surface_dims") (param $surface i32) (param $out i32)
    (local $entry i32) (local $wa i32)
    (local.set $entry (call $dx_from_this (local.get $surface)))
    (local.set $wa (call $g2w (local.get $out)))
    (i32.store (local.get $wa) (load.field DxObject width (local.get $entry)))
    (i32.store offset=4 (local.get $wa) (load.field DxObject height (local.get $entry)))
    (i32.store offset=8 (local.get $wa) (load.field DxObject misc1 (local.get $entry)))
    (i32.store offset=12 (local.get $wa) (load.field DxObject misc0 (local.get $entry)))
    (i32.store offset=16 (local.get $wa)
      (i32.load (call $dx_surf_meta_ptr (local.get $entry)))))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });

  const baseVtable = 0x00510000;
  const extendedVtable = 0x00510100;
  for (let i = 0; i < 24; i++) wat.guest_write32(extendedVtable + i * 4, 0x600000 + i);
  wat.mip_seed(baseVtable, extendedVtable);

  const out = 0x00410000;
  assert.strictEqual(wat.mip_create_ddraw(out) >>> 0, 0, 'DirectDrawCreate succeeds');
  const ddraw = wat.guest_read32(out) >>> 0;
  assert(ddraw, 'DirectDrawCreate published an interface pointer');

  // A 64x64 mipmapped texture, the way a renderer asks for one.
  // DDSURFACEDESC, the v1 shape IDirectDraw::CreateSurface reads: 108 bytes
  // with ddsCaps at +104 (DDSURFACEDESC2 puts it at +108, which this entry
  // point would read as the word past the end).
  const ddsd = 0x00411000;
  for (let i = 0; i < 108; i += 4) wat.guest_write32(ddsd + i, 0);
  wat.guest_write32(ddsd, 108);
  wat.guest_write32(ddsd + 4,
    DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_MIPMAPCOUNT);
  wat.guest_write32(ddsd + 8, 64);   // dwHeight
  wat.guest_write32(ddsd + 12, 64);  // dwWidth
  wat.guest_write32(ddsd + 24, 7);   // dwMipMapCount: 64,32,16,8,4,2,1
  wat.guest_write32(ddsd + 104, DDSCAPS_TEXTURE | DDSCAPS_MIPMAP | DDSCAPS_COMPLEX);
  // DDPIXELFORMAT at +72: dwSize, dwFlags=DDPF_RGB, ..., dwRGBBitCount=16
  wat.guest_write32(ddsd + 72, 32);
  wat.guest_write32(ddsd + 76, 0x40);
  wat.guest_write32(ddsd + 84, 16);

  assert.strictEqual(wat.mip_create_surface(ddraw, ddsd, out) >>> 0, 0,
    'CreateSurface succeeds for a mipmapped texture');
  const level0 = wat.guest_read32(out) >>> 0;
  assert(level0, 'CreateSurface published a surface pointer');

  const caps = 0x00411200;
  wat.guest_write32(caps, WALK_CAPS);
  wat.guest_write32(caps + 4, 0);
  wat.guest_write32(caps + 8, 0);
  wat.guest_write32(caps + 12, 0);

  const dims = 0x00411300;
  const readDims = (surface) => {
    wat.mip_surface_dims(surface, dims);
    return {
      w: wat.guest_read32(dims) >>> 0,
      h: wat.guest_read32(dims + 4) >>> 0,
      dib: wat.guest_read32(dims + 8) >>> 0,
      chain: wat.guest_read32(dims + 12) >>> 0,
      caps: wat.guest_read32(dims + 16) >>> 0,
    };
  };

  const top = readDims(level0);
  assert(top.chain,
    `level 0 links the rest of the pyramid (caps 0x${top.caps.toString(16)})`);
  assert.strictEqual(top.w, 64, 'level 0 is the size that was asked for');
  assert.strictEqual(top.h, 64, 'level 0 height');

  const seen = [top];
  let current = level0;
  for (let level = 1; level <= 6; level++) {
    wat.guest_write32(out, 0xdeadbeef);
    const hr = wat.mip_get_attached(current, caps, out) >>> 0;
    assert.strictEqual(hr, 0, `level ${level} is attached to level ${level - 1}`);
    const next = wat.guest_read32(out) >>> 0;
    assert(next && next !== 0xdeadbeef,
      `level ${level} published a surface pointer, not the NULL that was Locked through`);
    const d = readDims(next);
    assert.strictEqual(d.w, Math.max(1, 64 >> level), `level ${level} width halves`);
    assert.strictEqual(d.h, Math.max(1, 64 >> level), `level ${level} height halves`);
    assert(d.dib, `level ${level} has its own backing bits`);
    for (const earlier of seen) {
      assert.notStrictEqual(d.dib, earlier.dib,
        `level ${level} does not alias an earlier level's bits`);
    }
    seen.push(d);
    current = next;
  }

  // The chain bottoms out: 1x1 has nothing below it, and saying so is not the
  // same as the NULL-with-S_OK that started this.
  wat.guest_write32(out, 0xdeadbeef);
  const tailHr = wat.mip_get_attached(current, caps, out) >>> 0;
  assert.notStrictEqual(tailHr, 0, 'the 1x1 level reports no attached surface');
  assert.strictEqual(wat.guest_read32(out) >>> 0, 0,
    'a failed GetAttachedSurface zeroes the out pointer');

  // A surface with no mipmap caps gets no chain, so the levels are not a cost
  // every texture pays.
  wat.guest_write32(ddsd + 4, DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT);
  wat.guest_write32(ddsd + 104, DDSCAPS_TEXTURE);
  assert.strictEqual(wat.mip_create_surface(ddraw, ddsd, out) >>> 0, 0,
    'CreateSurface succeeds for a plain texture');
  const plain = wat.guest_read32(out) >>> 0;
  wat.guest_write32(out, 0xdeadbeef);
  assert.notStrictEqual(wat.mip_get_attached(plain, caps, out) >>> 0, 0,
    'a non-mipmapped texture has no attached level');

  console.log('test-directdraw-mip-chain: PASS');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
