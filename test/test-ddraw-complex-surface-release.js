#!/usr/bin/env node
'use strict';

// Releasing the front of a complex surface destroys the implicit attachments
// CreateSurface made for it: a flip chain's back buffer and every mip level
// below the top. The Plus! 98 Organic Art savers rebuild their whole D3DRM
// device on each form change, and every rebuild used to leave a 640x480 back
// buffer live in the DIB arena. A reference the application still holds keeps
// the attachment alive, exactly as on Windows.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_cs_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))
  (func (export "test_cs_ddraw") (result i32)
    (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
  (func (export "test_cs_create") (param $ddraw i32) (param $desc i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_cs_attached") (param $surface i32) (param $caps i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDrawSurface_GetAttachedSurface
      (local.get $surface) (local.get $caps) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_cs_release") (param $surface i32) (result i32)
    (call $dx_surface_release (local.get $surface)))
  (func (export "test_cs_live") (param $surface i32) (result i32)
    (i32.ne (call $ddraw_surface_entry_checked (local.get $surface)) (i32.const 0)))
  (func (export "test_cs_vidmem") (result i32) (global.get $dx_vidmem_used))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });
  const desc = 0x410000, out = 0x410100, caps = 0x410200, got = 0x410300;
  wat.test_cs_seed(0x51000000, 0x52000000);
  const ddraw = wat.test_cs_ddraw();
  const vidmemBefore = wat.test_cs_vidmem();

  function describe(flags, w, h, count, capsBits) {
    for (let i = 0; i < 108; i += 4) wat.guest_write32(desc + i, 0);
    wat.guest_write32(desc, 108);
    wat.guest_write32(desc + 4, flags);
    wat.guest_write32(desc + 8, h);
    wat.guest_write32(desc + 12, w);
    wat.guest_write32(desc + 20, count);   // dwBackBufferCount / dwMipMapCount union
    wat.guest_write32(desc + 104, capsBits);
  }

  function attachment(surface, capsBits) {
    wat.guest_write32(caps, capsBits);
    assert.strictEqual(wat.test_cs_attached(surface, caps, got) >>> 0, 0,
      'GetAttachedSurface finds the implicit attachment');
    return wat.guest_read32(got) >>> 0;
  }

  // Flip chain: DDSD_CAPS|DDSD_BACKBUFFERCOUNT, PRIMARY|FLIP|COMPLEX.
  describe(0x21, 0, 0, 1, 0x200 | 0x10 | 0x8);
  assert.strictEqual(wat.test_cs_create(ddraw, desc, out) >>> 0, 0);
  let front = wat.guest_read32(out) >>> 0;
  let back = attachment(front, 0x4);          // DDSCAPS_BACKBUFFER
  assert.notStrictEqual(back, front);
  assert.strictEqual(wat.test_cs_release(back), 1,
    'dropping the caller\'s reference leaves the chain\'s own');
  assert.strictEqual(wat.test_cs_release(front), 0);
  assert.strictEqual(wat.test_cs_live(back), 0,
    'the back buffer dies with the front of its flip chain');
  assert.strictEqual(wat.test_cs_vidmem(), vidmemBefore,
    'every byte of the chain is refunded');

  // A reference the application still holds keeps the back buffer alive.
  describe(0x21, 0, 0, 1, 0x200 | 0x10 | 0x8);
  assert.strictEqual(wat.test_cs_create(ddraw, desc, out) >>> 0, 0);
  front = wat.guest_read32(out) >>> 0;
  back = attachment(front, 0x4);
  assert.strictEqual(wat.test_cs_release(front), 0);
  assert.strictEqual(wat.test_cs_live(back), 1,
    'a held back buffer outlives its front');
  assert.strictEqual(wat.test_cs_release(back), 0);
  assert.strictEqual(wat.test_cs_live(back), 0);
  assert.strictEqual(wat.test_cs_vidmem(), vidmemBefore);

  // Mip chain: DDSD_CAPS|HEIGHT|WIDTH|MIPMAPCOUNT, TEXTURE|MIPMAP|COMPLEX.
  describe(0x7 | 0x20000, 64, 64, 3, 0x1000 | 0x400000 | 0x8);
  assert.strictEqual(wat.test_cs_create(ddraw, desc, out) >>> 0, 0);
  const top = wat.guest_read32(out) >>> 0;
  const level1 = attachment(top, 0x1000 | 0x400000);
  const level2 = attachment(level1, 0x1000 | 0x400000);
  assert.strictEqual(wat.test_cs_release(level1), 1);
  assert.strictEqual(wat.test_cs_release(level2), 1);
  assert.strictEqual(wat.test_cs_release(top), 0);
  assert.strictEqual(wat.test_cs_live(level1), 0, 'mip level 1 dies with the top level');
  assert.strictEqual(wat.test_cs_live(level2), 0, 'and so does level 2, through level 1');
  assert.strictEqual(wat.test_cs_vidmem(), vidmemBefore);

  console.log('PASS  releasing a complex surface releases its implicit attachments');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
