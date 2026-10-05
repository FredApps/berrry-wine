#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (global $avifile_test_delta (mut i32) (i32.const 0))

  (func $avifile_test_call (param $init i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x13572468))
    (if (local.get $init)
      (then (call $handle_AVIFileInit
        (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_AVIFileExit
        (i32.const 0) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0))))
    (global.set $avifile_test_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved)))

  (func (export "avifile_init") (call $avifile_test_call (i32.const 1)))
  (func (export "avifile_exit") (call $avifile_test_call (i32.const 0)))
  (func (export "avifile_count") (result i32)
    (i32.atomic.load (global.get $AVIFILE_STATE)))
  (func (export "avifile_delta") (result i32)
    (global.get $avifile_test_delta))
  (func (export "avifile_eax") (result i32) (i32.load offset=0 (global.get $reg_base)))
  (func (export "avifile_init_api_id") (result i32)
    (call $lookup_api_id "AVIFileInit"))
  (func (export "avifile_exit_api_id") (result i32)
    (call $lookup_api_id "AVIFileExit"))
`;

(async () => {
  for (const name of ['AVIFileInit', 'AVIFileExit']) {
    const row = apiTable.find(entry => entry.name === name);
    assert(row, `${name} is registered`);
    assert.strictEqual(row.nargs, 0, `${name} takes no arguments`);
    assert.strictEqual(row.convention, 'stdcall', `${name} uses stdcall`);
    assert.strictEqual(row.stub, undefined, `${name} has a real handler`);
  }

  const first = await bootRenderHarness({ extraWat, fonts: 'none' });
  const second = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    memory: first.memory,
  });
  const a = first.exports;
  const b = second.exports;
  const initId = apiTable.find(entry => entry.name === 'AVIFileInit').id;
  const exitId = apiTable.find(entry => entry.name === 'AVIFileExit').id;

  assert.strictEqual(a.avifile_init_api_id(), initId,
    'generated hash table resolves AVIFileInit');
  assert.strictEqual(a.avifile_exit_api_id(), exitId,
    'generated hash table resolves AVIFileExit');
  assert.strictEqual(a.avifile_count(), 0, 'fresh process starts uninitialized');

  a.avifile_exit();
  assert.strictEqual(a.avifile_delta(), 4,
    'zero-argument AVIFileExit pops only the return address');
  assert.strictEqual(a.avifile_eax() >>> 0, 0x13572468,
    'void AVIFileExit does not fabricate a return value');
  assert.strictEqual(a.avifile_count(), 0,
    'unmatched AVIFileExit does not underflow the reference count');

  a.avifile_init();
  assert.strictEqual(a.avifile_delta(), 4,
    'zero-argument AVIFileInit pops only the return address');
  assert.strictEqual(a.avifile_eax() >>> 0, 0x13572468,
    'void AVIFileInit does not fabricate a return value');
  assert.strictEqual(b.avifile_count(), 1,
    'another guest-thread instance observes initialized process state');

  b.avifile_init();
  assert.strictEqual(a.avifile_count(), 2,
    'nested initialization increments one shared library count');
  a.avifile_exit();
  assert.strictEqual(b.avifile_count(), 1,
    'one balanced exit keeps the library initialized');
  b.avifile_exit();
  assert.strictEqual(a.avifile_count(), 0,
    'the final balanced exit releases the library');
  b.avifile_exit();
  assert.strictEqual(a.avifile_count(), 0,
    'additional exits remain clamped at zero');

  console.log('PASS  AVIFileInit/AVIFileExit keep a balanced process-shared zero-argument library state');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
