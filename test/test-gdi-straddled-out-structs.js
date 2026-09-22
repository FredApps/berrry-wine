#!/usr/bin/env node
'use strict';

// The BITMAPINFO fix (test-dib-straddled-info-handlers.js) was one instance of
// a class: a handler translates the caller's pointer once with $g2w and then
// reads or writes a whole struct through it. Two adjacent sparse guest pages
// are not adjacent in WASM memory, so anything past the first page boundary
// lands in unrelated memory -- silently, and far from where it is noticed.
//
// These handlers now gather the span with $guest_span_in and, for the OUT
// ones, put it back with $guest_span_writeback. Each case is driven twice,
// once against a buffer well inside one page and once against the same bytes
// placed so the struct straddles a boundary at every interesting offset; the
// two must agree.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "sp_map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))

  ;; Each handler pops its own stdcall frame off ESP, so these lend it a
  ;; scratch stack and hand back EAX. None of them takes more than 5 arguments,
  ;; so nothing has to be pushed.
  (func (export "test_getobject") (param $sp i32) (param $h i32) (param $cb i32)
        (param $buf i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_GetObjectA (local.get $h) (local.get $cb) (local.get $buf)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_createpalette") (param $sp i32) (param $logpal i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_CreatePalette (local.get $logpal) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_getpalentries") (param $sp i32) (param $h i32) (param $start i32)
        (param $count i32) (param $dest i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_GetPaletteEntries (local.get $h) (local.get $start)
      (local.get $count) (local.get $dest) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_setpalentries") (param $sp i32) (param $h i32) (param $start i32)
        (param $count i32) (param $src i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_SetPaletteEntries (local.get $h) (local.get $start)
      (local.get $count) (local.get $src) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_gettextmetrics") (param $sp i32) (param $hdc i32) (param $tm i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_GetTextMetricsA (local.get $hdc) (local.get $tm) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.sp_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must be backed non-adjacently for this test to mean anything');

  const sp = ((e.guest_alloc(256) >>> 0) + 128) >>> 0;
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i) & 0xff);
  const write = (ga, bytes) => { bytes.forEach((b, i) => e.guest_write8(ga + i, b)); return ga; };
  const zero = (ga, n) => write(ga, new Array(n).fill(0));
  // A buffer of n bytes whose last k bytes fall on the far page.
  const split = (n, k) => page + 4096 - (n - k);

  // The arena is a LIFO: every case here must give back what it took.
  const cursor0 = e.guest_span_cursor_bytes() >>> 0;
  const overflow0 = e.guest_span_overflow_count() >>> 0;

  // --- CreatePalette / GetPaletteEntries / SetPaletteEntries -----------------
  // LOGPALETTE: version(u16) numEntries(u16) then 4 bytes per entry.
  const N = 64, LOGPAL = 4 + N * 4;
  const logpal = [0x00, 0x03, N & 0xff, N >> 8];
  for (let i = 0; i < N; i++) logpal.push(i * 3 & 0xff, i * 5 & 0xff, i * 7 & 0xff, 0);

  const entriesOf = hpal => {
    assert.ok(hpal, 'CreatePalette returned NULL');
    const dest = zero(e.guest_alloc(N * 4) >>> 0, N * 4);
    assert.strictEqual(e.test_getpalentries(sp, hpal, 0, N, dest) | 0, N,
      'GetPaletteEntries returned the wrong count');
    return read(dest, N * 4);
  };
  const wantEntries = entriesOf(e.test_createpalette(sp, write(e.guest_alloc(LOGPAL) >>> 0, logpal)) >>> 0);
  assert.ok(wantEntries.some(v => v !== 0), 'the unsplit palette kept its colors');
  // The header sits at +0/+2 and the array runs to the end, so split both.
  for (const k of [2, 4, 8, 100, LOGPAL - 4]) {
    assert.deepStrictEqual(
      entriesOf(e.test_createpalette(sp, write(split(LOGPAL, k), logpal)) >>> 0),
      wantEntries, `CreatePalette with ${k} bytes on the far page: wrong entries`);
  }

  // GetPaletteEntries writes the caller's array: a gathered copy must go back.
  const hpal = e.test_createpalette(sp, write(e.guest_alloc(LOGPAL) >>> 0, logpal)) >>> 0;
  for (const k of [4, 16, N * 4 - 4]) {
    const dest = zero(split(N * 4, k), N * 4);
    assert.strictEqual(e.test_getpalentries(sp, hpal, 0, N, dest) | 0, N);
    assert.deepStrictEqual(read(dest, N * 4), wantEntries,
      `GetPaletteEntries with ${k} bytes on the far page: the caller's array was not filled in`);
  }

  // SetPaletteEntries reads one: a straddling source must arrive whole.
  const newEntries = [];
  for (let i = 0; i < N; i++) newEntries.push(200 - i, i * 2 & 0xff, 0x40, 0);
  for (const k of [4, 16, N * 4 - 4]) {
    const target = e.test_createpalette(sp, write(e.guest_alloc(LOGPAL) >>> 0, logpal)) >>> 0;
    assert.strictEqual(e.test_setpalentries(sp, target, 0, N, write(split(N * 4, k), newEntries)) | 0, N,
      'SetPaletteEntries returned the wrong count');
    assert.deepStrictEqual(entriesOf(target), newEntries,
      `SetPaletteEntries with ${k} bytes on the far page: wrong entries stored`);
  }

  // --- GetObjectA -----------------------------------------------------------
  // A BITMAP (24 bytes) is small enough that a straddle cuts the middle of it.
  const bmiSize = 40 + 256 * 4;
  const bmi = e.guest_alloc(bmiSize) >>> 0;
  zero(bmi, bmiSize);
  const dv = new DataView(new ArrayBuffer(16));
  dv.setUint32(0, 40, true); dv.setInt32(4, 13, true); dv.setInt32(8, -7, true);
  dv.setUint16(12, 1, true); dv.setUint16(14, 8, true);
  for (let i = 0; i < 16; i++) e.guest_write8(bmi + i, dv.getUint8(i));
  const hbmp = e.test_call_CreateDIBSection(0, bmi, 0, e.guest_alloc(4) >>> 0, 0, 0) >>> 0;
  assert.ok(hbmp, 'CreateDIBSection for the GetObject case');

  const objectOf = buf => {
    zero(buf, 24);
    const ret = e.test_getobject(sp, hbmp, 24, buf) | 0;
    return [ret, ...read(buf, 24)];
  };
  const wantObject = objectOf(e.guest_alloc(24) >>> 0);
  assert.strictEqual(wantObject[0], 24, 'GetObject filled a BITMAP');
  assert.ok(wantObject.slice(1).some(v => v !== 0), 'GetObject wrote something');
  for (const k of [4, 8, 20]) {
    assert.deepStrictEqual(objectOf(split(24, k)), wantObject,
      `GetObject with ${k} bytes on the far page: the caller's BITMAP was not filled in`);
  }

  // --- GetTextMetricsA ------------------------------------------------------
  const metricsOf = buf => {
    zero(buf, 56);
    const ret = e.test_gettextmetrics(sp, 0, buf) | 0;
    return [ret, ...read(buf, 56)];
  };
  const wantMetrics = metricsOf(e.guest_alloc(56) >>> 0);
  assert.ok(wantMetrics.slice(1).some(v => v !== 0), 'GetTextMetrics wrote something');
  for (const k of [4, 12, 44, 52]) {
    assert.deepStrictEqual(metricsOf(split(56, k)), wantMetrics,
      `GetTextMetrics with ${k} bytes on the far page: wrong TEXTMETRIC`);
  }

  // Nothing leaked and nothing was too big for the arena.
  assert.strictEqual(e.guest_span_cursor_bytes() >>> 0, cursor0,
    'the gather arena was not given back');
  assert.strictEqual(e.guest_span_overflow_count() >>> 0, overflow0,
    'a span did not fit the gather arena');

  console.log('PASS  GetObject/CreatePalette/Get+SetPaletteEntries/GetTextMetrics survive a struct split across sparse pages');
})().catch(err => { console.error('FAIL ', err && err.stack || err); process.exit(1); });
