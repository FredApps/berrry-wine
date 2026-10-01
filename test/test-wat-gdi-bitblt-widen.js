#!/usr/bin/env node

'use strict';

// $gdi_raster_bitblt_fast32 and the generic per-pixel kernel below it are two
// statements of the same function, and the fast one is allowed to exist only
// while they agree.
//
// The fast path just grew two source depths -- 4bpp and 1bpp -- because a
// census (tools/gdi-decline-census.js) put 79-100% of every fast-blit decline
// on "source bpp is not 32/16/8" and the depth breakdown put all of the
// reachable ones on those two. Neither is a small addition: a sub-byte depth
// packs several pixels into a byte, so the loop's byte cursor cannot address
// one, and a 1bpp DDB takes no colour out of the source at all -- its two
// colours come from the destination DC's text and background fields. Both of
// those get silently-wrong in the same way: a mirrored nibble or an inverted
// mask still draws *something*, so nothing crashes and no shape test notices.
//
// So this is a differential oracle. Every case runs the same blit twice:
//
//   A. onto a DC whose clip is one rect  -> takes the fast path
//   B. onto a DC whose clip is that rect OR'd with a far-away one -> the fast
//      path declines (a >1-rect clip is reason 1), so the generic kernel runs
//      (32bpp SRCCOPY now uses the separately checked band path),
//      and because the union still covers the whole blit the intended output
//      is identical.
//
// and demands the two surfaces come out pixel-identical. The decline counters
// are checked on both sides, which is the part that makes the test mean
// anything: without it, a widening that silently stopped taking the fast path
// would pass every pixel comparison it was given.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// test_gdi_raster_bitblt pins both DCs to 0. The destination DC is exactly
// what a 1bpp DDB source reads its two colours out of, so it has to be real.
const EXTRA_WAT = `
  (func (export "test_band_system_clip") (param $hdc i32) (param $region i32)
    (i32.store offset=4
      (call $gdi_dc_system_clip_entry (local.get $hdc) (i32.const 1))
      (local.get $region)))
  (func (export "test_bitblt_dcs")
        (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)
    (call $gdi_raster_bitblt (local.get 0) (local.get 1)
      (local.get 2) (local.get 3) (local.get 4) (local.get 5) (local.get 6)
      (local.get 7) (local.get 8) (local.get 9) (local.get 10) (local.get 11)))
`;

const REASON = { DST_BPP: 0, MULTI_CLIP: 1, SRC_BPP: 4, PALETTE: 5, SRCINVERT: 10 };
// Slots 11..14 are reason 4's source-depth breakdown, not more reasons.
const BUCKET = { B1: 11, B4: 12, B24: 13, OTHER: 14 };

const DC_TEXT_COLOR = 20;
const DC_BK_COLOR = 24;

const ROPS = {
  SRCCOPY: 0x00CC0020,
  NOTSRCCOPY: 0x00330008,
  SRCAND: 0x008800C6,
  SRCPAINT: 0x00EE0086,
  SRCINVERT: 0x00660046,
};

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT });
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

  let nextBits = 0x02C00000;
  let nextDesc = 0x00180000;
  let nextHdc = 0x00380000;

  // A 32bpp destination plus a DC. `split` decides which of the two arms this
  // is: a one-rect clip takes the fast path, a two-rect clip cannot be spelled
  // as four bounds and so drops to the generic kernel. The second rect is far
  // outside the surface, which keeps the visible clip identical between the
  // arms and stops the region engine from coalescing the pair back into one.
  function destination(width, height, { split = false } = {}) {
    const stride = width * 4;
    const bits = nextBits;
    const desc = nextDesc;
    const hdc = nextHdc++;
    nextBits += stride * height + 0x1000;
    nextDesc += 0x100;
    const fields = [bits, width, height, stride, 32, 1,
      0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0];
    fields.forEach((value, index) => dv.setInt32(desc + index * 4, value, true));
    const region = wat.test_gdi_rgn_alloc_rect(0, 0, width, height);
    if (split) {
      const far = wat.test_gdi_rgn_alloc_rect(4000, 4000, 4008, 4008);
      assert.strictEqual(wat.test_gdi_rgn_combine(region, region, far, 2), 3,
        'the two-rect arm needs a COMPLEXREGION or it would take the fast path');
      wat.test_gdi_rgn_delete(far);
    }
    wat.test_gdi_dc_clip_select(hdc, region);
    wat.test_gdi_rgn_delete(region);
    return { hdc, desc, bits, width, height, stride };
  }

  function fill(t, value) {
    for (let i = 0; i < t.width * t.height; i++) {
      dv.setUint32(t.bits + i * 4, value, true);
    }
  }

  const pixels = t => Array.from({ length: t.width * t.height },
    (_, i) => dv.getUint32(t.bits + i * 4, true) & 0xFFFFFF);

  // ---- sources -------------------------------------------------------------
  //
  // A transient BITMAPINFO descriptor: no GDI object, so its colour table lives
  // in the descriptor's +24/+28 fields and $gdi_raster_palette_color resolves
  // through it. This is what an indexed DIB source looks like to the raster.
  function dibSource(width, height, bpp, { entries = null } = {}) {
    const count = 1 << bpp;
    const stride = ((width * bpp + 31) >> 5) << 2;
    const bits = nextBits;
    const table = nextBits + stride * height + 0x40;
    const desc = nextDesc;
    nextBits += stride * height + 0x40 + count * 4 + 0x1000;
    nextDesc += 0x100;
    // Deliberately aperiodic, so a nibble read from the wrong half or a bit
    // taken from the wrong end of the byte cannot coincide with the truth.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // A hash, not an arithmetic pattern: (x*7 + y*5 + (x^y)) reads as
        // aperiodic and is identically zero mod 2, which makes every 1bpp
        // source one flat colour and quietly compares nothing.
        const index = (((x * 73856093) ^ (y * 19349663)) >>> 3) % count;
        const at = bits + y * stride + Math.floor((x * bpp) / 8);
        const current = dv.getUint8(at);
        if (bpp === 8) dv.setUint8(at, index);
        else if (bpp === 4) {
          dv.setUint8(at, (x & 1)
            ? ((current & 0xF0) | index)
            : ((current & 0x0F) | (index << 4)));
        } else {
          const shift = 7 - (x & 7);
          dv.setUint8(at, (current & ~(1 << shift)) | (index << shift));
        }
      }
    }
    for (let i = 0; i < count; i++) {
      // RGBQUAD order (B,G,R,0), which is how a BITMAPINFO table is stored.
      dv.setUint32(table + i * 4, entries
        ? entries[i % entries.length]
        : (((i * 37) & 0xFF) | (((i * 91) & 0xFF) << 8) | (((i * 13) & 0xFF) << 16)),
        true);
    }
    const fields = [bits, width, height, stride, bpp, 1,
      table, count, 0, 0, 1, 1, 0, 0, 1, 1, 0];
    fields.forEach((value, index) => dv.setInt32(desc + index * 4, value, true));
    return { desc, bits, width, height, bpp, stride, table, count };
  }

  function packedSource(width, height, bpp) {
    const stride = ((width * bpp + 31) >> 5) << 2;
    const bits = nextBits;
    const desc = nextDesc;
    nextBits += stride * height + 0x1000;
    nextDesc += 0x100;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = ((x * 29 + y * 61) & 0xFF) |
          (((x * 11 + y * 3) & 0xFF) << 8) | (((x ^ (y * 5)) & 0xFF) << 16);
        if (bpp === 32) dv.setUint32(bits + y * stride + x * 4, v, true);
        else dv.setUint16(bits + y * stride + x * 2, v & 0xFFFF, true);
      }
    }
    const fields = [bits, width, height, stride, bpp, 1,
      0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0];
    fields.forEach((value, index) => dv.setInt32(desc + index * 4, value, true));
    return { desc, bits, width, height, bpp, stride };
  }

  // A real 1bpp DDB: CreateBitmap makes a GDI object whose record has the DIB
  // flag clear, which is precisely the case $gdi_raster_read_blt_source treats
  // as a mask rather than as a picture.
  function monoDdbSource(width, height) {
    const stride = ((width + 15) >> 4) << 1;   // CreateBitmap packs to WORDs
    const buf = wat.guest_alloc(stride * height) >>> 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += 8) {
        let byte = 0;
        for (let b = 0; b < 8 && x + b < width; b++) {
          if (((x + b) * 3 + y * 5) & 2) byte |= 1 << (7 - b);
        }
        wat.guest_write8(buf + y * stride + (x >> 3), byte);
      }
    }
    const bitmap = wat.test_call_CreateBitmap(width, height, 1, 1, buf) >>> 0;
    assert(bitmap, 'CreateBitmap(1bpp) failed');
    const desc = nextDesc;
    nextDesc += 0x100;
    assert(wat.test_gdi_raster_desc_from_bitmap(bitmap, desc),
      'desc_from_bitmap(1bpp DDB) failed');
    assert.strictEqual(dv.getInt32(desc + 16, true), 1, 'expected a 1bpp desc');
    return { desc, width, height, bpp: 1, bitmap };
  }

  const counts = () => Array.from({ length: 16 }, (_, i) =>
    wat.test_gdi_bitblt_decline_count(i) >>> 0);
  const moved = (before, after) => after
    .map((n, i) => ({ i, delta: n - before[i] }))
    .filter(x => x.delta !== 0);

  // The whole point: run it both ways and demand the same picture.
  function agrees(label, src, rop, { sx = 0, sy = 0, dx = 0, dy = 0,
    w = null, h = null, textColor = null, bkColor = null, size = 24,
    ground = 0x204060 } = {}) {
    const width = w === null ? src.width : w;
    const height = h === null ? src.height : h;
    const fastT = destination(size, size);
    const slowT = destination(size, size, { split: true });
    for (const t of [fastT, slowT]) {
      fill(t, ground);
      if (textColor !== null) wat.test_gdi_dc_set_field(t.hdc, DC_TEXT_COLOR, textColor, 0);
      if (bkColor !== null) wat.test_gdi_dc_set_field(t.hdc, DC_BK_COLOR, bkColor, 0);
    }

    const beforeFast = counts();
    assert.strictEqual(
      wat.test_bitblt_dcs(fastT.hdc, 0, fastT.desc, dx, dy, width, height,
        src.desc, sx, sy, 0, rop), 1, `${label}: fast arm refused the blit`);
    const fastDeclines = moved(beforeFast, counts());

    const beforeSlow = counts();
    assert.strictEqual(
      wat.test_bitblt_dcs(slowT.hdc, 0, slowT.desc, dx, dy, width, height,
        src.desc, sx, sy, 0, rop), 1, `${label}: generic arm refused the blit`);
    const slowDeclines = moved(beforeSlow, counts());

    // The generic arm must have declined for exactly the reason this test
    // engineered, or it is not measuring what it claims to.
    assert.deepStrictEqual(slowDeclines, [{ i: REASON.MULTI_CLIP, delta: 1 }],
      `${label}: the generic arm declined for an unexpected reason: ` +
      JSON.stringify(slowDeclines));

    const a = pixels(fastT);
    const b = pixels(slowT);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        const x = i % size, y = (i / size) | 0;
        throw new Error(`${label}: (${x},${y}) fast 0x${a[i].toString(16)} ` +
          `!= generic 0x${b[i].toString(16)}`);
      }
    }
    return { fastDeclines, changed: a.some(v => v !== ground) };
  }

  // Asserts the fast arm really was fast -- the comparison above is worthless
  // if both arms quietly went generic.
  function agreesFast(label, src, rop, opts) {
    const r = agrees(label, src, rop, opts);
    assert.deepStrictEqual(r.fastDeclines, [],
      `${label}: the fast arm declined (${JSON.stringify(r.fastDeclines)}), ` +
      `so this case never exercised the fast path at all`);
    assert(r.changed, `${label}: the blit wrote nothing, so nothing was compared`);
    return r;
  }

  // ---- the depths that already worked, as a control -------------------------

  check('32bpp and 16bpp sources still agree with the generic kernel', () => {
    for (const bpp of [32, 16]) {
      const src = packedSource(20, 20, bpp);
      for (const [name, rop] of Object.entries(ROPS)) {
        if (name === 'SRCINVERT') continue;   // its own case below
        agreesFast(`${bpp}bpp ${name}`, src, rop);
      }
    }
  });

  check('an 8bpp indexed source still agrees', () => {
    const src = dibSource(20, 20, 8);
    for (const [name, rop] of Object.entries(ROPS)) {
      if (name === 'SRCINVERT') continue;
      agreesFast(`8bpp ${name}`, src, rop);
    }
  });

  // ---- the two new depths ---------------------------------------------------

  check('a 4bpp indexed source agrees, at every ROP and both x parities', () => {
    const src = dibSource(20, 20, 4);
    for (const [name, rop] of Object.entries(ROPS)) {
      if (name === 'SRCINVERT') continue;
      agreesFast(`4bpp ${name}`, src, rop);
      // An odd source x puts every pixel in the other nibble, which is the
      // half a swapped select gets wrong while an even start looks perfect.
      agreesFast(`4bpp ${name} sx=1`, src, rop, { sx: 1, w: 19 });
      agreesFast(`4bpp ${name} sx=3 dx=2`, src, rop, { sx: 3, dx: 2, w: 17 });
    }
  });

  check('a 1bpp DIB source agrees, at every bit position in the byte', () => {
    const src = dibSource(20, 20, 1);
    for (const [name, rop] of Object.entries(ROPS)) {
      if (name === 'SRCINVERT') continue;
      agreesFast(`1bpp DIB ${name}`, src, rop);
    }
    // Every start offset inside a byte: bit 0 is the HIGH bit of the byte, so
    // a sub-byte index taken from the wrong end is only visible as a shift,
    // and only some of these offsets show it.
    for (let sx = 0; sx < 8; sx++) {
      agreesFast(`1bpp DIB SRCCOPY sx=${sx}`, src, ROPS.SRCCOPY,
        { sx, w: 20 - sx });
    }
  });

  check('a 1bpp DDB source is a mask: its colours come from the DC', () => {
    const src = monoDdbSource(20, 20);
    // Colours that are not black and white, and not palindromes in BGR, so a
    // missing R/B swap or a text/background swap both show up as a difference.
    const cases = [
      [0x00112233, 0x00AABBCC],
      [0x00FF0000, 0x000000FF],
      [0x00000000, 0x00FFFFFF],
    ];
    for (const [textColor, bkColor] of cases) {
      for (const [name, rop] of Object.entries(ROPS)) {
        if (name === 'SRCINVERT') continue;
        agreesFast(`1bpp DDB ${name} text=${textColor.toString(16)}`,
          src, rop, { textColor, bkColor });
      }
      for (let sx = 0; sx < 8; sx++) {
        agreesFast(`1bpp DDB SRCCOPY sx=${sx}`, src, ROPS.SRCCOPY,
          { sx, w: 20 - sx, textColor, bkColor });
      }
    }
  });

  // The two colours are read once per blit rather than once per pixel, so a
  // DC whose colours changed between blits has to be re-read. This is the
  // hoist's own failure mode and nothing above would catch it.
  check('changing the DC colours changes the next mask blit', () => {
    const src = monoDdbSource(16, 16);
    const t = destination(20, 20);
    fill(t, 0);
    wat.test_gdi_dc_set_field(t.hdc, DC_TEXT_COLOR, 0x00112233, 0);
    wat.test_gdi_dc_set_field(t.hdc, DC_BK_COLOR, 0x00445566, 0);
    wat.test_bitblt_dcs(t.hdc, 0, t.desc, 0, 0, 16, 16, src.desc, 0, 0, 0,
      ROPS.SRCCOPY);
    const first = pixels(t).join(',');
    fill(t, 0);
    wat.test_gdi_dc_set_field(t.hdc, DC_TEXT_COLOR, 0x00778899, 0);
    wat.test_gdi_dc_set_field(t.hdc, DC_BK_COLOR, 0x00AABBCC, 0);
    wat.test_bitblt_dcs(t.hdc, 0, t.desc, 0, 0, 16, 16, src.desc, 0, 0, 0,
      ROPS.SRCCOPY);
    assert.notStrictEqual(pixels(t).join(','), first,
      'the mask colours were hoisted out of the blit as well as out of the loop');
  });

  // ---- the gates that stay closed -------------------------------------------

  // SRCINVERT out of an indexed source is not an RGB xor in the generic
  // kernel: when the destination colour is an exact member of the source
  // palette it xors palette INDEXES. The fast path cannot reproduce that
  // without a whole-palette scan per pixel, so it declines -- and the two
  // arms of this test agreeing is what proves the decline is honest.
  check('SRCINVERT from an indexed source declines rather than diverging', () => {
    for (const bpp of [1, 4, 8]) {
      const src = dibSource(16, 16, bpp);
      // The index route only opens when the DESTINATION colour is an exact
      // member of the source palette, so a ground of any old colour never
      // reaches it -- with the gate removed such a blit agrees, and the gate
      // looks unnecessary. Ground the destination in a real palette entry.
      const ground = dv.getUint32(src.table + 4, true) & 0xFFFFFF;
      // Measured with the gate removed: 4bpp and 8bpp come out different
      // pixels here (fast 0x82b2b2 against generic 0x828e72 at (1,0)), which
      // is the divergence the 8bpp arm has been shipping since it landed.
      const r = agrees(`${bpp}bpp SRCINVERT`, src, ROPS.SRCINVERT, { ground });
      assert.deepStrictEqual(r.fastDeclines, [{ i: REASON.SRCINVERT, delta: 1 }],
        `${bpp}bpp SRCINVERT should decline for reason ${REASON.SRCINVERT}, ` +
        `got ${JSON.stringify(r.fastDeclines)}`);
    }
  });

  check('SRCINVERT from a packed source still takes the fast path', () => {
    for (const bpp of [32, 16]) {
      agreesFast(`${bpp}bpp SRCINVERT`, packedSource(16, 16, bpp),
        ROPS.SRCINVERT);
    }
  });

  check('banded 32bpp SRCCOPY preserves clips, row layout, overlap and reserved bytes', () => {
    const bytes = new Uint8Array(memory.buffer);
    const width = 13, height = 11;
    const clips = [[1, 1, 6, 10], [8, 2, 12, 8]];
    const visible = (x, y) => clips.some(([l, t, r, b]) =>
      x >= l && x < r && y >= t && y < b);
    const cases = [
      { dx: 0, dy: 0, sx: 0, sy: 0, w: 13, h: 11 },
      { dx: -2, dy: -1, sx: 1, sy: 2, w: 16, h: 13 },
      { dx: 2, dy: 1, sx: -2, sy: -1, w: 15, h: 12 },
      { dx: 9, dy: 8, sx: 10, sy: 9, w: 8, h: 8 },
    ];
    for (const dstTopDown of [0, 1]) {
      for (const srcTopDown of [0, 1]) {
        for (const overlap of [false, true]) {
          if (overlap && dstTopDown !== srcTopDown) continue;
          for (const c of cases) {
            const dst = destination(width, height);
            const src = overlap ? dst : packedSource(width, height, 32);
            for (const [surface, topDown] of [[dst, dstTopDown], [src, srcTopDown]]) {
              surface.stride = width * 4 + 12;
              surface.topDown = topDown;
              dv.setInt32(surface.desc + 12, surface.stride, true);
              dv.setInt32(surface.desc + 20, topDown, true);
              // Nonzero reserved bytes and padding catch accidental byte copies
              // or writes outside the selected pixels, which RGB-only checks miss.
              for (let i = 0; i < surface.stride * height; i++) {
                bytes[surface.bits + i] = (i * 37 + (i >>> 3) * 17 + 101) & 255;
              }
            }
            const region = wat.test_gdi_rgn_alloc_rect(...clips[0]);
            const second = wat.test_gdi_rgn_alloc_rect(...clips[1]);
            assert.strictEqual(wat.test_gdi_rgn_combine(region, region, second, 2), 3);
            wat.test_gdi_dc_clip_select(dst.hdc, region);
            wat.test_gdi_rgn_delete(second);
            wat.test_gdi_rgn_delete(region);
            const expected = bytes.slice(dst.bits, dst.bits + dst.stride * height);
            const source = bytes.slice(src.bits, src.bits + src.stride * height);
            const at = (surface, x, y) =>
              (surface.topDown ? y : height - 1 - y) * surface.stride + x * 4;
            // Snapshot oracle is independent of the kernel's traversal order.
            for (let y = 0; y < c.h; y++) {
              for (let x = 0; x < c.w; x++) {
                const dx = c.dx + x, dy = c.dy + y;
                const sx = c.sx + x, sy = c.sy + y;
                if (dx < 0 || dy < 0 || dx >= width || dy >= height ||
                    sx < 0 || sy < 0 || sx >= width || sy >= height ||
                    !visible(dx, dy)) continue;
                const dp = at(dst, dx, dy), sp = at(src, sx, sy);
                expected.set(source.subarray(sp, sp + 3), dp);
                expected[dp + 3] = 0;
              }
            }
            const before = counts();
            const bandsBefore = wat.test_gdi_fast_count(10);
            assert.strictEqual(wat.test_bitblt_dcs(dst.hdc, 0, dst.desc,
              c.dx, c.dy, c.w, c.h, src.desc, c.sx, c.sy, 0, ROPS.SRCCOPY), 1);
            assert.deepStrictEqual(moved(before, counts()),
              [{ i: REASON.MULTI_CLIP, delta: 1 }], 'single-rectangle path must decline');
            assert.strictEqual(wat.test_gdi_fast_count(10) - bandsBefore,
              overlap ? 0 : 1, 'separate backing uses bands; overlap keeps traversal');
            assert.deepStrictEqual(bytes.slice(dst.bits, dst.bits + dst.stride * height),
              expected, JSON.stringify({ dstTopDown, srcTopDown, overlap, ...c }));
          }
        }
      }
    }
  });

  check('band intersections honor both clips, DC origins, empty clips and extreme edges', () => {
    const width = 13, height = 11, ox = 3, oy = -2;
    const appRects = [[-1000000000, -4, 2, 1000000000], [4, -4, 10, 1000000000]];
    const systemRects = [[-3, 3, 10, 5], [-3, 7, 10, 12]];
    const makeRegion = rects => {
      const r = wat.test_gdi_rgn_alloc_rect(...rects[0]);
      for (const rect of rects.slice(1)) {
        const other = wat.test_gdi_rgn_alloc_rect(...rect);
        wat.test_gdi_rgn_combine(r, r, other, 2);
        wat.test_gdi_rgn_delete(other);
      }
      return r;
    };
    const inside = (rs, x, y) => rs.some(([l,t,r,b]) => x >= l && x < r && y >= t && y < b);
    for (const empty of [false, true]) {
      const dst = destination(width, height), src = packedSource(width, height, 32);
      fill(dst, 0xab123456);
      dv.setInt32(dst.desc + 72, ox, true);
      dv.setInt32(dst.desc + 76, oy, true);
      const app = makeRegion(appRects);
      const sys = makeRegion(empty ? [[0,0,0,0]] : systemRects);
      wat.test_gdi_dc_clip_select(dst.hdc, app);
      wat.test_band_system_clip(dst.hdc, sys);
      const expected = new Uint8Array(memory.buffer, dst.bits, dst.stride * height).slice();
      for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
        if (empty || !inside(appRects,x-ox,y-oy) || !inside(systemRects,x-ox,y-oy)) continue;
        const value = dv.getUint32(src.bits+y*src.stride+x*4,true) & 0xffffff;
        new DataView(expected.buffer).setUint32(y*dst.stride+x*4,value,true);
      }
      const before = wat.test_gdi_fast_count(10);
      assert.strictEqual(wat.test_bitblt_dcs(dst.hdc,0,dst.desc,0,0,width,height,
        src.desc,0,0,0,ROPS.SRCCOPY),1);
      assert.strictEqual(wat.test_gdi_fast_count(10)-before,1);
      assert.deepStrictEqual(new Uint8Array(memory.buffer,dst.bits,dst.stride*height),expected);
      wat.test_band_system_clip(dst.hdc,0);
      wat.test_gdi_rgn_delete(app);
      wat.test_gdi_rgn_delete(sys);
    }
  });

  // A table shorter than the depth's index space leaves high indexes to
  // $gdi_raster_palette_color's default-palette fallback, which the fast loop
  // does not reproduce -- so it must decline rather than read off the end.
  check('a table shorter than the depth needs is declined, per depth', () => {
    for (const [bpp, full] of [[1, 2], [4, 16], [8, 256]]) {
      const src = dibSource(16, 16, bpp);
      const dst = destination(20, 20);
      dv.setInt32(src.desc + 28, full - 1, true);       // one entry short
      let before = counts();
      wat.test_bitblt_dcs(dst.hdc, 0, dst.desc, 0, 0, 16, 16, src.desc, 0, 0,
        0, ROPS.SRCCOPY);
      assert.deepStrictEqual(moved(before, counts()),
        [{ i: REASON.PALETTE, delta: 1 }],
        `${bpp}bpp with ${full - 1} entries should decline for reason 5`);
      dv.setInt32(src.desc + 28, full, true);           // exactly enough
      before = counts();
      wat.test_bitblt_dcs(dst.hdc, 0, dst.desc, 0, 0, 16, 16, src.desc, 0, 0,
        0, ROPS.SRCCOPY);
      assert.deepStrictEqual(moved(before, counts()), [],
        `${bpp}bpp with a full ${full}-entry table should take the fast path`);
    }
  });

  check('24bpp is still declined, and still buckets itself', () => {
    const src = packedSource(16, 16, 24);
    const dst = destination(20, 20);
    const before = counts();
    wat.test_bitblt_dcs(dst.hdc, 0, dst.desc, 0, 0, 16, 16, src.desc, 0, 0,
      0, ROPS.SRCCOPY);
    assert.deepStrictEqual(moved(before, counts()).sort((a, b) => a.i - b.i),
      [{ i: REASON.SRC_BPP, delta: 1 }, { i: BUCKET.B24, delta: 1 }],
      'a 24bpp source should count reason 4 and the 24bpp bucket, and nothing else');
  });

  // The depth buckets moved up one slot when reason 10 was added. Nothing but
  // a test says so, and a census reading the old numbering would report 1bpp
  // declines as a reason.
  check('the depth buckets sit at 11..14, above the reasons', () => {
    wat.test_gdi_fast_reset();
    const dst = destination(20, 20);
    wat.test_bitblt_dcs(dst.hdc, 0, dst.desc, 0, 0, 8, 8,
      packedSource(8, 8, 24).desc, 0, 0, 0, ROPS.SRCCOPY);
    assert.strictEqual(wat.test_gdi_bitblt_decline_count(BUCKET.B24) >>> 0, 1);
    assert.strictEqual(wat.test_gdi_bitblt_decline_count(REASON.SRCINVERT) >>> 0, 0,
      'reason 10 must not be a depth bucket');
    wat.test_gdi_fast_reset();
    assert.deepStrictEqual(counts(), new Array(16).fill(0),
      'the reset must clear the reasons and the buckets alike');
  });

  if (failures) {
    console.log(`\n${passed} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
