#!/usr/bin/env node
'use strict';

// Black & White 2 Demo (BW2Demo.exe, SHA-256
// 65130510233cfc9e53758bab8480a3cfeeb6b1043de9774ab6e066191b2bb433)
// calls IDirect3DDevice9::ValidateDevice twice at API calls 711661/711737 in
// its authentic trace.  Both calls use the same device 0x07f4e030 and return
// address 0x026431af, with pNumPasses at 0x074ff428 and 0x074ff44c.  The
// current state selects a fixed-function stage but unbinds texture zero, so
// the backend can render it in exactly one pass.  Microsoft documents that a
// successful call must fill that output count, not merely return D3D_OK.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const D3D_OK = 0;
const D3DERR_WRONGTEXTUREFORMAT = 0x88760818;
const D3DERR_UNSUPPORTEDCOLOROPERATION = 0x88760819;
const D3DERR_UNSUPPORTEDCOLORARG = 0x8876081a;
const D3DERR_UNSUPPORTEDALPHAOPERATION = 0x8876081b;
const D3DERR_UNSUPPORTEDALPHAARG = 0x8876081c;
const D3DERR_TOOMANYOPERATIONS = 0x8876081d;
const D3DERR_CONFLICTINGRENDERSTATE = 0x88760821;
const D3DERR_DEVICELOST = 0x88760868;
const D3DERR_INVALIDCALL = 0x8876086c;
const STACK = 0x074ff000;

(async () => {
  const d3d9 = apiTable.find(entry => entry.name === 'IDirect3DDevice9_ValidateDevice');
  const d3d8 = apiTable.find(entry => entry.name === 'IDirect3DDevice8_ValidateDevice');
  assert(d3d9 && d3d8);
  assert.strictEqual(d3d9.id, 2763);
  assert.strictEqual(d3d8.id, 3523);
  assert.strictEqual(d3d8.handler, 'IDirect3DDevice9_ValidateDevice');

  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "new_device") (result i32)
      (local $device i32)
      (local.set $device
        (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
      (store.field DxObject misc1 (call $dx_from_this (local.get $device))
        (call $d3d9_program_alloc))
      (local.get $device))
    (func (export "set_tss") (param $device i32) (param $stage i32)
      (param $type i32) (param $value i32) (result i32)
      (call $d3d9_texture_stage_state (local.get $device) (local.get $stage)
        (local.get $type) (local.get $value) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "set_lost") (param $device i32) (param $lost i32)
      (call $gs32 (i32.add (call $d3d9_program_state (local.get $device))
        (i32.const 21776)) (local.get $lost)))
    (func (export "set_pixel_shader_word") (param $device i32) (param $shader i32)
      (call $gs32 (i32.add (call $d3d9_program_state (local.get $device))
        (i32.const 4)) (local.get $shader)))
    (func (export "bind_test_texture") (param $device i32) (param $stage i32)
      (param $format i32) (param $kind i32) (result i32)
      (local $texture i32) (local $wa i32)
      (local.set $texture (call $heap_alloc (i32.const 64)))
      (local.set $wa (call $g2w (local.get $texture)))
      (call $zero_memory (local.get $wa) (i32.const 64))
      (i32.store offset=12 (local.get $wa) (local.get $kind))
      (i32.store offset=36 (local.get $wa) (local.get $format))
      (call $gs32 (i32.add (call $d3d9_program_state (local.get $device))
        (call $d3d9_texture_offset (local.get $stage))) (local.get $texture))
      (local.get $texture))
    (func (export "validate") (param $api i32) (param $device i32)
      (param $passes i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
      (call $dispatch_api_table (local.get $api) (local.get $device)
        (local.get $passes) (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
  ` });
  e.init_dx_com_thunks();

  const set = (device, stage, type, value) =>
    assert.strictEqual(e.set_tss(device, stage, type, value) >>> 0, D3D_OK);
  const checkAbi = label =>
    assert.strictEqual(e.get_esp() >>> 0, STACK + 12, `${label} pops exactly two arguments`);
  const validate = (api, device, out, expected, label) => {
    const before = out ? e.guest_read32(out) >>> 0 : 0;
    const result = e.validate(api, device, out) >>> 0;
    assert.strictEqual(result, expected, label);
    checkAbi(label);
    if (out && expected !== D3D_OK)
      assert.strictEqual(e.guest_read32(out) >>> 0, before, `${label} preserves failure output`);
    return result;
  };
  const fresh = () => {
    const device = e.new_device() >>> 0;
    assert.ok(device);
    return device;
  };

  // Reproduce the exact B&W2 fixed-function state immediately preceding both
  // calls: SELECTARG1/TEXTURE for color, SELECTARG1/TFACTOR for alpha, stage 1
  // disabled and texture stage 0 unbound.  The two authentic stack pointers
  // are deliberately used here rather than substitute heap addresses.
  const bwDevice = fresh();
  set(bwDevice, 0, 1, 2); // COLOROP SELECTARG1
  set(bwDevice, 0, 2, 2); // COLORARG1 TEXTURE
  set(bwDevice, 0, 4, 2); // ALPHAOP SELECTARG1
  set(bwDevice, 0, 5, 3); // ALPHAARG1 TFACTOR
  set(bwDevice, 1, 1, 1); // COLOROP DISABLE
  for (const [api, out] of [[d3d9.id, 0x074ff428], [d3d8.id, 0x074ff44c]]) {
    e.guest_write32(out - 4, 0x11111111);
    e.guest_write32(out, 0xdeadbeef);
    e.guest_write32(out + 4, 0x22222222);
    validate(api, bwDevice, out, D3D_OK, `B&W2 API ${api}`);
    assert.strictEqual(e.guest_read32(out) >>> 0, 1, 'successful validation reports one pass');
    assert.strictEqual(e.guest_read32(out - 4) >>> 0, 0x11111111);
    assert.strictEqual(e.guest_read32(out + 4) >>> 0, 0x22222222);
  }
  // Validation has no state side effect: the game's following state changes
  // and repeat query still operate on the same live device.
  set(bwDevice, 0, 5, 2);
  e.guest_write32(0x074ff428, 0xa5a5a5a5);
  validate(d3d9.id, bwDevice, 0x074ff428, D3D_OK, 'B&W2 progression');
  assert.strictEqual(e.guest_read32(0x074ff428) >>> 0, 1);

  const output = e.guest_alloc(16) >>> 0;
  assert.ok(output);
  e.guest_write32(output, 0xdeadbeef);
  validate(d3d9.id, 0, output, D3DERR_INVALIDCALL, 'invalid device');
  validate(d3d9.id, bwDevice, 0, D3DERR_INVALIDCALL, 'NULL output');
  validate(d3d9.id, bwDevice, 0xfffffffe, D3DERR_INVALIDCALL, 'unmapped output');

  let device = fresh();
  e.guest_write32(output, 0xdeadbeef);
  e.set_lost(device, 1);
  validate(d3d9.id, device, output, D3DERR_DEVICELOST, 'lost device');

  device = fresh();
  set(device, 0, 2, 0); // keep stage active without a texture
  set(device, 0, 1, 27);
  validate(d3d9.id, device, output, D3DERR_UNSUPPORTEDCOLOROPERATION, 'color operation');

  device = fresh();
  set(device, 0, 2, 0);
  set(device, 0, 4, 18);
  validate(d3d9.id, device, output, D3DERR_UNSUPPORTEDALPHAOPERATION, 'alpha operation');

  device = fresh();
  set(device, 0, 1, 2);
  set(device, 0, 2, 7);
  validate(d3d9.id, device, output, D3DERR_UNSUPPORTEDCOLORARG, 'color argument');
  set(device, 0, 2, 0x12); // TEXTURE|COMPLEMENT without a bound texture
  validate(d3d9.id, device, output, D3DERR_UNSUPPORTEDCOLORARG, 'missing texture argument');

  device = fresh();
  set(device, 0, 2, 0);
  set(device, 0, 4, 2);
  set(device, 0, 5, 7);
  validate(d3d9.id, device, output, D3DERR_UNSUPPORTEDALPHAARG, 'alpha argument');

  device = fresh();
  set(device, 0, 2, 0);
  set(device, 0, 4, 1);
  set(device, 0, 28, 5); // RESULTARG TEMP cannot terminate the cascade
  validate(d3d9.id, device, output, D3DERR_CONFLICTINGRENDERSTATE, 'unpublished TEMP');

  device = fresh();
  for (let stage = 0; stage <= 6; stage++) {
    set(device, stage, 1, 2);
    set(device, stage, 2, 0);
    set(device, stage, 4, 1);
  }
  validate(d3d9.id, device, output, D3DERR_TOOMANYOPERATIONS, 'seventh active stage');

  device = fresh();
  e.bind_test_texture(device, 0, 21, 3);
  set(device, 0, 1, 22);
  validate(d3d9.id, device, output, D3DERR_WRONGTEXTUREFORMAT, 'bump color format');
  device = fresh();
  e.bind_test_texture(device, 0, 62, 5);
  set(device, 0, 1, 22);
  validate(d3d9.id, device, output, D3DERR_WRONGTEXTUREFORMAT, 'bump cube texture');
  device = fresh();
  e.bind_test_texture(device, 0, 62, 3);
  set(device, 0, 1, 22);
  e.guest_write32(output, 0xdeadbeef);
  validate(d3d9.id, device, output, D3D_OK, 'supported V8U8 bump state');
  assert.strictEqual(e.guest_read32(output) >>> 0, 1);
  set(device, 0, 7, 0x7fc00000);
  validate(d3d9.id, device, output, D3DERR_CONFLICTINGRENDERSTATE, 'nonfinite bump state');

  // A valid bound pixel shader supersedes fixed texture-stage blending.  The
  // public SetPixelShader path validates object ownership before this word is
  // installed; the direct seed isolates ValidateDevice's programmed branch.
  device = fresh();
  set(device, 0, 2, 0);
  set(device, 0, 1, 27);
  e.set_pixel_shader_word(device, 0x12345678);
  e.guest_write32(output, 0xdeadbeef);
  validate(d3d9.id, device, output, D3D_OK, 'programmed pixel pipeline');
  assert.strictEqual(e.guest_read32(output) >>> 0, 1);

  console.log('PASS D3D9 ValidateDevice: B&W2 tuples, state HRESULTs, pass count, aliases, ESP');
})().catch(error => { console.error(error); process.exit(1); });
