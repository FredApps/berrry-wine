#!/usr/bin/env node
'use strict';

// A large block gets a sparse arena of its own, and a freed one is kept for the
// next large request (never carved by small ones) until memory pressure hands it back,
// as the Windows heap does with a request it hands to VirtualAlloc. Alien
// Shooter allocates and frees a 48 MB decode buffer per sprite pack with a few
// small allocations in between. Those used to carve the freed block's front, so
// every 48 MB request reserved a fresh range: six cycles spent the whole 316 MB
// backing pool while under 3 MB was live, and every later pack load failed.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none' });
  const BIG = 0x03000000, keep = [];
  for (let i = 0; i < 12; i++) {
    const p = e.guest_alloc(BIG) >>> 0;
    assert(p, `48 MB allocation ${i} succeeds (the old heap failed the 7th)`);
    // Writable end to end: the arena is committed, not just reserved.
    e.guest_write32(p, 0x11111111 + i);
    e.guest_write32(p + BIG - 4, 0x22222222 + i);
    assert.strictEqual(e.guest_read32(p + BIG - 4) >>> 0, 0x22222222 + i);
    e.guest_free(p);
    for (let k = 0; k < 64; k++) {
      const s = e.guest_alloc(k & 1 ? 4096 : 10256) >>> 0;
      assert(s, 'small allocation between the large ones');
      keep.push(s);
    }
  }
  // Fresh pages, not the previous owner's bytes (HeapAlloc of a large block is
  // a fresh VirtualAlloc on Windows).
  const fresh = e.guest_alloc(BIG) >>> 0;
  assert(fresh);
  assert.strictEqual(e.guest_read32(fresh) >>> 0, 0, 'a reissued large block starts zeroed');
  assert.strictEqual(e.guest_read32(fresh + BIG - 4) >>> 0, 0);
  e.guest_free(fresh);
  for (const s of keep) e.guest_free(s);
  console.log('PASS  large heap blocks own an arena reused across alloc/free cycles (12 x 48 MB with live small blocks between)');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
