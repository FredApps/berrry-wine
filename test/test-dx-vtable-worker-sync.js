#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { parseWat } = require('../tools/struct-offset-census');

// Derive expectations from initialization, not from the restore code under
// test. New interfaces automatically gain coverage, regardless of tail name.
const generated = fs.readFileSync(path.join(__dirname,
  '../src/09b2-dispatch-table.generated.wat'), 'utf8');
const init = parseWat(generated).find(node => node[0] === 'func' && node[1] === '$init_dx_com_thunks');
assert(init, 'generated COM initializer exists');
const vtables = init.filter(node => Array.isArray(node) && node[0] === 'global.set')
  .map(node => {
    assert(['$init_com_vtable', '$extend_com_vtable'].includes(node[2]?.[1]),
      'each registered vtable is constructed or extended');
    return node[1];
  });
assert(vtables.length > 0 && new Set(vtables).size === vtables.length,
  'initialization registers unique interface globals');

const extraWat = String.raw`
  (func (export "test_dx_seed_registry") (param $count i32) (param $base i32)
    (local $i i32)
    (call $dx_vtable_registry_reset)
    (local.set $i (i32.const 0))
    (block $done (loop $seed
      (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
      (call $dx_vtable_registry_append
        (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const 0x100))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $seed))))
  (func (export "test_dx_clear_thread_vtables")
    ;; Model a newly instantiated worker: its mutable globals start at zero.
    ${vtables.map(name => `(global.set ${name} (i32.const 0))`).join('\n')})
  ${vtables.map((name, index) => `(func (export "test_vtable_${index}") (result i32)
    (global.get ${name}))`).join('\n')}
  ;; Read the size rather than restating it: the registry grows every time a
  ;; COM interface is added, and this test used to hardcode 52/53 -- it went
  ;; red the next time one was, saying "worker does not restore vtables" about
  ;; a worker that restores them correctly.
  (func (export "test_dx_registry_count") (result i32)
    (global.get $DX_VTBL_REGISTRY_COUNT))
  (func (export "test_dx_registry_ptr") (result i32)
    (global.get $DX_VTBL_REGISTRY))
  (func (export "test_dx_registry_bytes") (result i32)
    (i32.add (i32.const 4)
      (i32.mul (global.get $DX_VTBL_REGISTRY_COUNT) (i32.const 4))))
  (func (export "test_dx_aux_end") (result i32)
    (i32.add (global.get $COM_WRAPPERS_AUX)
      (global.get $COM_WRAPPERS_AUX_SIZE)))
  (func (export "test_vsock_ptr") (result i32)
    (global.get $VSOCK_TABLE))
`;

(async () => {
  const { exports: wat, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const base = 0x51000000;

  const count = wat.test_dx_registry_count() | 0;
  assert.strictEqual(count, vtables.length, 'registry capacity follows initialization inventory');
  const checkAll = (instance, expected, label) => vtables.forEach((name, index) =>
    assert.strictEqual(instance[`test_vtable_${index}`]() >>> 0, expected(index) >>> 0,
      `${label}: ${name} at registry slot ${index}`));
  assert.strictEqual(wat.test_dx_aux_end() >>> 0, wat.test_dx_registry_ptr() >>> 0,
    'the shared registry begins immediately after the bounded aux-wrapper pool');
  assert((wat.test_dx_registry_ptr() >>> 0) + (wat.test_dx_registry_bytes() >>> 0)
      <= (wat.test_vsock_ptr() >>> 0),
    'the shared DirectX registry does not overlap the virtual-socket table');

  wat.test_dx_seed_registry(count - 1, base);
  wat.test_dx_clear_thread_vtables();
  wat.init_thread(1, 0, 0, 0, 0, 0, 0);
  checkAll(wat, () => 0, 'partial registry must not restore any interface');

  wat.test_dx_seed_registry(count, base);
  wat.test_dx_clear_thread_vtables();
  wat.init_thread(1, 0, 0, 0, 0, 0, 0);
  checkAll(wat, index => base + index * 0x100, 'complete synthetic registry');

  // Exercise actual initialized pointers in a second WASM instance sharing
  // memory, rather than only pretending that one instance has fresh globals.
  wat.init_dx_com_thunks();
  const view = new DataView(memory.buffer);
  const registry = wat.test_dx_registry_ptr() >>> 0;
  assert.strictEqual(view.getUint32(registry, true), count);
  const pointers = vtables.map((_, index) => view.getUint32(registry + 4 + index * 4, true));
  assert(pointers.every(Boolean), 'real initialization publishes nonzero vtables');
  checkAll(wat, index => pointers[index], 'main initializer and registry agree');
  const { exports: worker } = await bootRenderHarness({ extraWat, memory, fonts: 'none' });
  checkAll(worker, () => 0, 'fresh instance has private uninitialized globals');
  worker.init_thread(2, 0, 0, 0, 0, 0, 0);
  checkAll(worker, index => pointers[index], 'second instance restores every real vtable');

  console.log('PASS  worker instances restore shared DirectX COM vtables');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
