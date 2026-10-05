#!/usr/bin/env node
'use strict';

// Releasing a texture must give back the surface it is a view of.
//
// QueryInterface does not build a new object for IDirect3DTexture/Texture2: it
// hands back another COM view of the DirectDrawSurface's own DX_OBJECTS slot.
// So the final release through the texture vtable IS the final release of the
// surface, and it has to run the surface teardown. Both texture Release
// handlers used to call $dx_free instead, which retires the slot and leaves
// the DIB pages allocated and $dx_vidmem_used still charged for them.
//
// That is not a slow leak. Measured on the Diablo II demo at its character
// screen: 4756 orphaned runs holding 48.5 MB of the 63 MB DIB arena, in the
// game's three exact tile geometries, with nothing alive owning any of them.
// The video memory never came back either, so GetAvailableVidMem answered
// 558 KB, d2direct3d sized its texture cache from that figure and reached a
// capacity of zero -- and that cache's eviction loop cannot terminate at
// capacity zero (count==0 skips the body including the decrement, while the
// exit test count==nMaxNumItems is already true). The game then spun forever
// at d2direct3d+0x9561 showing a black screen, which read for two sessions as
// a rendering bug rather than an accounting one.
//
// The second half of this file covers what made the refund itself unsound.
// DxObject.misc2 held the billed byte count AND was overwritten by
// SetColorKey on the same live surface, so a keyed surface refunded its
// colour key. The billed figure now lives in DX_SURF_META, which nothing else
// writes.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_tra_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))

  (func (export "test_tra_create_surface") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; Release through the legacy texture vtable -- the path Diablo II takes.
  (func (export "test_tra_texture2_release") (param $this i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DTexture2_Release
      (local.get $this) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_tra_texture_release") (param $this i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirect3DTexture_Release
      (local.get $this) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_tra_surface_release") (param $this i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_Release
      (local.get $this) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  ;; The negative control: retire the slot the way the old handlers did, with
  ;; no surface teardown at all. If this returned the pages too, the test
  ;; above would pass against the broken build and prove nothing.
  (func (export "test_tra_raw_dx_free") (param $this i32)
    (call $dx_free (call $dx_from_this (local.get $this))))

  (func (export "test_tra_set_colorkey") (param $this i32) (param $key i32) (result i32)
    (call $gs32 (i32.const 0x30200) (local.get $key))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_SetColorKey
      (local.get $this) (i32.const 8) (i32.const 0x30200) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_tra_vidmem_used") (result i32) (global.get $dx_vidmem_used))

  (func (export "test_tra_billed") (param $this i32) (result i32)
    (call $dx_surf_billed_get (call $dx_from_this (local.get $this))))

  (func (export "test_tra_misc2") (param $this i32) (result i32)
    (load.field DxObject misc2 (call $dx_from_this (local.get $this))))

  (func (export "test_tra_type") (param $this i32) (result i32)
    (load.field DxObject type (call $dx_from_this (local.get $this))))
`;

// A 256x256 16bpp texture: 128 KB of pixels, the largest of the three tile
// sizes Diablo II carves its cache into, and big enough that a leaked run is
// unmistakable against arena noise.
const TEX_W = 256;
const TEX_H = 256;

function makeSurface(wat, desc, out, width, height) {
  for (let i = 0; i < 128; i += 4) wat.guest_write32(desc + i, 0);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 0x1007); // CAPS|HEIGHT|WIDTH|PIXELFORMAT
  wat.guest_write32(desc + 8, height);
  wat.guest_write32(desc + 12, width);
  wat.guest_write32(desc + 72, 32);
  wat.guest_write32(desc + 76, 0x40); // DDPF_RGB
  wat.guest_write32(desc + 84, 16);
  wat.guest_write32(desc + 88, 0xf800);
  wat.guest_write32(desc + 92, 0x07e0);
  wat.guest_write32(desc + 96, 0x001f);
  wat.guest_write32(desc + 104, 0x40); // DDSCAPS_OFFSCREENPLAIN
  assert.strictEqual(wat.test_tra_create_surface(desc, out) >>> 0, 0,
    'CreateSurface succeeds');
  const obj = wat.guest_read32(out) >>> 0;
  assert.notStrictEqual(obj, 0, 'CreateSurface returned an object');
  return obj;
}

(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none' });
  const { exports: wat } = h;
  const desc = 0x410000;
  const out = 0x410100;

  // stat(1) is free pages, stat(0) used; the arena is a page bitmap, so these
  // are exact rather than sampled.
  const freePages = () => wat.gdi_dib_arena_stat(1) >>> 0;
  const usedPages = () => wat.gdi_dib_arena_stat(0) >>> 0;

  wat.test_tra_seed(0x51000000, 0x52000000);

  // ── 1. Release through IDirect3DTexture2 returns pages and video memory ──
  {
    const pagesBefore = freePages();
    const vidBefore = wat.test_tra_vidmem_used() >>> 0;
    const surf = makeSurface(wat, desc, out, TEX_W, TEX_H);

    const pagesHeld = pagesBefore - freePages();
    assert(pagesHeld >= TEX_W * TEX_H * 2 / 4096,
      `the surface took at least its pixels in pages (took ${pagesHeld})`);
    const billed = wat.test_tra_vidmem_used() - vidBefore;
    assert.strictEqual(billed, wat.test_tra_billed(surf) >>> 0,
      'what the surface added to dx_vidmem_used is what it records as billed');

    assert.strictEqual(wat.test_tra_texture2_release(surf) >>> 0, 0,
      'final release reports zero remaining references');
    assert.strictEqual(wat.test_tra_type(surf) >>> 0, 0, 'the slot is retired');
    assert.strictEqual(freePages(), pagesBefore,
      'every DIB page the surface held came back');
    assert.strictEqual(wat.test_tra_vidmem_used() >>> 0, vidBefore,
      'every byte of video memory it was billed came back');
  }

  // ── 2. The same for the v1 IDirect3DTexture vtable ──
  {
    const pagesBefore = freePages();
    const vidBefore = wat.test_tra_vidmem_used() >>> 0;
    const surf = makeSurface(wat, desc, out, TEX_W, TEX_H);
    assert.strictEqual(wat.test_tra_texture_release(surf) >>> 0, 0);
    assert.strictEqual(freePages(), pagesBefore,
      'IDirect3DTexture_Release returns the pages too');
    assert.strictEqual(wat.test_tra_vidmem_used() >>> 0, vidBefore,
      'IDirect3DTexture_Release returns the video memory too');
  }

  // ── 3. Negative control: $dx_free alone must NOT return anything ──
  // This is what both handlers used to do. If this assertion ever flips, the
  // two above stop being evidence of anything.
  {
    const pagesBefore = freePages();
    const vidBefore = wat.test_tra_vidmem_used() >>> 0;
    const surf = makeSurface(wat, desc, out, TEX_W, TEX_H);
    const pagesHeld = pagesBefore - freePages();
    wat.test_tra_raw_dx_free(surf);
    assert.strictEqual(wat.test_tra_type(surf) >>> 0, 0,
      'the slot is retired either way -- which is why the leak was invisible');
    assert.strictEqual(pagesBefore - freePages(), pagesHeld,
      'a bare $dx_free strands the DIB pages (the bug this file covers)');
    assert(wat.test_tra_vidmem_used() >>> 0 > vidBefore,
      'a bare $dx_free strands the video memory too');
  }

  // ── 4. A colour-keyed surface refunds its SIZE, not its key ──
  // misc2 used to hold both. The key is deliberately a small non-zero value:
  // refunding it instead of the size leaves almost the whole surface charged,
  // and refunding a zero key leaves all of it.
  {
    const vidBefore = wat.test_tra_vidmem_used() >>> 0;
    const pagesBefore = freePages();
    const surf = makeSurface(wat, desc, out, TEX_W, TEX_H);
    const billed = wat.test_tra_billed(surf) >>> 0;
    assert(billed > 0x10000, 'a 256x256x16 surface is billed six figures of bytes');

    assert.strictEqual(wat.test_tra_set_colorkey(surf, 0x07e0) >>> 0, 0,
      'SetColorKey succeeds');
    assert.strictEqual(wat.test_tra_misc2(surf) >>> 0, 0x07e0,
      'the colour key is what misc2 now holds');
    assert.strictEqual(wat.test_tra_billed(surf) >>> 0, billed,
      'and the billed byte count survived it');

    assert.strictEqual(wat.test_tra_surface_release(surf) >>> 0, 0);
    assert.strictEqual(wat.test_tra_vidmem_used() >>> 0, vidBefore,
      'the keyed surface refunded its size, not its colour key');
    assert.strictEqual(freePages(), pagesBefore,
      'and its pages came back');
  }

  // ── 5. Churn: the arena must be exactly where it started ──
  // One release proves the path; a hundred proves nothing is retained per
  // round, which is the shape the Diablo II failure actually had.
  {
    const pagesBefore = freePages();
    const usedBefore = usedPages();
    const vidBefore = wat.test_tra_vidmem_used() >>> 0;
    for (let i = 0; i < 100; i++) {
      const surf = makeSurface(wat, desc, out, TEX_W, TEX_H);
      assert.strictEqual(wat.test_tra_texture2_release(surf) >>> 0, 0);
    }
    assert.strictEqual(freePages(), pagesBefore,
      '100 create/release rounds leave the arena exactly as they found it');
    assert.strictEqual(usedPages(), usedBefore, 'used page count is unchanged');
    assert.strictEqual(wat.test_tra_vidmem_used() >>> 0, vidBefore,
      '100 rounds leave dx_vidmem_used exactly as they found it');
  }

  console.log('PASS test-d3dim-texture-release-arena');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
