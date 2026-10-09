#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_rtf_open") (param $wide i32) (param $path i32)
      (param $stack i32) (param $thunk i32) (param $thread i32) (result i32)
    (global.set $current_thread_id (local.get $thread))
    (global.set $current_thunk_eip (local.get $thunk))
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $handler_set_eip (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (i32.add (local.get $stack) (i32.const 24)) (i32.const 0))
    (if (local.get $wide)
      (then (call $handle_CreateFileW (local.get $path) (i32.const 0x80000000)
        (i32.const 1) (i32.const 0) (i32.const 3) (i32.const 0)))
      (else (call $handle_CreateFileA (local.get $path) (i32.const 0x80000000)
        (i32.const 1) (i32.const 0) (i32.const 3) (i32.const 0))))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_rtf_stack") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_rtf_error") (result i32) (global.get $last_error))
  (func (export "test_rtf_redirected") (result i32) (global.get $handler_set_eip))
`;

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = { getMemory: () => memory.buffer, exports: null };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  let error = 997, observed;
  imports.host.fs_create_file_result = (...args) => {
    observed = args;
    new DataView(memory.buffer).setUint32(args[5], error ? 0xffffffff : 0x70000001, true);
    return error;
  };
  const wasm = compileSrcWasm((file, source) => file === '13-exports.wat' ? source + extraWat : source);
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = context.exports = instance.exports;
  const path = e.guest_alloc(64), stack = e.guest_alloc(64), thunk = e.guest_alloc(8);
  for (const wide of [0, 1]) {
    const data = Buffer.from('c:\\eula.rtf\0', wide ? 'utf16le' : 'latin1');
    for (let i = 0; i < data.length; i++) e.guest_write8(path + i, data[i]);
    error = 997;
    assert.strictEqual(e.test_rtf_open(wide, path, stack, thunk, 7), -1);
    assert.strictEqual(observed.length, 7);
    assert.strictEqual(observed[4], wide);
    assert.strictEqual(observed[6], 7, 'actual calling thread reaches the shared broker');
    assert.strictEqual(e.test_rtf_stack(), stack, 'pending open retains its seven-argument frame');
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.test_rtf_redirected(), 1);
    assert.strictEqual(e.get_eip(), thunk, 'resume repeats the original import');
    error = 0;
    assert.strictEqual(e.test_rtf_open(wide, path, stack, thunk, 7), 0x70000001);
    assert.strictEqual(e.test_rtf_stack(), stack + 32, 'completed open pops exactly once');
    assert.strictEqual(e.get_yield_reason(), 0);
    assert.strictEqual(e.test_rtf_error(), 0);
    error = 30;
    assert.strictEqual(e.test_rtf_open(wide, path, stack, thunk, 7), -1);
    assert.strictEqual(e.test_rtf_stack(), stack + 32);
    assert.strictEqual(e.get_yield_reason(), 0, 'failed fill completes instead of parking forever');
    assert.strictEqual(e.test_rtf_error(), 30);
  }
  console.log('PASS CreateFileA/W: caller thread, IO_WAIT, retained frame, retry EIP, success and read fault');
})().catch(error => { console.error(error); process.exitCode = 1; });
