#!/usr/bin/env node
'use strict';

// Half-Life's hw.dll does not call DirectDrawCreate. It activates DirectDraw as
// a COM class -- CoCreateInstance(CLSID_DirectDraw, NULL, CLSCTX_INPROC_SERVER,
// IID_IDirectDraw, &dd) -- and then calls IDirectDraw::Initialize. When that
// activation failed, GoldSrc concluded it had no video hardware, put up "The
// selected D3D mode is not supported by your video card" and unloaded hw.dll.
//
// This pins the activation: the documented DirectDraw interfaces come back with
// distinct wrappers over one shared object, aggregation is refused, and the
// Direct3D IIDs are refused here on purpose -- Direct3D is reached by QI on an
// already-initialized device, so handing one out over a device that has never
// seen Initialize would be a lie the caller acts on.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  ;; The harness boots without $init_dx_com_thunks, so the DirectDraw vtable
  ;; globals are zero here. Seed them exactly as test-directdraw-create-ex does.
  (func (export "test_cocreate_seed") (param $base i32) (param $extended i32)
    (global.set $DX_VTBL_DDRAW (local.get $base))
    (global.set $DX_VTBL_DDRAW2 (local.get $extended)))
  (func (export "test_cocreate_call")
      (param $clsid i32) (param $outer i32) (param $iid i32) (param $ppv i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_CoCreateInstance
      (local.get $clsid) (local.get $outer) (i32.const 1)
      (local.get $iid) (local.get $ppv) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_cocreate_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_ddraw_initialize") (param $obj i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_Initialize
      (local.get $obj) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ddraw_release") (param $obj i32) (result i32)
    (call $dx_com_release_basic (local.get $obj)))
`;

function writeGuid(wat, addr, w0, w1, w2, w3) {
  wat.guest_write32(addr, w0);
  wat.guest_write32(addr + 4, w1);
  wat.guest_write32(addr + 8, w2);
  wat.guest_write32(addr + 12, w3);
}

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });

  const baseVtable = 0x00510000;
  const extendedVtable = 0x00510100;
  for (let i = 0; i < 24; i++) wat.guest_write32(extendedVtable + i * 4, 0x600000 + i);
  wat.test_cocreate_seed(baseVtable, extendedVtable);

  const clsid = 0x410000;
  const iid = 0x410020;
  const ppv = 0x410040;

  // CLSID_DirectDraw {D7B70EE0-4340-11CF-B063-0020AFC2CD35}, read out of
  // hw.dll's .rdata at original VA 0x100b5348.
  writeGuid(wat, clsid, 0xD7B70EE0, 0x11CF4340, 0x200063B0, 0x35CDC2AF);

  // IID_IDirectDraw {6C14DB80-A733-11CE-A521-0020AF0BE560} -- what hw.dll asks
  // for, at original VA 0x100b5368.
  writeGuid(wat, iid, 0x6C14DB80, 0x11CEA733, 0x200021A5, 0x60E50BAF);

  wat.guest_write32(ppv, 0xdeadbeef);
  assert.strictEqual(wat.test_cocreate_call(clsid, 0, iid, ppv) >>> 0, 0,
    'CoCreateInstance(CLSID_DirectDraw, IID_IDirectDraw) should succeed');
  assert.strictEqual(wat.test_cocreate_esp() >>> 0, 0x30018,
    'CoCreateInstance pops its return address and five stdcall arguments');

  const ddraw = wat.guest_read32(ppv) >>> 0;
  assert(ddraw && ddraw !== 0xdeadbeef,
    'the activation should publish an interface pointer');
  assert(wat.guest_read32(ddraw) >>> 0,
    'the published pointer should carry a vtable');

  // The object is uninitialized by contract, and Initialize is what the caller
  // reaches for next. It must accept it.
  assert.strictEqual(wat.test_ddraw_initialize(ddraw) >>> 0, 0,
    'IDirectDraw::Initialize should return DD_OK on a CoCreateInstance object');

  // IID_IDirectDraw7 {15E65EC0-3B9C-11D2-B92F-00609797EA5B} -- also a DirectDraw
  // interface, so also activatable, and with its own wrapper rather than an
  // alias of the v1 pointer (the two have different method ABIs).
  writeGuid(wat, iid, 0x15E65EC0, 0x11D23B9C, 0x60002FB9, 0x5BEA9797);
  wat.guest_write32(ppv, 0xdeadbeef);
  assert.strictEqual(wat.test_cocreate_call(clsid, 0, iid, ppv) >>> 0, 0,
    'CoCreateInstance(CLSID_DirectDraw, IID_IDirectDraw7) should succeed');
  const ddraw7 = wat.guest_read32(ppv) >>> 0;
  assert(ddraw7 && ddraw7 !== 0xdeadbeef,
    'IDirectDraw7 activation should publish an interface pointer');
  assert.notStrictEqual(wat.guest_read32(ddraw7) >>> 0, wat.guest_read32(ddraw) >>> 0,
    'IDirectDraw7 should not share the IDirectDraw vtable');

  // IID_IDirect3D7 {F5049E77-4861-11D2-A407-00A0C90629A8} is refused: it is not
  // a class this CLSID activates.
  writeGuid(wat, iid, 0xF5049E77, 0x11D24861, 0xA00007A4, 0xA82906C9);
  wat.guest_write32(ppv, 0xdeadbeef);
  assert.strictEqual(wat.test_cocreate_call(clsid, 0, iid, ppv) >>> 0, 0x80004002,
    'CoCreateInstance(CLSID_DirectDraw, IID_IDirect3D7) should be E_NOINTERFACE');
  assert.strictEqual(wat.guest_read32(ppv) >>> 0, 0,
    'a failed activation must zero *ppv');

  // Aggregation is refused, as for every other local class.
  writeGuid(wat, iid, 0x6C14DB80, 0x11CEA733, 0x200021A5, 0x60E50BAF);
  wat.guest_write32(ppv, 0xdeadbeef);
  assert.strictEqual(wat.test_cocreate_call(clsid, 0x420000, iid, ppv) >>> 0, 0x80040110,
    'a non-NULL pUnkOuter should be CLASS_E_NOAGGREGATION');
  assert.strictEqual(wat.guest_read32(ppv) >>> 0, 0,
    'CLASS_E_NOAGGREGATION must zero *ppv');

  console.log('test-cocreate-directdraw: PASS');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
