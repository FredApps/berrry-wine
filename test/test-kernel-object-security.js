#!/usr/bin/env node
'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $test_kernel_sd (mut i32) (i32.const 0))
  (global $test_kernel_needed (mut i32) (i32.const 0))
  (global $test_kernel_stack_delta (mut i32) (i32.const 0))

  (func $test_kernel_security_init
    (global.set $test_kernel_sd (call $heap_alloc (i32.const 20)))
    (global.set $test_kernel_needed (call $heap_alloc (i32.const 4))))

  ;; length_mode: 0 = mapped DWORD, 1 = NULL, 2 = unmapped guest pointer.
  (func (export "test_get_kernel_object_security")
        (param $length_mode i32) (result i32)
    (local $descriptor_ptr i32) (local $length_ptr i32) (local $saved_esp i32)
    (call $gs32 (global.get $test_kernel_sd) (i32.const 0x11223344))
    (call $gs32 (i32.add (global.get $test_kernel_sd) (i32.const 4))
      (i32.const 0x55667788))
    (call $gs32 (global.get $test_kernel_needed) (i32.const 0x7badf00d))
    (local.set $length_ptr
      (select
        (global.get $test_kernel_needed)
        (select (i32.const 0) (i32.const 0x7f000000)
          (i32.eq (local.get $length_mode) (i32.const 1)))
        (i32.eqz (local.get $length_mode))))
    (local.set $descriptor_ptr
      (select
        (global.get $test_kernel_sd)
        (select (i32.const 0) (i32.const 0x7f001000)
          (i32.eq (local.get $length_mode) (i32.const 1)))
        (i32.eqz (local.get $length_mode))))
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetKernelObjectSecurity
      (i32.const 0xffffffff) (i32.const 0xffffffff)
      (local.get $descriptor_ptr) (i32.const 20) (local.get $length_ptr)
      (i32.const 0))
    (global.set $test_kernel_stack_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved_esp)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  ;; invalid_inputs selects NULL rather than deliberately unmapped values.
  (func (export "test_set_kernel_object_security")
        (param $invalid_inputs i32) (result i32)
    (local $saved_esp i32)
    (call $gs32 (global.get $test_kernel_sd) (i32.const 0xa1b2c3d4))
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetKernelObjectSecurity
      (select (i32.const 0) (i32.const 0x7f000000) (local.get $invalid_inputs))
      (i32.const 0xffffffff)
      (select (i32.const 0) (i32.const 0x7f001000) (local.get $invalid_inputs))
      (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $test_kernel_stack_delta
      (i32.sub (i32.load offset=16 (global.get $reg_base)) (local.get $saved_esp)))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_kernel_sd_word") (param $offset i32) (result i32)
    (call $gl32 (i32.add (global.get $test_kernel_sd) (local.get $offset))))
  (func (export "test_kernel_needed_word") (result i32)
    (call $gl32 (global.get $test_kernel_needed)))
  (func (export "test_kernel_stack_delta") (result i32)
    (global.get $test_kernel_stack_delta))
  (func (export "test_kernel_last_error") (result i32)
    (global.get $last_error))
  (func (export "test_lookup_get_kernel_object_security") (result i32)
    (call $lookup_api_id "GetKernelObjectSecurity"))
  (func (export "test_lookup_set_kernel_object_security") (result i32)
    (call $lookup_api_id "SetKernelObjectSecurity"))

  (start $test_kernel_security_init)
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });

  for (const [mode, label] of [[0, 'mapped length'], [1, 'NULL length'], [2, 'unmapped length']]) {
    assert.strictEqual(e.test_get_kernel_object_security(mode), 0,
      `GetKernelObjectSecurity never fabricates success for ${label}`);
    assert.strictEqual(e.test_kernel_last_error(), 120,
      `GetKernelObjectSecurity reports ERROR_CALL_NOT_IMPLEMENTED for ${label}`);
    assert.strictEqual(e.test_kernel_stack_delta(), 24,
      `GetKernelObjectSecurity pops five stdcall arguments for ${label}`);
    assert.strictEqual(e.test_kernel_sd_word(0) >>> 0, 0x11223344,
      `GetKernelObjectSecurity leaves descriptor byte range untouched for ${label}`);
    assert.strictEqual(e.test_kernel_sd_word(4) >>> 0, 0x55667788,
      `GetKernelObjectSecurity does not partially copy a descriptor for ${label}`);
    assert.strictEqual(e.test_kernel_needed_word() >>> 0,
      mode === 0 ? 0 : 0x7badf00d,
      `GetKernelObjectSecurity only clears a mapped non-NULL length for ${label}`);
  }

  for (const [invalidInputs, label] of [[0, 'unmapped'], [1, 'NULL']]) {
    assert.strictEqual(e.test_set_kernel_object_security(invalidInputs), 0,
      `SetKernelObjectSecurity never fabricates success for ${label} inputs`);
    assert.strictEqual(e.test_kernel_last_error(), 120,
      `SetKernelObjectSecurity reports ERROR_CALL_NOT_IMPLEMENTED for ${label} inputs`);
    assert.strictEqual(e.test_kernel_stack_delta(), 16,
      `SetKernelObjectSecurity pops three stdcall arguments for ${label} inputs`);
    assert.strictEqual(e.test_kernel_sd_word(0) >>> 0, 0xa1b2c3d4,
      `SetKernelObjectSecurity does not mutate descriptor input for ${label} inputs`);
  }

  const getApi = apiTable.find(api => api.name === 'GetKernelObjectSecurity');
  const setApi = apiTable.find(api => api.name === 'SetKernelObjectSecurity');
  assert.deepStrictEqual(
    [getApi && getApi.nargs, setApi && setApi.nargs], [5, 3],
    'kernel-object security APIs retain their documented stdcall argument counts');
  assert.strictEqual(e.test_lookup_get_kernel_object_security() >>> 0, getApi.id,
    'generated hash table resolves GetKernelObjectSecurity');
  assert.strictEqual(e.test_lookup_set_kernel_object_security() >>> 0, setApi.id,
    'generated hash table resolves SetKernelObjectSecurity');

  console.log('PASS  Win98 kernel-object security imports fail without fake descriptors');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
