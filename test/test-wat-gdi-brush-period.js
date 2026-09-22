#!/usr/bin/env node

'use strict';

// $gdi_brush_fill_span and $gdi_brush_sample are two statements of the same
// function.
//
// The filler used to call the sampler once per pixel. It now asks
// $gdi_brush_x_period how far the brush repeats along x, samples one period,
// and reads the rest of the row out of that table -- so a brush whose real
// period the period function gets wrong renders a row the sampler would never
// produce, and nothing in the shape tests would say so: they assert pictures
// of shapes drawn with a handful of brushes, not the whole brush vocabulary.
//
// So this is a differential oracle, not a transcript. For every kind of brush
// the sampler knows about, it fills a row through the filler and demands the
// row equal what the sampler says pixel by pixel. Two claims are checked:
//
//   A. the filled row == the per-pixel sampler, at ROP2 13 (COPYPEN), where
//      "what the sampler says" is literally the destination colour.
//   B. filling [l,r) in one call == filling it in two adjacent calls, for any
//      ROP2. Splitting a span repeats no pixel, so this holds whatever the
//      raster op does -- and it is the claim that catches a period that is a
//      multiple or divisor of the truth, which claim A can miss when the span
//      happens to start on a period boundary.
//
// A brush whose period $gdi_brush_x_period declines (returns 0) still has to
// pass both: the filler falls back to the per-pixel loop, and that fallback
// agreeing is exactly what makes declining safe.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const RegionMap = require('../lib/region-map.generated.js');

const MARKER = 0x123456;   // pre-fill, so "the filler skipped this pixel" shows
const TRANSPARENT = 0x01000001;
const INVALID = 0x01000000;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness();
  const bytes = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  let passed = 0;
  let failures = 0;

  function check(name, fn) {
    try {
      fn();
      passed++;
      console.log(`PASS  ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    }
  }

  // Same shape as test-wat-gdi-shapes.js's target(): a 32bpp top-down surface
  // descriptor plus a DC with an explicit full-surface clip.
  let nextBits = 0x02000000;
  let nextDesc = 0x00100000;
  let nextHdc = 0x00320000;
  let nextHandle = 0x00420000;

  function target(width, height) {
    const stride = width * 4;
    const bits = nextBits;
    const desc = nextDesc;
    const hdc = nextHdc++;
    nextBits += stride * height + 0x1000;
    nextDesc += 0x100;
    const fields = [bits, width, height, stride, 32, 1,
      0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0];
    fields.forEach((value, index) => dv.setInt32(desc + index * 4, value, true));
    const clip = wat.test_gdi_rgn_alloc_rect(0, 0, width, height);
    assert.strictEqual(wat.test_gdi_dc_clip_select(hdc, clip), 2);
    wat.test_gdi_rgn_delete(clip);
    return { hdc, desc, bits, width, height, stride };
  }

  function fillMarker(t) {
    for (let i = 0; i < t.width * t.height; i++) {
      dv.setUint32(t.bits + i * 4, MARKER, true);
    }
  }

  // $gdi_brush_sample answers in COLORREF order (0x00BBGGRR, which is what a
  // guest passes to CreateSolidBrush); the 32bpp surface stores XRGB. The
  // rasterizer swaps on the way in, so the oracle has to swap on the way out.
  const swapRb = c => ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >>> 16) & 0xFF);

  function colorAt(t, x, y) {
    const p = t.bits + y * t.stride + x * 4;
    return bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
  }

  function object(type, style, width, color, flags = 0) {
    const handle = nextHandle++;
    assert.strictEqual(
      wat.test_gdi_object_adopt(handle, type, style, width, color, flags), handle);
    return handle;
  }

  // A colour DIB of the given size, filled with a deliberately aperiodic
  // pattern so a wrong period cannot coincide with the right picture.
  function patternBitmap(width, height) {
    const bmi = wat.guest_alloc(40) >>> 0;
    const out = wat.guest_alloc(4) >>> 0;
    for (let offset = 0; offset < 40; offset += 4) wat.guest_write32(bmi + offset, 0);
    wat.guest_write32(bmi, 40);
    wat.guest_write32(bmi + 4, width);
    wat.guest_write32(bmi + 8, -height);
    wat.guest_write16(bmi + 12, 1);
    wat.guest_write16(bmi + 14, 32);
    const bitmap = wat.test_call_CreateDIBSection(0, bmi, 0, out, 0, 0) >>> 0;
    const bitsGa = wat.guest_read32(out) >>> 0;
    assert(bitmap && bitsGa, 'CreateDIBSection failed');
    const bits = RegionMap.BASE.DIB_BACKING_BASE + (bitsGa - 0x50000000);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = ((x * 37 + y * 101) & 0xFF) |
          (((x * 13 + y * 7) & 0xFF) << 8) | (((x ^ (y * 3)) & 0xFF) << 16);
        dv.setUint32(bits + (y * width + x) * 4, v, true);
      }
    }
    return bitmap;
  }

  // A packed DIB (header immediately followed by bits) in guest memory, which
  // is what CreateDIBPatternBrushPt takes.
  function packedDib(width, height) {
    const stride = width * 4;
    const ptr = wat.guest_alloc(40 + stride * height) >>> 0;
    for (let offset = 0; offset < 40; offset += 4) wat.guest_write32(ptr + offset, 0);
    wat.guest_write32(ptr, 40);
    wat.guest_write32(ptr + 4, width);
    wat.guest_write32(ptr + 8, -height);
    wat.guest_write16(ptr + 12, 1);
    wat.guest_write16(ptr + 14, 32);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        wat.guest_write32(ptr + 40 + (y * width + x) * 4,
          ((x * 53 + y * 17) & 0xFFFFFF));
      }
    }
    return ptr;
  }

  const brushes = [];
  const add = (name, handle) => {
    assert(handle, `${name}: no brush handle`);
    brushes.push({ name, brush: handle >>> 0 });
  };

  // System colour brushes are small integers, not GDI handles.
  for (const index of [1, 16, 23]) add(`sys colour ${index}`, index);
  // Stock brushes. DKGRAY (0x30013) is the (x+y) parity checker, so its period
  // along x is 2 -- the only stock brush that is not one colour per row.
  for (const stock of [0x30010, 0x30011, 0x30012, 0x30013, 0x30014, 0x30015]) {
    add(`stock 0x${stock.toString(16)}`, stock);
  }
  add('solid', wat.test_call_CreateSolidBrush(0x00123456));
  add('hollow', object(2, 1, 0, 0));
  for (let hatch = 0; hatch < 6; hatch++) {
    add(`hatch ${hatch}`, wat.test_call_CreateHatchBrush(hatch, 0x0000FF00));
  }
  // Pattern brushes at three widths: a power of two, an odd width that no
  // span boundary lands on, and one wider than the spans below.
  for (const [w, h] of [[8, 4], [3, 5], [40, 2]]) {
    add(`pattern ${w}x${h}`,
      wat.test_call_CreatePatternBrush(patternBitmap(w, h)));
  }
  add('dib pattern 5x3',
    wat.test_call_CreateDIBPatternBrushPt(packedDib(5, 3), 0));
  // Not a brush at all: the sampler returns its invalid sentinel for every x,
  // and the filler must write nothing rather than paint the sentinel.
  add('not a brush', 0x00990099);

  const SPANS = [[0, 40], [1, 40], [3, 29], [7, 8], [0, 1], [11, 12]];

  check('a filled row equals the per-pixel sampler for every brush', () => {
    const t = target(40, 12);
    for (const { name, brush } of brushes) {
      for (const [left, right] of SPANS) {
        for (let y = 0; y < t.height; y++) {
          fillMarker(t);
          const wrote = wat.test_gdi_brush_fill_span(
            t.hdc, t.desc, y, left, right, brush, 13);
          let expectedWrote = 0;
          for (let x = left; x < right; x++) {
            const sample = wat.test_gdi_brush_sample(t.hdc, brush, x, y) >>> 0;
            const want = sample <= 0xFFFFFF ? swapRb(sample) : MARKER;
            if (sample <= 0xFFFFFF) expectedWrote = 1;
            assert.strictEqual(colorAt(t, x, y), want,
              `${name} span [${left},${right}) y=${y} x=${x}: ` +
              `filled 0x${colorAt(t, x, y).toString(16)}, ` +
              `sampler says 0x${sample.toString(16)}`);
          }
          // An invalid sample is the one case where the filler may report 0
          // after writing the pixels before it, so only demand agreement on
          // the "wrote something" direction when nothing was invalid.
          const anyInvalid = Array.from(
            { length: right - left },
            (_, i) => wat.test_gdi_brush_sample(t.hdc, brush, left + i, y) >>> 0)
            .some(s => s === INVALID);
          if (!anyInvalid) {
            assert.strictEqual(wrote ? 1 : 0, expectedWrote,
              `${name} span [${left},${right}) y=${y}: reported wrote=${wrote}`);
          }
          // Nothing outside the span may be touched.
          for (const x of [left - 1, right]) {
            if (x < 0 || x >= t.width) continue;
            assert.strictEqual(colorAt(t, x, y), MARKER,
              `${name} span [${left},${right}) y=${y}: wrote outside at x=${x}`);
          }
        }
      }
    }
  });

  check('splitting a span changes nothing, at every ROP2', () => {
    // R2_COPYPEN, R2_XORPEN, R2_MASKPEN, R2_MERGEPEN, R2_NOT: a mix of ops
    // that do and do not depend on what the destination already holds.
    const ROPS = [13, 7, 9, 15, 6];
    const whole = target(40, 6);
    const split = target(40, 6);
    for (const { name, brush } of brushes) {
      for (const rop2 of ROPS) {
        for (const cut of [1, 5, 13, 20, 39]) {
          for (let y = 0; y < whole.height; y++) {
            fillMarker(whole);
            fillMarker(split);
            wat.test_gdi_brush_fill_span(
              whole.hdc, whole.desc, y, 0, 40, brush, rop2);
            wat.test_gdi_brush_fill_span(
              split.hdc, split.desc, y, 0, cut, brush, rop2);
            wat.test_gdi_brush_fill_span(
              split.hdc, split.desc, y, cut, 40, brush, rop2);
            for (let x = 0; x < 40; x++) {
              assert.strictEqual(colorAt(whole, x, y), colorAt(split, x, y),
                `${name} rop2=${rop2} cut=${cut} y=${y} x=${x}: ` +
                `whole 0x${colorAt(whole, x, y).toString(16)} != ` +
                `split 0x${colorAt(split, x, y).toString(16)}`);
            }
          }
        }
      }
    }
  });

  check('a transparent brush leaves the destination alone', () => {
    const t = target(40, 4);
    const hollow = brushes.find(b => b.name === 'hollow').brush;
    assert.strictEqual(
      wat.test_gdi_brush_sample(t.hdc, hollow, 0, 0) >>> 0, TRANSPARENT,
      'hollow brush no longer samples as transparent; the test is stale');
    fillMarker(t);
    assert.strictEqual(
      wat.test_gdi_brush_fill_span(t.hdc, t.desc, 1, 0, 40, hollow, 13), 0);
    for (let x = 0; x < 40; x++) {
      assert.strictEqual(colorAt(t, x, 1), MARKER, `x=${x}`);
    }
  });

  if (failures) {
    console.log(`\n${passed} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passed} checks passed over ${brushes.length} brushes`);
})().catch((e) => { console.error(e); process.exit(1); });
