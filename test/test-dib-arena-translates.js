#!/usr/bin/env node
'use strict';

// Every page the DIB arena hands out must translate. $DIB_PAGE_COUNT once
// stayed at 64MB after $DIB_GUEST_CAPACITY dropped to 63MB, so the arena's top
// megabyte translated to the NULL sentinel: a surface created there was zeroed
// from wasm 0xF0 and texture uploads wrote over the guest image (Deus Ex on
// OpenGlDrv lost deusex.exe's vtables after Escape). Fill the arena in 1MB
// blocks and check each block's first and last byte map into DIB backing.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "dib_alloc_test") (param $size i32) (result i32)
      (call $dib_alloc (local.get $size)))
    (func (export "dib_translate_test") (param $ga i32) (result i32)
      (call $g2w (local.get $ga)))
    (func (export "dib_page_count_test") (result i32) (global.get $DIB_PAGE_COUNT))
    (func (export "dib_capacity_test") (result i32) (global.get $DIB_GUEST_CAPACITY))
    (func (export "dib_sentinel_test") (result i32) (global.get $NULL_SENTINEL))
  ` });

  const pages = e.dib_page_count_test() >>> 0;
  const capacity = e.dib_capacity_test() >>> 0;
  const sentinel = e.dib_sentinel_test() >>> 0;
  assert.strictEqual(pages * 4096, capacity,
    'the DIB arena hands out exactly the guest range $g2w translates');

  const block = 1 << 20;
  let blocks = 0;
  for (;;) {
    const ga = e.dib_alloc_test(block) >>> 0;
    if (!ga) break;
    blocks++;
    for (const probe of [ga, ga + block - 4]) {
      const wa = e.dib_translate_test(probe) >>> 0;
      assert.notStrictEqual(wa, sentinel,
        `DIB guest 0x${probe.toString(16)} (block ${blocks}) does not translate`);
    }
  }
  assert.ok(blocks >= Math.floor(capacity / block) - 1,
    `the arena filled to ${blocks} MB of ${capacity / block}`);

  console.log(`PASS  every DIB arena page translates (${blocks} x 1MB blocks, ${pages} pages)`);
})().catch(err => { console.error(err); process.exit(1); });
