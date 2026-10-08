'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { stageReceiver, resourceDll } = require('./win16-path-stage-helper');

const extraWat = `
  (func (export "t_init")
    (global.set $image_base (i32.const 0))
    (global.set $is_win16 (i32.const 1))
    (global.set $code16 (i32.const 1))
    (call $win16_handle_reset)
    (call $win16_next_seg_set (i32.const 40))
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (call $win16_set_sreg (i32.const 3) (call $win16_index_to_sel (i32.const 2))))
  (func (export "t_find") (param $id i32) (result i32)
    (local $h i32)
    (global.set $win16_res_module_id (i32.or (local.get $id) (i32.const 0x10000)))
    (if (call $win16_find_resource (i32.const 2) (i32.const 164))
      (then (local.set $h (call $win16_res_handle_alloc (i32.const 0x200A4)
        (global.get $win16_res_module_id) (i32.const 0)))))
    (global.set $win16_res_module_id (i32.const 0))
    (local.get $h))
  (func (export "t_load") (param $h i32) (result i32)
    (call $win16_res_load (call $win16_res_desc_from_handle (local.get $h))))
  (func (export "t_data") (param $sel i32) (result i32)
    (call $g2w (call $win16_seg_base (call $win16_sel_to_index (local.get $sel)))))
  (func (export "t_path") (param $id i32) (result i32)
    (call $win16_dll_path_guest (local.get $id)))
  (func (export "t_refs") (param $h i32) (result i32)
    (i32.shr_u (i32.load offset=8 (call $win16_res_desc_from_handle (local.get $h))) (i32.const 16)))
  (func (export "t_path_table") (result i32) (call $win16_dll_path_sel_ptr (i32.const 0)))
  (func (export "t_path_selector") (param $id i32) (result i32)
    (i32.load (call $win16_dll_path_sel_ptr (local.get $id))))
  (func (export "t_global_is_free") (param $sel i32) (result i32)
    (i32.ne (i32.and (call $win16_gseg_field (call $win16_sel_to_index (local.get $sel)) (i32.const 8))
      (global.get $WIN16_SEG_GFREE)) (i32.const 0)))
  (func $t_frame
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x110800))
    (call $gs16 (i32.const 0x110800) (i32.const 0x40))
    (call $gs16 (i32.const 0x110802) (call $win16_index_to_sel (i32.const 1))))
  (func (export "t_filename") (param $id i32) (param $size i32) (result i32)
    (call $t_frame)
    (call $gs16 (i32.const 0x110804) (local.get $size))
    (call $gs16 (i32.const 0x110806) (i32.const 0xA00))
    (call $gs16 (i32.const 0x110808) (call $win16_index_to_sel (i32.const 2)))
    (call $gs16 (i32.const 0x11080A) (call $win16_h16 (i32.or (i32.const 0xD10000) (local.get $id))))
    (call $win16_GetModuleFileName)
    (i32.load (global.get $reg_base)))
  (func (export "t_filename_buffer") (result i32) (call $g2w (i32.const 0x110A00)))
  (func (export "t_access") (param $id i32) (param $h i32) (result i32)
    (call $t_frame)
    (call $gs16 (i32.const 0x110804) (local.get $h))
    (call $gs16 (i32.const 0x110806) (call $win16_h16 (i32.or (i32.const 0xD10000) (local.get $id))))
    (call $win16_AccessResource)
    (i32.load (global.get $reg_base)))
  (func (export "t_free_library") (param $id i32)
    (i32.store (call $win16_dll_refs_ptr (local.get $id)) (i32.const 1))
    (call $t_frame)
    (call $gs16 (i32.const 0x110804) (call $win16_h16 (i32.or (i32.const 0xD10000) (local.get $id))))
    (call $win16_FreeLibrary))
`;

(async () => {
  const { exports: e, memory, hostCtx, host } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.t_init();
  const fixture = resourceDll(), firstPath = 'c:\\windows\\temp\\art.dll';
  hostCtx.vfs.files.set(firstPath, { data: fixture.bytes, attrs: 0x20 });
  const m = () => new Uint8Array(memory.buffer);
  function register(id, name) {
    const p = e.win16_dynamic_module_slot(id - 13);
    m().fill(0, p, p + 16);
    m().set([name.length, ...Buffer.from(name)], p);
  }
  register(13, 'ART');
  // The old staging contract loses the nested VFS pathname. Exercise the
  // actual loader/resource/file APIs, not a mocked resource return.
  const legacy = stageReceiver({ ...e, win16_dll_path_alloc: undefined }, memory, hostCtx.vfs);
  const size = legacy._stageWin16Module('ART', 13);
  assert.equal(size, fixture.bytes.length);
  assert.equal(e.load_ne_dll_sized(13, size), 1);
  const h = e.t_find(13);
  assert.notEqual(h, 0);
  assert.equal(e.t_load(h), 0, 'a fabricated root pathname cannot reopen the nested DLL');

  const selected = stageReceiver(e, memory, hostCtx.vfs);
  const cpuNames = ['get_eip', 'get_esp', 'get_eax', 'get_edx'];
  const cpuBefore = cpuNames.map(n => e[n]());
  assert.equal(selected._stageWin16Module('ART', 13), size);
  assert.deepEqual(cpuNames.map(n => e[n]()), cpuBefore, 'host pathname allocation leaves CPU registers untouched');
  const sel = e.t_load(h);
  assert.notEqual(sel, 0);
  assert.deepEqual(m().slice(e.t_data(sel), e.t_data(sel) + fixture.dataSize), fixture.data,
    'a resource beyond the retained 64KiB metadata page reads every original file byte');
  assert.equal(e.t_load(h), sel);
  assert.equal(e.t_refs(h), 2);
  const pathSelector = e.t_path_selector(13);
  const pathGA = e.t_path(13);
  assert.notEqual(pathGA, 0);
  const out = e.t_filename_buffer();
  m().fill(0xCC, out, out + 260);
  assert.equal(e.t_filename(13, 0), 0);
  assert.equal(m()[out], 0xCC);
  assert.equal(e.t_filename(13, 5), 4);
  assert.equal(Buffer.from(m().subarray(out, out + 5)).toString(), firstPath.slice(0, 4) + String.fromCharCode(0));
  assert.equal(m()[out + 5], 0xCC);
  assert.equal(e.t_filename(13, 260), firstPath.length);
  assert.equal(Buffer.from(m().subarray(out, out + 260)).toString().split(String.fromCharCode(0))[0], firstPath);
  const file = e.t_access(13, h);
  assert.ok(file > 0 && file < 65535);
  assert.equal(hostCtx.vfs.handles.get(file).pos, fixture.dataOffset, 'AccessResource opens the same selected file and seeks to its bytes');
  host.fs_close_handle(file);

  e.t_free_library(13);
  assert.equal(e.t_path(13), 0, 'unloading releases the module-owned filename');
  assert.equal(e.t_global_is_free(pathSelector), 1, 'FreeLibrary releases the allocated path block as well as its pointer');
  assert.equal(e.t_load(h), 0, 'a released resource descriptor cannot read the old file');
  const next = resourceDll(0x19), nextPath = 'c:\\games\\different\\other.dll';
  hostCtx.vfs.files.set(nextPath, { data: next.bytes, attrs: 0x20 });
  register(13, 'OTHER');
  assert.equal(selected._stageWin16Module('OTHER', 13), next.bytes.length);
  assert.equal(e.load_ne_dll_sized(13, next.bytes.length), 1);
  const nextH = e.t_find(13), nextSel = e.t_load(nextH);
  assert.notEqual(nextSel, 0);
  assert.deepEqual(m().slice(e.t_data(nextSel), e.t_data(nextSel) + next.dataSize), next.data,
    'reusing a module id reads its new pathname and new resource bytes');
  e.t_free_library(13);
  e.win16_dynamic_modules_reset();
  assert.equal(e.t_path(13), 0);
  const table = e.t_path_table();
  const left = m().slice(table - 16, table), right = m().slice(table + 37 * 4, table + 37 * 4 + 16);
  const beforeInvalid = m().slice(table - 16, table + 37 * 4 + 16);
  for (const id of [0, 12, 37, 0xFFFFFFFF]) assert.equal(e.win16_dll_path_alloc(id), 0);
  assert.deepEqual(m().slice(table - 16, table + 37 * 4 + 16), beforeInvalid);
  const allocated = [];
  for (let id = 13; id < 37; id++) {
    assert.notEqual(e.win16_dll_path_alloc(id), 0);
    allocated.push(e.t_path_selector(id));
  }
  assert.deepEqual(m().slice(table - 16, table), left);
  assert.deepEqual(m().slice(table + 37 * 4, table + 37 * 4 + 16), right);
  e.win16_dynamic_modules_reset();
  for (let id = 13; id < 37; id++) assert.equal(e.t_path_selector(id), 0);
  for (const sel of allocated) assert.equal(e.t_global_is_free(sel), 1, 'reset frees every allocated path block');
  assert.deepEqual(m().slice(table - 16, table), left);
  assert.deepEqual(m().slice(table + 37 * 4, table + 37 * 4 + 16), right);
  console.log('PASS Win16 selected nested module pathname: real huge-resource bytes, filename bounds, AccessResource seek, unload and slot reuse');
})().catch(err => { console.error(err); process.exitCode = 1; });
