#!/usr/bin/env node
'use strict';

// Every GDI entry point that takes a BITMAPINFO used to read it, header and
// color table alike, through one translated pointer. Two adjacent sparse guest
// pages need not be adjacent in WASM memory, so a struct that straddles a page
// boundary was read half from unrelated memory -- the CreateDIBSection case
// (SimCity 2000's pink coal plant, bd56cd1f) was one of six. The rest are
// covered here: they all gather a straddling BITMAPINFO through
// $gdi_bitmap_info_wa now.
//
// GetDIBits is also an OUT parameter: it describes the bitmap in the caller's
// header, so what the call wrote into the gathered copy has to be written back.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "dib_map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))
  (func (export "dib_pixel") (param $h i32) (param $i i32) (result i32)
    (i32.load8_u (i32.add
      (load.field.memarg GdiBitmap bits (call $gdi_object_record (local.get $h)))
      (local.get $i))))
  (func (export "dib_width") (param i32) (result i32)
    (load.field.memarg GdiBitmap width (call $gdi_object_record (local.get 0))))
  (func (export "dib_height") (param i32) (result i32)
    (load.field.memarg GdiBitmap height (call $gdi_object_record (local.get 0))))
  (func (export "dib_color") (param i32) (param i32) (result i32)
    (i32.load (i32.add
      (load.field.memarg GdiBitmap palette (call $gdi_object_record (local.get 0)))
      (i32.shl (local.get 1) (i32.const 2)))))

  ;; SetDIBits/GetDIBits take 7 stdcall arguments; the last two live on the
  ;; guest stack, so these build that frame on a caller-supplied scratch stack.
  (func (export "test_setdibits") (param $sp i32) (param $hdc i32) (param $hbmp i32)
        (param $start i32) (param $lines i32) (param $bits i32) (param $bmi i32)
        (param $usage i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $gs32 (i32.add (local.get $sp) (i32.const 24)) (local.get $bmi))
    (call $gs32 (i32.add (local.get $sp) (i32.const 28)) (local.get $usage))
    (call $handle_SetDIBits (local.get $hdc) (local.get $hbmp) (local.get $start)
      (local.get $lines) (local.get $bits) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_getdibits") (param $sp i32) (param $hdc i32) (param $hbmp i32)
        (param $start i32) (param $lines i32) (param $bits i32) (param $bmi i32)
        (param $usage i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $gs32 (i32.add (local.get $sp) (i32.const 24)) (local.get $bmi))
    (call $gs32 (i32.add (local.get $sp) (i32.const 28)) (local.get $usage))
    (call $handle_GetDIBits (local.get $hdc) (local.get $hbmp) (local.get $start)
      (local.get $lines) (local.get $bits) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  // Two guest pages deliberately committed with another page between them.
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.dib_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must be backed non-adjacently for this test to mean anything');

  const W = 8, H = 8, SIZE = 40 + 256 * 4;
  const info = new Uint8Array(SIZE), dv = new DataView(info.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, W, true); dv.setInt32(8, -H, true);
  dv.setUint16(12, 1, true); dv.setUint16(14, 8, true);
  for (let i = 0; i < 256; i++) dv.setUint32(40 + i * 4, (i * 0x010305 + 0x102030) & 0xffffff, true);
  const writeInfo = ga => { info.forEach((b, i) => e.guest_write8(ga + i, b)); return ga; };

  const bits = e.guest_alloc(W * H) >>> 0;
  for (let i = 0; i < W * H; i++) e.guest_write8(bits + i, (i * 7 + 3) & 0xff);
  const sp = ((e.guest_alloc(128) >>> 0) + 64) >>> 0;
  const out = e.guest_alloc(4) >>> 0;
  const unsplit = writeInfo(e.guest_alloc(SIZE) >>> 0);
  // Splits that cut the header, the first color entries, and the table's tail.
  const SPLITS = [4, 8, 12, 16, 40, 44, 300, SIZE - 4];
  const splitAt = n => writeInfo(page + 4096 - n);

  // SetDIBits: the source palette and geometry come from the BITMAPINFO.
  const dest = () => e.test_call_CreateDIBSection(0, unsplit, 0, out, 0, 0) >>> 0;
  const setInto = bmi => {
    const h = dest();
    assert(h, 'destination DIB section');
    const ret = e.test_setdibits(sp, 0, h, 0, H, bits, bmi, 0) | 0;
    const px = [];
    for (let i = 0; i < W * H; i++) px.push(e.dib_pixel(h, i) | 0);
    return { ret, px };
  };
  const want = setInto(unsplit);
  assert.strictEqual(want.ret, H, 'unsplit SetDIBits accepted every scan line');
  assert.ok(want.px.some(v => v !== 0), 'unsplit SetDIBits wrote pixels');
  for (const n of SPLITS) {
    const got = setInto(splitAt(n));
    assert.strictEqual(got.ret, want.ret, `SetDIBits split at byte ${n}: wrong return`);
    assert.deepStrictEqual(got.px, want.px, `SetDIBits split at byte ${n}: wrong pixels`);
  }

  // GetDIBits fills the caller's header in place: a gathered copy must be
  // written back, or the guest sees nothing at all.
  const src = dest();
  const query = bmi => {
    for (let i = 0; i < SIZE; i++) e.guest_write8(bmi + i, 0);
    e.guest_write8(bmi, 40);
    assert.ok(e.test_getdibits(sp, 0, src, 0, 0, 0, bmi, 0) | 0, 'GetDIBits query');
    const b = i => e.guest_read8(bmi + i) & 0xff;
    const u16 = i => b(i) | (b(i + 1) << 8);
    const u32 = i => (u16(i) | (u16(i + 2) << 16)) >>> 0;
    return [u16(4), u16(8), u16(14), u32(40), u32(40 + 255 * 4)];
  };
  const queryOut = e.guest_alloc(SIZE) >>> 0;
  const wantQuery = query(queryOut);
  assert.deepStrictEqual(wantQuery.slice(0, 3), [W, H, 8],
    'unsplit GetDIBits describes the bitmap');
  assert.ok(wantQuery[3] || wantQuery[4], 'unsplit GetDIBits filled in a color table');
  for (const n of SPLITS) {
    assert.deepStrictEqual(query(splitAt(n)), wantQuery,
      `GetDIBits split at byte ${n}: the caller's header was not filled in`);
  }

  // CreateDIBitmap reads the same structure through lpbmi.
  const created = bmi => {
    const h = e.test_call_CreateDIBitmap(0, bmi, 4, bits, bmi, 0) >>> 0;
    assert(h, 'CreateDIBitmap returned NULL');
    return [e.dib_width(h) | 0, e.dib_height(h) | 0,
      ...[0, 1, 200, 255].map(i => e.dib_color(h, i) >>> 0)];
  };
  const wantCreate = created(unsplit);
  assert.deepStrictEqual(wantCreate.slice(0, 2), [W, H]);
  for (const n of SPLITS) {
    assert.deepStrictEqual(created(splitAt(n)), wantCreate,
      `CreateDIBitmap split at byte ${n}: wrong bitmap`);
  }

  console.log('PASS  SetDIBits/GetDIBits/CreateDIBitmap read a BITMAPINFO split across sparse pages');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
