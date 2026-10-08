#!/usr/bin/env node
'use strict';

// ModifyWorldTransform against DCs that carry no world transform (page space
// is the identity). MWT_IDENTITY and a multiply by the identity XFORM keep
// that state exactly and succeed; a bad DC or mode fails with the documented
// errors. Tiberian Sun's DC-reset helper calls ModifyWorldTransform(hdc, NULL,
// MWT_IDENTITY) after SetGraphicsMode(GM_ADVANCED) and trapped before.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_init") (global.set $image_base (i32.const 0x00400000)))
  (func (export "t_xform") (param $at i32) (param $m11 f32) (param $dx f32)
    (call $gs32 (local.get $at) (i32.reinterpret_f32 (local.get $m11)))
    (call $gs32 (i32.add (local.get $at) (i32.const 4)) (i32.const 0))
    (call $gs32 (i32.add (local.get $at) (i32.const 8)) (i32.const 0))
    (call $gs32 (i32.add (local.get $at) (i32.const 12)) (i32.reinterpret_f32 (f32.const 1)))
    (call $gs32 (i32.add (local.get $at) (i32.const 16)) (i32.reinterpret_f32 (local.get $dx)))
    (call $gs32 (i32.add (local.get $at) (i32.const 20)) (i32.const 0)))
  (func (export "t_mwt") (param $hdc i32) (param $xf i32) (param $mode i32) (result i32)
    (global.set $last_error (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00480000))
    (call $handle_ModifyWorldTransform (local.get $hdc) (local.get $xf) (local.get $mode)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "t_err") (result i32) (global.get $last_error))
  (func (export "t_dc") (result i32)
    (call $gdi_dc_state_entry (i32.const 0x00310005) (i32.const 1)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.t_init();
  const HDC = 0x00310005, XF = 0x00470000;
  assert.notStrictEqual(e.t_dc(), 0, 'the test DC has state');

  assert.strictEqual(e.t_mwt(HDC, 0, 1), 1, 'MWT_IDENTITY succeeds with a NULL XFORM');
  assert.strictEqual(e.t_esp() >>> 0, 0x00480010, 'stdcall pops the return address and three arguments');
  e.t_xform(XF, 1, 0);
  assert.strictEqual(e.t_mwt(HDC, XF, 2), 1, 'MWT_LEFTMULTIPLY by the identity succeeds');
  assert.strictEqual(e.t_mwt(HDC, XF, 3), 1, 'MWT_RIGHTMULTIPLY by the identity succeeds');
  assert.strictEqual(e.t_mwt(HDC, 0, 2), 0, 'a multiply needs an XFORM');
  assert.strictEqual(e.t_err(), 87, 'ERROR_INVALID_PARAMETER');
  assert.strictEqual(e.t_mwt(HDC, XF, 9), 0, 'an unknown mode fails');
  assert.strictEqual(e.t_err(), 87);
  assert.strictEqual(e.t_mwt(0x00777777, 0, 1), 0, 'an unknown DC fails');
  assert.strictEqual(e.t_err(), 6, 'ERROR_INVALID_HANDLE');
  console.log('PASS ModifyWorldTransform keeps the identity page space and rejects bad DCs/modes');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
