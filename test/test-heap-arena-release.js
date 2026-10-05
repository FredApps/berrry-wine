'use strict';

// A sparse heap arena nothing lives in any more has to be given back.
//
// Every allocation too big for the current chunk gets a fresh sparse arena, and
// a free block may not be merged with the one in the arena next door -- so a
// container that grows by reallocating used to pay for every size it ever was.
// Black & White 2's land loader grows one by roughly 1.5x a step (1, 1.4, 2.2,
// 3.3, 4.8, 7.1, 10.7, 16, 24, 36, 54, 81, 121 MB, each step a HeapReAlloc that
// frees the step before it). Measured at the 191 MB step: 390 map records, the
// reserve cursor 923 MB down from 0x50000000 and 315 of the backing pool's
// 316 MB spent, for a container 121 MB long. The allocation failed, the game
// threw std::bad_alloc and died on the unhandled exception path.
//
// So the same series is replayed here against a pool that cannot hold its sum.
// Reaching the top of it at all is the assertion: without the release the run
// stops partway, because the abandoned steps are still committed.
//
// Buffers are probed through guest_read32/guest_write32 rather than a view on
// the WASM buffer, because a commit this large is split across several backing
// extents and the guest range behind it is deliberately not contiguous there.

const assert = require('assert');
const fs = require('fs');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

const MB = 1024 * 1024;
const IMAGE_BASE = 0x400000;

// The arena's ceiling is asked of the module rather than written down: it
// moved once already (0x40000000 -> 0x50000000 -> the top of user space), and
// a stale copy here would turn the reservation-cursor delta below into a
// meaningless number without failing.
const extraWat = `
  (func (export "test_alloc_top_init") (result i32)
    (global.get $VIRTUAL_ALLOC_TOP_INIT))
`;

(async () => {
  const module = await WebAssembly.compile(
    process.argv[2] ? fs.readFileSync(process.argv[2]) : compileSrcWasm(
      (filename, source) =>
        filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source));
  let ALLOC_TOP = 0;
  const lowEnd = regions.END.GUEST_HEAP_BASE - regions.GUEST_BASE + IMAGE_BASE;
  const poolBytes = regions.REGIONS.VIRTUAL_BACKING_BASE.size;

  async function boot() {
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const host = { memory };
    for (const [n, s] of Object.entries(sigs)) host[n] = s.results?.length ? () => 0 : () => {};
    const e = (await WebAssembly.instantiate(module, { host })).exports;
    e.init_thread(0, IMAGE_BASE, 0, 0, 0, 0, 0);
    e.heap_init(lowEnd);   // low window already spent: everything goes sparse
    ALLOC_TOP = e.test_alloc_top_init() >>> 0;
    return { e, memory };
  }
  // +4 is the backing bump cursor, +8 the downward reservation cursor.
  const state = (memory) => {
    const dv = new DataView(memory.buffer);
    return {
      records: dv.getUint32(regions.BASE.VIRTUAL_MAP_STATE, true),
      backing: dv.getUint32(regions.BASE.VIRTUAL_MAP_STATE + 4, true)
        - regions.BASE.VIRTUAL_BACKING_BASE,
      reserved: ALLOC_TOP - dv.getUint32(regions.BASE.VIRTUAL_MAP_STATE + 8, true),
    };
  };
  // Four words spread over the block: the first, the last, and two inside. Far
  // enough apart to land in different backing extents of a split commit.
  const marks = (size) => [0, (size >> 2) & ~3, (size >> 1) & ~3, size - 4];
  const stamp = (e, ptr, size, seed) => {
    for (const off of marks(size)) e.guest_write32(ptr + off, (seed ^ off) | 0);
  };
  const check = (e, ptr, size, seed, where) => {
    for (const off of marks(size)) {
      assert.strictEqual(e.guest_read32(ptr + off) >>> 0, ((seed ^ off) >>> 0),
        `${where}: word at +0x${off.toString(16)} of the block at `
        + `0x${ptr.toString(16)} changed underneath its owner`);
    }
  };

  // 1. The growth series: allocate the next size, then free the previous
  //    buffer -- HeapReAlloc, by hand.
  {
    const { e, memory } = await boot();
    let size = 4 * MB;
    let ptr = e.guest_alloc(size) >>> 0;
    assert(ptr, 'first buffer');
    stamp(e, ptr, size, 0xa5a50001);
    let sum = size, steps = 1;
    while (size < 128 * MB) {
      const next = Math.floor(size * 1.5) & ~7;
      const grown = e.guest_alloc(next) >>> 0;
      assert(grown, `step ${steps}: ${(next / MB).toFixed(1)}MB refused after `
        + `${(sum / MB).toFixed(0)}MB of cumulative growth in a ${(poolBytes / MB) | 0}MB pool`);
      // The buffer being copied out of is still the owner's, whatever the
      // allocator had to hand back to serve this step.
      check(e, ptr, size, 0xa5a50000 | steps, 'live buffer during growth');
      e.guest_free(ptr);
      ptr = grown; size = next; sum += next; steps++;
      stamp(e, ptr, size, 0xa5a50000 | steps);
    }
    assert(steps >= 9, 'the series really ran');
    check(e, ptr, size, 0xa5a50000 | steps, 'final buffer');
    assert(sum > poolBytes, `the series must outgrow the pool (${(sum / MB) | 0}MB)`);
    const st = state(memory);
    assert(st.backing <= poolBytes,
      `backing high-water ${(st.backing / MB) | 0}MB must stay inside the pool`);
    assert(st.backing < 3 * size,
      'a released series costs its largest members, not their sum '
      + `(${(st.backing / MB) | 0}MB high-water for a ${(size / MB) | 0}MB buffer)`);
  }

  // 2. An arena still holding a live block is not released, however hard the
  //    allocator is pushed.
  {
    const { e } = await boot();
    const keep = e.guest_alloc(8 * MB) >>> 0;
    assert(keep);
    stamp(e, keep, 8 * MB, 0x3c3c3c3c);
    const churn = [];
    for (let i = 0; i < 6; i++) churn.push(e.guest_alloc(24 * MB) >>> 0);
    for (const p of churn) { assert(p); e.guest_free(p); }
    // Enough pressure that the release scan has to run.
    const big = e.guest_alloc(200 * MB) >>> 0;
    assert(big, 'a large allocation lands once the dead arenas are handed back');
    stamp(e, big, 200 * MB, 0x5eed0001);
    check(e, keep, 8 * MB, 0x3c3c3c3c, 'live arena');
    check(e, big, 200 * MB, 0x5eed0001, 'the block the release made room for');
    e.guest_free(big);
  }

  // 3. Address space comes back too, not just backing: the downward reserve
  //    cursor is what Black & White 2 walked 923MB of.
  {
    const { e, memory } = await boot();
    let ptr = e.guest_alloc(64 * MB) >>> 0;
    assert(ptr);
    const after1 = state(memory).reserved;
    for (let i = 0; i < 4; i++) {
      const next = e.guest_alloc(64 * MB) >>> 0;
      assert(next, `64MB buffer ${i + 2}`);
      e.guest_free(ptr);
      ptr = next;
    }
    const after5 = state(memory).reserved;
    assert(after5 <= after1 * 3,
      `reservation cursor walked ${(after5 / MB) | 0}MB for five 64MB buffers `
      + `of which one is live (first cost ${(after1 / MB) | 0}MB)`);
  }

  console.log('Heap sparse arena release PASS: growth series, live arena kept, address space reclaimed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
