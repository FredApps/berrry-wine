#!/usr/bin/env node
'use strict';

// FormatMessage(FORMAT_MESSAGE_FROM_SYSTEM) answers from the system message
// table: Windows Installer's msiexec reports every failure that way, and a
// 1619 ("This installation package could not be opened.") reached the user
// as the clipped generic "Err". The text keeps the table's trailing CRLF.
// An id the table does not carry still gets the generic text, as before.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "format") (param $wide i32) (param $flags i32) (param $id i32)
        (param $out i32) (param $size i32) (result i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (call $gs32 (i32.const 0x074ff018) (local.get $size))
      (call $gs32 (i32.const 0x074ff01c) (i32.const 0))
      (if (local.get $wide)
        (then (call $handle_FormatMessageW (local.get $flags) (i32.const 0)
          (local.get $id) (i32.const 0) (local.get $out) (i32.const 0)))
        (else (call $handle_FormatMessageA (local.get $flags) (i32.const 0)
          (local.get $id) (i32.const 0) (local.get $out) (i32.const 0))))
      (i32.load (global.get $reg_base)))
  ` });
  const readA = ga => { let s = ''; for (let c; (c = e.guest_read8(ga)); ga++) s += String.fromCharCode(c); return s; };
  const readW = ga => {
    let s = '';
    for (;; ga += 2) {
      const c = e.guest_read8(ga) | (e.guest_read8(ga + 1) << 8);
      if (!c) return s;
      s += String.fromCharCode(c);
    }
  };
  const buf = e.guest_alloc(512) >>> 0;
  const FROM_SYSTEM = 0x1000, ALLOCATE = 0x100;

  const fileNotFound = 'The system cannot find the file specified.\r\n';
  assert.strictEqual(e.format(0, FROM_SYSTEM, 2, buf, 512), fileNotFound.length);
  assert.strictEqual(readA(buf), fileNotFound, 'ERROR_FILE_NOT_FOUND has its system text');

  assert.strictEqual(e.format(0, FROM_SYSTEM, 1619, buf, 512) > 0, true);
  assert.strictEqual(readA(buf), 'This installation package could not be opened.\r\n',
    'ERROR_INSTALL_PACKAGE_OPEN_FAILED, the code msiexec reported as "Err"');

  // ALLOCATE_BUFFER: lpBuffer receives a pointer to a LocalAlloc'd copy.
  const slot = e.guest_alloc(4) >>> 0;
  assert.strictEqual(e.format(0, FROM_SYSTEM | ALLOCATE, 5, slot, 0), 'Access is denied.\r\n'.length);
  assert.strictEqual(readA(e.guest_read32(slot) >>> 0), 'Access is denied.\r\n', 'allocated copy');

  // The wide spelling answers from the same table.
  assert.strictEqual(e.format(1, FROM_SYSTEM, 87, buf, 256), 'The parameter is incorrect.\r\n'.length);
  assert.strictEqual(readW(buf), 'The parameter is incorrect.\r\n', 'FormatMessageW');

  // Not in the table: the generic text, unchanged.
  e.format(0, FROM_SYSTEM, 0x12345, buf, 512);
  assert.strictEqual(readA(buf), 'Error', 'an unknown id keeps the generic fallback');

  console.log('PASS test-format-message-system');
})().catch(err => { console.error(err); process.exit(1); });
