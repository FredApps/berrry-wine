#!/usr/bin/env node
'use strict';

// The biggest caller-supplied output records in the emulator are COM and
// Winsock ones: D3DADAPTER_IDENTIFIER9 (1100 bytes), its D3D8 twin (0x42c),
// a DDGAMMARAMP (1536) and WSADATA (400). Each used to be filled through one
// $g2w translation, which is only good for a single guest page -- two adjacent
// sparse guest pages need not be adjacent in WASM memory, so a caller whose
// buffer crossed a boundary got the head of its record and the tail written
// into unrelated memory. A 1536-byte record crosses a boundary from more than
// a third of all addresses.
//
// Each is driven twice against identical inputs, once wholly inside one page
// and once split across the boundary, and the two results must agree byte for
// byte. The gather arena's cursor must also come back to where it started.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "sp_map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))

  (func (export "test_d3d9_adapter_id") (param $sp i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirect3D9_GetAdapterIdentifier
      (i32.const 0) (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_d3d8_adapter_id") (param $sp i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirect3D8_GetAdapterIdentifier
      (i32.const 0) (i32.const 0) (i32.const 0) (local.get $out) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_wsastartup") (param $sp i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_WSAStartup
      (i32.const 0x0101) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_gamma_create") (result i32)
    (local $obj i32) (local $entry i32)
    (local.set $obj (call $dx_create_com_obj
      (i32.const 2) (call $init_com_vtable (i32.const 3079) (i32.const 5))))
    (if (local.get $obj)
      (then
        (local.set $entry (call $dx_from_this (local.get $obj)))
        (store.field DxObject flags (local.get $entry) (i32.const 1))))
    (local.get $obj))

  (func (export "test_gamma_get") (param $sp i32) (param $obj i32) (param $ramp i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirectDrawGammaControl_GetGammaRamp
      (local.get $obj) (i32.const 0) (local.get $ramp) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_gamma_set") (param $sp i32) (param $obj i32) (param $ramp i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirectDrawGammaControl_SetGammaRamp
      (local.get $obj) (i32.const 0) (local.get $ramp) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const page = 0x30000000, other = 0x28000000;
  // Four pages: a 1536-byte record needs room on both sides of a boundary.
  for (const ga of [page, other, page + 4096, page + 8192]) {
    assert.strictEqual(e.sp_map(ga) >>> 0, ga);
  }
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must be backed non-adjacently for this test to mean anything');

  const sp = ((e.guest_alloc(256) >>> 0) + 128) >>> 0;
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i) & 0xff);
  const zero = (ga, n) => { for (let i = 0; i < n; i++) e.guest_write8(ga + i, 0); return ga; };
  // A buffer of n bytes with its last k bytes on the following page.
  const split = (n, k) => page + 4096 - (n - k);

  const cursor0 = e.guest_span_cursor_bytes() >>> 0;
  const overflow0 = e.guest_span_overflow_count() >>> 0;

  // --- the two adapter identifiers and WSADATA -----------------------------
  for (const [name, call, SIZE] of [
    ['IDirect3D9::GetAdapterIdentifier', e.test_d3d9_adapter_id, 1100],
    ['IDirect3D8::GetAdapterIdentifier', e.test_d3d8_adapter_id, 0x42c],
    ['WSAStartup', e.test_wsastartup, 400],
  ]) {
    const ask = ga => [call(sp, zero(ga, SIZE)) | 0, ...read(ga, SIZE)];
    const want = ask(e.guest_alloc(SIZE) >>> 0);
    assert.strictEqual(want[0], 0, `${name} succeeded`);
    assert.ok(want.slice(1).some(v => v !== 0), `${name} wrote something`);
    for (const k of [4, 64, Math.floor(SIZE / 2), SIZE - 8]) {
      assert.deepStrictEqual(ask(split(SIZE, k)), want,
        `${name} with ${k} bytes on the far page: wrong record`);
    }
  }

  // --- the gamma ramp, both directions -------------------------------------
  const RAMP = 1536;
  const gamma = e.test_gamma_create() >>> 0;
  assert.ok(gamma, 'a primary surface with gamma control exists');

  // Get: the identity ramp the emulator synthesizes before anything is set.
  {
    const ask = ga => [e.test_gamma_get(sp, gamma, zero(ga, RAMP)) | 0, ...read(ga, RAMP)];
    const want = ask(e.guest_alloc(RAMP) >>> 0);
    assert.strictEqual(want[0], 0, 'GetGammaRamp succeeded');
    assert.ok(want.slice(1).some(v => v !== 0), 'GetGammaRamp wrote a ramp');
    for (const k of [4, 512, 1024, RAMP - 8]) {
      assert.deepStrictEqual(ask(split(RAMP, k)), want,
        `GetGammaRamp with ${k} bytes on the far page: wrong ramp`);
    }
  }

  // Set then Get: a ramp written from a straddling buffer must read back whole.
  {
    const pattern = i => (i * 193 + 7) & 0xff;
    const write = ga => { for (let i = 0; i < RAMP; i++) e.guest_write8(ga + i, pattern(i)); return ga; };
    const readback = e.guest_alloc(RAMP) >>> 0;
    for (const src of [e.guest_alloc(RAMP) >>> 0, split(RAMP, 4), split(RAMP, 900)]) {
      assert.strictEqual(e.test_gamma_set(sp, gamma, write(src)) | 0, 0, 'SetGammaRamp succeeded');
      assert.strictEqual(e.test_gamma_get(sp, gamma, zero(readback, RAMP)) | 0, 0);
      assert.deepStrictEqual(read(readback, RAMP), Array.from({ length: RAMP }, (_, i) => pattern(i)),
        `SetGammaRamp from 0x${src.toString(16)} did not store the whole ramp`);
      zero(src, RAMP);
    }
  }

  assert.strictEqual(e.guest_span_cursor_bytes() >>> 0, cursor0,
    'the gather arena was not given back');
  assert.strictEqual(e.guest_span_overflow_count() >>> 0, overflow0,
    'a span did not fit the gather arena');

  console.log('PASS  adapter identifiers, gamma ramps and WSADATA survive a sparse page split');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
