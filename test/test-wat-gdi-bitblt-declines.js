#!/usr/bin/env node

'use strict';

// $gdi_raster_bitblt_fast32 hands a blit back to the generic per-pixel path by
// returning -1, and until now it did so anonymously. That mattered because a
// decline is not a small cost: the generic loop re-resolves the clip and the
// DC state for every pixel of the blit, which on Diablo's Choose Class screen
// was about three quarters of all CPU. Which gate fired decides what is worth
// widening, and "this app never takes the fast blit" and "it takes it and that
// is not where the time goes" are opposite conclusions that look identical
// without the reason.
//
// So each gate now counts itself, and this test pins the mapping: it drives a
// blit that can only fail for one reason and demands that reason's counter --
// and only that one -- move. A gate that is renumbered or quietly reordered
// fails here rather than silently mislabelling a future profile.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// test_gdi_raster_bitblt pins hdc to 0, and a DC of 0 has no clip record at
// all -- every blit through it would decline for reason 1 and nothing else
// could ever be observed. This variant passes the DC through.
const EXTRA_WAT = `
  (func (export "test_bitblt_on_dc")
        (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)
    (call $gdi_raster_bitblt (local.get 0) (i32.const 0)
      (local.get 1) (local.get 2) (local.get 3) (local.get 4) (local.get 5)
      (local.get 6) (local.get 7) (local.get 8) (local.get 9) (local.get 10)))
`;

const REASON = {
  DST_BPP: 0, NO_CLIP: 1, GEOMETRY: 2, SRC_COORDS: 3, SRC_BPP: 4,
  PALETTE: 5, MASK: 6, OVERLAP: 7, ROP3: 8, BRUSH: 9, SRCINVERT: 10,
};
const REASON_COUNT = 11;

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

  let nextBits = 0x02800000;
  let nextDesc = 0x00140000;
  let nextHdc = 0x00340000;

  function surface(width, height, bpp, { clip = true } = {}) {
    const stride = ((width * bpp + 31) >> 5) << 2;
    const bits = nextBits;
    const desc = nextDesc;
    const hdc = nextHdc++;
    nextBits += stride * height + 0x1000;
    nextDesc += 0x100;
    const fields = [bits, width, height, stride, bpp, 1,
      0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0];
    fields.forEach((value, index) => dv.setInt32(desc + index * 4, value, true));
    if (clip) {
      const region = wat.test_gdi_rgn_alloc_rect(0, 0, width, height);
      assert.strictEqual(wat.test_gdi_dc_clip_select(hdc, region), 2);
      wat.test_gdi_rgn_delete(region);
    }
    return { hdc, desc, bits, width, height, bpp, stride };
  }

  const counts = () => Array.from({ length: REASON_COUNT }, (_, i) =>
    wat.test_gdi_bitblt_decline_count(i) >>> 0);
  // Slots 11..14 are a second dimension over reason 4, not more reasons.
  // They sit above the reasons, so adding a reason moves them; that is what
  // this file exists to pin.
  const depths = () => Array.from({ length: 4 }, (_, i) =>
    wat.test_gdi_bitblt_decline_count(REASON_COUNT + i) >>> 0);

  // Runs `fn` and asserts exactly one counter moved, by exactly one.
  function onlyReason(reason, fn) {
    const before = counts();
    fn();
    const after = counts();
    const moved = after
      .map((n, i) => ({ i, delta: n - before[i] }))
      .filter(x => x.delta !== 0);
    assert.deepStrictEqual(moved, [{ i: reason, delta: 1 }],
      `expected reason ${reason} alone; counters moved: ` +
      JSON.stringify(moved));
  }

  const SRCCOPY = 0x00CC0020;

  check('a destination that is not 32bpp is its own reason', () => {
    const dst = surface(8, 8, 16);
    const src = surface(8, 8, 32);
    onlyReason(REASON.DST_BPP, () => {
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
        0, SRCCOPY);
    });
  });

  // Reason 1 is deliberately not provoked here, and that is the finding worth
  // pinning: a DC that never had a region selected still resolves app and
  // system clip records, so selecting no clip does NOT decline -- it takes the
  // fast path. Reason 1 means a DC this path has no business touching at all
  // (hdc 0 is the one the test exports used to pass), not "the app set no
  // clipping region", and a profile that reads it the second way would chase
  // the wrong gate.
  check('a DC with no region selected still takes the fast path', () => {
    const dst = surface(8, 8, 32, { clip: false });
    const src = surface(8, 8, 32);
    const before = counts();
    assert.strictEqual(
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
        0, SRCCOPY), 1);
    assert.deepStrictEqual(counts(), before);
  });

  // What reason 1 actually means: $gdi_raster_simple_clip_record returns 0
  // only for a selected region of MORE THAN ONE RECT. An absent region reads
  // as "no clipping" and is fine; a two-rect region is a clip this fast path
  // cannot express as four bounds, so the whole blit goes per-pixel.
  check('a multi-rect clip region is the reason this path cannot express', () => {
    const dst = surface(16, 16, 32);
    const src = surface(16, 16, 32);
    const region = wat.test_gdi_rgn_alloc_rect(0, 0, 4, 16);
    const other = wat.test_gdi_rgn_alloc_rect(10, 0, 16, 16);
    // RGN_OR = 2: two disjoint rects, so the result has two.
    assert.strictEqual(wat.test_gdi_rgn_combine(region, region, other, 2), 3,
      'expected COMPLEXREGION');
    assert.strictEqual(wat.test_gdi_dc_clip_select(dst.hdc, region), 3);
    wat.test_gdi_rgn_delete(region);
    wat.test_gdi_rgn_delete(other);
    onlyReason(REASON.NO_CLIP, () => {
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 16, 16, src.desc, 0, 0,
        0, SRCCOPY);
    });
  });

  check('a source bit depth the unpacker does not know is counted', () => {
    const dst = surface(8, 8, 32);
    // 4bpp and 1bpp joined the fast path; 24 is the depth still declined.
    const src = surface(8, 8, 24);
    onlyReason(REASON.SRC_BPP, () => {
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
        0, SRCCOPY);
    });
  });

  // "not 32/16/8" names three different unpackers and does not say which one
  // an app wants, so reason 4 also buckets the depth it saw. The buckets are
  // counted in ADDITION to reason 4 and must sum to it, or a census reading
  // both numbers would double-count.
  check('reason 4 also records which source depth it declined', () => {
    const dst = surface(8, 8, 32);
    const before = depths();
    // A DIB is 1/4/8/16/24/32 and the fast path now unpacks every one of
    // those but 24, so 24 is the ONLY depth this gate can still see on a
    // well-formed surface. Bucket 14 ("some other depth") is a catch-all that
    // a valid descriptor cannot reach, and buckets 0-1 (1bpp, 4bpp) are now
    // dead by construction rather than untested -- widening them is exactly
    // what emptied those buckets, and this check is how that stays visible.
    for (const [bpp, bucket] of [[24, 2]]) {
      const src = surface(8, 8, bpp);
      const reasonBefore = counts()[REASON.SRC_BPP];
      const depthBefore = depths();
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
        0, SRCCOPY);
      const moved = depths()
        .map((n, i) => ({ i, delta: n - depthBefore[i] }))
        .filter(x => x.delta !== 0);
      assert.deepStrictEqual(moved, [{ i: bucket, delta: 1 }],
        `${bpp}bpp source should land in bucket ${bucket}`);
      assert.strictEqual(counts()[REASON.SRC_BPP], reasonBefore + 1,
        `${bpp}bpp source should also count as reason 4`);
    }
    const spread = depths().map((n, i) => n - before[i]);
    assert.strictEqual(spread.reduce((a, b) => a + b, 0), 1,
      'the buckets must sum to the reason-4 declines, not over- or under-count');
  });

  // 1bpp and 4bpp used to be reason 4. They are unpacked now, and what stops
  // these particular surfaces is that they carry no colour table at all --
  // a different gate, and a decline the fast path is still right to make.
  check('a sub-byte source with no colour table declines on the palette', () => {
    const dst = surface(8, 8, 32);
    for (const bpp of [1, 4]) {
      const src = surface(8, 8, bpp);
      onlyReason(REASON.PALETTE, () => {
        wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
          0, SRCCOPY);
      });
    }
  });

  check('blitting a surface onto itself is counted as overlap', () => {
    const t = surface(16, 16, 32);
    onlyReason(REASON.OVERLAP, () => {
      wat.test_bitblt_on_dc(t.hdc, t.desc, 0, 0, 8, 8, t.desc, 4, 4,
        0, SRCCOPY);
    });
  });

  check('a ROP3 with no source and no pattern spelling is counted', () => {
    const dst = surface(8, 8, 32);
    // 0x5A = PATINVERT: uses the pattern, is not one of the four this path
    // spells out, and reads no source.
    onlyReason(REASON.ROP3, () => {
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, 0, 0, 0,
        0, 0x005A0049);
    });
  });

  check('a blit that succeeds moves no counter at all', () => {
    const dst = surface(8, 8, 32);
    const src = surface(8, 8, 32);
    const before = counts();
    assert.strictEqual(
      wat.test_bitblt_on_dc(dst.hdc, dst.desc, 0, 0, 8, 8, src.desc, 0, 0,
        0, SRCCOPY), 1);
    assert.deepStrictEqual(counts(), before,
      'a fast-path blit counted a decline');
  });

  check('the reset clears every reason', () => {
    assert(counts().some(n => n > 0), 'nothing had been counted yet');
    wat.test_gdi_fast_reset();
    assert.deepStrictEqual(counts(), new Array(REASON_COUNT).fill(0));
    assert.deepStrictEqual(depths(), new Array(4).fill(0),
      'the reset must clear the depth buckets too, not just the reasons');
  });

  if (failures) {
    console.log(`\n${passed} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
