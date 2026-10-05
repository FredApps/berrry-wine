#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const extraWat = String.raw`
  (func (export "test_named_semaphore_init")
    (global.set $image_base (i32.const 0)))

  (func (export "test_create_semaphore_a")
      (param $name i32) (param $initial i32) (param $maximum i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateSemaphoreA
      (i32.const 0) (local.get $initial) (local.get $maximum) (local.get $name)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_create_semaphore_w")
      (param $name i32) (param $initial i32) (param $maximum i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateSemaphoreW
      (i32.const 0) (local.get $initial) (local.get $maximum) (local.get $name)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_open_semaphore_a") (param $name i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_OpenSemaphoreA
      (i32.const 0x00100002) (i32.const 0) (local.get $name)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_release_semaphore")
      (param $handle i32) (param $count i32) (param $previous i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_ReleaseSemaphore
      (local.get $handle) (local.get $count) (local.get $previous)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_wait_semaphore_now") (param $handle i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_WaitForSingleObject
      (local.get $handle) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_create_event_a") (param $name i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateEventA
      (i32.const 0) (i32.const 0) (i32.const 0) (local.get $name)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_create_mutex_a") (param $name i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateMutexA
      (i32.const 0) (i32.const 0) (local.get $name)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_named_semaphore_last_error") (result i32)
    (global.get $last_error))
`;

function appendTestExports(file, source) {
  return file === '13-exports.wat' ? `${source}\n${extraWat}\n` : source;
}

async function main() {
  const wasmBytes = compileSrcWasm(appendTestExports);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = {
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: {},
    onExit: () => {},
  };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  imports.host.com_create_instance = () => 0x80004002;
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const wat = instance.exports;
  ctx.exports = wat;
  wat.test_named_semaphore_init();

  const names = new Map();
  let next = 0x2000;
  function writeName(value, wide = false) {
    const address = next;
    next += (value.length + 1) * (wide ? 2 : 1) + 8;
    for (let i = 0; i < value.length; i++) {
      if (wide) wat.guest_write16(address + i * 2, value.charCodeAt(i));
      else wat.guest_write8(address + i, value.charCodeAt(i));
    }
    if (wide) wat.guest_write16(address + value.length * 2, 0);
    else wat.guest_write8(address + value.length, 0);
    names.set(`${wide ? 'W' : 'A'}:${value}`, address);
    return address;
  }

  const ansiName = writeName('Fable Browser Semaphore');
  const wideName = writeName('Fable Browser Semaphore', true);
  const differentCase = writeName('fable browser semaphore');
  assert.strictEqual(wat.test_open_semaphore_a(ansiName), 0,
    'OpenSemaphoreA reports a missing name');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 2,
    'a missing named semaphore sets ERROR_FILE_NOT_FOUND');

  const handle = wat.test_create_semaphore_w(wideName, 1, 2) >>> 0;
  assert(handle, 'CreateSemaphoreW allocates a named semaphore');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 0);
  assert.strictEqual(wat.test_open_semaphore_a(differentCase), 0,
    'semaphore names are case-sensitive');

  assert.strictEqual(wat.test_wait_semaphore_now(handle), 0,
    'the original initial count is available');
  assert.strictEqual(wat.test_wait_semaphore_now(handle), 0x102,
    'the wait consumes the original count');

  assert.strictEqual(wat.test_create_semaphore_a(ansiName, -9, 0) >>> 0, handle,
    'CreateSemaphoreA opens an existing A/W name even when replacement counts are invalid');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 183,
    'recreating a semaphore sets ERROR_ALREADY_EXISTS');
  assert.strictEqual(wat.test_open_semaphore_a(ansiName) >>> 0, handle,
    'OpenSemaphoreA resolves the object created through CreateSemaphoreW');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 0);

  const previous = 0x2800;
  assert.strictEqual(wat.test_release_semaphore(handle, 2, previous), 1,
    'the existing object retained its original maximum count');
  assert.strictEqual(wat.guest_read32(previous), 0,
    'ReleaseSemaphore publishes the shared previous count');
  assert.strictEqual(wat.test_release_semaphore(handle, 1, 0), 0,
    'a release past the original maximum still fails');
  assert.strictEqual(wat.test_wait_semaphore_now(handle), 0);
  assert.strictEqual(wat.test_wait_semaphore_now(handle), 0);
  assert.strictEqual(wat.test_wait_semaphore_now(handle), 0x102,
    'all handles share one count');

  assert.strictEqual(ctx.closeSyncHandle(handle), true);
  assert.strictEqual(ctx.closeSyncHandle(handle), true);
  assert.strictEqual(wat.test_open_semaphore_a(ansiName) >>> 0, handle,
    'the name survives while one Create/Open reference remains');
  assert.strictEqual(ctx.closeSyncHandle(handle), true);
  assert.strictEqual(ctx.closeSyncHandle(handle), true);
  assert.strictEqual(wat.test_open_semaphore_a(ansiName), 0,
    'the name disappears after the final handle reference closes');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 2);

  assert.strictEqual(wat.test_create_semaphore_a(0, -1, 4), 0);
  assert.strictEqual(wat.test_named_semaphore_last_error(), 87,
    'a new semaphore rejects a negative initial count');
  assert.strictEqual(wat.test_create_semaphore_a(0, 0, 0), 0);
  assert.strictEqual(wat.test_named_semaphore_last_error(), 87,
    'a new semaphore rejects a non-positive maximum');

  const eventName = writeName('Fable Shared Event Name');
  assert(wat.test_create_event_a(eventName), 'a named event can be created');
  assert.strictEqual(wat.test_create_semaphore_a(eventName, 0, 1), 0,
    'CreateSemaphoreA rejects a name owned by an event');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 6,
    'a cross-type name collision sets ERROR_INVALID_HANDLE');

  const semaphoreName = writeName('Fable Shared Semaphore Name');
  assert(wat.test_create_semaphore_a(semaphoreName, 0, 1),
    'a second named semaphore can be created');
  assert.strictEqual(wat.test_create_mutex_a(semaphoreName), 0,
    'CreateMutexA rejects a name owned by a semaphore');
  assert.strictEqual(wat.test_named_semaphore_last_error(), 6,
    'the synchronization namespace is shared in both directions');

  console.log('PASS  named semaphore APIs preserve names, counts, lifetime, and namespace rules');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
