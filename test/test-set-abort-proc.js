#!/usr/bin/env node
'use strict';

// WordPad installs an abort callback on its print DC. Browser printing is
// synchronous, so there is no spooler wait in which to invoke it; nevertheless
// SetAbortProc must distinguish the live printer DC from unrelated handles.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_set_abort_proc")
      (param $hdc i32) (param $callback i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (global.get $GUEST_STACK))
    (call $handle_SetAbortProc
      (local.get $hdc) (local.get $callback) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_stack") (result i32)
    (global.get $GUEST_STACK))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = e.test_stack() >>> 0;
  const callback = 0x00401000;
  const printerDc = e.test_call_CreateDCA(0, 0, 0, 0) >>> 0;
  const memoryDc = e.test_call_CreateCompatibleDC(0) >>> 0;
  const screenDc = e.test_call_GetDC(0) >>> 0;
  assert(printerDc && memoryDc && screenDc, 'test device contexts allocate');

  assert.strictEqual(e.test_set_abort_proc(printerDc, callback), 1,
    'the live browser printer accepts an advisory abort callback');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'SetAbortProc pops its HDC, callback, and return address');

  for (const [label, hdc] of [
    ['NULL', 0],
    ['fabricated', 0x7777],
    ['memory', memoryDc],
    ['screen', screenDc],
  ]) {
    assert.strictEqual(e.test_set_abort_proc(hdc, callback), -1,
      `${label} DC returns SP_ERROR`);
  }

  assert.strictEqual(e.test_call_DeleteDC(printerDc), 1, 'printer DC releases');
  assert.strictEqual(e.test_set_abort_proc(printerDc, callback), -1,
    'a released printer DC returns SP_ERROR');
  assert.strictEqual(e.get_esp() >>> 0, stack + 12,
    'failed SetAbortProc preserves stdcall cleanup');

  console.log('PASS  SetAbortProc validates the live browser printer DC');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
