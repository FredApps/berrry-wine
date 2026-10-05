#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  // Bias 0x1E0 (UTC-8): nonzero in two bytes, so the Bias store is checked
  // across every page split as well as the zero fill.
  let clockCtx = null;
  const { exports: e, hostCtx } = await bootRenderHarness({ fonts: 'none', extraHostOverrides: {
    wall_clock: (out, kind) => {
      if (kind !== 3) return 0;
      new DataView(clockCtx.getMemory()).setInt32(out, 0x1E0, true);
      return 1;
    },
  }, extraWat: `
    (func (export "map_timezone_page") (param $ga i32) (result i32)
      (call $virtual_map_commit (local.get $ga) (i32.const 4096)))
    (func (export "timezone_info") (param $out i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $handle_GetTimeZoneInformation (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
      (i32.load (global.get $reg_base)))
  ` });
  clockCtx = hostCtx;
  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) assert.strictEqual(e.map_timezone_page(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(unrelated + i, 0xa5);
  for (let split = 1; split <= 172; split++) {
    const out = page + 4096 - split;
    for (let i = -1; i <= 172; i++) e.guest_write8(out + i, 0xcc);
    assert.strictEqual(e.timezone_info(out), 0, 'existing TIME_ZONE_ID_UNKNOWN policy');
    assert.deepStrictEqual(read(out - 1, 174), [0xcc, 0xe0, 0x01, ...new Array(170).fill(0), 0xcc], `split=${split}`);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  }
  assert.deepStrictEqual(read(unrelated, 4096), new Array(4096).fill(0xa5));
  console.log('PASS GetTimeZoneInformation: 171 sparse crossings, Bias from the host zone, page-local control, canaries and stdcall');
})().catch(error => { console.error(error); process.exitCode = 1; });
