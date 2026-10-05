#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const LCID_INSTALLED = 1;
const LCID_SUPPORTED = 2;
const LOCALE_USER_DEFAULT = 0x0400;
const LOCALE_SYSTEM_DEFAULT = 0x0800;

const extraWat = String.raw`
  (func (export "test_is_valid_locale") (param $locale i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IsValidLocale (local.get $locale) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);

  for (const locale of [0x0409, LOCALE_USER_DEFAULT, LOCALE_SYSTEM_DEFAULT]) {
    assert.strictEqual(e.test_is_valid_locale(locale, LCID_INSTALLED), 1,
      `0x${locale.toString(16)} is installed`);
    assert.strictEqual(e.test_is_valid_locale(locale, LCID_SUPPORTED), 1,
      `0x${locale.toString(16)} is supported`);
  }
  assert.strictEqual(e.get_esp() >>> 0, 0x0030000c,
    'IsValidLocale pops two arguments');

  for (const locale of [0, 0x0407, 0x0411, 0x7fffffff]) {
    assert.strictEqual(e.test_is_valid_locale(locale, LCID_INSTALLED), 0,
      `unadvertised locale 0x${locale.toString(16)} is not installed`);
    assert.strictEqual(e.test_is_valid_locale(locale, LCID_SUPPORTED), 0,
      `unadvertised locale 0x${locale.toString(16)} is not supported`);
  }
  for (const flags of [0, 3, 0x39, 0xffffffff]) {
    assert.strictEqual(e.test_is_valid_locale(0x0409, flags), 0,
      `undocumented Win98 validity query 0x${flags.toString(16)} is rejected`);
  }

  console.log('PASS  IsValidLocale matches the advertised en-US locale surface');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
