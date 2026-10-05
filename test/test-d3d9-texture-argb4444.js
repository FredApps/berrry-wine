#!/usr/bin/env node
'use strict';

// D3DFMT_A4R4G4B4 (26) is a format CreateTexture has to accept.
//
// Black & White 2 asks for exactly one of them on its way into a land: a 32x32
// managed single-level texture, through the game's own direct
// IDirect3DDevice9::CreateTexture call at 0x00938af6 with no CheckDeviceFormat
// ahead of it. A refusal is not a fallback it takes -- the constructor at
// 0x009389b0 leaves its texture slot NULL and its load state at 2, and thirty
// instructions later 0x0093907b calls through the NULL. Measured over a whole
// run to the land, the format census is DXT1 142, DXT3 107, A8R8G8B8 34,
// DXT5 20, L8 7, A8L8 4, R5G6B5 2, X8R8G8B8 1, A4R4G4B4 1 -- this was the only
// one we refused.
//
// What this pins: a 16-bit ARGB texture is created, is two bytes per texel in
// its pitch and its mip storage, and reports its own format back through
// GetLevelDesc; CheckDeviceFormat agrees with the create gate on it, because a
// yes there that CreateTexture contradicts is what leaves a game holding a NULL
// it never checked; and the gate is still a gate -- a format we genuinely do
// not store is refused by both.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const ARGB4444 = 26;      // D3DFMT_A4R4G4B4
const A8R8G8B8 = 21;
const UNSUPPORTED = 28;   // D3DFMT_A8 -- nothing stores it today
const D3DERR_NOTAVAILABLE = 0x8876086A;
const D3DERR_INVALIDCALL = 0x8876086C;

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "new_device") (result i32)
      (local $device i32)
      (local.set $device (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
      (store.field DxObject misc1 (call $dx_from_this (local.get $device)) (call $d3d9_program_alloc))
      (local.get $device))
    (func (export "texture") (param $d i32) (param $w i32) (param $h i32) (param $levels i32)
      (param $format i32) (param $out i32) (result i32)
      (call $d3d9_texture_create (local.get $d) (local.get $w) (local.get $h) (local.get $levels)
        (i32.const 0) (local.get $format) (i32.const 1) (local.get $out)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "lock") (param $t i32) (param $level i32) (param $out i32) (result i32)
      (call $d3d9_texture_lock (local.get $t) (local.get $level) (local.get $out) (i32.const 0) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "unlock") (param $t i32) (param $level i32) (result i32)
      (call $handle_IDirect3DTexture9_UnlockRect (local.get $t) (local.get $level) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "desc") (param $t i32) (param $level i32) (param $out i32) (result i32)
      (call $d3d9_texture_desc (local.get $t) (local.get $level) (local.get $out)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "release_texture") (param $t i32) (result i32)
      (call $handle_IDirect3DTexture9_Release (local.get $t) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)) (i32.load offset=0 (global.get $reg_base)))
    (func (export "check_format") (param $usage i32) (param $rtype i32) (param $format i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $rtype))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $format))
      (call $handle_IDirect3D9_CheckDeviceFormat (i32.const 0) (i32.const 0)
        (i32.const 1) (i32.const 22) (local.get $usage) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
  ` });
  e.init_dx_com_thunks();

  const d = e.new_device(), out = 0x00409000, locked = out + 128, desc = out + 256;

  // 1. B&W2's own request, argument for argument.
  assert.strictEqual(e.texture(d, 32, 32, 1, ARGB4444, out) >>> 0, 0,
    'CreateTexture(32x32, 1 level, A4R4G4B4, MANAGED) must succeed');
  const t = e.guest_read32(out) >>> 0;
  assert.ok(t, 'a created texture is not NULL');

  // 2. Two bytes per texel, in the pitch and in the storage behind it.
  assert.strictEqual(e.desc(t, 0, desc) >>> 0, 0);
  assert.strictEqual(e.guest_read32(desc) >>> 0, ARGB4444, 'GetLevelDesc reports A4R4G4B4');
  assert.strictEqual(e.guest_read32(desc + 24) >>> 0, 32);
  assert.strictEqual(e.guest_read32(desc + 28) >>> 0, 32);
  assert.strictEqual(e.lock(t, 0, locked) >>> 0, 0);
  assert.strictEqual(e.guest_read32(locked) >>> 0, 32 * 2, 'pitch is width * 2');
  const bits = e.guest_read32(locked + 4) >>> 0;
  assert.ok(bits, 'lock hands back a guest pointer');
  // Every texel of the level is writable through that pitch, and a write to the
  // last one does not run into whatever follows the mip.
  for (let i = 0; i < 32 * 32; i++) e.guest_write32(bits + i * 2 - (i * 2) % 4, 0);
  e.guest_write32(bits + 32 * 32 * 2 - 4, 0xF00FA55A | 0);
  assert.strictEqual(e.guest_read32(bits + 32 * 32 * 2 - 4) >>> 0, 0xF00FA55A);
  assert.strictEqual(e.unlock(t, 0) >>> 0, 0);
  assert.strictEqual(e.release_texture(t) >>> 0, 0);

  // 3. A full mip chain: each level halves and the pitch follows it.
  assert.strictEqual(e.texture(d, 8, 4, 0, ARGB4444, out) >>> 0, 0);
  const chain = e.guest_read32(out) >>> 0;
  for (const [level, [w, h]] of [[8, 4], [4, 2], [2, 1], [1, 1]].entries()) {
    assert.strictEqual(e.desc(chain, level, desc) >>> 0, 0, `level ${level} exists`);
    assert.strictEqual(e.guest_read32(desc + 24) >>> 0, w);
    assert.strictEqual(e.guest_read32(desc + 28) >>> 0, h);
    assert.strictEqual(e.lock(chain, level, locked) >>> 0, 0);
    assert.strictEqual(e.guest_read32(locked) >>> 0, w * 2, `level ${level} pitch is ${w} * 2`);
    assert.strictEqual(e.unlock(chain, level) >>> 0, 0);
  }
  assert.strictEqual(e.release_texture(chain) >>> 0, 0);

  // 4. CheckDeviceFormat and the create gate answer the same question the same
  //    way. A yes here that CreateTexture then refuses is the shape of the bug.
  assert.strictEqual(e.check_format(0, 3, ARGB4444) >>> 0, 0, 'plain texture A4R4G4B4 is available');
  assert.strictEqual(e.check_format(0, 3, A8R8G8B8) >>> 0, 0);
  assert.strictEqual(e.check_format(0, 3, UNSUPPORTED) >>> 0, D3DERR_NOTAVAILABLE,
    'a format we do not store is still refused');

  // 5. The gate is still a gate.
  assert.strictEqual(e.texture(d, 32, 32, 1, UNSUPPORTED, out) >>> 0, D3DERR_INVALIDCALL,
    'an unstorable format is still refused by CreateTexture');
  assert.strictEqual(e.guest_read32(out) >>> 0, 0, 'a refused create leaves the out pointer NULL');

  console.log('PASS D3D9 A4R4G4B4 textures: create, 2-byte pitch, mip chain, format-check agreement');
})().catch(err => { console.error(err); process.exit(1); });
