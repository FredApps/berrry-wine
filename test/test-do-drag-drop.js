#!/usr/bin/env node
'use strict';

// DoDragDrop is a synchronous OLE modal loop whose interfaces are implemented
// by the application. These tiny x86 COM objects prove the real callback ABI
// and CACA0011 continuation, including browser-style input changes between
// parked slices; WAT-only mocks would not exercise that boundary.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const apiTable = require('../src/api_table.json');
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_drag_window")
        (param $hwnd i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32)
    (local $slot i32)
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x10000000)))
    (local.set $slot (call $wnd_table_find (local.get $hwnd)))
    (call $ctrl_geom_set (local.get $slot) (local.get $x) (local.get $y)
      (local.get $w) (local.get $h)))

  (func (export "test_do_drag_drop_start")
        (param $data i32) (param $source i32) (param $allowed i32)
        (param $effect i32) (param $stack i32) (result i32)
    (global.set $eip (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (call $gs32 (local.get $stack) (i32.const 0))
    (call $handle_DoDragDrop
      (local.get $data) (local.get $source) (local.get $allowed)
      (local.get $effect) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_do_drag_drop_api_id") (result i32)
    (call $lookup_api_id "DoDragDrop"))
`;

function put32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

(async () => {
  const wasm = compileSrcWasm((file, source) =>
    file === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const input = { x: 10, y: 10, buttons: 1, escape: false, shift: false, control: false };
  let comCount = 0;
  let comApartment = 0;
  const imports = createHostImports({ getMemory: () => memory.buffer, renderer: null, resourceJson: {} });
  imports.host.memory = memory;
  Object.assign(imports.host, {
    create_thread: () => 0,
    exit_thread: () => 0,
    terminate_thread: () => 0,
    create_event: () => 0,
    set_event: () => 0,
    reset_event: () => 0,
    wait_single: () => 0,
    wait_multiple: () => 0,
    com_create_instance: () => 0x80004002,
    com_initialize_thread: (reserved, flags) => {
      if (reserved) return 0x80070057;
      const requestedApartment = (flags & 2) ? 1 : 2;
      if (comCount && comApartment !== requestedApartment) return 0x80010106;
      if (comCount++) return 1;
      comApartment = requestedApartment;
      return 0;
    },
    com_uninitialize_thread: () => {
      if (comCount && !--comCount) comApartment = 0;
      return 0;
    },
    get_mouse_position: () => ((input.y & 0xffff) << 16) | (input.x & 0xffff),
    get_mouse_buttons: () => input.buttons,
    get_window_rect: (hwnd, rectWa) => {
      const view = new DataView(memory.buffer);
      const left = (hwnd >>> 0) === 0x12346 ? 100 : 0;
      view.setInt32(rectWa, left, true);
      view.setInt32(rectWa + 4, 0, true);
      view.setInt32(rectWa + 8, left + 100, true);
      view.setInt32(rectWa + 12, 100, true);
    },
    get_key_down_state: key => {
      if (key === 0x1b) return input.escape ? 0x8000 : 0;
      if (key === 0x10) return input.shift ? 0x8000 : 0;
      if (key === 0x11) return input.control ? 0x8000 : 0;
      return 0;
    },
  });
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  const e = instance.exports;
  const exe = fs.readFileSync(path.join(ROOT, 'test/binaries/calc.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  assert(e.load_pe(exe.length), 'fixture PE initializes callback thunks');
  e.init_dx_com_thunks();

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const read = guest => e.guest_read32(guest) >>> 0;
  const write = (guest, value) => e.guest_write32(guest, value >>> 0);
  const alloc = size => e.guest_alloc(size) >>> 0;

  const emit = data => {
    const address = alloc(Math.max(64, data.length));
    bytes.fill(0xcc, wa(address), wa(address) + Math.max(64, data.length));
    bytes.set(data, wa(address));
    return address;
  };
  const returnMethod = pop => emit([0xb8, 1, 0, 0, 0, 0xc2, pop, 0]);
  const recordPrefix = id => {
    const code = [
      0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4] (this)
      0x8b, 0x50, 0x08,                   // mov edx,[eax+8] (log)
      0x8b, 0x0a,                         // mov ecx,[edx] (count)
      0xc7, 0x44, 0x8a, 0x04, 0, 0, 0, 0, // mov [edx+ecx*4+4],id
      0x41,                               // inc ecx
      0x89, 0x0a,                         // mov [edx],ecx
    ];
    put32(code, 13, id);
    return code;
  };
  const sourceMethod = (id, configured, pop) => emit([
    ...recordPrefix(id),
    ...(configured
      ? [0x8b, 0x40, 0x0c]                // mov eax,[eax+12]
      : [0xb8, 0x02, 0x01, 0x04, 0x00]), // DRAGDROP_S_USEDEFAULTCURSORS
    0xc2, pop, 0,
  ]);
  const feedbackMethod = () => emit([
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4] (this)
    0x8b, 0x50, 0x08,                   // mov edx,[eax+8] (log)
    0x8b, 0x0a,                         // mov ecx,[edx] (count)
    0x8b, 0x44, 0x24, 0x08,             // mov eax,[esp+8] (effect)
    0x0d, 0x00, 0x01, 0x00, 0x00,       // or eax,0x100 (feedback marker)
    0x89, 0x44, 0x8a, 0x04,             // mov [edx+ecx*4+4],eax
    0x41,                               // inc ecx
    0x89, 0x0a,                         // mov [edx],ecx
    0xb8, 0x02, 0x01, 0x04, 0x00,       // DRAGDROP_S_USEDEFAULTCURSORS
    0xc2, 0x08, 0x00,
  ]);
  const targetMethod = (id, effectStackOffset, pop) => {
    const code = [...recordPrefix(id)];
    if (effectStackOffset) code.push(
      0x8b, 0x54, 0x24, effectStackOffset, // mov edx,[esp+effect]
      0x8b, 0x48, 0x0c,                    // mov ecx,[eax+12] chosen effect
      0x89, 0x0a);                          // mov [edx],ecx
    code.push(0x8b, 0x40, 0x10, 0xc2, pop, 0); // configured HRESULT; ret N
    return emit(code);
  };
  const makeSource = log => {
    const vtable = alloc(20);
    const object = alloc(20);
    write(vtable, returnMethod(12));
    write(vtable + 4, returnMethod(4));
    write(vtable + 8, returnMethod(4));
    write(vtable + 12, sourceMethod(1, true, 12));
    write(vtable + 16, feedbackMethod());
    write(object, vtable);
    write(object + 8, log);
    write(object + 12, 0);
    return object;
  };
  const makeData = () => {
    const vtable = alloc(4);
    const object = alloc(8);
    write(vtable, returnMethod(12));
    write(object, vtable);
    return object;
  };
  const makeTarget = (log, base, effect = 1) => {
    const vtable = alloc(28);
    const object = alloc(24);
    write(vtable, returnMethod(12));
    write(vtable + 4, returnMethod(4));
    write(vtable + 8, returnMethod(4));
    write(vtable + 12, targetMethod(base, 24, 24));       // DragEnter
    write(vtable + 16, targetMethod(base + 1, 20, 20));   // DragOver
    write(vtable + 20, targetMethod(base + 2, 0, 4));     // DragLeave
    write(vtable + 24, targetMethod(base + 3, 24, 24));   // Drop
    write(object, vtable);
    write(object + 8, log);
    write(object + 12, effect);
    write(object + 16, 0);
    return object;
  };
  const makeLog = () => {
    const log = alloc(260);
    for (let i = 0; i < 65; i++) write(log + i * 4, 0);
    return log;
  };
  const logValues = log => Array.from({ length: read(log) }, (_, i) => read(log + 4 + i * 4));

  const dragApi = apiTable.find(entry => entry.name === 'DoDragDrop');
  assert(dragApi, 'DoDragDrop is registered in the generated API table');
  assert.strictEqual(dragApi.nargs, 4, 'API metadata records all four arguments');
  assert.strictEqual(dragApi.convention, 'stdcall');
  assert.strictEqual(e.test_do_drag_drop_api_id(), dragApi.id,
    'runtime import hashing resolves DoDragDrop to its registered id');

  const callApi = (name, ...args) => {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} is registered`);
    const thunkWa = RegionMap.BASE.THUNK_BASE;
    const thunkGuest = (thunkWa - guestBase + imageBase) >>> 0;
    const view = new DataView(memory.buffer);
    const savedName = view.getUint32(thunkWa, true);
    const savedId = view.getUint32(thunkWa + 4, true);
    view.setUint32(thunkWa + 4, api.id, true);
    e.call_func(thunkGuest, ...[...args, 0, 0, 0, 0].slice(0, 4));
    for (let i = 0; i < 400 && e.get_eip(); i++) e.run(5000);
    view.setUint32(thunkWa, savedName, true);
    view.setUint32(thunkWa + 4, savedId, true);
    assert.strictEqual(e.get_eip(), 0, `${name} completes`);
    return e.get_eax() >>> 0;
  };
  const startDrag = (data, source, allowed, effect) => {
    const stackBase = alloc(4096);
    const stack = stackBase + 4000;
    e.test_do_drag_drop_start(data, source, allowed, effect, stack);
    return { stack, expectedEsp: stack + 20 };
  };
  const runToParkOrDone = () => {
    for (let i = 0; i < 1000 && e.get_eip() && (e.get_yield_reason() | 0) !== 15; i++) {
      try { e.run(5000); }
      catch (error) {
        throw new Error(`${error.message} at guest eip=0x${(e.get_eip() >>> 0).toString(16)} `
          + `esp=0x${(e.get_esp() >>> 0).toString(16)}`);
      }
    }
    assert((e.get_eip() >>> 0) === 0 || (e.get_yield_reason() | 0) === 15,
      'drag reaches a parked input wait or completes');
  };
  const resume = () => {
    assert.strictEqual(e.get_yield_reason() | 0, 15, 'drag is parked for physical input');
    e.clear_yield();
    runToParkOrDone();
  };
  const checkEsp = call => assert.strictEqual(e.get_esp() >>> 0, call.expectedEsp >>> 0,
    'DoDragDrop pops its return address and four arguments');

  const data = makeData();
  const preInitLog = makeLog();
  const preInitSource = makeSource(preInitLog);
  const preInitEffect = alloc(4);
  write(preInitEffect, 0xcccccccc);
  let call = startDrag(data, preInitSource, 3, preInitEffect);
  assert.strictEqual(e.get_eax() >>> 0, 0x8000ffff, 'DoDragDrop requires OleInitialize');
  assert.strictEqual(read(preInitEffect), 0xcccccccc, 'precondition failure preserves pdwEffect');
  checkEsp(call);

  assert.strictEqual(callApi('CoInitialize', 0), 0, 'bare CoInitialize succeeds');
  call = startDrag(data, preInitSource, 3, preInitEffect);
  assert.strictEqual(e.get_eax() >>> 0, 0x8000ffff,
    'bare CoInitialize does not enable OLE drag/drop');
  checkEsp(call);
  callApi('CoUninitialize');

  assert.strictEqual(callApi('CoInitializeEx', 0, 0), 0, 'MTA CoInitializeEx succeeds');
  assert.strictEqual(callApi('OleInitialize', 0), 0x80010106,
    'OleInitialize reports RPC_E_CHANGED_MODE in an MTA');
  call = startDrag(data, preInitSource, 3, preInitEffect);
  assert.strictEqual(e.get_eax() >>> 0, 0x8000ffff,
    'failed OleInitialize does not enable OLE drag/drop');
  checkEsp(call);
  callApi('CoUninitialize');

  assert.strictEqual(callApi('OleInitialize', 1), 0x80070057,
    'invalid OleInitialize arguments are rejected');
  call = startDrag(data, preInitSource, 3, preInitEffect);
  assert.strictEqual(e.get_eax() >>> 0, 0x8000ffff,
    'invalid OleInitialize does not increment the OLE balance');
  checkEsp(call);

  assert.strictEqual(callApi('OleInitialize', 0), 0, 'first OleInitialize returns S_OK');
  assert.strictEqual(callApi('OleInitialize', 0), 1, 'nested OleInitialize returns S_FALSE');

  const invalidEffect = alloc(4);
  write(invalidEffect, 0xaaaaaaaa);
  for (const [badData, badSource, badOut] of [
    [0, preInitSource, invalidEffect], [data, 0, invalidEffect], [data, preInitSource, 0],
  ]) {
    call = startDrag(badData, badSource, 3, badOut);
    assert.strictEqual(e.get_eax() >>> 0, 0x80070057, 'invalid interface/output is E_INVALIDARG');
    checkEsp(call);
  }
  const malformed = alloc(8);
  write(malformed, 0);
  for (const [badData, badSource] of [
    [malformed, preInitSource], [data, malformed],
  ]) {
    call = startDrag(badData, badSource, 3, invalidEffect);
    assert.strictEqual(e.get_eax() >>> 0, 0x80070057,
      'non-null interfaces with missing methods are rejected');
    checkEsp(call);
  }

  const hwndA = 0x12345;
  const hwndB = 0x12346;
  e.test_drag_window(hwndA, 0, 0, 100, 100);
  e.test_drag_window(hwndB, 100, 0, 100, 100);
  const switchLog = makeLog();
  const source = makeSource(switchLog);
  const targetA = makeTarget(switchLog, 10, 1);
  const targetB = makeTarget(switchLog, 20, 6); // LINK is disallowed; MOVE survives.
  assert.strictEqual(callApi('RegisterDragDrop', hwndA, targetA), 0);
  assert.strictEqual(callApi('RegisterDragDrop', hwndB, targetB), 0);
  const effect = alloc(4);
  write(effect, 0xcccccccc);
  input.x = 10; input.y = 10; input.buttons = 1; input.escape = false;
  call = startDrag(data, source, 3, effect);
  runToParkOrDone();
  assert.deepStrictEqual(logValues(switchLog), [10, 0x101],
    'initial DragEnter then GiveFeedback with the accepted effect');
  assert.strictEqual(read(effect), 0xcccccccc, 'pdwEffect is not an in-progress scratch word');

  input.x = 110;
  resume();
  assert.deepStrictEqual(logValues(switchLog), [10, 0x101, 12, 0x100, 20, 0x102],
    'target switch is DragLeave, GiveFeedback(NONE), DragEnter, GiveFeedback(masked effect)');

  write(source + 12, 0x00040100);
  input.buttons = 0;
  resume();
  assert.strictEqual(e.get_eip() >>> 0, 0, 'accepted Drop completes the modal call');
  assert.strictEqual(e.get_eax() >>> 0, 0x00040100, 'accepted Drop returns DRAGDROP_S_DROP');
  assert.strictEqual(read(effect), 2, 'target result is intersected with dwOKEffects');
  assert.deepStrictEqual(logValues(switchLog), [10, 0x101, 12, 0x100, 20, 0x102, 1, 23],
    'button release queries the source before calling Drop');
  checkEsp(call);
  assert.strictEqual(callApi('RevokeDragDrop', hwndA), 0);
  assert.strictEqual(callApi('RevokeDragDrop', hwndB), 0);

  const cancelLog = makeLog();
  const cancelSource = makeSource(cancelLog);
  const cancelTarget = makeTarget(cancelLog, 30, 1);
  assert.strictEqual(callApi('RegisterDragDrop', hwndA, cancelTarget), 0);
  const cancelEffect = alloc(4);
  write(cancelEffect, 0xfeedface);
  input.x = 10; input.buttons = 1;
  call = startDrag(data, cancelSource, 3, cancelEffect);
  runToParkOrDone();
  write(cancelSource + 12, 0); // QueryContinueDrag S_OK on modifier change.
  input.control = true;
  resume();
  assert.deepStrictEqual(logValues(cancelLog), [30, 0x101, 1, 31, 0x101],
    'key-state change queries source, then DragOver and feedback');
  write(cancelSource + 12, 0x00040101);
  input.escape = true;
  resume();
  assert.strictEqual(e.get_eax() >>> 0, 0x00040101, 'source cancellation is propagated');
  assert.strictEqual(read(cancelEffect), 0xfeedface, 'cancellation leaves pdwEffect untouched');
  assert.deepStrictEqual(logValues(cancelLog), [30, 0x101, 1, 31, 0x101, 1, 32, 0x100],
    'cancel cleanup is DragLeave followed by GiveFeedback(DROPEFFECT_NONE)');
  checkEsp(call);
  assert.strictEqual(callApi('RevokeDragDrop', hwndA), 0);
  input.control = false; input.escape = false;

  // One balanced OleUninitialize leaves the nested OLE initialization active.
  callApi('OleUninitialize');
  const noTargetLog = makeLog();
  const noTargetSource = makeSource(noTargetLog);
  const noTargetEffect = alloc(4);
  write(noTargetEffect, 0x12345678);
  input.x = 300; input.buttons = 1;
  call = startDrag(data, noTargetSource, 3, noTargetEffect);
  runToParkOrDone();
  write(noTargetSource + 12, 0x00040100);
  input.buttons = 0;
  resume();
  assert.strictEqual(e.get_eax() >>> 0, 0x00040101,
    'release without an in-process target is truthful cancellation');
  assert.strictEqual(read(noTargetEffect), 0x12345678, 'no-target cancellation preserves output');
  assert.deepStrictEqual(logValues(noTargetLog), [0x100, 1],
    'empty space gets GiveFeedback(NONE) and source query only');
  checkEsp(call);

  callApi('OleUninitialize');
  call = startDrag(data, noTargetSource, 3, noTargetEffect);
  assert.strictEqual(e.get_eax() >>> 0, 0x8000ffff,
    'the final OleUninitialize disables DoDragDrop again');
  checkEsp(call);

  console.log('PASS  DoDragDrop OLE lifecycle, target negotiation, switching, drop, cancel, and stdcall');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
