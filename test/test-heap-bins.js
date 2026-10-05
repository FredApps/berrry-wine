'use strict';
// Randomized allocator property test for the small-block bins in front of the
// free list (src/10-helpers.wat, $heap_bin_*). Two instances share one memory
// the way guest threads do; blocks are allocated by one instance and freed by
// either, and get_free_list (which splices every bin back onto the list) runs
// at random points. Invariants: no live block ever overlaps another, and no
// live block's bytes change while it is live.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

(async () => {
  const module = await WebAssembly.compile(compileSrcWasm());
  const imageBase = 0x400000;
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const host = { memory };
  for (const [name, signature] of Object.entries(sigs))
    host[name] = signature.results?.length ? () => 0 : () => {};
  const a = (await WebAssembly.instantiate(module, { host })).exports;
  const peer = (await WebAssembly.instantiate(module, { host })).exports;
  a.init_thread(0, imageBase, 0, 0, 0, 0, 0);
  a.heap_init(regions.BASE.GUEST_HEAP_BASE - regions.GUEST_BASE + imageBase);
  peer.init_thread(1, imageBase, 0, 0, 0, 0, 0);
  const bytes = new Uint8Array(memory.buffer);
  const wa = p => a.guest_to_wasm(p) >>> 0;

  // Deterministic xorshift, so a failure names a reproducible op index.
  let seed = 0x2545f491;
  const rand = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };

  const live = new Map(); // guest ptr -> { size, tag }
  const check = (p, { size, tag }, op) => {
    const w = wa(p);
    for (let i = 0; i < size; i++)
      if (bytes[w + i] !== tag) assert.fail(`op ${op}: live block 0x${p.toString(16)}+${i} changed (${bytes[w + i]} != ${tag})`);
  };
  let tagNext = 1, binnedReuse = 0;
  const freed = new Set();

  for (let op = 0; op < 20000; op++) {
    const r = rand(100);
    if (r < 55 || live.size === 0) {
      // Mostly small (binned) sizes, some across the 256-byte cutoff.
      const size = rand(10) < 8 ? 1 + rand(250) : 1 + rand(600);
      const p = a.guest_alloc(size) >>> 0;
      assert(p, `op ${op}: alloc(${size}) failed`);
      if (freed.has(p)) binnedReuse++;
      const lo = p - 4, hi = p - 4 + ((size + 4 + 7) & ~7);
      for (const [q, b] of live) {
        const qlo = q - 4, qhi = q - 4 + ((b.size + 4 + 7) & ~7);
        if (lo < qhi && qlo < hi)
          assert.fail(`op ${op}: alloc(${size}) = 0x${p.toString(16)} overlaps live 0x${q.toString(16)} (${b.size})`);
      }
      const tag = tagNext = (tagNext % 250) + 1;
      bytes.fill(tag, wa(p), wa(p) + size);
      live.set(p, { size, tag });
    } else if (r < 97) {
      const keys = [...live.keys()], p = keys[rand(keys.length)];
      check(p, live.get(p), op);
      live.delete(p);
      freed.add(p);
      (rand(4) === 0 ? peer : a).guest_free(p);
    } else {
      a.get_free_list();
      peer.get_free_list();
    }
    if (op % 1000 === 999) for (const [p, b] of live) check(p, b, op);
  }
  for (const [p, b] of live) check(p, b, 'end');
  assert(binnedReuse > 1000, `freed blocks are actually reused (${binnedReuse})`);
  const st = i => Number(a.heap_stat(i));
  assert(st(2) / Math.max(1, st(0)) < 64, `walk stays short: ${st(2)} steps for ${st(0)} allocs`);
  console.log(`PASS  heap bins: 20000 random ops, no overlap or clobber; ${binnedReuse} reuses, ` +
    `${(st(2) / st(0)).toFixed(1)} steps/alloc`);
})().catch(err => { console.error(err); process.exit(1); });
