#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const apiTable = require('../src/api_table.json');
const apiId = name => apiTable.find(api => api.name === name).id;
for (const family of ['IDirectMusic', 'IAMMultiMediaStream', 'IDirectDrawGammaControl']) {
  for (const [method, handler] of [['AddRef', 'dx_com_addref'], ['Release', 'dx_com_release_basic']]) {
    assert.strictEqual(apiTable.find(api => api.name === `${family}_${method}`).handler,
      handler, `${family}_${method} retains its canonical lifetime implementation`);
  }
}

const extraWat = String.raw`
  (func (export "test_create_directmusic") (result i32)
    (call $dx_create_com_obj
      (i32.const 35) (call $directmusic_vtable)))

  (func (export "test_create_amstream") (result i32)
    (call $dx_create_com_obj
      (i32.const 36)
      (call $init_com_vtable
        (global.get $API_ID_IAMMultiMediaStream_BASE) (i32.const 19))))

  (func (export "test_create_gamma_control") (result i32)
    (call $dx_create_com_obj
      (i32.const 2) (call $init_com_vtable (i32.const 3079) (i32.const 5))))

  (func (export "test_directmusic_refcount") (param $obj i32) (result i32)
    (load.field DxObject refcount (call $dx_from_this (local.get $obj))))

  (func (export "test_dx_live_count") (result i32)
    (local $i i32) (local $count i32)
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (global.get $DX_MAX)))
      (if (i32.load (i32.add (global.get $DX_OBJECTS)
            (i32.mul (local.get $i) (i32.const 32))))
        (then (local.set $count (i32.add (local.get $count) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan)))
    (local.get $count))

  (func (export "test_cocreate")
      (param $clsid i32) (param $outer i32) (param $iid i32) (param $out i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_CoCreateInstance
      (local.get $clsid) (local.get $outer) (i32.const 1)
      (local.get $iid) (local.get $out) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_enum_port") (param $obj i32) (param $index i32) (param $caps i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $dispatch_api_table
      (call $gl32 (i32.add (call $gl32 (i32.add (call $gl32 (local.get $obj)) (i32.const 12))) (i32.const 4)))
      (local.get $obj) (local.get $index) (local.get $caps)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))

  (func (export "test_call_IDirectMusic_QueryInterface")
        (param $obj i32) (param $iid i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectMusic_QueryInterface
      (local.get $obj) (local.get $iid) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_IAMMultiMediaStream_QueryInterface")
        (param $obj i32) (param $iid i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IAMMultiMediaStream_QueryInterface
      (local.get $obj) (local.get $iid) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_IDirectDrawGammaControl_QueryInterface")
        (param $obj i32) (param $iid i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_IDirectDrawGammaControl_QueryInterface
      (local.get $obj) (local.get $iid) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_call_IDirectMusic_Release") (param $obj i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $dispatch_api_table (i32.const ${apiId('IDirectMusic_Release')})
      (local.get $obj) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_ref_dispatch") (param $api i32) (param $obj i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $dispatch_api_table (local.get $api) (local.get $obj)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;

async function main() {
  const wasm = compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const imports = createHostImports({ getMemory: () => memory.buffer, renderer: null, resourceJson: {} });
  imports.host.memory = memory;
  Object.assign(imports.host, {
    create_thread: () => 0, exit_thread: () => 0, terminate_thread: () => 0,
    create_event: () => 0,
    set_event: () => 0, reset_event: () => 0, wait_single: () => 0,
    wait_multiple: () => 0, com_create_instance: () => 0x80004002,
  });
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  e.init_dx_com_thunks();
  const dv = new DataView(memory.buffer);
  const wa = gp => gp - e.get_image_base() + e.get_guest_base();
  const alloc = n => e.guest_alloc(n) >>> 0;
  let pass = 0;
  let fail = 0;
  const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };
  const writeGuid = words => {
    const value = alloc(16);
    words.forEach((word, i) => dv.setUint32(wa(value) + i * 4, word, true));
    return value;
  };

  const iunknown = writeGuid([0, 0, 0x000000c0, 0x46000000]);
  for (const [family, create] of [
    ['IDirectMusic', e.test_create_directmusic],
    ['IAMMultiMediaStream', e.test_create_amstream],
    ['IDirectDrawGammaControl', e.test_create_gamma_control],
  ]) {
    const live = e.test_dx_live_count();
    const object = create() >>> 0;
    check(`${family} starts with one owned reference`, object !== 0 &&
      e.test_directmusic_refcount(object) === 1 && e.test_dx_live_count() === live + 1);
    for (const [method, expected] of [['AddRef', 2], ['AddRef', 3], ['Release', 2], ['Release', 1]]) {
      check(`${family} dispatched ${method} returns ${expected} and pops once`,
        e.test_ref_dispatch(apiId(`${family}_${method}`), object) === expected &&
        e.test_directmusic_refcount(object) === expected && e.get_esp() === 0x00300008);
    }
    check(`${family} final dispatched release retires its object`,
      e.test_ref_dispatch(apiId(`${family}_Release`), object) === 0 &&
      e.test_dx_live_count() === live && e.get_esp() === 0x00300008);
  }
  const clsidDirectMusic = writeGuid([0x636b9f10, 0x11d10c7d, 0x2000b295, 0x2174dcaf]);
  const clsidDirectMusicWrongSuffix = writeGuid([0x636b9f10, 0, 0, 0]);
  const clsidAMStream = writeGuid([0x49c47ce5, 0x11d09ba4, 0xc0001282, 0x452cc34f]);
  const idirectmusic = writeGuid([0x6536115a, 0x11d27b2d, 0x000018ba, 0x12ac75f8]);
  const iamstream = writeGuid([0xbebe595c, 0x11d09a6f, 0xc000de8f, 0x9d18d94f]);
  const gammaControl = writeGuid([0x69c11c3e, 0x11d1b46b, 0xc0007aad, 0x4e9bc24f]);
  const wrongSuffix = writeGuid([0x6536115a, 0, 0, 0]);
  const unsupported = writeGuid([0x6536115b, 0x11d27b2d, 0x000018ba, 0x12ac75f8]);
  const out = alloc(4);
  const obj = e.test_create_directmusic() >>> 0;
  check('creates the bounded IDirectMusic object with one caller reference',
    obj !== 0 && e.test_directmusic_refcount(obj) === 1);

  const methods = ['QueryInterface','AddRef','Release','EnumPort','CreateMusicBuffer',
    'CreatePort','EnumMasterClock','GetMasterClock','SetMasterClock','Activate','GetDefaultPort','SetDirectSound'];
  const vtable=dv.getUint32(wa(obj),true);
  for(let slot=0;slot<methods.length;++slot) {
    const thunk=dv.getUint32(wa(vtable)+slot*4,true);
    check(`DirectMusic slot ${slot} maps to ${methods[slot]}`,
      dv.getUint32(wa(thunk),true)===0xcaca0010 &&
      dv.getUint32(wa(thunk)+4,true)===apiId('IDirectMusic_'+methods[slot]));
  }
  const caps=alloc(308), capBytes=new Uint8Array(memory.buffer,wa(caps),308);
  capBytes.fill(0xa7);dv.setUint32(wa(caps),308,true);
  const unchanged=Buffer.from(capBytes);
  for(const index of [0,1,0xffffffff]) check(`no fabricated DirectMusic port ${index}`,
    e.test_enum_port(obj,index,caps)===1 && e.get_esp()===0x00300010 &&
    Buffer.from(capBytes).equals(unchanged));
  check('EnumPort null caps is E_POINTER', (e.test_enum_port(obj,0,0)>>>0)===0x80004003);
  dv.setUint32(wa(caps),307,true);
  check('empty enumeration never reads or changes descriptor content', e.test_enum_port(obj,0,caps)===1 && dv.getUint32(wa(caps),true)===307);
  for(let slot=4;slot<methods.length;++slot) {
    const thunk=dv.getUint32(wa(vtable)+slot*4,true), id=dv.getUint32(wa(thunk)+4,true);
    assert.throws(()=>e.test_ref_dispatch(id,obj),WebAssembly.RuntimeError,methods[slot]+' fails explicitly');
  }

  check('IDirectMusic QueryInterface returns E_POINTER for null output without AddRef',
    (e.test_call_IDirectMusic_QueryInterface(obj, idirectmusic, 0) >>> 0) === 0x80004003 &&
    e.test_directmusic_refcount(obj) === 1 && (e.get_esp() >>> 0) === 0x00300010);

  dv.setUint32(wa(out), 0xfeedface, true);
  check('IDirectMusic QueryInterface rejects an unsupported IID and clears output',
    (e.test_call_IDirectMusic_QueryInterface(obj, unsupported, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_directmusic_refcount(obj) === 1);

  dv.setUint32(wa(out), 0xfeedface, true);
  check('IDirectMusic QueryInterface compares the complete GUID',
    (e.test_call_IDirectMusic_QueryInterface(obj, wrongSuffix, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_directmusic_refcount(obj) === 1);

  check('IDirectMusic QueryInterface accepts IUnknown and AddRefs the result',
    e.test_call_IDirectMusic_QueryInterface(obj, iunknown, out) === 0 &&
    dv.getUint32(wa(out), true) === obj && e.test_directmusic_refcount(obj) === 2);
  check('balancing the IUnknown query leaves the caller reference',
    e.test_call_IDirectMusic_Release(obj) === 1);

  check('IDirectMusic QueryInterface accepts its own IID and AddRefs the result',
    e.test_call_IDirectMusic_QueryInterface(obj, idirectmusic, out) === 0 &&
    dv.getUint32(wa(out), true) === obj && e.test_directmusic_refcount(obj) === 2);
  check('balancing the interface query leaves the caller reference',
    e.test_call_IDirectMusic_Release(obj) === 1);
  check('final caller release destroys the DirectMusic object',
    e.test_call_IDirectMusic_Release(obj) === 0);

  const stream = e.test_create_amstream() >>> 0;
  check('IAMMultiMediaStream accepts its own IID after the shared-helper split',
    e.test_call_IAMMultiMediaStream_QueryInterface(stream, iamstream, out) === 0 &&
    dv.getUint32(wa(out), true) === stream && e.test_directmusic_refcount(stream) === 2);
  check('IAMMultiMediaStream rejects the unrelated IDirectMusic IID',
    (e.test_call_IAMMultiMediaStream_QueryInterface(stream, idirectmusic, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_directmusic_refcount(stream) === 2);
  check('IAMMultiMediaStream references balance to destruction',
    e.test_call_IDirectMusic_Release(stream) === 1 &&
    e.test_call_IDirectMusic_Release(stream) === 0);

  const gamma = e.test_create_gamma_control() >>> 0;
  check('IDirectDrawGammaControl accepts its own IID after the shared-helper split',
    e.test_call_IDirectDrawGammaControl_QueryInterface(gamma, gammaControl, out) === 0 &&
    dv.getUint32(wa(out), true) === gamma && e.test_directmusic_refcount(gamma) === 2);
  check('IDirectDrawGammaControl rejects the unrelated IDirectMusic IID',
    (e.test_call_IDirectDrawGammaControl_QueryInterface(gamma, idirectmusic, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_directmusic_refcount(gamma) === 2);
  check('IDirectDrawGammaControl references balance to destruction',
    e.test_call_IDirectMusic_Release(gamma) === 1 &&
    e.test_call_IDirectMusic_Release(gamma) === 0);

  const liveBeforeFactories = e.test_dx_live_count();
  check('CoCreateInstance validates the complete DirectMusic CLSID',
    e.test_cocreate(clsidDirectMusicWrongSuffix, 0, idirectmusic, out) !== 0 &&
    dv.getUint32(wa(out), true) === 0 && e.test_dx_live_count() === liveBeforeFactories);
  check('CoCreateInstance rejects an unsupported DirectMusic IID without leaking',
    (e.test_cocreate(clsidDirectMusic, 0, unsupported, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_dx_live_count() === liveBeforeFactories);
  check('CoCreateInstance rejects DirectMusic aggregation and clears output',
    (e.test_cocreate(clsidDirectMusic, 1, idirectmusic, out) >>> 0) === 0x80040110 &&
    dv.getUint32(wa(out), true) === 0 && e.test_dx_live_count() === liveBeforeFactories);
  check('CoCreateInstance reports E_POINTER for a null DirectMusic output',
    (e.test_cocreate(clsidDirectMusic, 0, idirectmusic, 0) >>> 0) === 0x80004003 &&
    e.test_dx_live_count() === liveBeforeFactories);
  check('CoCreateInstance returns DirectMusic with one caller-owned reference',
    e.test_cocreate(clsidDirectMusic, 0, idirectmusic, out) === 0 &&
    (dv.getUint32(wa(out), true) >>> 0) !== 0 &&
    e.test_directmusic_refcount(dv.getUint32(wa(out), true)) === 1);
  check('the CoCreateInstance DirectMusic reference releases to destruction',
    e.test_call_IDirectMusic_Release(dv.getUint32(wa(out), true)) === 0 &&
    e.test_dx_live_count() === liveBeforeFactories);

  check('CoCreateInstance rejects a cross-class AM-stream IID without leaking',
    (e.test_cocreate(clsidAMStream, 0, idirectmusic, out) >>> 0) === 0x80004002 &&
    dv.getUint32(wa(out), true) === 0 && e.test_dx_live_count() === liveBeforeFactories);
  check('CoCreateInstance returns IAMMultiMediaStream with one caller reference',
    e.test_cocreate(clsidAMStream, 0, iamstream, out) === 0 &&
    (dv.getUint32(wa(out), true) >>> 0) !== 0 &&
    e.test_directmusic_refcount(dv.getUint32(wa(out), true)) === 1);
  check('the CoCreateInstance AM-stream reference releases to destruction',
    e.test_call_IDirectMusic_Release(dv.getUint32(wa(out), true)) === 0 &&
    e.test_dx_live_count() === liveBeforeFactories);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
