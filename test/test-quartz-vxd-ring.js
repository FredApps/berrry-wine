#!/usr/bin/env node
'use strict';

// Win98 quartz.dll gets its parser ring buffers from \\.\QUARTZ.VXD: ioctl 1
// (page count in, base out) returns a region whose upper half is a second
// mapping of the lower half, ioctl 2 frees it. Without the device every
// DirectShow Pause/Run fails, and Morrowind rebuilt its music graph each frame
// until the heap ran out. Pin: CreateFileA/W open the device, the alias is
// real in both directions (including an access straddling the wrap), bad
// frees are refused, a freed ring unmaps both halves, and CloseHandle works.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const HANDLE = 0xf9000001;
const ERROR_INVALID_FUNCTION = 1;
const ERROR_INVALID_PARAMETER = 87;

const extraWat = String.raw`
  (func (export "test_create_file") (param $name i32) (param $wide i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0x5a5aa55a))
    (call $gs32 (i32.add (i32.const 0x00300000) (i32.const 24)) (i32.const 0x80))
    (if (local.get $wide)
      (then (call $handle_CreateFileW (local.get $name) (i32.const 0x40000000)
        (i32.const 2) (i32.const 0) (i32.const 4) (i32.const 0)))
      (else (call $handle_CreateFileA (local.get $name) (i32.const 0x40000000)
        (i32.const 2) (i32.const 0) (i32.const 4) (i32.const 0))))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_ioctl")
      (param $handle i32) (param $code i32)
      (param $in i32) (param $in_size i32)
      (param $out i32) (param $out_size i32) (param $bytes i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $last_error (i32.const 0x5a5aa55a))
    (call $gs32 (i32.add (i32.const 0x00300000) (i32.const 24)) (local.get $out_size))
    (call $gs32 (i32.add (i32.const 0x00300000) (i32.const 28)) (local.get $bytes))
    (call $gs32 (i32.add (i32.const 0x00300000) (i32.const 32)) (i32.const 0))
    (call $handle_DeviceIoControl
      (local.get $handle) (local.get $code)
      (local.get $in) (local.get $in_size) (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_close") (param $handle i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_CloseHandle (local.get $handle)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_last_error") (result i32) (global.get $last_error))
  (func (export "test_mapped") (param $ga i32) (result i32)
    (i32.ne (call $guest_page_translate (local.get $ga)) (global.get $NULL_SENTINEL)))
  (func (export "test_rd32") (param $ga i32) (result i32) (call $gl32 (local.get $ga)))
  (func (export "test_wr32") (param $ga i32) (param $v i32) (call $gs32 (local.get $ga) (local.get $v)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat });

  const putA = s => {
    const p = e.guest_alloc(s.length + 1) >>> 0;
    for (let i = 0; i < s.length; i++) e.guest_write8(p + i, s.charCodeAt(i));
    e.guest_write8(p + s.length, 0);
    return p;
  };
  const putW = s => {
    const p = e.guest_alloc(2 * s.length + 2) >>> 0;
    for (let i = 0; i <= s.length; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0;
      e.guest_write8(p + 2 * i, c & 0xff);
      e.guest_write8(p + 2 * i + 1, c >> 8);
    }
    return p;
  };

  // --- open ---
  assert.strictEqual(e.test_create_file(putA('\\\\.\\QUARTZ.VXD'), 0) >>> 0, HANDLE,
    'CreateFileA opens the device (quartz spelling)');
  assert.strictEqual(e.test_last_error(), 0, 'open clears last error');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 32, 'CreateFileA pops seven args');
  assert.strictEqual(e.test_create_file(putW('\\\\.\\quartz.vxd'), 1) >>> 0, HANDLE,
    'CreateFileW opens the device, case-insensitively');
  assert.notStrictEqual(e.test_create_file(putA('\\\\.\\QUARTZ.VXDX'), 0) >>> 0, HANDLE,
    'a longer name is not the device');

  const inp = e.guest_alloc(4) >>> 0;
  const out = e.guest_alloc(4) >>> 0;
  const bytes = e.guest_alloc(4) >>> 0;

  // --- allocate a 3-page ring ---
  const pages = 3, N = pages * 0x1000;
  e.guest_write32(inp, pages);
  e.guest_write32(out, 0);
  e.guest_write32(bytes, 0xa5a5a5a5);
  assert.strictEqual(e.test_ioctl(HANDLE, 1, inp, 4, out, 4, bytes), 1, 'ioctl 1 succeeds');
  assert.strictEqual(e.test_last_error(), 0);
  assert.strictEqual(e.get_esp() >>> 0, STACK + 36, 'DeviceIoControl pops eight args');
  assert.strictEqual(e.guest_read32(bytes) >>> 0, 4, 'ioctl 1 reports four bytes out');
  const base = e.guest_read32(out) >>> 0;
  assert(base && (base & 0xffff) === 0, `ring base 0x${base.toString(16)} is 64KB aligned`);
  for (let off = 0; off < 2 * N; off += 0x1000)
    assert.strictEqual(e.test_mapped(base + off), 1, `ring page +0x${off.toString(16)} is mapped`);
  assert.strictEqual(e.test_mapped(base + 2 * N), 0, 'nothing past the upper view');

  // --- alias in both directions ---
  for (let off = 0; off < N; off += 0x7fc) {
    e.test_wr32(base + off, 0x11000000 + off);
    assert.strictEqual(e.test_rd32(base + N + off) >>> 0, 0x11000000 + off,
      `lower write at +0x${off.toString(16)} reads back through the upper view`);
    e.test_wr32(base + N + off, 0x22000000 + off);
    assert.strictEqual(e.test_rd32(base + off) >>> 0, 0x22000000 + off,
      `upper write at +0x${off.toString(16)} reads back through the lower view`);
  }
  // A dword straddling the wrap: its last byte lives in the lower view's page 0.
  e.test_wr32(base + N - 2, 0xddccbbaa);
  assert.strictEqual(e.test_rd32(base) & 0xffff, 0xddcc, 'a straddling write wraps into page 0');
  e.test_wr32(base, 0x44332211);
  assert.strictEqual(e.test_rd32(base + N - 2) >>> 0, 0x2211bbaa,
    'a straddling read sees the lower view\'s first bytes after the wrap');

  // --- refused requests ---
  const refuse = (label, err, args) => {
    assert.strictEqual(e.test_ioctl(...args), 0, `${label}: FALSE`);
    assert.strictEqual(e.test_last_error(), err, `${label}: error ${err}`);
  };
  e.guest_write32(inp, 0);
  refuse('zero pages', ERROR_INVALID_PARAMETER, [HANDLE, 1, inp, 4, out, 4, bytes]);
  e.guest_write32(inp, 1);
  refuse('short output', ERROR_INVALID_PARAMETER, [HANDLE, 1, inp, 4, out, 2, bytes]);
  refuse('unknown ioctl', ERROR_INVALID_FUNCTION, [HANDLE, 7, inp, 4, out, 4, bytes]);
  e.guest_write32(inp, base + 0x10000);
  refuse('free of a non-ring base', ERROR_INVALID_PARAMETER, [HANDLE, 2, inp, 4, 0, 0, bytes]);
  assert.strictEqual(e.test_mapped(base + N), 1, 'a refused free leaves the ring alone');

  // --- free ---
  e.guest_write32(inp, base);
  assert.strictEqual(e.test_ioctl(HANDLE, 2, inp, 4, 0, 0, bytes), 1, 'ioctl 2 frees the ring');
  for (let off = 0; off < 2 * N; off += 0x1000)
    assert.strictEqual(e.test_mapped(base + off), 0, `freed ring page +0x${off.toString(16)} is gone`);
  refuse('double free', ERROR_INVALID_PARAMETER, [HANDLE, 2, inp, 4, 0, 0, bytes]);

  // --- a second ring reuses space and still aliases ---
  e.guest_write32(inp, 16);
  assert.strictEqual(e.test_ioctl(HANDLE, 1, inp, 4, out, 4, bytes), 1, 'a second ring allocates');
  const base2 = e.guest_read32(out) >>> 0;
  e.test_wr32(base2 + 0xfffc, 0x5eed5eed);
  assert.strictEqual(e.test_rd32(base2 + 0x10000 + 0xfffc) >>> 0, 0x5eed5eed, 'second ring aliases');

  assert.strictEqual(e.test_close(HANDLE), 1, 'CloseHandle accepts the device handle');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8, 'CloseHandle pops one arg');

  console.log('PASS  QUARTZ.VXD opens, double-maps a ring across the wrap, and frees it');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
