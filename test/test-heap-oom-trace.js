'use strict';

// Every heap allocation we refuse has to say so. A guest malloc that returns
// NULL is rare and catastrophic: a program that checks it prints "out of
// memory", and one that does not stores the NULL and corrupts a structure whose
// damage surfaces nowhere near the allocation. Black & White 2's spatial grid
// is the second kind -- it writes the NULL into a cell, doubles the recorded
// capacity anyway, and a later query walks hundreds of thousands of entries
// from address zero -- so the invariant under test is simply: $heap_alloc never
// returns 0 without reporting why.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

(async () => {
  const module = await WebAssembly.compile(compileSrcWasm());
  const imageBase = 0x400000;

  // Both legal host memories. The extension backing window above THREAD_RPC's
  // end exists only on a host that created more than the 8192-page minimum, so
  // the two sizes have genuinely different ceilings and only the larger one
  // exercises $virtual_backing_ext_take.
  const ceilings = [];
  for (const pages of [8192, 16384]) {
    const oom = [];
    const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
    const host = { memory };
    for (const [name, signature] of Object.entries(sigs))
      host[name] = signature.results?.length ? () => 0 : () => {};
    host.heap_oom_trace = (size, reason) => oom.push({ size: size >>> 0, reason });

    const a = (await WebAssembly.instantiate(module, { host })).exports;
    a.init_thread(0, imageBase, 0, 0, 0, 0, 0);
    a.heap_init(regions.BASE.GUEST_HEAP_BASE - regions.GUEST_BASE + imageBase);

    // An ordinary allocation is silent.
    assert.ok(a.guest_alloc(64) >>> 0, 'a 64-byte allocation should succeed');
    assert.strictEqual(oom.length, 0, `a healthy allocation reported OOM: ${JSON.stringify(oom)}`);

    // An over-large request is refused before the header arithmetic, and says so.
    assert.strictEqual(a.guest_alloc(0x7FFFFFF1) >>> 0, 0, 'an oversized request must fail');
    assert.strictEqual(oom.length, 1, 'the refusal must be reported exactly once');
    assert.strictEqual(oom[0].reason, 5, `expected reason 5, got ${oom[0].reason}`);
    assert.strictEqual(oom[0].size, 0x7FFFFFF1, 'the reported size is what the guest asked for');

    // The real invariant: exhaust the arena and check that the first refusal is
    // reported. Bounded so the test stays fast whether or not it reaches the end.
    oom.length = 0;
    let served = 0, refused = 0;
    for (let i = 0; i < 512; i++) {
      if (a.guest_alloc(8 << 20) >>> 0) served++;
      else { refused++; break; }
    }
    assert.ok(served > 0, 'expected at least one 8MB allocation to be served');
    ceilings.push(served);
    if (refused) {
      assert.ok(oom.length >= 1,
        'guest_alloc returned 0 without reporting why -- a silent OOM is the bug this test exists to stop');
      assert.ok([1, 2, 3, 4].includes(oom[0].reason),
        `exhaustion should report an arena reason, got ${oom[0].reason}`);
      console.log(`  ${pages} pages: exhausted after ${served} x 8MB (${served * 8}MB), reason=${oom[0].reason}`);
    } else {
      console.log(`  ${pages} pages: served ${served} x 8MB (${served * 8}MB) without exhausting`);
    }
  }

  // The extension window is the whole reason --memory-mb above 512 is offered.
  assert.ok(ceilings[1] > ceilings[0],
    `a 1GB host memory must reach further than a 512MB one, got ${ceilings[0]} vs ${ceilings[1]} x 8MB`);

  console.log('PASS heap OOM is always reported, and the extension window extends the ceiling');
})().catch((e) => { console.error(e); process.exit(1); });
