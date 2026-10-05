#!/usr/bin/env node
'use strict';

// Direct3D Device 2 and Device 7 expose the same SetTransform operation:
// a transform-state selector plus one D3DMATRIX.  Keep both public COM slots
// and API identities while dispatching them to one stateful implementation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = String.raw`
  (func (export "d3dim_transform_create_device") (result i32)
    (local $obj i32) (local $entry i32) (local $state i32)
    (local.set $obj
      (call $dx_create_com_obj (i32.const 20) (i32.const 0x53000000)))
    (if (i32.eqz (local.get $obj)) (then (return (i32.const 0))))
    (local.set $entry (call $dx_from_this (local.get $obj)))
    (local.set $state (call $heap_alloc (i32.const 4096)))
    (call $d3ddev_init_state (local.get $state))
    (i32.store offset=16 (local.get $entry) (local.get $state))
    (local.get $obj))

  (func (export "d3dim_transform_call")
      (param $api i32) (param $device i32) (param $type i32)
      (param $matrix i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $dispatch_api_table
      (local.get $api) (local.get $device) (local.get $type)
      (local.get $matrix) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "d3dim_transform_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

function api(name) {
  const entry = apiTable.find(candidate => candidate.name === name);
  assert(entry, `${name} remains registered`);
  return entry;
}

(async () => {
  const d2set = api('IDirect3DDevice2_SetTransform');
  const d2get = api('IDirect3DDevice2_GetTransform');
  const d7set = api('IDirect3DDevice7_SetTransform');
  const d7get = api('IDirect3DDevice7_GetTransform');

  assert.strictEqual(d2set.id, 1340, 'Device2 setter id remains stable');
  assert.strictEqual(d2get.id, 1341, 'Device2 getter id remains stable');
  assert.strictEqual(d7set.id, 1358, 'Device7 setter id remains stable');
  assert.strictEqual(d7get.id, 1359, 'Device7 getter id remains stable');
  for (const entry of [d2set, d2get, d7set, d7get]) {
    assert.strictEqual(entry.nargs, 5, `${entry.name} keeps the common handler ABI`);
  }
  assert.strictEqual(d7set.handler, 'IDirect3DDevice2_SetTransform',
    'Device7 setter metadata aliases the canonical Device2 handler');

  const root = path.join(__dirname, '..');
  const dispatch = fs.readFileSync(
    path.join(root, 'src/09b2-dispatch-table.generated.wat'), 'utf8');
  assert.match(dispatch,
    /;; 1358: IDirect3DDevice7_SetTransform[\s\S]*?call \$handle_IDirect3DDevice2_SetTransform/,
    'generated dispatch routes Device7 through the Device2 implementation');
  const source = fs.readFileSync(
    path.join(root, 'src/09aa-handlers-d3dim.wat'), 'utf8');
  assert(!source.includes('(func $handle_IDirect3DDevice7_SetTransform'),
    'the duplicate Device7 wrapper is absent');
  assert(source.includes('(func $handle_IDirect3DDevice2_SetTransform'),
    'the canonical stateful Device2 implementation remains');

  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const device = wat.d3dim_transform_create_device() >>> 0;
  assert(device, 'created a state-backed legacy Direct3D device');
  const input = 0x00310000;
  const output = 0x00310100;

  for (const [setIndex, setter] of [d2set, d7set].entries()) {
    const expected = [];
    for (let word = 0; word < 16; word++) {
      const value = (0x3f000000 + setIndex * 0x00100000 + word * 0x00010101) >>> 0;
      expected.push(value);
      wat.guest_write32(input + word * 4, value);
    }

    assert.strictEqual(
      wat.d3dim_transform_call(setter.id, device, 1 + setIndex, input) >>> 0,
      0, `${setter.name} returns D3D_OK`);
    assert.strictEqual(wat.d3dim_transform_esp() >>> 0, 0x00300010,
      `${setter.name} pops return address plus three COM arguments`);

    for (const getter of [d2get, d7get]) {
      for (let word = 0; word < 16; word++) {
        wat.guest_write32(output + word * 4, 0xdeadbeef);
      }
      assert.strictEqual(
        wat.d3dim_transform_call(getter.id, device, 1 + setIndex, output) >>> 0,
        0, `${getter.name} returns D3D_OK`);
      assert.strictEqual(wat.d3dim_transform_esp() >>> 0, 0x00300010,
        `${getter.name} keeps the same four-word stdcall cleanup`);
      assert.deepStrictEqual(
        expected.map((_, word) => wat.guest_read32(output + word * 4) >>> 0),
        expected, `${getter.name} reads the matrix written through ${setter.name}`);
    }
  }

  console.log('PASS  Direct3D Device2/7 SetTransform share one stateful handler');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
