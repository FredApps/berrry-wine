#!/usr/bin/env node
'use strict';

// acmGetVersion() answers Windows 98's MSACM32 version, 4.00 build 1998, as
// 0xAABBCCCC (major, minor, build), and pops only its return address.
// Descent: FreeSpace's demo calls it before it opens any ACM stream; it was
// not an API at all, so the import trapped as unimplemented.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_acm_get_version") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_acmGetVersion (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const v = e.t_acm_get_version() >>> 0;
  assert.strictEqual(v >>> 24, 4, 'major version 4');
  assert.strictEqual((v >>> 16) & 0xff, 0, 'minor version 00');
  assert.strictEqual(v & 0xffff, 1998, 'build 1998');
  assert.strictEqual(e.get_esp() >>> 0, 0x00300004, 'stdcall, no arguments: only the return address is popped');
  console.log('PASS  acmGetVersion reports MSACM32 4.00.1998');
})().catch(error => { console.error(error); process.exit(1); });
