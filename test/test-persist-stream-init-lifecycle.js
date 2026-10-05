#!/usr/bin/env node
'use strict';

// IPersistStreamInit has two mutually exclusive initialization paths.  A
// CommonDialog control loaded from a stream must not later accept InitNew and
// silently discard that loaded state.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const S_OK = 0;
const E_POINTER = 0x80004003;
const E_UNEXPECTED = 0x8000ffff;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_create_common_dialog") (result i32)
    ;; $ole_create_static_handler only needs the CommonDialog CLSID's Data1 to
    ;; select its IPersistStreamInit and IDispatch faces.
    (call $gs32 (i32.const 0x2c00) (i32.const 0xF9043C85))
    (call $ole_create_static_handler (i32.const 0x2c00)))

  (func (export "test_persist_stream_load")
        (param $iface i32) (param $stream i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IPersistStreamInit_Load
      (local.get $iface) (local.get $stream) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_persist_stream_init_new")
        (param $iface i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IPersistStreamInit_InitNew
      (local.get $iface) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat });
  const create = () => {
    const root = e.test_create_common_dialog() >>> 0;
    assert.notStrictEqual(root, 0, 'CommonDialog static handler is allocated');
    return { root, iface: (root + 172) >>> 0 };
  };
  const load = (iface, stream) => e.test_persist_stream_load(iface, stream) >>> 0;
  const initNew = iface => e.test_persist_stream_init_new(iface) >>> 0;
  const stream = e.test_ole_create_hglobal_stream(0, 0) >>> 0;
  assert.notStrictEqual(stream, 0, 'a memory-backed IStream is allocated');

  const fresh = create();
  assert.strictEqual(initNew(fresh.iface), S_OK,
    'a fresh object accepts default initialization');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
    'InitNew pops this and the return address');
  assert.strictEqual(load(fresh.iface, stream), E_UNEXPECTED,
    'Load rejects an object already initialized by InitNew');

  const failedLoad = create();
  assert.strictEqual(load(failedLoad.iface, 0), E_POINTER,
    'Load rejects a null IStream pointer');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 12,
    'Load pops this, stream, and the return address');
  assert.strictEqual(initNew(failedLoad.iface), S_OK,
    'a failed Load does not initialize the object');

  const loaded = create();
  assert.strictEqual(load(loaded.iface, stream), S_OK,
    'a non-null stream initializes the compatibility control');
  assert.strictEqual(initNew(loaded.iface), E_UNEXPECTED,
    'InitNew rejects an object already initialized by Load');

  const independent = create();
  assert.strictEqual(initNew(independent.iface), S_OK,
    'initialization state is per object');

  for (const { root } of [fresh, failedLoad, loaded, independent]) {
    assert.strictEqual(e.test_ole_release(root), 0, 'test object releases cleanly');
  }
  assert.strictEqual(e.test_ole_release(stream), 0, 'test stream releases cleanly');

  console.log('PASS  IPersistStreamInit preserves mutually exclusive initialization paths');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
