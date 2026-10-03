#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_seh_begin")
      (param $frame i32) (param $record i32)
      (param $resume_eip i32) (param $resume_esp i32)
      (param $stack i32)
    (global.set $fs_base (i32.const 0x00402100))
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA000E))
    (i32.store offset=4 (global.get $THUNK_BASE) (i32.const 0))
    (call $gs32 (local.get $frame) (i32.const -1))
    (call $gs32 (i32.add (local.get $frame) (i32.const 4)) (i32.const 0x00401000))
    (call $gs32 (global.get $fs_base) (local.get $frame))
    (global.set $delphi_exception_record (local.get $record))
    (global.set $delphi_seh_rec (local.get $frame))
    (global.set $delphi_resume_eip (local.get $resume_eip))
    (global.set $delphi_resume_esp (local.get $resume_esp))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $dispatch_delphi_exception_handler))
  (func (export "test_seh_return") (param $stack i32)
    ;; Simulate the handler's cdecl RET. Nested dispatches have overwritten all
    ;; shared exception globals; the outer call must recover its own state.
    (i32.store offset=16 (global.get $reg_base) (i32.add (local.get $stack) (i32.const 4)))
    (global.set $steps (i32.const 77))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0)) ;; ExceptionContinueExecution
    (call $win32_dispatch (i32.const 0)))
  (func (export "test_record") (result i32) (global.get $delphi_exception_record))
  (func (export "test_frame") (result i32) (global.get $delphi_seh_rec))
  (func (export "test_head") (result i32) (global.get $delphi_seh_head_before))
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

  wat.test_seh_begin(0x402200, 0x402300, resumeEip, resumeEsp, 0x406000);
  const outerStack = wat.test_esp();
  wat.test_seh_begin(0x402240, 0x402380, 0x401888, 0x405000, outerStack - 256);
  wat.test_seh_return(wat.test_esp());
  assert.strictEqual(wat.test_eip(), 0x401888, 'nested exception resumes its own caller');
  assert.strictEqual(wat.test_esp(), 0x405000, 'nested exception restores its own stack');
  wat.test_seh_return(outerStack);

  assert.deepStrictEqual(exits, [],
    'ExceptionContinueExecution must not terminate through the stale-stack guard');
  assert.strictEqual(wat.test_eip() >>> 0, resumeEip,
    'execution resumes at the instruction after RaiseException');
  assert.strictEqual(wat.test_esp() >>> 0, resumeEsp,
    'execution resumes with RaiseException stdcall cleanup preserved');
  assert.strictEqual(wat.test_steps(), 0,
    'the dispatcher yields immediately to the restored guest instruction');
  assert.strictEqual(wat.test_record(), 0x402300, 'outer exception record survives nested dispatch');
  assert.strictEqual(wat.test_frame(), 0x402200, 'outer search frame survives nested dispatch');
  assert.strictEqual(wat.test_head(), 0x402200, 'outer chain snapshot survives nested dispatch');

  console.log('PASS SEH ExceptionContinueExecution resumes after RaiseException');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
