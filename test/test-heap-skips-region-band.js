'use strict';

// The low heap window is not contiguous. Between the end of GUEST_BASE and the
// start of GUEST_HEAP_BASE the region allocator places emulator-private tables
// (MM_TIMER_TABLE, CS_RING, CLIENT_RECT, ...), and $g2w's direct window maps
// those guest addresses straight onto them. Moorhuhn 2's heap grew through the
// band, blitted sprites over MM_TIMER_TABLE, and DispatchMessageA then called a
// pixel value as a timer callback. No block may start or end inside the band.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const sigs = require('../lib/host-import-sigs.generated.json').sigs;
const regions = require('../lib/region-map.generated');

(async () => {
  const module = await WebAssembly.compile(compileSrcWasm());
  const imageBase = 0x400000;
  const toGuest = (wa) => wa - regions.GUEST_BASE + imageBase;
  const bandLo = toGuest(regions.END.GUEST_BASE);
  const bandHi = toGuest(regions.BASE.GUEST_HEAP_BASE);
  assert.ok(bandHi > bandLo, 'expected emulator regions between GUEST_BASE and GUEST_HEAP_BASE');

  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const host = { memory };
  for (const [name, signature] of Object.entries(sigs))
    host[name] = signature.results?.length ? () => 0 : () => {};
  const a = (await WebAssembly.instantiate(module, { host })).exports;
  a.init_thread(0, imageBase, 0, 0, 0, 0, 0);
  // Start the heap 1.5 arena chunks under the band: the first 1MB chunk fits
  // below it, the second would straddle it.
  a.heap_init(bandLo - 0x180000);

  let below = 0, above = 0;
  for (let i = 0; i < 1024; i++) {
    const size = 0x1000 + (i % 7) * 0x300;
    const p = a.guest_alloc(size) >>> 0;
    assert.ok(p, `allocation ${i} of ${size} bytes failed`);
    assert.ok(p + size <= bandLo || p >= bandHi,
      `block 0x${p.toString(16)}+0x${size.toString(16)} overlaps the region band ` +
      `[0x${bandLo.toString(16)}, 0x${bandHi.toString(16)})`);
    if (p < bandLo) below++; else above++;
  }
  assert.ok(below > 0 && above > 0, `expected blocks on both sides, got ${below} below / ${above} above`);
  console.log(`PASS heap skips the region band: ${below} blocks below, ${above} above ` +
    `[0x${bandLo.toString(16)}, 0x${bandHi.toString(16)})`);
})().catch((e) => { console.error(e); process.exit(1); });
