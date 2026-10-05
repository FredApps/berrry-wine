#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_seh_continue_execution")
      (param $resume_eip i32) (param $resume_esp i32)
    ;; A returned exception handler enters the private continuation thunk with
    ;; its four cdecl arguments still below ESP and the disposition in EAX.
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA000E))
    (i32.store offset=4 (global.get $THUNK_BASE) (i32.const 0))
    (global.set $delphi_resume_eip (local.get $resume_eip))
    (global.set $delphi_resume_esp (local.get $resume_esp))
    (global.set $eip (i32.const 0xCCCCCCCC))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00402000))
    (global.set $steps (i32.const 77))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)) ;; ExceptionContinueExecution
    (call $win32_dispatch (i32.const 0)))
  (func (export "test_eip") (result i32) (global.get $eip))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_steps") (result i32) (global.get $steps))
`;

(async () => {
  const exits = [];
  const { exports: wat } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: { exit: code => exits.push(code >>> 0) },
  });
  const resumeEip = 0x00401234;
  const resumeEsp = 0x00405678;

  wat.test_seh_continue_execution(resumeEip, resumeEsp);

  assert.deepStrictEqual(exits, [],
    'ExceptionContinueExecution must not terminate through the stale-stack guard');
  assert.strictEqual(wat.test_eip() >>> 0, resumeEip,
    'execution resumes at the instruction after RaiseException');
  assert.strictEqual(wat.test_esp() >>> 0, resumeEsp,
    'execution resumes with RaiseException stdcall cleanup preserved');
  assert.strictEqual(wat.test_steps(), 0,
    'the dispatcher yields immediately to the restored guest instruction');

  console.log('PASS SEH ExceptionContinueExecution resumes after RaiseException');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
