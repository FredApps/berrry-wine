#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_init_dx") (call $init_dx_com_thunks))
  (func (export "test_create_clipper") (result i32)
    (call $dx_create_com_obj (i32.const 10) (global.get $DX_VTBL_DDCLIP)))
  (func (export "test_create_surface") (result i32)
    (call $dx_create_com_obj (i32.const 2) (global.get $DX_VTBL_DDSURF)))
  (func (export "test_alloc") (param $bytes i32) (result i32)
    (call $heap_alloc (local.get $bytes)))
  (func (export "test_peek32") (param $ptr i32) (result i32)
    (call $gl32 (local.get $ptr)))
  (func (export "test_poke32") (param $ptr i32) (param $value i32)
    (call $gs32 (local.get $ptr) (local.get $value)))
  (func (export "test_clipper_list") (param $clipper i32) (result i32)
    (load.field DxObject misc1 (call $dx_from_this (local.get $clipper))))
  (func (export "test_shift_snapshot") (param $clipper i32)
    (local $entry i32)
    (local.set $entry (call $dx_from_this (local.get $clipper)))
    (i32.store offset=12 (local.get $entry)
      (i32.add (i32.load offset=12 (local.get $entry)) (i32.const 1))))
  (func (export "test_init_surface")
      (param $surface i32) (param $w i32) (param $h i32) (param $value i32)
      (result i32)
    (local $entry i32) (local $guest i32) (local $wa i32)
    (local $i i32) (local $pixels i32)
    (local.set $entry (call $dx_from_this (local.get $surface)))
    (local.set $pixels (i32.mul (local.get $w) (local.get $h)))
    (local.set $guest (call $heap_alloc (i32.shl (local.get $pixels) (i32.const 2))))
    (local.set $wa (call $g2w (local.get $guest)))
    (store.field DxObject width (local.get $entry) (local.get $w))
    (store.field DxObject height (local.get $entry) (local.get $h))
    (store.field DxObject bpp (local.get $entry) (i32.const 32))
    (store.field DxObject pitch (local.get $entry) (i32.shl (local.get $w) (i32.const 2)))
    (store.field DxObject misc1 (local.get $entry) (local.get $wa))
    (block $done (loop $fill
      (br_if $done (i32.ge_u (local.get $i) (local.get $pixels)))
      (i32.store (i32.add (local.get $wa) (i32.shl (local.get $i) (i32.const 2)))
        (local.get $value))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $fill)))
    (local.get $guest))
  (func (export "test_set_list")
      (param $clipper i32) (param $list i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_SetClipList
      (local.get $clipper) (local.get $list) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_list")
      (param $clipper i32) (param $filter i32) (param $list i32) (param $size i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_GetClipList
      (local.get $clipper) (local.get $filter) (local.get $list) (local.get $size)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_changed")
      (param $clipper i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_IsClipListChanged
      (local.get $clipper) (local.get $out) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_set_hwnd")
      (param $clipper i32) (param $hwnd i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_SetHWnd
      (local.get $clipper) (i32.const 0) (local.get $hwnd)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_set_surface_clipper")
      (param $surface i32) (param $clipper i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawSurface_SetClipper
      (local.get $surface) (local.get $clipper) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_blt")
      (param $dst i32) (param $src i32) (param $flags i32) (param $fx i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $fx))
    (call $handle_IDirectDrawSurface_Blt
      (local.get $dst) (i32.const 0) (local.get $src) (i32.const 0)
      (local.get $flags) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_blt_fast")
      (param $dst i32) (param $src i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (i32.const 0))
    (call $handle_IDirectDrawSurface_BltFast
      (local.get $dst) (i32.const 0) (i32.const 0) (local.get $src)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_release_clipper") (param $clipper i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawClipper_Release
      (local.get $clipper) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

function put32(e, ptr, offset, value) {
  e.test_poke32((ptr + offset) >>> 0, value | 0);
}

function get32(e, ptr, offset = 0) {
  return e.test_peek32((ptr + offset) >>> 0) | 0;
}

function makeRegion(e, rects, { size = 32, type = 1, regionBytes = rects.length * 16 } = {}) {
  const ptr = e.test_alloc(32 + rects.length * 16) >>> 0;
  put32(e, ptr, 0, size);
  put32(e, ptr, 4, type);
  put32(e, ptr, 8, rects.length);
  put32(e, ptr, 12, regionBytes);
  rects.forEach(([left, top, right, bottom], index) => {
    const offset = 32 + index * 16;
    put32(e, ptr, offset, left);
    put32(e, ptr, offset + 4, top);
    put32(e, ptr, offset + 8, right);
    put32(e, ptr, offset + 12, bottom);
  });
  return ptr;
}

(async () => {
  const DD_OK = 0;
  const DDERR_INVALIDCLIPLIST = 0x8876006e | 0;
  const DDERR_INVALIDPARAMS = 0x80070057 | 0;
  const DDERR_NOCLIPLIST = 0x887600cd | 0;
  const DDERR_REGIONTOOSMALL = 0x88760236 | 0;
  const DDERR_CLIPPERISUSINGHWND = 0x88760237 | 0;
  const DDERR_UNSUPPORTED = 0x80004001 | 0;
  const DESKTOP_HWND = 0x10000;

  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_init_dx();

  const clipper = e.test_create_clipper() >>> 0;
  const sizeOut = e.test_alloc(4) >>> 0;
  const output = e.test_alloc(96) >>> 0;
  const changed = e.test_alloc(4) >>> 0;
  assert(clipper && sizeOut && output && changed);

  assert.strictEqual(e.test_get_list(clipper, 0, 0, sizeOut), DDERR_NOCLIPLIST,
    'a new clipper has no explicit or HWND-derived clip list');
  assert.strictEqual(e.test_changed(clipper, 0), DDERR_INVALIDPARAMS,
    'IsClipListChanged rejects a null BOOL output');

  const malformed = makeRegion(e, [[0, 0, 1, 1]], { size: 28 });
  assert.strictEqual(e.test_set_list(clipper, malformed, 0), DDERR_INVALIDCLIPLIST,
    'SetClipList validates the RGNDATAHEADER size');
  const inverted = makeRegion(e, [[4, 1, 3, 2]]);
  assert.strictEqual(e.test_set_list(clipper, inverted, 0), DDERR_INVALIDCLIPLIST,
    'SetClipList rejects inverted rectangles');
  const input = makeRegion(e, [[1, 1, 4, 4], [5, 0, 7, 2]]);
  assert.strictEqual(e.test_set_list(clipper, input, 1), DDERR_INVALIDPARAMS,
    'SetClipList requires the reserved flags to be zero');
  assert.strictEqual(e.test_set_list(clipper, input, 0), DD_OK,
    'SetClipList accepts a bounded rectangle list');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300010,
    'SetClipList pops this and its two arguments');
  const privateCopy = e.test_clipper_list(clipper) >>> 0;
  assert(privateCopy && privateCopy !== input,
    'the clipper owns a private copy instead of retaining caller storage');

  put32(e, input, 32, 99);
  put32(e, sizeOut, 0, 0);
  assert.strictEqual(e.test_get_list(clipper, 0, 0, sizeOut), DD_OK,
    'NULL output performs the documented size query');
  assert.strictEqual(get32(e, sizeOut), 64);
  assert.strictEqual(e.get_esp() >>> 0, 0x00300014,
    'GetClipList pops this and its three arguments');

  put32(e, sizeOut, 0, 63);
  assert.strictEqual(e.test_get_list(clipper, 0, output, sizeOut), DDERR_REGIONTOOSMALL,
    'a short output buffer reports DDERR_REGIONTOOSMALL');
  assert.strictEqual(get32(e, sizeOut), 64,
    'the short-buffer failure still publishes the required size');
  put32(e, sizeOut, 0, 96);
  assert.strictEqual(e.test_get_list(clipper, 0, output, sizeOut), DD_OK);
  assert.deepStrictEqual([
    get32(e, output, 0), get32(e, output, 4), get32(e, output, 8), get32(e, output, 12),
    get32(e, output, 16), get32(e, output, 20), get32(e, output, 24), get32(e, output, 28),
  ], [32, 1, 2, 32, 1, 0, 7, 4], 'GetClipList emits a canonical header and bound');
  assert.deepStrictEqual([
    get32(e, output, 32), get32(e, output, 36), get32(e, output, 40), get32(e, output, 44),
    get32(e, output, 48), get32(e, output, 52), get32(e, output, 56), get32(e, output, 60),
  ], [1, 1, 4, 4, 5, 0, 7, 2], 'the retained rectangles survive caller mutation');

  const filter = e.test_alloc(16) >>> 0;
  [2, 1, 6, 3].forEach((value, index) => put32(e, filter, index * 4, value));
  put32(e, sizeOut, 0, 96);
  assert.strictEqual(e.test_get_list(clipper, filter, output, sizeOut), DD_OK);
  assert.deepStrictEqual([
    get32(e, output, 16), get32(e, output, 20), get32(e, output, 24), get32(e, output, 28),
    get32(e, output, 32), get32(e, output, 36), get32(e, output, 40), get32(e, output, 44),
    get32(e, output, 48), get32(e, output, 52), get32(e, output, 56), get32(e, output, 60),
  ], [2, 1, 6, 3, 2, 1, 4, 3, 5, 1, 6, 2],
  'lpRect returns the non-empty rectangle intersections and their bound');

  assert.strictEqual(e.test_set_hwnd(clipper, DESKTOP_HWND), DDERR_INVALIDCLIPLIST,
    'SetHWnd cannot replace an existing explicit clip list');
  assert.strictEqual(e.test_set_list(clipper, 0, 0), DD_OK,
    'SetClipList(NULL) deletes an explicit list');
  assert.strictEqual(e.test_get_list(clipper, 0, 0, sizeOut), DDERR_NOCLIPLIST);
  assert.strictEqual(e.test_set_hwnd(clipper, DESKTOP_HWND), DD_OK,
    'SetHWnd succeeds after the explicit list is removed');
  assert.strictEqual(e.test_set_hwnd(clipper, DESKTOP_HWND), DD_OK,
    'refreshing an existing HWND association does not confuse its cached rectangle with an explicit list');
  assert.strictEqual(e.test_set_list(clipper, input, 0), DDERR_CLIPPERISUSINGHWND,
    'SetClipList cannot replace an HWND-derived clip list');
  put32(e, changed, 0, 0x7f7f7f7f);
  assert.strictEqual(e.test_changed(clipper, changed), DD_OK);
  assert.strictEqual(get32(e, changed), 0, 'a newly captured HWND region is unchanged');
  e.test_shift_snapshot(clipper);
  assert.strictEqual(e.test_changed(clipper, changed), DD_OK);
  assert.strictEqual(get32(e, changed), 1, 'client geometry changes are detected');
  put32(e, sizeOut, 0, 96);
  assert.strictEqual(e.test_get_list(clipper, 0, output, sizeOut), DD_OK,
    'an HWND clipper exposes its current client rectangle as RGNDATA');
  assert.strictEqual(e.test_changed(clipper, changed), DD_OK);
  assert.strictEqual(get32(e, changed), 0, 'copying the current HWND list clears the change latch');

  const regionClipper = e.test_create_clipper() >>> 0;
  const region = makeRegion(e, [[1, 1, 4, 4], [5, 0, 7, 2]]);
  assert.strictEqual(e.test_set_list(regionClipper, region, 0), DD_OK);
  const retainedForRelease = e.test_clipper_list(regionClipper) >>> 0;
  const dst = e.test_create_surface() >>> 0;
  const src = e.test_create_surface() >>> 0;
  const dstPixels = e.test_init_surface(dst, 8, 5, 0x11111111) >>> 0;
  e.test_init_surface(src, 8, 5, 0xaabbccdd);
  assert.strictEqual(e.test_set_surface_clipper(dst, regionClipper), DD_OK);
  assert.strictEqual(e.test_blt_fast(dst, src), DDERR_UNSUPPORTED,
    'BltFast rejects a destination surface with any attached clipper');
  assert.strictEqual(e.test_blt(dst, src, 0, 0), DD_OK,
    'Blt accepts and applies an attached explicit clip list');
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 8; x++) {
      const visible = (x >= 1 && x < 4 && y >= 1 && y < 4)
        || (x >= 5 && x < 7 && y >= 0 && y < 2);
      assert.strictEqual(get32(e, dstPixels, (y * 8 + x) * 4) >>> 0,
        visible ? 0xaabbccdd : 0x11111111,
        `copy clipping at ${x},${y}`);
    }
  }

  const fx = e.test_alloc(100) >>> 0;
  put32(e, fx, 80, 0x12345678);
  assert.strictEqual(e.test_blt(dst, 0, 0x400, fx), DD_OK,
    'color-fill Blt also honors the explicit region');
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 8; x++) {
      const visible = (x >= 1 && x < 4 && y >= 1 && y < 4)
        || (x >= 5 && x < 7 && y >= 0 && y < 2);
      assert.strictEqual(get32(e, dstPixels, (y * 8 + x) * 4) >>> 0,
        visible ? 0x12345678 : 0x11111111,
        `fill clipping at ${x},${y}`);
    }
  }

  assert.strictEqual(e.test_set_surface_clipper(dst, 0), DD_OK);
  assert.strictEqual(e.test_release_clipper(regionClipper), 0);
  assert.strictEqual(e.test_alloc(64) >>> 0, retainedForRelease,
    'final clipper release returns its canonical RGNDATA allocation to the heap');

  console.log('PASS DirectDraw clip lists own RGNDATA, round-trip, detect changes and clip Blt');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
