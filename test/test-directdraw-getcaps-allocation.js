#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const extraWat = String.raw`
 (func (export "test_caps_create") (param $desc i32) (param $out i32) (result i32)
  (local $dd i32)
  (local.set $dd (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x300000))
  (call $handle_IDirectDraw_CreateSurface (local.get $dd) (local.get $desc) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0))
  (i32.load offset=0 (global.get $reg_base)))
 (func (export "test_caps_desc") (param $surface i32) (param $out i32)
  (call $handle_IDirectDrawSurface_GetSurfaceDesc (local.get $surface) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
 (func (export "test_caps_query") (param $surface i32) (param $iid i32) (param $out i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x300000))
  (call $handle_IDirectDrawSurface_QueryInterface (local.get $surface) (local.get $iid) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0))
  (i32.load offset=0 (global.get $reg_base)))
 (func (export "test_caps_attached") (param $surface i32) (param $caps i32) (param $out i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x300000))
  (call $handle_IDirectDrawSurface_GetAttachedSurface (local.get $surface) (local.get $caps) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0))
  (i32.load offset=0 (global.get $reg_base)))
 (func (export "test_caps_get") (param $surface i32) (param $out i32) (result i32)
  (i32.store offset=16 (global.get $reg_base) (i32.const 0x300000))
  (call $handle_IDirectDrawSurface_GetCaps (local.get $surface) (local.get $out) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
  (i32.load offset=0 (global.get $reg_base)))
 (func (export "test_caps_foreign") (result i32) (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
 (func (export "test_caps_release") (param $surface i32) (result i32) (call $dx_surface_release (local.get $surface)))
`;
(async () => {
  const wasm = compileSrcWasm((file, source) => file === '13-exports.wat' ? source + extraWat : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const imports = createHostImports({ getMemory: () => memory.buffer, renderer: null, resourceJson: {} });
  Object.assign(imports.host, { memory, create_thread: () => 0, exit_thread: () => 0,
    terminate_thread: () => 0, create_event: () => 0, set_event: () => 0,
    reset_event: () => 0, wait_single: () => 0, wait_multiple: () => 0,
    com_create_instance: () => 0x80004002 });
  const { instance } = await WebAssembly.instantiate(wasm, imports), e = instance.exports;
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging()); assert(e.load_pe(exe.length)); e.init_dx_com_thunks();
  const alloc = n => e.guest_alloc(n) >>> 0;
  const desc = alloc(108), out = alloc(4), query = alloc(108), storage = alloc(32), caps = storage + 8, iid = alloc(16), stack = alloc(64);
  const guard = 0xa5a5a5a5;
  function create(flags, chain = false) {
    for (let i = 0; i < 108; i += 4) e.guest_write32(desc + i, 0);
    e.guest_write32(desc, 108); e.guest_write32(desc + 4, chain ? 0x27 : 7);
    e.guest_write32(desc + 8, 32); e.guest_write32(desc + 12, 32);
    if (chain) e.guest_write32(desc + 20, 1);
    e.guest_write32(desc + 104, flags);
    assert.equal(e.test_caps_create(desc, out) >>> 0, 0, 'real CreateSurface');
    return e.guest_read32(out) >>> 0;
  }
  function get(surface, expected, label) {
    e.guest_write32(caps - 4, guard); e.guest_write32(caps, 0); e.guest_write32(caps + 4, guard);
    assert.equal(e.test_caps_get(surface, caps) >>> 0, 0, label);
    assert.equal(e.guest_read32(caps) >>> 0, expected >>> 0, label + ' exact truthful allocation caps');
    assert.equal(e.get_esp() >>> 0, 0x30000c, 'this/out/return stdcall cleanup');
    assert.equal(e.guest_read32(caps - 4) >>> 0, guard); assert.equal(e.guest_read32(caps + 4) >>> 0, guard, 'legacy DDSCAPS writes only four bytes');
    e.test_caps_desc(surface, query); assert.equal(e.guest_read32(query + 104) >>> 0, expected >>> 0, 'GetSurfaceDesc parity');
  }
  const explicitVideo = create(0x4040);
  get(explicitVideo, 0x4040, 'SDL explicit offscreen VIDEOMEMORY'); // Before source must fail here, not setup.
  const defaultVideo = create(0x40); get(defaultVideo, 0x10004040, 'implicit local video');
  const system = create(0x840); get(system, 0x840, 'explicit system memory must not gain VIDEOMEMORY');
  const primary = create(0x200); get(primary, 0x10004200, 'primary allocation');
  const chain = create(0x218, true); get(chain, 0x10004218, 'primary flip chain');
  e.guest_write32(caps, 4); assert.equal(e.test_caps_attached(chain, caps, out), 0);
  const back = e.guest_read32(out) >>> 0; get(back, 0x1000401c, 'attached back buffer allocation');
  // Real Surface3 QI gives a distinct wrapper; method slot14 retains DDSCAPS ABI.
  [0xDA044E00, 0x11D069B2, 0xAA00D5A1, 0xBBDFB800].forEach((v, i) => e.guest_write32(iid + 4 * i, v));
  assert.equal(e.test_caps_query(explicitVideo, iid, out), 0);
  const surface3 = e.guest_read32(out) >>> 0; assert.notEqual(surface3, explicitVideo); get(surface3, 0x4040, 'Surface3 alias');
  for (const surface of [explicitVideo, surface3]) {
    const vtable = e.guest_read32(surface) >>> 0, entry = e.guest_read32(vtable + 14 * 4) >>> 0;
    e.guest_write32(stack, 0); e.guest_write32(stack + 4, surface); e.guest_write32(stack + 8, caps);
    e.set_esp(stack); e.set_eip(entry); e.run(1000);
    assert.equal(e.get_eip(), 0); assert.equal(e.get_eax(), 0); assert.equal(e.get_esp() >>> 0, stack + 12);
    assert.equal(e.guest_read32(caps) >>> 0, 0x4040, 'actual COM thunk result');
  }
  for (const bad of [0, 0x70000000, 0xfffffffe]) assert.equal(e.test_caps_get(system, bad) >>> 0, 0x80070057, 'invalid output pointer');
  for (const object of [0, e.test_caps_foreign()]) {
    e.guest_write32(caps, guard); assert.equal(e.test_caps_get(object, caps) >>> 0, 0x88760082);
    assert.equal(e.guest_read32(caps) >>> 0, guard, 'invalid object leaves caller buffer unchanged');
  }
  assert.equal(e.test_caps_release(defaultVideo), 0);
  assert.equal(e.test_caps_get(defaultVideo, caps) >>> 0, 0x88760082, 'released surface fails');
  assert.equal(e.get_esp() >>> 0, 0x30000c, 'failure cleanup');
  console.log('PASS real allocation caps primary/back/video/system, Surface2/3 COM thunks, exact buffer writes and invalid/released contracts');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
