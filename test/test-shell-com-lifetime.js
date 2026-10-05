#!/usr/bin/env node
'use strict';

// Desktop shell objects are ordinary COM objects: QueryInterface owns the
// returned copy, and AddRef/Release must change the object's actual lifetime.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const S_OK = 0;
const E_NOINTERFACE = 0x80004002;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func $test_shell_iid (param $data1 i32)
    (call $gs32 (i32.const 0x2d00) (local.get $data1))
    (call $gs32 (i32.const 0x2d04) (i32.const 0))
    (call $gs32 (i32.const 0x2d08) (i32.const 0x000000C0))
    (call $gs32 (i32.const 0x2d0c) (i32.const 0x46000000)))

  (func (export "test_shell_folder_create") (result i32)
    (call $gs32 (i32.const 0x2c00) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_SHGetDesktopFolder
      (i32.const 0x2c00) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (call $gl32 (i32.const 0x2c00)))

  (func (export "test_shell_folder_enum") (param $folder i32) (result i32)
    (call $gs32 (i32.const 0x2c04) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IShellFolder_EnumObjects
      (local.get $folder) (i32.const 0) (i32.const 0)
      (i32.const 0x2c04) (i32.const 0) (i32.const 0))
    (call $gl32 (i32.const 0x2c04)))

  (func (export "test_shell_folder_qi")
        (param $folder i32) (param $data1 i32) (result i32)
    (call $test_shell_iid (local.get $data1))
    (call $gs32 (i32.const 0x2d20) (i32.const 0xDEADBEEF))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IShellFolder_QueryInterface
      (local.get $folder) (i32.const 0x2d00) (i32.const 0x2d20)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_enum_qi")
        (param $enumerator i32) (param $data1 i32) (result i32)
    (call $test_shell_iid (local.get $data1))
    (call $gs32 (i32.const 0x2d20) (i32.const 0xDEADBEEF))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IEnumIDList_QueryInterface
      (local.get $enumerator) (i32.const 0x2d00) (i32.const 0x2d20)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_qi_out") (result i32)
    (call $gl32 (i32.const 0x2d20)))

  (func (export "test_shell_folder_addref") (param $folder i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IShellFolder_AddRef
      (local.get $folder) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_folder_release") (param $folder i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IShellFolder_Release
      (local.get $folder) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_enum_addref") (param $enumerator i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IEnumIDList_AddRef
      (local.get $enumerator) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_enum_release") (param $enumerator i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IEnumIDList_Release
      (local.get $enumerator) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_shell_refcount") (param $object i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $object))))

  (func (export "test_shell_type") (param $object i32) (result i32)
    (load.field DxObject type (call $dx_from_this (local.get $object))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat });

  const folder = e.test_shell_folder_create() >>> 0;
  assert.notStrictEqual(folder, 0, 'SHGetDesktopFolder returns an object');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8, 'factory call pops its frame');
  assert.strictEqual(e.test_shell_type(folder), 32, 'folder object is live');
  assert.strictEqual(e.test_shell_refcount(folder), 1, 'folder starts with one reference');

  assert.strictEqual(e.test_shell_folder_qi(folder, 0x000214e6) >>> 0, S_OK,
    'folder accepts IID_IShellFolder');
  assert.strictEqual(e.test_shell_qi_out() >>> 0, folder,
    'QueryInterface returns the folder interface');
  assert.strictEqual(e.test_shell_refcount(folder), 2,
    'QueryInterface owns the returned interface reference');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 16, 'QueryInterface pops its frame');
  assert.strictEqual(e.test_shell_folder_release(folder), 1,
    'releasing the queried copy preserves the original');

  assert.strictEqual(e.test_shell_folder_qi(folder, 0xdeadbeef) >>> 0, E_NOINTERFACE,
    'folder rejects an unsupported IID');
  assert.strictEqual(e.test_shell_qi_out(), 0, 'failed QueryInterface clears its output');
  assert.strictEqual(e.test_shell_refcount(folder), 1,
    'failed QueryInterface does not acquire a reference');

  const enumerator = e.test_shell_folder_enum(folder) >>> 0;
  assert.notStrictEqual(enumerator, 0, 'EnumObjects returns an enumerator');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 20, 'EnumObjects pops its frame');
  assert.strictEqual(e.test_shell_type(enumerator), 33, 'enumerator object is live');
  assert.strictEqual(e.test_shell_refcount(enumerator), 1,
    'enumerator starts with one reference');

  assert.strictEqual(e.test_shell_enum_qi(enumerator, 0x000214f2) >>> 0, S_OK,
    'enumerator accepts IID_IEnumIDList');
  assert.strictEqual(e.test_shell_qi_out() >>> 0, enumerator,
    'QueryInterface returns the enumerator interface');
  assert.strictEqual(e.test_shell_refcount(enumerator), 2,
    'enumerator QueryInterface acquires its returned reference');
  assert.strictEqual(e.test_shell_enum_release(enumerator), 1,
    'releasing the queried enumerator copy preserves the original');

  assert.strictEqual(e.test_shell_enum_addref(enumerator), 2,
    'IEnumIDList::AddRef increments and returns the real count');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 8, 'AddRef pops its frame');
  assert.strictEqual(e.test_shell_enum_release(enumerator), 1,
    'the matching Release decrements the real count');
  assert.strictEqual(e.test_shell_enum_release(enumerator), 0,
    'final enumerator Release returns zero');
  assert.strictEqual(e.test_shell_type(enumerator), 0,
    'final enumerator Release frees the logical object');

  assert.strictEqual(e.test_shell_folder_addref(folder), 2,
    'IShellFolder::AddRef increments and returns the real count');
  assert.strictEqual(e.test_shell_folder_release(folder), 1,
    'the matching folder Release decrements the real count');
  assert.strictEqual(e.test_shell_folder_release(folder), 0,
    'final folder Release returns zero');
  assert.strictEqual(e.test_shell_type(folder), 0,
    'final folder Release frees the logical object');

  console.log('PASS  shell folder and enumerator obey COM reference ownership');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
