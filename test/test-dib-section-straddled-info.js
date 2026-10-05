#!/usr/bin/env node
'use strict';

// CreateDIBSection reads its BITMAPINFO, header and color table alike,
// through one translated pointer. A guest heap block that straddles two
// sparse pages is not linear in WASM memory when the pages were committed
// with another page in between. SimCity 2000's power-plant picker builds a
// 1064-byte BITMAPINFO at 0x7ee3aff8, so biHeight is the first dword of the
// next page. The call returned NULL (no coal picture), or, when only the color
// table crossed, built the picture with a garbage palette (a pink coal plant).
// Every split of the 1064 bytes must produce the same bitmap as an unsplit
// copy.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "dib_map") (param i32) (result i32)
      (call $virtual_map_commit (local.get 0) (i32.const 4096)))
    (func (export "dib_width") (param i32) (result i32)
      (load.field.memarg GdiBitmap width (call $gdi_object_record (local.get 0))))
    (func (export "dib_height") (param i32) (result i32)
      (load.field.memarg GdiBitmap height (call $gdi_object_record (local.get 0))))
    (func (export "dib_flags") (param i32) (result i32)
      (load.field.memarg GdiBitmap flags (call $gdi_object_record (local.get 0))))
    (func (export "dib_color") (param i32) (param i32) (result i32)
      (i32.load (i32.add
        (load.field.memarg GdiBitmap palette (call $gdi_object_record (local.get 0)))
        (i32.shl (local.get 1) (i32.const 2)))))
  ` });
  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.dib_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must be backed non-adjacently for this test to mean anything');

  const SIZE = 40 + 256 * 4;
  const info = new Uint8Array(SIZE), dv = new DataView(info.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, 64, true); dv.setInt32(8, -56, true);
  dv.setUint16(12, 1, true); dv.setUint16(14, 8, true);
  for (let i = 0; i < 256; i++) dv.setUint32(40 + i * 4, (i * 0x010305 + 0x102030) & 0xffffff, true);
  const out = e.guest_alloc(4) >>> 0;
  const create = ga => {
    info.forEach((b, i) => e.guest_write8(ga + i, b));
    return e.test_call_CreateDIBSection(0, ga, 0, out, 0, 0) >>> 0;
  };
  const shape = h => [e.dib_width(h), e.dib_height(h), e.dib_flags(h),
    ...[0, 1, 5, 128, 200, 255].map(i => e.dib_color(h, i) >>> 0)];

  const reference = create(e.guest_alloc(SIZE) >>> 0);
  assert(reference, 'unsplit BITMAPINFO creates a section');
  const want = shape(reference);
  assert.deepStrictEqual(want.slice(0, 2), [64, 56]);

  for (const split of [4, 8, 9, 12, 40, 41, 300, SIZE - 4]) {
    const h = create(page + 4096 - split);
    assert(h, `split at byte ${split}: CreateDIBSection returned NULL`);
    assert.deepStrictEqual(shape(h), want, `split at byte ${split}: wrong bitmap`);
  }
  console.log('PASS  CreateDIBSection: a BITMAPINFO split across non-adjacent sparse pages reads whole');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
