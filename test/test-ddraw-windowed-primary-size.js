#!/usr/bin/env node
'use strict';

// A windowed DirectDraw primary (no exclusive cooperative level, no display
// mode selected) is the desktop, so it is as large as SM_CXSCREEN/SM_CYSCREEN.
// It used to default to 640x480 whatever the desktop was: on the browser's
// larger desktop, Deus Ex's D3DDrv Blt of its client rect (screen coordinates)
// to the primary was cut at x=640 / y=480. After SetDisplayMode, or with
// exclusive access, the primary is the selected mode, as before.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_wps_seed") (param $ddraw_vtbl i32) (param $surface_vtbl i32)
    (global.set $DX_VTBL_DDRAW (local.get $ddraw_vtbl))
    (global.set $DX_VTBL_DDSURF2 (local.get $surface_vtbl)))
  (func (export "test_wps_create_primary") (param $desc i32) (param $out i32) (result i32)
    (local $ddraw i32)
    (local.set $ddraw (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_IDirectDraw_CreateSurface
      (local.get $ddraw) (local.get $desc) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_wps_width") (param $surface i32) (result i32)
    (load.field DxObject width (call $dx_from_this (local.get $surface))))
  (func (export "test_wps_height") (param $surface i32) (result i32)
    (load.field DxObject height (call $dx_from_this (local.get $surface))))
  (func (export "test_wps_screen_w") (result i32) (call $screen_metric_w))
  (func (export "test_wps_screen_h") (result i32) (call $screen_metric_h))
  (func (export "test_wps_mode") (param $w i32) (param $h i32)
    (call $dx_display_w_set (local.get $w))
    (call $dx_display_h_set (local.get $h))
    (call $dx_display_mode_set (i32.const 1)))
  (func (export "test_wps_reset")
    (call $dx_display_w_set (i32.const 0))
    (call $dx_display_h_set (i32.const 0))
    (call $dx_display_mode_set (i32.const 0))
    (call $dx_exclusive_set (i32.const 0)))
  (func (export "test_wps_exclusive") (call $dx_exclusive_set (i32.const 1)))
`;

function primary(wat, desc, out) {
  for (let i = 0; i < 128; i += 4) wat.guest_write32(desc + i, 0);
  wat.guest_write32(desc, 108);
  wat.guest_write32(desc + 4, 0x1);          // DDSD_CAPS
  wat.guest_write32(desc + 104, 0x200);      // DDSCAPS_PRIMARYSURFACE
  assert.strictEqual(wat.test_wps_create_primary(desc, out) >>> 0, 0);
  const s = wat.guest_read32(out) >>> 0;
  return [wat.test_wps_width(s), wat.test_wps_height(s)];
}

(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'none', width: 1024, height: 768 });
  const wat = h.exports;
  const desc = 0x410000;
  const out = 0x410100;
  wat.test_wps_seed(0x51000000, 0x52000000);

  wat.test_wps_reset();
  const screen = [wat.test_wps_screen_w(), wat.test_wps_screen_h()];
  assert(screen[0] > 0 && screen[1] > 0);
  assert.deepStrictEqual(primary(wat, desc, out), screen,
    'a windowed primary is the desktop');

  wat.test_wps_mode(800, 600);
  assert.deepStrictEqual(primary(wat, desc, out + 4), [800, 600],
    'after SetDisplayMode the primary is the mode');

  wat.test_wps_reset();
  wat.test_wps_exclusive();
  assert.deepStrictEqual(primary(wat, desc, out + 8), [640, 480],
    'an exclusive primary with no mode keeps the 640x480 default');

  console.log(`PASS windowed DirectDraw primary is the ${screen[0]}x${screen[1]} desktop; mode/exclusive primaries unchanged`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
