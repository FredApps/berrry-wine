#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');
const cases = [
  ['IsCharAlphaA', 0x100, false], ['IsCharAlphaNumericA', 0x104, false],
  ['IsCharUpperA', 1, false], ['IsCharLowerA', 2, false],
  ['IsCharAlphaW', 0x100, true], ['IsCharUpperW', 1, true],
];
const extraWat = cases.map(([name]) => `
  (func (export "test_${name}") (param $ch i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x07000000))
    (call $handle_${name} (local.get $ch) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`).join('') + `
  (func (export "test_ansi_flags") (param $ch i32) (result i32)
    (call $ctype1_ascii_flags (local.get $ch)))
  (func (export "test_unicode_flags") (param $ch i32) (result i32)
    (call $ctype1_unicode_flags (local.get $ch)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  let checked = 0;
  for (const [name, mask, wide] of cases) {
    assert.strictEqual(apiTable.find(api => api.name === name).nargs, 1);
    const classify = e[`test_${name}`];
    const flags = wide ? e.test_unicode_flags : e.test_ansi_flags;
    for (let ch = 0; ch < (wide ? 65536 : 256); ch++) {
      const expected = (flags(ch) & mask) !== 0 ? 1 : 0;
      assert.strictEqual(classify(ch), expected, `${name}(${ch})`);
      assert.strictEqual(e.get_esp(), 0x07000008, `${name} stdcall cleanup`);
      const promoted = wide ? (ch | 0xabcd0000) : (ch | 0xabcdef00);
      assert.strictEqual(classify(promoted), expected, `${name} promoted argument`);
      assert.strictEqual(e.get_esp(), 0x07000008);
      checked += 2;
    }
  }
  // Independent fixtures: these catch classifier mistakes too.
  for (const ch of [0x41, 0x5a, 0x61, 0x7a, 0xc9, 0xe9, 0x8a, 0x9f])
    assert.strictEqual(e.test_IsCharAlphaA(ch), 1);
  for (const ch of [0, 0x20, 0x30, 0x5b, 0x5f, 0xd7, 0xf7])
    assert.strictEqual(e.test_IsCharAlphaA(ch), 0);
  assert.strictEqual(e.test_IsCharAlphaNumericA(0x39), 1);
  assert.strictEqual(e.test_IsCharUpperA(0x8a), 1);
  assert.strictEqual(e.test_IsCharUpperW(0x8a), 0, 'Unicode C1 control is not CP1252 S-caron');
  assert.strictEqual(e.test_IsCharUpperW(0x160), 1);
  assert.strictEqual(e.test_IsCharAlphaW(0x153), 1);
  assert.strictEqual(e.test_IsCharUpperW(0x153), 0);
  assert.strictEqual(e.test_IsCharLowerA(0xdf), 1);
  assert.strictEqual(e.test_IsCharLowerA(0xc9), 0);
  assert.strictEqual(e.test_IsCharAlphaW(0xd800), 0, 'surrogate is not a letter');
  console.log(`PASS ${checked} real IsChar* calls: table agreement, promotion, BOOL and ESP`);
})().catch(error => { console.error(error); process.exit(1); });
