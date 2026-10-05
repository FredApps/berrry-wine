#!/usr/bin/env node
// A 16-bit render-target texture is widened to 32-bit, not refused.
//
// Colour storage in this emulator is 32 bits per texel end to end:
// $d3d9_texture_colors_init copies the texture's own format into the record at
// +28 and the mip pitch at +48, ensureColor in lib/d3d9-host.js throws on any
// pitch that is not width*4, and the sampler path insists the record's format
// and the requested format agree. So a D3DFMT_R5G6B5 render target cannot be
// stored as asked.
//
// Refusing it is worse than widening it. Black & White 2 asks for exactly one
// 512x512 R5G6B5 D3DUSAGE_RENDERTARGET texture in a whole land load (its other
// six render targets are A8R8G8B8), the format is a hardcoded immediate at
// 0xa9d4b0 so there is no fallback to negotiate, and the guest stores the NULL
// a refusal leaves behind without checking it -- then calls GetSurfaceLevel
// through that null vtable 2.8M API calls later. That read as a slow land load
// for three sessions. See docs/re-notes/black-white-2.md.
//
// Widening is sound for a render target specifically: the surface is rendered
// into and sampled, and 32 bits cannot lose what 16 would have kept. It would
// be wrong for a texture locked and written as raw 16-bit texels, which is why
// this only fires when D3DUSAGE_RENDERTARGET is set -- that is the property
// this test pins, along with every gate the widening must not have loosened.
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const D3DFMT_A8R8G8B8 = 21, D3DFMT_X8R8G8B8 = 22, D3DFMT_R5G6B5 = 23, D3DFMT_A4R4G4B4 = 26;
const D3DUSAGE_RENDERTARGET = 1, D3DUSAGE_DYNAMIC = 0x200;
const D3DPOOL_DEFAULT = 0, D3DPOOL_MANAGED = 1;
const D3DERR_INVALIDCALL = 0x8876086c;

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "new_device") (result i32)
      (local $device i32)
      (local.set $device (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
      (store.field DxObject misc1 (call $dx_from_this (local.get $device)) (call $d3d9_program_alloc))
      (local.get $device))
    ;; Every argument explicit -- usage, format and pool are exactly what this
    ;; test varies, and the existing texture harness pins two of the three.
    (func (export "create") (param $d i32) (param $w i32) (param $h i32)
      (param $usage i32) (param $format i32) (param $pool i32) (param $out i32) (result i32)
      (call $d3d9_texture_create (local.get $d) (local.get $w) (local.get $h) (i32.const 1)
        (local.get $usage) (local.get $format) (local.get $pool) (local.get $out))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "desc") (param $t i32) (param $level i32) (param $out i32) (result i32)
      (call $d3d9_texture_desc (local.get $t) (local.get $level) (local.get $out)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "lock") (param $t i32) (param $level i32) (param $out i32) (result i32)
      (call $d3d9_texture_lock (local.get $t) (local.get $level) (local.get $out)
        (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "unlock") (param $t i32) (param $level i32) (result i32)
      (call $handle_IDirect3DTexture9_UnlockRect (local.get $t) (local.get $level)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
  ` });
  e.init_dx_com_thunks();
  const d = e.new_device(), out = 0x00409000, desc = out + 256, locked = out + 512;

  // Returns the format the record actually stores, or the failing HRESULT.
  const storedFormat = (usage, format, pool, w = 512, h = 512) => {
    e.guest_write32(out, 0);
    const hr = e.create(d, w, h, usage, format, pool, out) >>> 0;
    if (hr !== 0) return hr;
    const t = e.guest_read32(out) >>> 0;
    assert.ok(t, 'a success must produce a texture');
    assert.strictEqual(e.desc(t, 0, desc), 0);
    return { format: e.guest_read32(desc), texture: t };
  };

  // The case B&W2 actually asks for, at its actual size.
  const rt565 = storedFormat(D3DUSAGE_RENDERTARGET, D3DFMT_R5G6B5, D3DPOOL_DEFAULT);
  assert.strictEqual(rt565.format, D3DFMT_X8R8G8B8,
    'a R5G6B5 render target is stored as X8R8G8B8');

  // R5G6B5 has no alpha, so X8R8G8B8 is its widening and A8R8G8B8 would be a
  // lie about the alpha channel; A4R4G4B4 does, so it widens to A8R8G8B8.
  assert.strictEqual(storedFormat(D3DUSAGE_RENDERTARGET, D3DFMT_A4R4G4B4, D3DPOOL_DEFAULT).format,
    D3DFMT_A8R8G8B8, 'an A4R4G4B4 render target is stored as A8R8G8B8');

  // A render target is not lockable, which is both correct D3D9 behaviour and
  // the reason widening is safe here: nothing can observe the storage as raw
  // texels. The pitch invariant the widening exists to preserve therefore has
  // to be read off the format rather than a LockRect -- $d3d9_texture_pitch is
  // width * $d3d9_texture_texel_bytes(format), so a 32-bit stored format IS a
  // width*4 pitch, which is what ensureColor in lib/d3d9-host.js demands.
  assert.strictEqual(e.lock(rt565.texture, 0, locked) >>> 0, D3DERR_INVALIDCALL,
    'a render target is not lockable');

  // Widening is scoped to render targets. A plain texture in a 16-bit format
  // keeps the format it asked for -- it may be locked and written as raw
  // 16-bit texels, which is exactly the case widening would corrupt.
  for (const format of [D3DFMT_R5G6B5, D3DFMT_A4R4G4B4]) {
    assert.strictEqual(storedFormat(0, format, D3DPOOL_MANAGED, 64, 64).format, format,
      `a non-render-target ${format} texture keeps its own format`);
  }

  // A 32-bit render target is unaffected either way.
  for (const format of [D3DFMT_A8R8G8B8, D3DFMT_X8R8G8B8]) {
    assert.strictEqual(storedFormat(D3DUSAGE_RENDERTARGET, format, D3DPOOL_DEFAULT, 64, 64).format,
      format, `a ${format} render target is untouched`);
  }

  // Every gate the widening sits in front of still holds. These ran before the
  // change and must still run after it: widening a format is not a licence to
  // create a render target anywhere but D3DPOOL_DEFAULT, nor to accept a usage
  // that is more than D3DUSAGE_RENDERTARGET alone.
  assert.strictEqual(storedFormat(D3DUSAGE_RENDERTARGET, D3DFMT_R5G6B5, D3DPOOL_MANAGED),
    D3DERR_INVALIDCALL, 'a render target outside D3DPOOL_DEFAULT is still refused');
  assert.strictEqual(
    storedFormat(D3DUSAGE_RENDERTARGET | D3DUSAGE_DYNAMIC, D3DFMT_R5G6B5, D3DPOOL_DEFAULT),
    D3DERR_INVALIDCALL, 'a dynamic render target is still refused');

  // Sensitivity check: the format gate this widening sits in front of is still
  // there and still rejecting. D3DFMT_R8G8B8 (20) is a supported texture format
  // that the widening deliberately does not cover -- it is 24-bit, so there is
  // no 32-bit format it maps to without inventing an alpha channel. If this
  // ever starts succeeding, the gate has been removed rather than narrowed and
  // the assertions above stop meaning anything.
  assert.strictEqual(storedFormat(D3DUSAGE_RENDERTARGET, 20, D3DPOOL_DEFAULT, 64, 64),
    D3DERR_INVALIDCALL, 'the render-target format gate still rejects what it does not widen');

  console.log('PASS test-d3d9-rendertarget-widen');
})().catch(error => { console.error(error); process.exit(1); });
