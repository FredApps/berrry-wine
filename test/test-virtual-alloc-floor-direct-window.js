#!/usr/bin/env node
'use strict';
// Where the sparse arena's floor actually is.
//
// It used to be the flat constant 0x10000000, which is not a fact about
// anything. The only address a sparse reservation must stay clear of is the
// direct window: $g2w answers anything inside it from the image's affine delta
// and never looks at the page table, so a mapping placed there would be
// silently aliased onto the PE image. That window ends at
//   guest = (region.end $DIRECT_WINDOW) + image_base - GUEST_BASE
// which for the usual 0x400000 image is 0x083EE000 -- so the constant was
// holding back 124 MB of guest address space nothing else could ever use.
//
// Black & White 2 is what made that matter. At its land picker the reserve
// cursor stands at 0x289F0000 and the land loader asks for one 430 MB
// (0x19AA0000) reservation. That lands at 0x0EF50000: 18 MB below the old
// floor, 100 MB above this one. It was refused with "no guest address space
// left to reserve", operator new returned null, and the unhandled
// std::bad_alloc ended the process at the land-selection screen.
const assert = require('assert');
const fs = require('fs');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const { REGIONS } = require('../lib/region-map.generated.js');

const GUEST_BASE = REGIONS.GUEST_BASE.base;
const OLD_FLOOR = 0x10000000;
const BW2_REQUEST = 0x19AA0000;

const extraWat = `
  (func (export "test_floor") (result i32) (call $virtual_alloc_min))
  ;; The span the fast path covers, asked of the compiler rather than written
  ;; down: it is a declaration, not an ABI, and a copied literal would keep
  ;; passing after it moved.
  (func (export "test_direct_end") (result i32) (region.end $DIRECT_WINDOW))
  (func (export "test_set_cursor") (param $v i32)
    (i32.store offset=8 (global.get $VIRTUAL_MAP_STATE) (local.get $v))
    (global.set $virtual_alloc_top (local.get $v)))
  (func (export "test_reserve") (param $size i32) (result i32)
    (call $virtual_reserve_down (local.get $size)))
  (func (export "test_commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_g2w") (param $ga i32) (result i32) (call $g2w (local.get $ga)))
`;

(async () => {
  const wasmBytes = process.argv[2] ? fs.readFileSync(process.argv[2])
    : compileSrcWasm((filename, source) =>
      filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const module = await WebAssembly.compile(wasmBytes);

  let DIRECT_END = 0;
  const boot = async (imageBase) => {
    const memory = new WebAssembly.Memory({ initial: 16384, maximum: 16384, shared: true });
    const host = { memory };
    for (const [n, s] of Object.entries(sigs)) host[n] = s.results?.length ? () => 0 : () => {};
    const e = (await WebAssembly.instantiate(module, { host })).exports;
    e.init_thread(0, imageBase, 0, 0, 0, 0, 0);
    DIRECT_END = e.test_direct_end() >>> 0;
    return e;
  };

  // --- The floor tracks the image, and it never overlaps the direct window.
  for (const imageBase of [0x400000, 0x1000000]) {
    const e = await boot(imageBase);
    const floor = e.test_floor() >>> 0;
    const directEnd = (DIRECT_END + imageBase - GUEST_BASE) >>> 0;
    assert.ok(floor >= directEnd,
      `floor 0x${floor.toString(16)} must clear the direct window's end 0x${directEnd.toString(16)}`);
    assert.strictEqual(floor & 0xffff, 0, 'the floor is 64KB-aligned');
    assert.ok(floor < OLD_FLOOR,
      `a ${imageBase.toString(16)} image should gain space, not lose it`);
    // One byte below the floor still belongs to the image, one byte above does
    // not -- which is the whole reason the floor is where it is.
    assert.notStrictEqual(e.test_g2w(directEnd - 4) >>> 0, e.test_g2w(0) >>> 0,
      'the last direct-window address translates through the image delta');
  }

  // --- B&W2's reservation: refused at the old floor, served at the real one.
  {
    const e = await boot(0x400000);
    const floor = e.test_floor() >>> 0;
    const cursor = 0x289F0000; // measured at the land picker
    const landing = (cursor - BW2_REQUEST) & 0xFFFF0000;
    assert.ok(landing < OLD_FLOOR && landing >= floor,
      `the 430MB step lands at 0x${landing.toString(16)}: below the old floor, above the real one`);

    e.test_set_cursor(cursor);
    const got = e.test_reserve(BW2_REQUEST) >>> 0;
    assert.strictEqual(got, landing >>> 0,
      'the 430MB reservation is served from the bump, not refused');
    assert.ok(e.test_commit(got, BW2_REQUEST) >>> 0, 'and the whole range commits');
    // Committed, it must be reachable through the sparse map rather than
    // aliased onto the image: the first and last pages translate, and they
    // translate contiguously.
    const base = e.test_g2w(got) >>> 0;
    assert.strictEqual(e.test_g2w((got + BW2_REQUEST - 4) >>> 0) >>> 0,
      (base + BW2_REQUEST - 4) >>> 0, 'the reservation is one contiguous mapping');
    assert.ok(base >= DIRECT_END, 'it is backed outside the direct window');
  }

  console.log('PASS test-virtual-alloc-floor-direct-window');
})().catch(err => { console.error(err); process.exit(1); });
