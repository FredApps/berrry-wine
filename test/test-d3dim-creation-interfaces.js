'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "invoke") (param $id i32) (param $sp i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
 (func (export "refs") (param $p i32) (result i32)
   (load.field DxObject refcount (call $dx_from_this (local.get $p))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_dx_com_thunks();
  const sp = e.guest_alloc(128), out = e.guest_alloc(4);
  const id = name => {
    const api = apis.find(a => a.name === name);
    assert(api, name);
    return api.id;
  };
  const invoke = (api, bytes, a, b = 0, c = 0) => {
    e.guest_write32(sp + bytes, 0xdeadbeef);
    const result = e.invoke(api, sp, a, b, c) >>> 0;
    assert.strictEqual(e.get_esp(), sp + bytes, 'stdcall cleanup');
    assert.strictEqual(e.guest_read32(sp + bytes) >>> 0, 0xdeadbeef, 'stack guard');
    return result;
  };
  const failures = [];
  for (const kind of ['Material', 'Viewport']) for (const version of [1, 2, 3]) {
    const suffix = version === 1 ? '' : version;
    const creator = `IDirect3D${suffix}_Create${kind}`;
    const prefix = `IDirect3D${kind}${suffix}_`;
    e.guest_write32(out, 0xdeadbeef);
    assert.strictEqual(invoke(id(creator), 16, 0, out), 0, creator);
    const p = e.guest_read32(out), vt = e.guest_read32(p);
    assert(p && vt, 'published object and vtable');
    assert.strictEqual(e.refs(p), 1);
    const slot = index => {
      const thunk = e.guest_read32(vt + index * 4);
      assert.strictEqual(e.guest_read32(thunk) >>> 0, 0xcaca0010, 'COM thunk marker');
      return e.guest_read32(thunk + 4);
    };
    // Check every slot, not just compatible methods shared by successive ABIs.
    const methods = apis.filter(a => a.name.startsWith(prefix));
    for (let n = 0; n < methods.length; n++) {
      const actual = slot(n);
      if (actual !== methods[n].id) failures.push(`${creator} slot ${n}: ${apis[actual]?.name} != ${methods[n].name}`);
    }
    // Dispatch the IDs read from the returned vtable, not named test helpers.
    assert.strictEqual(invoke(slot(1), 8, p), 2);
    assert.strictEqual(invoke(slot(2), 8, p), 1);
    assert.strictEqual(invoke(slot(2), 8, p), 0);
  }
  assert.deepStrictEqual(failures, [], 'creation must return the declared interface version');
  console.log('PASS six D3D creation interfaces: exact vtable slots, thunk-routed AddRef/Release and stdcall guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
