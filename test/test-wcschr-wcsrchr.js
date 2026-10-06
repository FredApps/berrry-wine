#!/usr/bin/env node
'use strict';

// MSVCRT wcschr / wcsrchr walk the caller's string by GUEST address and return
// a guest address. wcsrchr used to translate once with $g2w and convert back
// with "wa - GUEST_BASE + image_base", which is only the inverse of $g2w in the
// direct window: for a string on a sparse page (a large app's heap or stack --
// Deus Ex's Core.dll calls these on 0x179ff8xx) it returned a pointer into
// nowhere, and read past a page boundary into unrelated memory.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "sp_map") (param i32) (result i32)
    (call $virtual_map_commit (local.get 0) (i32.const 4096)))

  (func (export "test_wcschr") (param $sp i32) (param $str i32) (param $ch i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_wcschr (local.get $str) (local.get $ch)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_wcsrchr") (param $sp i32) (param $str i32) (param $ch i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $handle_wcsrchr (local.get $str) (local.get $ch)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const page = 0x30000000, other = 0x28000000;
  for (const ga of [page, other, page + 4096]) assert.strictEqual(e.sp_map(ga) >>> 0, ga);
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must be backed non-adjacently for this test to mean anything');

  const sp = ((e.guest_alloc(256) >>> 0) + 128) >>> 0;
  const writeW = (ga, s) => {
    for (let i = 0; i <= s.length; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0;
      e.guest_write8(ga + i * 2, c & 0xff);
      e.guest_write8(ga + i * 2 + 1, c >>> 8);
    }
    return ga;
  };
  const text = 'C:\\DeusEx\\System\\Core.u';
  const ch = c => c.charCodeAt(0);
  const check = (where, ga) => {
    writeW(ga, text);
    assert.strictEqual(e.test_wcschr(sp, ga, ch('\\')) >>> 0, ga + 2 * text.indexOf('\\'),
      `${where}: wcschr finds the first backslash`);
    assert.strictEqual(e.test_wcsrchr(sp, ga, ch('\\')) >>> 0, ga + 2 * text.lastIndexOf('\\'),
      `${where}: wcsrchr finds the last backslash`);
    assert.strictEqual(e.test_wcschr(sp, ga, 0) >>> 0, ga + 2 * text.length,
      `${where}: wcschr(s, 0) is the terminator`);
    assert.strictEqual(e.test_wcsrchr(sp, ga, 0) >>> 0, ga + 2 * text.length,
      `${where}: wcsrchr(s, 0) is the terminator`);
    assert.strictEqual(e.test_wcschr(sp, ga, ch('#')) >>> 0, 0, `${where}: wcschr misses -> NULL`);
    assert.strictEqual(e.test_wcsrchr(sp, ga, ch('#')) >>> 0, 0, `${where}: wcsrchr misses -> NULL`);
    // Only the low 16 bits of ch are a wchar_t.
    assert.strictEqual(e.test_wcschr(sp, ga, 0x10000 | ch('S')) >>> 0, ga + 2 * text.indexOf('S'),
      `${where}: ch is truncated to a wchar_t`);
  };

  check('heap string', e.guest_alloc(128) >>> 0);
  // Half the string on each of two pages that are not adjacent in WASM memory,
  // with the last backslash on the second page.
  check('string across a sparse page boundary', page + 4096 - 2 * 12);

  console.log('PASS  wcschr/wcsrchr walk guest addresses, including across a sparse page split');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
