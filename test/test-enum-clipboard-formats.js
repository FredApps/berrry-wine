#!/usr/bin/env node
'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_enum_binary_ptr (mut i32) (i32.const 0))

  ;; mask: 1 = CF_DIB, 2 = registered RTF, 4 = text conversion pair.
  (func (export "test_clipboard_configure") (param $mask i32)
    (call $clipboard_clear_all_data)
    (if (i32.ne (i32.and (local.get $mask) (i32.const 1)) (i32.const 0))
      (then
        (global.set $test_enum_binary_ptr (call $heap_alloc (i32.const 4)))
        (global.set $clipboard_binary_format (i32.const 8))
        (global.set $clipboard_binary_ptr (global.get $test_enum_binary_ptr))
        (global.set $clipboard_binary_len (i32.const 4))))
    (if (i32.ne (i32.and (local.get $mask) (i32.const 2)) (i32.const 0))
      (then
        (global.set $clipboard_rtf_format_id (i32.const 0xc123))
        (global.set $clipboard_rtf_present (i32.const 1)) (global.set $clipboard_rtf_len (i32.const 1))))
    (if (i32.ne (i32.and (local.get $mask) (i32.const 4)) (i32.const 0))
      (then (global.set $clipboard_text_present (i32.const 1)) (global.set $clipboard_len (i32.const 1)))))

  (func (export "test_clipboard_set_open") (param $open i32)
    (global.set $clipboard_open (local.get $open)))

  (func (export "test_enum_clipboard_formats")
      (param $format i32) (param $esp0 i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $esp0))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (call $handle_EnumClipboardFormats
      (local.get $format) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_enum_set_last_error") (param $value i32)
    (global.set $last_error (local.get $value)))
  (func (export "test_enum_get_last_error") (result i32)
    (global.get $last_error))
  (func (export "test_enum_clipboard_formats_id") (result i32)
    (call $lookup_api_id "EnumClipboardFormats"))
`;

const ERROR_SUCCESS = 0;
const ERROR_INVALID_PARAMETER = 87;
const ERROR_CLIPBOARD_NOT_OPEN = 1418;
const SENTINEL = 0x5a5aa55a;
const ESP0 = 0x07390000;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const api = apiTable.find(entry => entry.name === 'EnumClipboardFormats');
  assert.deepStrictEqual(
    api && { id: api.id, nargs: api.nargs, convention: api.convention },
    { id: 3617, nargs: 1, convention: 'stdcall' },
    'EnumClipboardFormats retains its append-only API identity and ABI');
  assert.strictEqual(e.test_enum_clipboard_formats_id() >>> 0, 3617,
    'the generated hash table resolves EnumClipboardFormats by name');

  function enumerate(format) {
    const result = e.test_enum_clipboard_formats(format, ESP0) >>> 0;
    assert.strictEqual(e.get_esp() >>> 0, ESP0 + 8,
      'EnumClipboardFormats pops its one stdcall argument');
    return result;
  }

  e.test_clipboard_configure(7);
  e.test_clipboard_set_open(0);
  e.test_enum_set_last_error(SENTINEL);
  assert.strictEqual(enumerate(0), 0,
    'enumeration fails while the clipboard is closed');
  assert.strictEqual(e.test_enum_get_last_error(), ERROR_CLIPBOARD_NOT_OPEN,
    'closed enumeration reports ERROR_CLIPBOARD_NOT_OPEN');

  e.test_clipboard_set_open(1);
  e.test_clipboard_configure(0);
  e.test_enum_set_last_error(SENTINEL);
  assert.strictEqual(enumerate(0), 0, 'an empty open clipboard ends enumeration');
  assert.strictEqual(e.test_enum_get_last_error(), ERROR_SUCCESS,
    'normal end of enumeration is distinguishable from failure');

  e.test_clipboard_configure(7);
  e.test_enum_set_last_error(SENTINEL);
  assert.strictEqual(enumerate(0), 8, 'CF_DIB is the first rich format');
  assert.strictEqual(e.test_enum_get_last_error() >>> 0, SENTINEL,
    'a successful enumeration step preserves last-error');
  assert.strictEqual(enumerate(8), 0xc123, 'registered RTF follows CF_DIB');
  assert.strictEqual(enumerate(0xc123), 1, 'CF_TEXT follows rich formats');
  assert.strictEqual(enumerate(1), 7,
    'CF_OEMTEXT is enumerated as the supported text conversion');
  e.test_enum_set_last_error(SENTINEL);
  assert.strictEqual(enumerate(7), 0, 'the last available format ends enumeration');
  assert.strictEqual(e.test_enum_get_last_error(), ERROR_SUCCESS,
    'the final zero result carries ERROR_SUCCESS');

  e.test_clipboard_configure(5);
  assert.strictEqual(enumerate(8), 1,
    'enumeration skips registered formats that are not currently present');

  e.test_enum_set_last_error(SENTINEL);
  assert.strictEqual(enumerate(0xdead), 0,
    'an unavailable continuation format fails rather than restarting');
  assert.strictEqual(e.test_enum_get_last_error(), ERROR_INVALID_PARAMETER,
    'an unavailable continuation format reports ERROR_INVALID_PARAMETER');

  console.log('PASS  EnumClipboardFormats walks the bounded Win32 clipboard state');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
