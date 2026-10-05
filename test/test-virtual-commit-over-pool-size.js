#!/usr/bin/env node
'use strict';
// One commit larger than the 316MB primary pool.
//
// Black & White 2's land loader asks for 430,511,656 bytes in a single
// allocation at the land-selection screen. The extension window a 1GB host
// creates is 512MB and empty at that point, and $virtual_backing_ext_take is
// written to serve exactly this case -- but $virtual_map_commit_locked opened
// with a size guard against the PRIMARY pool's size, so the request was
// refused before anything looked at the window that could hold it. The guest
// saw a failed operator new and died on an unhandled bad_alloc.
//
// The bound that is actually true is the largest window, not the first one:
// a commit lands on one window's contiguous bytes or it is split in half, so
// only a request bigger than both can never be served.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { REGIONS } = require('../lib/region-map.generated.js');

const EXT_BASE = REGIONS.THREAD_RPC.end;
const POOL = REGIONS.VIRTUAL_BACKING_BASE.size;
// The size B&W2 actually asks for, rounded up to a 64K page as VirtualAlloc
// would: bigger than the 316MB pool, smaller than the 512MB extension.
const BW2_REQUEST = 0x19AA0000;

const EXTRA_WAT = `
  (func (export "commit") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "backing_of") (param $guest i32) (result i32)
    (call $g2w (local.get $guest)))
  (func (export "ext_end") (result i32) (call $virtual_backing_ext_end))
  (func (export "max_extent") (result i32) (call $virtual_backing_max_extent))
`;

const boot = pages => bootRenderHarness({
  fonts: 'none', extraWat: EXTRA_WAT,
  memory: new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true }),
});

(async () => {
  assert.ok(BW2_REQUEST > POOL, 'the request has to outgrow the primary pool to test anything');

  // --- 1GB host: the extension window exists and is big enough.
  {
    const { exports: e } = await boot(16384);
    const extSize = (e.ext_end() >>> 0) - EXT_BASE;
    assert.ok(extSize >= BW2_REQUEST, `extension window ${extSize} must hold the request`);
    assert.strictEqual(e.max_extent() >>> 0, extSize, 'the bound is the larger window');

    const guest = 0x60000000;
    assert.strictEqual(e.commit(guest, BW2_REQUEST) >>> 0, guest,
      'a 430MB commit must succeed on a host with a 512MB extension window');
    const backing = e.backing_of(guest) >>> 0;
    assert.ok(backing >= EXT_BASE, `430MB landed at ${backing.toString(16)}, not the extension`);

    // Every page of it is addressable, not just the first: the record covers
    // the whole range or the guest writes off the end of its own allocation.
    const last = (guest + BW2_REQUEST - 4) >>> 0;
    const lastBacking = e.backing_of(last) >>> 0;
    assert.strictEqual(lastBacking, backing + BW2_REQUEST - 4,
      'the tail of the allocation must be contiguous with its base');
  }

  // --- 512MB host: no extension, so the bound stays the primary pool and the
  // request is refused rather than half-served.
  {
    const { exports: e } = await boot(8192);
    assert.strictEqual(e.ext_end() >>> 0, 0, 'no window above a 512MB memory');
    assert.strictEqual(e.max_extent() >>> 0, POOL, 'without an extension the pool is the bound');
    assert.strictEqual(e.commit(0x60000000, BW2_REQUEST) >>> 0, 0,
      'a request larger than every window must fail, not alias');
  }

  console.log('PASS test-virtual-commit-over-pool-size');
})().catch(err => { console.error(err); process.exit(1); });
