#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
 (func (export "routine_resolve_test") (result i32)
  (global.set $exe_size_of_image (i32.const 4096))
  (call $help_routine_resolve (call $help_routine_at (i32.const 0))))
 (func (export "routine_name_test") (result i32)
  (i32.load offset=4 (call $help_routine_at (i32.const 0))))
 (func (export "routine_free_test")
  (call $help_release_all_routine_strings))
 (func (export "routine_is_free_test") (param $guest i32) (result i32)
  (local $cur i32) (local $n i32)
  (local.set $cur (global.get $free_list))
  (block $done (loop $scan
   (br_if $done (i32.eqz (local.get $cur)))
   (if (i32.eq (local.get $cur) (i32.sub (local.get $guest) (i32.const 4)))
    (then (return (i32.const 1))))
   (local.set $n (i32.add (local.get $n) (i32.const 1)))
   (if (i32.gt_u (local.get $n) (i32.const 10000)) (then (return (i32.const -1))))
   (local.set $cur (i32.load offset=4 (call $g2w (local.get $cur))))
   (br $scan))) (i32.const 0))
`;
(async () => {
 let e, mode = 'missing', opens = 0, closes = 0;
 const fakeRead = (handle, buffer, size, count) => {
  assert.strictEqual(handle, 100);
  for (let i = 0; i < size; i++) e.guest_write8(buffer + i, 0);
  e.guest_write32(count, mode === 'short' ? size - 1 : mode === 'fault' ? 0 : size);
  return mode === 'fault' ? 0 : 1;
 };
 const h = await bootRenderHarness({ fonts: 'none', extraWat, extraHostOverrides: {
  fs_create_file: () => { opens++; return mode === 'missing' ? -1 : 100; },
  fs_get_file_size: () => mode === 'empty' ? 0 : mode === 'bad-size' ? -1 : mode === 'oversize' ? 0x7fffffff : 64,
  fs_read_file: fakeRead,
  fs_read_file_preserve_pending: fakeRead,
  fs_close_handle: () => { closes++; return 1; },
 }});
 e = h.exports;
 const macro = Buffer.from('RegisterRoutine("absent.dll","Probe","")\0');
 const address = 0x120000;
 macro.forEach((b, i) => e.guest_write8(address + i, b));
 // Test export accepts a WASM address; this guest address uses the normal
 // image mapping supplied by the render harness.
 const wa = e.guest_to_wasm ? e.guest_to_wasm(address) : null;
 assert.notStrictEqual(wa, null, 'guest_to_wasm export required');
 assert.strictEqual(e.test_help_macro_execute(0, wa, macro.length - 1), 1);
 const name = e.routine_name_test();
 const original = Array.from({ length: 11 }, (_, i) => e.guest_read8(name + i));
 for (mode of ['missing', 'empty', 'bad-size', 'oversize', 'fault', 'short', 'malformed']) {
  for (let retry = 0; retry < 2; retry++) {
   const before = closes;
   assert.strictEqual(e.routine_resolve_test(), 0, mode);
   assert.strictEqual(closes - before, mode === 'missing' ? 0 : 1, mode);
   assert.strictEqual(e.routine_name_test(), name);
   assert.strictEqual(e.routine_is_free_test(name), 0, `${mode}: registry name must remain owned`);
   assert.deepStrictEqual(Array.from({ length: 11 }, (_, i) => e.guest_read8(name + i)), original, mode);
  }
 }
 assert.strictEqual(opens, 14);
 e.routine_free_test();
 assert.strictEqual(e.routine_name_test(), 0);
 assert.strictEqual(e.routine_is_free_test(name), 1);
 e.routine_free_test();
 assert.strictEqual(e.routine_is_free_test(name), 1, 'repeated registry cleanup is safe');
 console.log('PASS WinHelp routine filename ownership: 14 failed lookups, retries, registry cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
