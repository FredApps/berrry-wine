#!/usr/bin/env node
'use strict';

// The biggest caller-supplied output records in the emulator are COM and
// Winsock ones: D3DADAPTER_IDENTIFIER9 (1100 bytes), its D3D8 twin (0x42c),
// a DDGAMMARAMP (1536), D3DCAPS9 (304), D3DCAPS8 (0xd4) and WSADATA (400).
// Each used to be filled through one $g2w translation, which is only good for
// a single guest page -- two adjacent
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

  (func (export "test_d3d9_caps") (param $sp i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirect3D9_GetDeviceCaps
      (i32.const 0) (i32.const 0) (i32.const 1) (local.get $out) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_d3d8_caps") (param $sp i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_IDirect3D8_GetDeviceCaps
      (i32.const 0) (i32.const 0) (i32.const 1) (local.get $out) (i32.const 0) (i32.const 0))
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

  (func (export "test_guid_string") (param $sp i32) (param $guid i32) (param $out i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_StringFromGUID2
      (local.get $guid) (local.get $out) (i32.const 39) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  ;; WsControl takes its sixth argument (pcbResponseInfoLen) off the guest
  ;; stack at [esp+24], so the caller's frame has to be built here.
  (func (export "test_wscontrol") (param $sp i32) (param $req i32) (param $out i32)
        (param $lenp i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $gs32 (i32.add (local.get $sp) (i32.const 24)) (local.get $lenp))
    (call $handle_WsControl
      (i32.const 0) (i32.const 0) (local.get $req) (i32.const 0) (local.get $out) (i32.const 0))
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

  // --- the adapter identifiers, the device caps and WSADATA ----------------
  for (const [name, call, SIZE] of [
    ['IDirect3D9::GetAdapterIdentifier', e.test_d3d9_adapter_id, 1100],
    ['IDirect3D8::GetAdapterIdentifier', e.test_d3d8_adapter_id, 0x42c],
    ['IDirect3D9::GetDeviceCaps', e.test_d3d9_caps, 304],
    ['IDirect3D8::GetDeviceCaps', e.test_d3d8_caps, 0xd4],
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

  // --- StringFromGUID2: both the GUID in and the 39 wide chars out ---------
  {
    const GUID = 16, OUT = 78;
    const fillGuid = ga => { for (let i = 0; i < GUID; i++) e.guest_write8(ga + i, (i * 17 + 3) & 0xff); return ga; };
    const ask = (guidGa, outGa) =>
      [e.test_guid_string(sp, fillGuid(guidGa), zero(outGa, OUT)) | 0, ...read(outGa, OUT)];
    const linearGuid = e.guest_alloc(GUID) >>> 0;
    const want = ask(linearGuid, e.guest_alloc(OUT) >>> 0);
    assert.strictEqual(want[0], 39, 'StringFromGUID2 reported 39 chars');
    assert.strictEqual(want[1], 0x7b, 'the string opens with {');
    // Split the output, then the input, then both.
    for (const k of [4, 40, OUT - 8]) {
      assert.deepStrictEqual(ask(linearGuid, split(OUT, k)), want,
        `StringFromGUID2 with ${k} output bytes on the far page: wrong string`);
    }
    for (const k of [2, 8, 14]) {
      assert.deepStrictEqual(ask(split(GUID, k), e.guest_alloc(OUT) >>> 0), want,
        `StringFromGUID2 with ${k} GUID bytes on the far page: wrong string`);
    }
  }

  // --- WsControl's IP statistics, 92 bytes of caller buffer ----------------
  {
    const RESP = 92;
    const req = e.guest_alloc(24) >>> 0;
    const lenp = e.guest_alloc(4) >>> 0;
    const w32 = (ga, v) => { for (let i = 0; i < 4; i++) e.guest_write8(ga + i, (v >>> (i * 8)) & 0xff); };
    w32(req, 0x301);      // entity: CL_NL_ENTITY
    w32(req + 8, 0x200);  // class: INFO_CLASS_PROTOCOL
    w32(req + 16, 1);     // id: statistics
    const ask = ga => {
      zero(ga, RESP); w32(lenp, RESP);
      return [e.test_wscontrol(sp, req, ga, lenp) | 0, ...read(ga, RESP)];
    };
    const want = ask(e.guest_alloc(RESP) >>> 0);
    assert.strictEqual(want[0], 0, 'WsControl answered the statistics query');
    assert.ok(want.slice(1).some(v => v !== 0), 'WsControl wrote statistics');
    for (const k of [4, 48, RESP - 8]) {
      assert.deepStrictEqual(ask(split(RESP, k)), want,
        `WsControl with ${k} bytes on the far page: wrong IPSNMPInfo`);
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

  console.log('PASS  adapter identifiers, device caps, gamma ramps and WSADATA survive a sparse page split');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
