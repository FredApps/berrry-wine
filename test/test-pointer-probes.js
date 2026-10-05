#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_virtual_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE)
        (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE)
      (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store (i32.add (global.get $VIRTUAL_MAP_STATE) (i32.const 4))
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT)))
  (func (export "test_virtual_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_virtual_protect")
      (param $address i32) (param $size i32) (param $protect i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualProtect
      (local.get $address) (local.get $size) (local.get $protect)
      (i32.const 0x00402000) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_bad_read") (param $ptr i32) (param $len i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_IsBadReadPtr
      (local.get $ptr) (local.get $len) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_bad_write") (param $ptr i32) (param $len i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_IsBadWritePtr
      (local.get $ptr) (local.get $len) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_bad_code") (param $ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_IsBadCodePtr
      (local.get $ptr) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_bad_string_a") (param $ptr i32) (param $max i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_IsBadStringPtrA
      (local.get $ptr) (local.get $max) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_bad_string_w") (param $ptr i32) (param $max i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_IsBadStringPtrW
      (local.get $ptr) (local.get $max) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

async function main() {
  const wasm = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = {
    exports: null,
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  imports.host.create_thread = () => 0;
  imports.host.exit_thread = () => 0;
  imports.host.terminate_thread = () => 0;
  imports.host.create_event = () => 0;
  imports.host.set_event = () => 0;
  imports.host.reset_event = () => 0;
  imports.host.wait_single = () => 0;
  imports.host.wait_multiple = () => 0;
  imports.host.com_create_instance = () => 0x80004002;
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  context.exports = e;

  e.test_virtual_reset();
  const base = e.test_virtual_alloc(0x4000) >>> 0;
  assert.notStrictEqual(base, 0, 'four committed sparse pages must allocate');
  assert.strictEqual(e.test_virtual_protect(base + 0x1000, 0x1000, 0x01), 1,
    'second page becomes PAGE_NOACCESS');
  assert.strictEqual(e.test_virtual_protect(base + 0x2000, 0x1000, 0x02), 1,
    'third page becomes PAGE_READONLY');
  assert.strictEqual(e.test_virtual_protect(base + 0x3000, 0x1000, 0x104), 1,
    'fourth page becomes PAGE_READWRITE | PAGE_GUARD');

  assert.strictEqual(e.test_bad_read(0, 0), 0,
    'zero-length read probes succeed even for NULL');
  assert.strictEqual(e.test_bad_write(0, 0), 0,
    'zero-length write probes succeed even for NULL');
  assert.strictEqual(e.test_bad_read(0, 1), 1);
  assert.strictEqual(e.test_bad_read(0x00402000, 1), 0,
    'direct-window memory remains readable');
  assert.strictEqual(e.test_bad_write(0x00402000, 1), 0,
    'direct-window memory remains writable until it has section metadata');
  assert.strictEqual(e.test_bad_read(0x70000000, 1), 1,
    'an unmapped guest address is not readable');
  assert.strictEqual(e.test_bad_read(0xfffffff0, 0x20), 1,
    'wrapped ranges are rejected');

  assert.strictEqual(e.test_bad_read(base, 1), 0);
  assert.strictEqual(e.test_bad_write(base, 1), 0);
  assert.strictEqual(e.test_bad_read(base + 0x1000, 1), 1,
    'PAGE_NOACCESS rejects reads');
  assert.strictEqual(e.test_bad_write(base + 0x1000, 1), 1,
    'PAGE_NOACCESS rejects writes');
  assert.strictEqual(e.test_bad_read(base + 0x2000, 1), 0,
    'PAGE_READONLY permits reads');
  assert.strictEqual(e.test_bad_write(base + 0x2000, 1), 1,
    'PAGE_READONLY rejects writes');
  assert.strictEqual(e.test_bad_code(base + 0x2000), 0,
    'IsBadCodePtr follows its documented read-access contract');
  assert.strictEqual(e.test_bad_code(base + 0x1000), 1);
  assert.strictEqual(e.test_bad_read(base + 0x3000, 1), 1,
    'PAGE_GUARD rejects system-service read probes');
  assert.strictEqual(e.test_bad_write(base + 0x3000, 1), 1,
    'PAGE_GUARD rejects system-service write probes');
  assert.strictEqual(e.test_bad_read(base + 0xfff, 0x2002), 1,
    'an inaccessible interior page rejects the complete range');

  e.guest_write8(base + 0xffe, 0x58); // X
  e.guest_write8(base + 0xfff, 0x00);
  assert.strictEqual(e.test_bad_string_a(base + 0xffe, 4), 0,
    'ANSI scan stops at NUL before an inaccessible page');
  e.guest_write8(base + 0xfff, 0x59); // Y
  assert.strictEqual(e.test_bad_string_a(base + 0xffe, 1), 0,
    'a readable nonterminated prefix is valid when ucchMax ends first');
  assert.strictEqual(e.test_bad_string_a(base + 0xffe, 4), 1,
    'ANSI scan rejects the inaccessible page before a terminator');

  e.guest_write8(base + 0x2ffe, 0x5a); // L'Z'
  e.guest_write8(base + 0x2fff, 0x00);
  e.guest_write8(base + 0x3000, 0x00);
  e.guest_write8(base + 0x3001, 0x00);
  assert.strictEqual(e.test_bad_read(base + 0x2ffe, 2), 0,
    'the final readable wide character remains within PAGE_READONLY');
  assert.strictEqual(e.test_bad_string_w(base + 0x2ffe, 2), 1,
    'wide scan checks both bytes of the next character across a guard page');
  e.guest_write8(base + 0x2ffe, 0x00);
  assert.strictEqual(e.guest_read8(base + 0x2ffe), 0x00);
  assert.strictEqual(e.guest_read8(base + 0x2fff), 0x00);
  assert.strictEqual(e.test_bad_string_w(base + 0x2ffe, 2), 0,
    'wide scan stops at a readable NUL before the guard page');
  assert.strictEqual(e.test_bad_string_a(0, 0), 0);
  assert.strictEqual(e.test_bad_string_w(0, 0), 0);
  assert.strictEqual(e.test_bad_string_a(0, 1), 1);
  assert.strictEqual(e.test_bad_string_w(0, 1), 1);
  assert.strictEqual(e.test_esp(), 0x0050000c,
    'two-argument string probes retain their stdcall stack contract');

  console.log('PASS pointer probes honor sparse PAGE_* access and bounded strings');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
