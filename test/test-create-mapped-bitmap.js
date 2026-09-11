#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const extraWat = String.raw`
  (global $test_cmb_cleanup (mut i32) (i32.const 0))
  (func (export "test_create_mapped_bitmap")
      (param $instance i32) (param $id i32) (param $flags i32)
      (param $map i32) (param $count i32) (result i32)
    (local $before i32)
    (global.set $esp (call $w2g (region.addr $GUEST_STACK 524288)))
    (local.set $before (global.get $esp))
    (call $handle_CreateMappedBitmap
      (local.get $instance) (local.get $id) (local.get $flags)
      (local.get $map) (local.get $count) (i32.const 0))
    (global.set $test_cmb_cleanup
      (i32.sub (global.get $esp) (local.get $before)))
    (global.get $eax))
  (func (export "test_cmb_cleanup") (result i32)
    (global.get $test_cmb_cleanup))
`;

(async () => {
  const { exports: e, memory, gdi } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const guestBase = RegionMap.GUEST_BASE;
  const root = guestBase + 0x1000;
  const payload = guestBase + 0x1100;

  // Minimal PE resource tree: RT_BITMAP / 101 / language 1033.
  dv.setUint32(guestBase + 0x3C, 0x80, true);
  dv.setUint32(guestBase + 0x80 + 136, 0x1000, true);
  dv.setUint16(root + 14, 1, true);
  dv.setUint32(root + 16, 2, true);
  dv.setUint32(root + 20, 0x80000020, true);
  dv.setUint16(root + 0x20 + 14, 1, true);
  dv.setUint32(root + 0x30, 101, true);
  dv.setUint32(root + 0x34, 0x80000040, true);
  dv.setUint16(root + 0x40 + 14, 1, true);
  dv.setUint32(root + 0x50, 1033, true);
  dv.setUint32(root + 0x54, 0x60, true);
  dv.setUint32(root + 0x60, 0x1100, true);
  dv.setUint32(root + 0x64, 56, true);

  // Two-color, 2x2 indexed RT_BITMAP. Palette and pixels are replaced between
  // calls; every returned HBITMAP must own its mapped copy.
  dv.setUint32(payload, 40, true);
  dv.setInt32(payload + 4, 2, true);
  dv.setInt32(payload + 8, 2, true);
  dv.setUint16(payload + 12, 1, true);
  dv.setUint16(payload + 14, 8, true);
  dv.setUint32(payload + 32, 2, true);
  bytes.set([0, 1, 0xAA, 0xBB, 1, 0, 0xCC, 0xDD], payload + 48);
  e.init_thread(0, 0, 0, 0, 0, 0, 0, 0x1000);

  const paletteWord = (bitmap, index = 0) => {
    const palette = e.test_gdi_bitmap_palette(bitmap) >>> 0;
    assert(palette, 'mapped bitmap has an owned indexed palette');
    return dv.getUint32(palette + index * 4, true) & 0x00FFFFFF;
  };

  // Custom COLORMAP entries are COLORREFs (00BBGGRR), while DIB palettes are
  // RGBQUAD byte words (00RRGGBB). Exercise the asymmetric channel conversion.
  bytes.set([0x30, 0x20, 0x10, 0, 0, 0, 0, 0], payload + 40);
  const map = e.guest_alloc(8) >>> 0;
  e.guest_write32(map, 0x00302010);     // RGB(10,20,30)
  e.guest_write32(map + 4, 0x00C0B0A0); // RGB(A0,B0,C0)
  const custom = e.test_create_mapped_bitmap(0, 101, 0, map, 1) >>> 0;
  assert(custom, 'valid bitmap resource produces an HBITMAP');
  assert.strictEqual(paletteWord(custom), 0x00A0B0C0,
    'custom map replaces the matching RGBQUAD with channel order preserved');
  const customPresentation = gdi.surfacePresentations.get(custom);
  customPresentation.flush();
  assert.deepStrictEqual(customPresentation.surface.palette[0],
    [0xA0, 0xB0, 0xC0],
    'the browser presentation refreshes from the mapped WAT-owned palette');
  assert.strictEqual(e.test_cmb_cleanup(), 24,
    'CreateMappedBitmap pops return address plus five arguments');

  // A NULL map selects Win98's six stock toolbar mappings. Pure blue maps to
  // COLOR_HIGHLIGHT, which is dark blue in this Win98 classic palette.
  bytes.set([0xFF, 0, 0, 0, 0, 0, 0, 0], payload + 40);
  const defaults = e.test_create_mapped_bitmap(0, 101, 0, 0, 99) >>> 0;
  assert(defaults);
  assert.strictEqual(paletteWord(defaults), 0x00000080,
    'NULL COLORMAP uses the Win98 blue-to-COLOR_HIGHLIGHT default');
  const wordId = e.test_create_mapped_bitmap(0, 0x12340065, 0, 0, 0) >>> 0;
  assert(wordId);
  assert.strictEqual(paletteWord(wordId), 0x00000080,
    'Win98 reads idBitmap from the low WORD of its INT_PTR argument slot');

  const noMaps = e.test_create_mapped_bitmap(0, 101, 0, map, 0) >>> 0;
  assert(noMaps);
  assert.strictEqual(paletteWord(noMaps), 0x000000FF,
    'a non-NULL zero-length map leaves the palette unchanged');

  bytes.set([
    0xFF, 0x00, 0xFF, 0, // mapped magenta: transparent mask bit
    0x00, 0x00, 0x00, 0, // black: opaque mask bit
  ], payload + 40);
  const masked = e.test_create_mapped_bitmap(0, 101, 2, map, 0) >>> 0;
  assert(masked);
  const maskedPresentation = gdi.surfacePresentations.get(masked);
  assert.strictEqual(maskedPresentation.width, 4,
    'CMB_MASKED doubles the source width for image and mask halves');
  assert.strictEqual(maskedPresentation.height, 2);
  assert.strictEqual(maskedPresentation.surface.bpp, 32,
    'CMB_MASKED returns a display-compatible color bitmap');
  maskedPresentation.flush();
  const maskedRgba = maskedPresentation.surface.rgbaRect(0, 0, 4, 2);
  const rgb = pixel => [...maskedRgba.subarray(pixel * 4, pixel * 4 + 3)];
  assert.deepStrictEqual([0, 1, 2, 3].map(rgb), [
    [0, 0, 0], [255, 0, 255], [0, 0, 0], [255, 255, 255],
  ], 'top row contains mapped image followed by black/white transparency mask');
  assert.deepStrictEqual([4, 5, 6, 7].map(rgb), [
    [255, 0, 255], [0, 0, 0], [255, 255, 255], [0, 0, 0],
  ], 'bottom row preserves orientation in both CMB_MASKED halves');

  bytes.set([0xFF, 0, 0, 0, 0, 0, 0, 0], payload + 40);
  const tooMany = e.guest_alloc(17 * 8) >>> 0;
  for (let i = 0; i < 17; i++) {
    e.guest_write32(tooMany + i * 8, i === 16 ? 0x00FF0000 : 0x00010203);
    e.guest_write32(tooMany + i * 8 + 4, 0x0000FF00);
  }
  const clamped = e.test_create_mapped_bitmap(0, 101, 0, tooMany, 17) >>> 0;
  assert(clamped);
  assert.strictEqual(paletteWord(clamped), 0x000000FF,
    'Win98 ignores custom color-map entries beyond its sixteen-entry cap');

  assert.strictEqual(e.test_create_mapped_bitmap(0, 999, 0, 0, 0), 0,
    'a missing RT_BITMAP returns NULL instead of a fabricated blank bitmap');

  console.log('PASS  CreateMappedBitmap applies Win98 color maps, masks, and load failures');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
