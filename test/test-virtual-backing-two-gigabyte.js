#!/usr/bin/env node
'use strict';
// One gigabyte of guest memory is not enough for Black & White 2, and the
// import's maximum is what decides that.
//
// Measured at its land selection on 2026-09-13, with the arena ceiling already
// raised to 0x7F000000 so placement is not the constraint: 371 records holding
// 0x317CA000 (792MB) of live backing, then the land loader asks for one
// 0x19AA0000 (430MB) range. A 1GB memory provides 828MB of backing -- the
// 316MB primary pool plus the 512MB above 0x20000000 -- so the reservation
// places fine and the commit behind it is refused with reason 3, "reserved
// range could not be committed". operator new returns null and the unhandled
// std::bad_alloc ends the process.
//
// So the declaration moved to (memory 8192 32768 shared). This test is the
// difference that change makes, both halves in one process: identical WAT, two
// memories, and the demand profile that cannot be served on the 1GB one served
// on the 2GB one.
//
// 32768 is also the last safe value, and that is asserted here rather than
// left as a comment: $virtual_backing_ext_end is (i32.shl (memory.size) 16),
// which is 0x80000000 at 2GB -- negative as a signed i32, and read correctly
// only because every comparison it feeds is unsigned. At 65536 pages the shift
// wraps to 0 and the window silently disappears.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { REGIONS } = require('../lib/region-map.generated.js');

const EXT_BASE = REGIONS.THREAD_RPC.end;
const POOL = REGIONS.VIRTUAL_BACKING_BASE.size;

// The measurement this test exists for.
const BW2_LIVE = 0x317CA000;
const BW2_REQUEST = 0x19AA0000;

// Guest addresses for the replay. The fill starts above the direct window and
// stops well short of the excluded 0x50000000..0x60000000 band; the big
// request goes above the band. Neither ever reaches kernel space.
const FILL_BASE = 0x08400000;
const REQUEST_BASE = 0x60000000;
const CHUNK = 16 * 1024 * 1024;

const EXTRA_WAT = `
  (func (export "commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "backing_of") (param $guest i32) (result i32)
    (call $g2w (local.get $guest)))
  (func (export "ext_end") (result i32) (call $virtual_backing_ext_end))
  (func (export "capacity") (result i32) (call $virtual_backing_capacity))
  (func (export "available") (result i32) (call $virtual_backing_available))
  (func (export "max_extent") (result i32) (call $virtual_backing_max_extent))
`;

const boot = pages => bootRenderHarness({
  fonts: 'none', extraWat: EXTRA_WAT,
  memory: new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true }),
});

// Put BW2_LIVE bytes of live mappings on the table the way the app does -- many
// separate records, not one -- and report how much actually landed.
function fillToLive(e) {
  let guest = FILL_BASE, placed = 0;
  while (placed < BW2_LIVE) {
    const size = Math.min(CHUNK, BW2_LIVE - placed);
    if (!(e.commit(guest, size) >>> 0)) break;
    placed += size;
    guest += CHUNK;
  }
  return placed;
}

(async () => {
  // --- 1GB: the ceiling B&W2 was measured against. The fill alone spends it.
  {
    const { exports: e } = await boot(16384);
    assert.strictEqual(e.capacity() >>> 0, (POOL + 0x40000000 - EXT_BASE) >>> 0,
      '828MB of backing behind a 1GB memory');
    const placed = fillToLive(e);
    assert.ok(placed < BW2_LIVE || (e.available() >>> 0) < BW2_REQUEST,
      'a 1GB memory cannot hold the land load and still have 430MB left');
    assert.strictEqual(e.commit(REQUEST_BASE, BW2_REQUEST) >>> 0, 0,
      'this is the refusal that killed the process at the land picker');
  }

  // --- 2GB: same WAT, same sequence, served.
  {
    const { exports: e } = await boot(32768);
    // The sign bit does not lie. 2GB is 0x80000000, and reading it as a
    // negative number anywhere in the window arithmetic would report either
    // "no window" or a window ending below its own base.
    assert.strictEqual(e.ext_end() >>> 0, 0x80000000, 'the window runs to 2GB');
    assert.ok((e.ext_end() >>> 0) > EXT_BASE, 'and it is above its own base, unsigned');
    assert.strictEqual(e.capacity() >>> 0, (POOL + 0x80000000 - EXT_BASE) >>> 0,
      '1852MB of backing behind a 2GB memory');
    assert.ok((e.max_extent() >>> 0) >= BW2_REQUEST,
      'one 430MB commit fits in one window, so it never has to be split');

    const placed = fillToLive(e);
    assert.strictEqual(placed, BW2_LIVE, 'the whole 792MB working set is live');
    assert.ok((e.available() >>> 0) >= BW2_REQUEST,
      `only 0x${(e.available() >>> 0).toString(16)} left for a 0x${BW2_REQUEST.toString(16)} request`);

    assert.strictEqual(e.commit(REQUEST_BASE, BW2_REQUEST) >>> 0, REQUEST_BASE,
      "the land loader's 430MB range commits");

    // It has to be real memory, contiguous, and nobody else's. The last page
    // is the one that matters: its backing address is up near 0x80000000,
    // where a signed compare or a truncated PTE would go wrong quietly.
    const base = e.backing_of(REQUEST_BASE) >>> 0;
    const last = (REQUEST_BASE + BW2_REQUEST - 4) >>> 0;
    assert.strictEqual(e.backing_of(last) >>> 0, (base + BW2_REQUEST - 4) >>> 0,
      'the range is one contiguous mapping');
    e.guest_write32(REQUEST_BASE, 0x5a5a1234);
    e.guest_write32(last, 0x0badc0de);
    assert.strictEqual(e.guest_read32(REQUEST_BASE) >>> 0, 0x5a5a1234);
    assert.strictEqual(e.guest_read32(last) >>> 0, 0x0badc0de,
      'the top of a 2GB memory reads back what was written to it');

    // And it did not land on the working set that was already there.
    assert.strictEqual(e.guest_read32(FILL_BASE) >>> 0, 0,
      'the new range must not alias the live mappings below it');
  }

  console.log('PASS sparse backing: 2GB serves the land load that 1GB refuses');
})().catch(error => { console.error(error); process.exitCode = 1; });
