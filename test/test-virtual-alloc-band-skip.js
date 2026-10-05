#!/usr/bin/env node
'use strict';
// The sparse arena now runs to the top of Win32 user space, and there are two
// things sitting in the middle of it that are not memory it may hand out.
//
// The DIB guest arena (0x50000000, 63MB) translates through its own affine
// range in $g2w, before the page table is ever consulted -- so a sparse mapping
// placed there would be silently aliased onto DIB backing, the same class of
// bug the direct window already causes. The static system-DLL pseudo handles
// (0x5D110000) are not memory at all: they exist to be compared, and
// GetModuleHandle hands them to guest code that may well read through the
// result. A real mapping underneath one turns "nothing there" into plausible
// bytes.
//
// Neither is in the record table or the reserve table, so neither can block a
// placement by itself. They are declared instead, as one 256MB band, and both
// placement paths -- the downward bump and the gap slide -- have to step over
// it. That is what this pins, on both paths, plus the property that makes the
// whole change worth having: a 430MB reservation (Black & White 2's land
// loader) has somewhere to go once the arena reaches past 0x50000000.
const assert = require('assert');
const fs = require('fs');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;

const MB = 1024 * 1024;
const IMAGE_BASE = 0x400000;
const BW2_REQUEST = 0x19AA0000; // 430MB, measured at the land pick

const extraWat = `
  (func (export "band_base") (result i32) (global.get $VIRTUAL_ALLOC_BAND_BASE))
  (func (export "band_end") (result i32) (global.get $VIRTUAL_ALLOC_BAND_END))
  (func (export "alloc_top") (result i32) (global.get $VIRTUAL_ALLOC_TOP_INIT))
  (func (export "alloc_floor") (result i32) (call $virtual_alloc_min))
  (func (export "dib_base") (result i32) (global.get $DIB_GUEST_BASE))
  (func (export "dib_capacity") (result i32) (global.get $DIB_GUEST_CAPACITY))
  (func (export "dll_handle_base") (result i32) (global.get $STATIC_SYS_DLL_HANDLE_BASE))
  (func (export "set_cursor") (param $v i32)
    (i32.store offset=8 (global.get $VIRTUAL_MAP_STATE) (local.get $v))
    (global.set $virtual_alloc_top (local.get $v)))
  (func (export "cursor") (result i32)
    (i32.load offset=8 (global.get $VIRTUAL_MAP_STATE)))
  (func (export "reserve") (param $size i32) (result i32)
    (call $virtual_reserve_down (local.get $size)))
  (func (export "gap_reserve") (param $size i32) (result i32)
    (call $virtual_reserve_gap (local.get $size)))
  (func (export "commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "translate") (param $ga i32) (result i32) (call $g2w (local.get $ga)))
`;

(async () => {
  const wasmBytes = process.argv[2] ? fs.readFileSync(process.argv[2])
    : compileSrcWasm((filename, source) =>
      filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const module = await WebAssembly.compile(wasmBytes);
  const boot = async () => {
    const memory = new WebAssembly.Memory({ initial: 16384, maximum: 16384, shared: true });
    const host = { memory };
    for (const [n, s] of Object.entries(sigs)) host[n] = s.results?.length ? () => 0 : () => {};
    const e = (await WebAssembly.instantiate(module, { host })).exports;
    e.init_thread(0, IMAGE_BASE, 0, 0, 0, 0, 0);
    return e;
  };

  const e0 = await boot();
  const BAND_BASE = e0.band_base() >>> 0, BAND_END = e0.band_end() >>> 0;
  const TOP = e0.alloc_top() >>> 0, FLOOR = e0.alloc_floor() >>> 0;
  const inBand = (base, size) => base < BAND_END && base + size > BAND_BASE;

  // --- The band really covers what it is there for.
  assert.ok(BAND_BASE <= (e0.dib_base() >>> 0)
    && (e0.dib_base() >>> 0) + (e0.dib_capacity() >>> 0) <= BAND_END,
    'the band covers the whole DIB guest arena');
  assert.ok((e0.dll_handle_base() >>> 0) >= BAND_BASE
    && (e0.dll_handle_base() >>> 0) < BAND_END,
    'the band covers the static system-DLL pseudo handles');
  assert.ok(TOP > BAND_END, 'and there is arena above it, or none of this matters');
  assert.ok(TOP <= 0x80000000, 'the ceiling stays inside Win32 user space');

  // --- The bump steps over the band instead of straddling it.
  {
    const e = await boot();
    // Park the cursor just above the band so the next reservation must cross.
    e.set_cursor((BAND_END + 16 * MB) >>> 0);
    const got = e.reserve(64 * MB) >>> 0;
    assert.ok(got, 'a reservation that has to cross the band is still served');
    assert.ok(!inBand(got, 64 * MB),
      `0x${got.toString(16)}+64MB straddles the band 0x${BAND_BASE.toString(16)}`);
    assert.ok(got + 64 * MB <= BAND_BASE, 'it went below, which is where the room is');
    assert.strictEqual(e.cursor() >>> 0, got,
      'and the cursor followed it below the band, so the next one pays nothing');
    // The placement is real: it commits and translates outside the DIB range.
    assert.strictEqual(e.commit(got, 64 * MB) >>> 0, got, 'the placement commits');
    assert.notStrictEqual(e.translate(got) >>> 0,
      e.translate((e0.dib_base() + 0) >>> 0) >>> 0,
      'and it is not aliased onto DIB backing');
  }

  // --- The gap slide steps over it too, even with the table empty.
  {
    const e = await boot();
    // A size that cannot fit between the band's top and the ceiling forces the
    // slide past it rather than a placement above it.
    const size = (TOP - BAND_END + 32 * MB) & 0xFFFF0000;
    const got = e.gap_reserve(size) >>> 0;
    assert.ok(got, 'the gap path places it somewhere');
    assert.ok(!inBand(got, size),
      `gap placement 0x${got.toString(16)}+0x${size.toString(16)} straddles the band`);
    assert.ok(got >= FLOOR, 'and stays above the floor');
  }

  // --- A placement that fits above the band stays above it.
  {
    const e = await boot();
    const got = e.reserve(32 * MB) >>> 0;
    assert.ok(got >= BAND_END, 'the first reservation comes off the top, above the band');
    assert.ok(!inBand(got, 32 * MB));
  }

  // --- What the whole change is for: B&W2's 430MB reservation has a home.
  {
    const e = await boot();
    const got = e.reserve(BW2_REQUEST) >>> 0;
    assert.ok(got, 'the 430MB land-loader reservation is served');
    assert.ok(!inBand(got, BW2_REQUEST), 'and not out of the band');
    assert.ok(TOP - BAND_END >= BW2_REQUEST,
      'the space above the band alone is big enough for it, which is the point:'
      + ' the old 0x50000000 ceiling left 785MB of live mappings no run this size');
  }

  console.log('PASS sparse arena band: bump and gap both step over the DIB/handle band');
})().catch(error => { console.error(error); process.exitCode = 1; });
