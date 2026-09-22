#!/usr/bin/env node
'use strict';

// A positive LOGFONT height smaller than every installed MS Sans Serif strike
// still maps to the smallest strike, the 13px (8pt) cell: a raster font cannot
// be shrunk, only multiplied. SimCity 2000's Select Power Plant picker asks for
// CreateFontA(8, ..., "MS Sans Serif") and lays its "200 Mw  $4,000" captions
// out around the extents it gets back.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

(async () => {
  const { exports: wat, memory } = await bootRenderHarness();
  const bytes = new Uint8Array(memory.buffer);
  const imageBase = wat.get_image_base() >>> 0;
  const wa = guest => RegionMap.g2w(guest, imageBase);
  const allocZero = size => {
    const guest = wat.guest_alloc(size) >>> 0;
    assert(guest, `guest_alloc(${size}) failed`);
    bytes.fill(0, wa(guest), wa(guest) + size);
    return guest;
  };
  const writeWide = value => {
    const guest = allocZero((value.length + 1) * 2);
    [...value].forEach((ch, i) => wat.guest_write16(guest + i * 2, ch.charCodeAt(0)));
    return guest;
  };
  const bmi = allocZero(40);
  wat.guest_write32(bmi, 40);
  wat.guest_write32(bmi + 4, 64);
  wat.guest_write32(bmi + 8, -32);
  wat.guest_write16(bmi + 12, 1);
  wat.guest_write16(bmi + 14, 32);
  const bitmap = wat.test_call_CreateDIBSection(0, bmi, allocZero(4)) >>> 0;
  const hdc = wat.test_call_CreateCompatibleDC(0) >>> 0;
  assert.notStrictEqual(wat.test_call_SelectObject(hdc, bitmap) | 0, -1);

  const text = allocZero(4);
  bytes.set(Buffer.from('200\0', 'latin1'), wa(text));
  const size = allocZero(8);
  const extentFor = height => {
    const font = wat.test_call_CreateFontW(height, 400, 0, writeWide('MS Sans Serif')) >>> 0;
    assert(font, 'CreateFontW failed');
    wat.test_call_SelectObject(hdc, font);
    assert.strictEqual(wat.test_call_GetTextExtentExPointA(hdc, text, 3, 0x7fffffff, 0, 0, size), 1);
    return [wat.guest_read32(size), wat.guest_read32(size + 4)];
  };
  const ref = extentFor(13);
  console.log('height 13 ->', ref, ' height 8 ->', extentFor(8), ' height -8 ->', extentFor(-8));
  assert.strictEqual(ref[1], 13, '13px request is the 8pt strike');
  assert.deepStrictEqual(extentFor(8), ref, 'an 8px cell request maps to the 13px strike');
  assert.deepStrictEqual(extentFor(-8), ref, 'an 8px character request maps to the 13px strike');
  console.log('PASS  gdi: MS Sans Serif below its smallest strike maps to the 13px strike');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
