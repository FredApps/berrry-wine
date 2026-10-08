#!/usr/bin/env node
'use strict';

// DirectDraw FOURCC "DXT1".."DXT5" surfaces. Colin McRae Rally 2.0 creates
// every texture as a DXT5 staging surface (DDSD_LINEARSIZE, DDPF_FOURCC),
// writes the compressed blocks through Lock, and Blts it into an ARGB4444
// texture, relying on the driver to decompress. Without that the Blt copied
// raw block bytes as pixels and every texture in the game was static.
//
// This drives the real handlers: the DDPIXELFORMAT -> format-kind mapping,
// Lock/GetSurfaceDesc reporting LINEARSIZE + the FourCC, and Blt from DXT1,
// DXT3 and DXT5 sources into ARGB4444 and ARGB8888 destinations, compared
// texel for texel with an independent JS decoder of the S3TC formulas.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const ESP = 0x30000;

const extraWat = String.raw`
  (func (export "test_dxt_surface_new") (param $w i32) (param $h i32) (param $bpp i32)
      (param $pitch i32) (param $fmt i32) (result i32)
    (local $surface i32) (local $entry i32)
    (local.set $surface (call $dx_create_com_obj (i32.const 2) (i32.const 0x52000000)))
    (local.set $entry (call $dx_from_this (local.get $surface)))
    (i32.store16 offset=12 (local.get $entry) (local.get $w))
    (i32.store16 offset=14 (local.get $entry) (local.get $h))
    (i32.store16 offset=16 (local.get $entry) (local.get $bpp))
    (i32.store16 offset=18 (local.get $entry) (local.get $pitch))
    (i32.store offset=20 (local.get $entry)
      (call $g2w (call $dib_alloc (i32.add (i32.mul (local.get $pitch) (local.get $h)) (i32.const 64)))))
    (i32.store offset=24 (local.get $entry) (i32.const 0))
    (i32.store offset=28 (local.get $entry) (i32.const 4))
    (call $dx_surf_fmt_set (local.get $entry) (local.get $fmt))
    (local.get $surface))

  (func (export "test_dxt_bits") (param $surface i32) (result i32)
    (i32.load offset=20 (call $dx_from_this (local.get $surface))))

  (func (export "test_dxt_fmt_from_pf") (param $pf i32) (result i32)
    (call $dx_surf_fmt_from_ddpf (call $g2w (local.get $pf)) (i32.const 0)))

  (func (export "test_dxt_blt") (param $dst i32) (param $src i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
    (call $handle_IDirectDrawSurface_Blt
      (local.get $dst) (i32.const 0) (local.get $src) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dxt_lock") (param $surface i32) (param $ddsd i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${ESP}))
    (call $handle_IDirectDrawSurface_Lock
      (local.get $surface) (i32.const 0) (local.get $ddsd) (i32.const 0) (i32.const 0)
      (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_dxt_desc") (param $surface i32) (param $ddsd i32)
    (call $dx_fill_surface_desc (call $g2w (local.get $ddsd))
      (call $dx_from_this (local.get $surface))))
`;

let seed = 0x5eed;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };

const FOURCC = { 7: 0x31545844, 9: 0x33545844, 11: 0x35545844 };

// ---- independent reference decoder -------------------------------------
const exp565 = c => {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
};
const mix = (a, b, wa, wb, d) => a.map((v, i) => Math.floor((v * wa + b[i] * wb) / d));

function refDecode(kind, bytes, w, h) {
  const out = new Array(w * h);
  const bs = kind === 7 ? 8 : 16;
  const bw = (w + 3) >> 2, bh = (h + 3) >> 2;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * bs;
    const co = kind === 7 ? o : o + 8;
    const c0 = bytes[co] | (bytes[co + 1] << 8), c1 = bytes[co + 2] | (bytes[co + 3] << 8);
    const idx = (bytes[co + 4] | (bytes[co + 5] << 8) | (bytes[co + 6] << 16) | (bytes[co + 7] << 24)) >>> 0;
    const p0 = exp565(c0), p1 = exp565(c1);
    const four = kind !== 7 || c0 > c1;
    const pal = four
      ? [p0, p1, mix(p0, p1, 2, 1, 3), mix(p0, p1, 1, 2, 3)]
      : [p0, p1, mix(p0, p1, 1, 1, 2), [0, 0, 0]];
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= w || y >= h) continue;
      const code = (idx >>> (2 * i)) & 3;
      let a = 255;
      if (kind === 7 && !four && code === 3) a = 0;
      if (kind === 9) {
        const nib = (bytes[o + (i >> 1)] >> ((i & 1) * 4)) & 15;
        a = nib * 17;
      }
      if (kind === 11) {
        const a0 = bytes[o], a1 = bytes[o + 1];
        let bits = 0n;
        for (let k = 0; k < 6; k++) bits |= BigInt(bytes[o + 2 + k]) << BigInt(8 * k);
        const ac = Number((bits >> BigInt(3 * i)) & 7n);
        if (ac === 0) a = a0;
        else if (ac === 1) a = a1;
        else if (a0 > a1) a = Math.floor(((8 - ac) * a0 + (ac - 1) * a1) / 7);
        else if (ac === 6) a = 0;
        else if (ac === 7) a = 255;
        else a = Math.floor(((6 - ac) * a0 + (ac - 1) * a1) / 5);
      }
      out[y * w + x] = [a, ...pal[code]];
    }
  }
  return out;
}
const pack4444 = ([a, r, g, b]) => ((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
const pack8888 = ([a, r, g, b]) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const mem = () => new Uint8Array(memory.buffer);
  const dv = () => new DataView(memory.buffer);
  const scratch = e.guest_alloc(256) >>> 0;
  const g2w = p => e.guest_to_wasm(p) >>> 0;

  // DDPIXELFORMAT -> kind: FOURCC DXT1/3/5 map, other FourCCs and RGB do not.
  for (const [fourcc, want] of [[0x31545844, 7], [0x32545844, 8], [0x33545844, 9],
                                [0x34545844, 10], [0x35545844, 11], [0x32595559, 0]]) {
    for (let i = 0; i < 32; i++) e.guest_write8(scratch + i, 0);
    e.guest_write32(scratch, 32); e.guest_write32(scratch + 4, 4); e.guest_write32(scratch + 8, fourcc);
    assert.strictEqual(e.test_dxt_fmt_from_pf(scratch), want,
      `FourCC 0x${fourcc.toString(16)} maps to kind ${want}`);
  }

  for (const [kind, w, h] of [[7, 8, 8], [9, 8, 4], [11, 12, 8], [7, 6, 5], [11, 4, 4]]) {
    const linear = ((w + 3) >> 2) * ((h + 3) >> 2) * (kind === 7 ? 8 : 16);
    const src = e.test_dxt_surface_new(w, h, 16, w * 2, kind) >>> 0;

    // Lock and GetSurfaceDesc describe a compressed surface.
    for (let i = 0; i < 124; i++) e.guest_write8(scratch + i, 0xcc);
    assert.strictEqual(e.test_dxt_lock(src, scratch), 0, 'Lock succeeds');
    const lockFlags = e.guest_read32(scratch + 4) >>> 0;
    assert.ok(lockFlags & 0x80000, 'Lock reports DDSD_LINEARSIZE');
    assert.ok(!(lockFlags & 0x8), 'Lock does not report DDSD_PITCH');
    assert.strictEqual(e.guest_read32(scratch + 16) >>> 0, linear, 'dwLinearSize');
    assert.strictEqual(e.guest_read32(scratch + 76) >>> 0, 4, 'DDPF_FOURCC');
    assert.strictEqual(e.guest_read32(scratch + 80) >>> 0, FOURCC[kind], 'dwFourCC');
    e.test_dxt_desc(src, scratch);
    assert.strictEqual(e.guest_read32(scratch + 16) >>> 0, linear, 'GetSurfaceDesc dwLinearSize');
    assert.strictEqual(e.guest_read32(scratch + 80) >>> 0, FOURCC[kind], 'GetSurfaceDesc dwFourCC');

    // Random blocks, but force both DXT1 colour modes and both DXT5 alpha modes.
    const bytes = Array.from({ length: linear }, () => rnd(256));
    const bs = kind === 7 ? 8 : 16;
    for (let b = 0; b * bs < linear; b++) {
      const o = b * bs, co = kind === 7 ? o : o + 8;
      const swap = b & 1;
      const c0 = bytes[co] | (bytes[co + 1] << 8), c1 = bytes[co + 2] | (bytes[co + 3] << 8);
      if ((c0 > c1) !== !swap) {
        [bytes[co], bytes[co + 2]] = [bytes[co + 2], bytes[co]];
        [bytes[co + 1], bytes[co + 3]] = [bytes[co + 3], bytes[co + 1]];
      }
      if (kind === 11 && swap) [bytes[o], bytes[o + 1]] = [Math.min(bytes[o], bytes[o + 1]), Math.max(bytes[o], bytes[o + 1])];
    }
    const bits = e.test_dxt_bits(src) >>> 0;
    mem().set(bytes, bits);
    const ref = refDecode(kind, bytes, w, h);

    for (const [dbpp, dfmt, pack] of [[16, 4, pack4444], [32, 5, pack8888]]) {
      const pitch = w * (dbpp / 8);
      const dst = e.test_dxt_surface_new(w, h, dbpp, pitch, dfmt) >>> 0;
      assert.strictEqual(e.test_dxt_blt(dst, src), 0, 'Blt succeeds');
      const dbits = e.test_dxt_bits(dst) >>> 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const off = dbits + y * pitch + x * (dbpp / 8);
        const got = dbpp === 16 ? dv().getUint16(off, true) : dv().getUint32(off, true);
        const want = pack(ref[y * w + x]);
        assert.strictEqual(got, want,
          `kind ${kind} ${w}x${h} -> ${dbpp}bpp texel (${x},${y}): got 0x${got.toString(16)} want 0x${want.toString(16)}`);
      }
    }
  }
  console.log('PASS  DirectDraw DXT1/3/5 surfaces: FourCC mapping, LINEARSIZE desc, Blt decompression to ARGB4444/8888');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
