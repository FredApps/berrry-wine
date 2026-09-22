#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "map_startup_page") (param $ga i32) (result i32)
      (call $virtual_map_commit (local.get $ga) (i32.const 4096)))
    (func (export "startup_info") (param $wide i32) (param $out i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (if (local.get $wide)
        (then (call $handle_GetStartupInfoW (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
        (else (call $handle_GetStartupInfoA (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))))
  ` });
  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) assert.strictEqual(e.map_startup_page(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096);
  const expected = [68, ...new Array(67).fill(0)];
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(unrelated + i, 0xa5);
  for (const wide of [0, 1]) for (let split = 1; split < 68; split++) {
    const out = page + 4096 - split;
    for (let i = -1; i <= 68; i++) e.guest_write8(out + i, 0xcc);
    e.startup_info(wide, out);
    assert.deepStrictEqual(read(out - 1, 70), [0xcc, ...expected, 0xcc], `wide=${wide}, split=${split}`);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  }
  assert.deepStrictEqual(read(unrelated, 4096), new Array(4096).fill(0xa5));
  console.log('PASS GetStartupInfo A/W: 134 sparse splits, full structure, canaries and stdcall');
})().catch(error => { console.error(error); process.exitCode = 1; });
