#!/usr/bin/env node

'use strict';

// A scalable face created with an explicit, narrower-than-natural lfWidth
// must keep its stems.
//
// SimCity 2000 Network Edition draws its city funds as Arial at
// lfHeight=16, lfWidth=8, lfWeight=600. Two things erased the digits:
//
//   - FW_SEMIBOLD picked the Regular file. The Win9x mapper takes the
//     installed weight nearest the request, so 600 is Bold.
//   - Horizontal compression sampled one source column per output column,
//     skipping the columns in between -- whole 1-2px stems at this size. '0'
//     came out as 'C' and 'u' as 'L'. Each output column now takes the ink of
//     every source column it covers.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({});
  const mem = () => new Uint8Array(memory.buffer);
  const imageBase = wat.get_image_base() >>> 0;
  const wa = guest => RegionMap.g2w(guest, imageBase);
  const allocZero = size => {
    const pointer = wat.guest_alloc(size) >>> 0;
    mem().fill(0, wa(pointer), wa(pointer) + size);
    return pointer;
  };
  const allocStr = text => {
    const pointer = allocZero(text.length + 1);
    mem().set(Buffer.from(text, 'latin1'), wa(pointer));
    return pointer;
  };
  const WIDTH = 120;
  const HEIGHT = 48;
  const createTextDc = () => {
    const bmi = allocZero(40);
    wat.guest_write32(bmi, 40);
    wat.guest_write32(bmi + 4, WIDTH);
    wat.guest_write32(bmi + 8, -HEIGHT);
    wat.guest_write16(bmi + 12, 1);
    wat.guest_write16(bmi + 14, 32);
    const bitsOut = allocZero(4);
    const bitmap = wat.test_call_CreateDIBSection(0, bmi, 0, bitsOut, 0, 0) >>> 0;
    const hdc = wat.test_call_CreateCompatibleDC(0) >>> 0;
    wat.test_call_SelectObject(hdc, bitmap);
    wat.test_call_PatBlt(hdc, 0, 0, WIDTH, HEIGHT, 0x00FF0062);
    return hdc;
  };
  // Draw `text` in Arial and return the ink as rows of booleans.
  const render = (text, height, width, weight) => {
    const hdc = createTextDc();
    const face = allocZero(12);
    [...'Arial'].forEach((ch, i) => wat.guest_write16(face + i * 2, ch.charCodeAt(0)));
    const font = wat.test_call_CreateFontW(height, width, 0, 0, weight, 0, 0, 0, 1, 0, 0, 0, 0,
      face) >>> 0;
    wat.test_call_SelectObject(hdc, font);
    wat.test_call_TextOutA(hdc, 2, 2, allocStr(text), text.length);
    const rows = [];
    for (let y = 0; y < HEIGHT; y++) {
      const row = [];
      for (let x = 0; x < WIDTH; x++) row.push((wat.test_call_GetPixel(hdc, x, y) >>> 0) !== 0xFFFFFF);
      rows.push(row);
    }
    return rows;
  };
  const ascii = rows => rows.map(r => r.map(b => (b ? '#' : '.')).join('').replace(/\.+$/, ''))
    .filter(Boolean).join('\n');
  const inkCount = rows => rows.reduce((n, r) => n + r.filter(Boolean).length, 0);
  const bbox = rows => {
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    rows.forEach((r, y) => r.forEach((b, x) => {
      if (!b) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }));
    return { x0, x1, y0, y1 };
  };

  // FW_SEMIBOLD maps to the Bold file, FW_MEDIUM does not.
  const regular = inkCount(render('0000', 16, 0, 400));
  const medium = inkCount(render('0000', 16, 0, 500));
  const semibold = inkCount(render('0000', 16, 0, 600));
  const bold = inkCount(render('0000', 16, 0, 700));
  assert.strictEqual(medium, regular, 'FW_MEDIUM keeps the Regular file');
  assert.strictEqual(semibold, bold, 'FW_SEMIBOLD takes the Bold file');
  assert.ok(bold > regular, `bold (${bold}) inks more than regular (${regular})`);
  console.log('PASS  weight 600 selects Bold, 500 Regular');

  // A compressed '0' is still a closed ring: every row strictly inside its
  // bounding box has ink at both its left and right edge columns (+-1).
  const zero = render('0', 16, 8, 600);
  const box = bbox(zero);
  assert.ok(box.x1 > box.x0 && box.y1 - box.y0 >= 6, `narrow '0' has ink:\n${ascii(zero)}`);
  for (let y = box.y0 + 2; y <= box.y1 - 2; y++) {
    const left = zero[y][box.x0] || zero[y][box.x0 + 1];
    const right = zero[y][box.x1] || zero[y][box.x1 - 1];
    assert.ok(left && right, `narrow '0' row ${y - box.y0} lost a stem:\n${ascii(zero)}`);
  }
  console.log('PASS  16x8 semibold \'0\' keeps both stems');

  // 'u' keeps its right stem: the rightmost column carries ink over most of
  // the x-height instead of only at the baseline (the 'L' shape).
  const u = render('u', 40, 20, 600);
  const ub = bbox(u);
  let rightInk = 0;
  for (let y = ub.y0; y <= ub.y1; y++) if (u[y][ub.x1] || u[y][ub.x1 - 1]) rightInk++;
  assert.ok(rightInk >= (ub.y1 - ub.y0 + 1) * 0.7, `compressed 'u' kept its right stem:\n${ascii(u)}`);
  console.log('PASS  40x20 semibold \'u\' keeps its right stem');

  // Compression must still narrow the text, not fall back to natural width.
  const natural = bbox(render('0000', 16, 0, 600));
  const narrow = bbox(render('0000', 16, 8, 600));
  assert.ok(narrow.x1 - narrow.x0 < natural.x1 - natural.x0,
    `lfWidth=8 is narrower (${narrow.x1 - narrow.x0}) than natural (${natural.x1 - natural.x0})`);
  console.log('PASS  lfWidth still narrows the run');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
