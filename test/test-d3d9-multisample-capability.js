#!/usr/bin/env node
'use strict';

// Black & White 2 Demo (BW2Demo.exe, SHA-256
// 65130510233cfc9e53758bab8480a3cfeeb6b1043de9774ab6e066191b2bb433)
// makes 204 CheckDeviceMultiSampleType calls during its D3D9 capability probe.
// Calls 684890..684910 in the authentic trace sweep A8R8G8B8/fullscreen from
// NONE through 16_SAMPLES with a quality output; 684919..684935 repeat that
// sweep for D24S8 with a NULL output, and 684961 onward repeat it windowed.
// The backend does not implement multisampled storage: both corresponding
// resource creators reject any nonzero type or quality. This test pins one
// truthful capability answer to the exact tuples the game asks about.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const D3D_OK = 0;
const D3DERR_NOTAVAILABLE = 0x8876086a;
const D3DERR_INVALIDDEVICE = 0x8876086b;
const D3DERR_INVALIDCALL = 0x8876086c;
const STACK = 0x074ff000;

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "new_device") (result i32)
      (local $device i32)
      (local.set $device (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV9)))
      (store.field DxObject misc1 (call $dx_from_this (local.get $device)) (call $d3d9_program_alloc))
      (local.get $device))
    (func (export "check_multisample") (param $adapter i32) (param $type i32)
      (param $format i32) (param $windowed i32) (param $multisample i32)
      (param $quality i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $multisample))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (local.get $quality))
      (call $handle_IDirect3D9_CheckDeviceMultiSampleType (i32.const 0)
        (local.get $adapter) (local.get $type) (local.get $format)
        (local.get $windowed) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "create_target") (param $device i32) (param $format i32)
      (param $multisample i32) (param $quality i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $quality))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (i32.const 0))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (local.get $out))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36)) (i32.const 0))
      (call $handle_IDirect3DDevice9_CreateRenderTarget (local.get $device)
        (i32.const 8) (i32.const 8) (local.get $format) (local.get $multisample) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
    (func (export "create_depth") (param $device i32) (param $format i32)
      (param $multisample i32) (param $quality i32) (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $quality))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 28)) (i32.const 0))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 32)) (local.get $out))
      (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 36)) (i32.const 0))
      (call $handle_IDirect3DDevice9_CreateDepthStencilSurface (local.get $device)
        (i32.const 8) (i32.const 8) (local.get $format) (local.get $multisample) (i32.const 0))
      (i32.load offset=0 (global.get $reg_base)))
  ` });
  e.init_dx_com_thunks();

  const storage = e.guest_alloc(64) >>> 0;
  const quality = storage + 8;
  const out = storage + 32;
  const check = (adapter, type, format, windowed, multisample, pointer) => {
    const result = e.check_multisample(adapter, type, format, windowed, multisample, pointer) >>> 0;
    assert.strictEqual(e.get_esp() >>> 0, STACK + 32, 'CheckDeviceMultiSampleType pops exactly seven arguments');
    return result;
  };

  // The exact color/depth and fullscreen/windowed tuples from B&W2's probe.
  for (const format of [21, 75]) {
    for (const windowed of [0, 1]) {
      e.guest_write32(quality - 4, 0x11111111);
      e.guest_write32(quality, 0xdeadbeef);
      e.guest_write32(quality + 4, 0x22222222);
      assert.strictEqual(check(0, 1, format, windowed, 0, quality), D3D_OK);
      assert.strictEqual(e.guest_read32(quality) >>> 0, 1, 'NONE exposes only quality index zero');
      assert.strictEqual(e.guest_read32(quality - 4) >>> 0, 0x11111111);
      assert.strictEqual(e.guest_read32(quality + 4) >>> 0, 0x22222222);
      assert.strictEqual(check(0, 1, format, windowed, 0, 0), D3D_OK,
        'the optional quality pointer may be NULL');
      for (let multisample = 1; multisample <= 16; multisample++) {
        e.guest_write32(quality, 0xdeadbeef);
        assert.strictEqual(check(0, 1, format, windowed, multisample, quality), D3DERR_NOTAVAILABLE);
        assert.strictEqual(e.guest_read32(quality) >>> 0, 0xdeadbeef,
          'a failed capability query leaves its output untouched');
      }
    }
  }

  // Every format that the current render/depth creators can actually store is
  // available without multisampling; an unsupported surface format is not.
  for (const format of [21, 22, 75, 77, 80])
    assert.strictEqual(check(0, 1, format, 1, 0, 0), D3D_OK);
  assert.strictEqual(check(0, 1, 28, 1, 0, 0), D3DERR_NOTAVAILABLE);

  // Microsoft assigns these three validation failures distinct HRESULTs.
  e.guest_write32(quality, 0xdeadbeef);
  assert.strictEqual(check(1, 1, 21, 1, 0, quality), D3DERR_INVALIDCALL);
  assert.strictEqual(check(0, 2, 21, 1, 0, quality), D3DERR_INVALIDDEVICE);
  assert.strictEqual(check(0, 1, 21, 1, 17, quality), D3DERR_INVALIDCALL);
  assert.strictEqual(check(0, 1, 21, 1, 0xffffffff, quality), D3DERR_INVALIDCALL);
  assert.strictEqual(e.guest_read32(quality) >>> 0, 0xdeadbeef);
  assert.strictEqual(check(0, 1, 21, 1, 0, 0xfffffffe), D3DERR_INVALIDCALL,
    'an invalid non-NULL quality output is rejected safely');

  // Capability and creation agree: NONE/quality zero works; any nonzero type
  // or quality is refused by the resource path the capability guards.
  const device = e.new_device() >>> 0;
  assert.ok(device);
  e.guest_write32(out, 0);
  assert.strictEqual(e.create_target(device, 21, 0, 0, out) >>> 0, D3D_OK);
  assert.ok(e.guest_read32(out) >>> 0);
  assert.strictEqual(e.get_esp() >>> 0, STACK + 40);
  e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(e.create_target(device, 21, 1, 0, out) >>> 0, D3DERR_INVALIDCALL);
  assert.strictEqual(e.guest_read32(out) >>> 0, 0);
  e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(e.create_target(device, 21, 0, 1, out) >>> 0, D3DERR_INVALIDCALL);
  assert.strictEqual(e.guest_read32(out) >>> 0, 0);

  e.guest_write32(out, 0);
  assert.strictEqual(e.create_depth(device, 75, 0, 0, out) >>> 0, D3D_OK);
  assert.ok(e.guest_read32(out) >>> 0);
  assert.strictEqual(e.get_esp() >>> 0, STACK + 40);
  e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(e.create_depth(device, 75, 2, 0, out) >>> 0, D3DERR_INVALIDCALL);
  assert.strictEqual(e.guest_read32(out) >>> 0, 0);
  e.guest_write32(out, 0xdeadbeef);
  assert.strictEqual(e.create_depth(device, 75, 0, 1, out) >>> 0, D3DERR_INVALIDCALL);
  assert.strictEqual(e.guest_read32(out) >>> 0, 0);

  console.log('PASS D3D9 multisample capability truth: B&W2 tuples, HRESULTs, quality, ESP, create agreement');
})().catch(error => { console.error(error); process.exit(1); });
