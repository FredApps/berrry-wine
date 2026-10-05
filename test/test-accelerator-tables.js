#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_accel_create") (param $source i32) (param $count i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateAcceleratorTableA
      (local.get $source) (local.get $count) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_create_w") (param $source i32) (param $count i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CreateAcceleratorTableW
      (local.get $source) (local.get $count) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_destroy") (param $handle i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DestroyAcceleratorTable
      (local.get $handle) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_copy")
      (param $handle i32) (param $dest i32) (param $capacity i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CopyAcceleratorTableW
      (local.get $handle) (local.get $dest) (local.get $capacity)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_copy_a")
      (param $handle i32) (param $dest i32) (param $capacity i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CopyAcceleratorTableA
      (local.get $handle) (local.get $dest) (local.get $capacity)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_load_data")
      (param $data_guest i32) (param $count i32) (result i32)
    (if (result i32) (local.get $data_guest)
      (then (call $accel_table_load
        (call $g2w (local.get $data_guest)) (local.get $count)))
      (else (call $accel_table_load (i32.const 0) (local.get $count)))))

  (func (export "test_accel_match")
      (param $handle i32) (param $vkey i32) (param $modifiers i32) (result i32)
    (call $accel_table_match
      (local.get $handle) (local.get $vkey)
      (i32.and (local.get $modifiers) (i32.const 1))
      (i32.and (local.get $modifiers) (i32.const 2))
      (i32.and (local.get $modifiers) (i32.const 4))))

  (func (export "test_accel_translate")
      (param $hwnd i32) (param $handle i32) (param $msg i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_TranslateAcceleratorA
      (local.get $hwnd) (local.get $handle) (local.get $msg)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_accel_window") (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (global.get $WNDPROC_CTRL_NATIVE))
    (local.get $hwnd))

  ;; A top-level window whose wndproc is x86 guest code, owned by no thread.
  (func (export "test_accel_x86_window") (param $wndproc i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd) (local.get $wndproc))
    (local.get $hwnd))

  ;; TranslateAcceleratorA entered the way the guest calls it: a live stdcall
  ;; frame [ret][hwnd][haccel][lpMsg] at ESP. Leaves EIP/ESP as the handler
  ;; set them so the test can read the frame it built.
  (func (export "test_accel_translate_frame")
      (param $hwnd i32) (param $handle i32) (param $msg i32) (param $ret i32)
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 16)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (local.get $ret))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 4)) (local.get $hwnd))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 8)) (local.get $handle))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 12)) (local.get $msg))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x55555555))
    (global.set $eip (i32.const 0))
    (call $handle_TranslateAcceleratorA
      (local.get $hwnd) (local.get $handle) (local.get $msg)
      (i32.const 0) (i32.const 0) (i32.const 0)))

  ;; The wndproc's stdcall RET 16 lands on the return thunk (CACA0011).
  (func (export "test_accel_wndproc_return") (param $lresult i32)
    (local $thunk i32)
    (local.set $thunk (call $gl32 (i32.load offset=16 (global.get $reg_base))))
    (i32.store offset=16 (global.get $reg_base) (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 20)))
    (i32.store offset=0 (global.get $reg_base) (local.get $lresult))
    (call $win32_dispatch
      (i32.shr_u (i32.sub (local.get $thunk) (global.get $thunk_guest_base))
                 (i32.const 3))))

  ;; No PE is loaded here, so allocate the one CACA0011 thunk the way
  ;; $load_pe does, unless a loader already has.
  (func (export "test_accel_ret_thunk") (result i32)
    (if (i32.eqz (global.get $font_enum_ret_thunk))
      (then
        (global.set $thunk_guest_base
          (i32.add (i32.sub (global.get $THUNK_BASE) (global.get $GUEST_BASE))
                   (global.get $image_base)))
        (global.set $font_enum_ret_thunk
          (i32.add (global.get $thunk_guest_base)
                   (i32.mul (global.get $num_thunks) (i32.const 8))))
        (i32.store (i32.add (global.get $THUNK_BASE)
                            (i32.mul (global.get $num_thunks) (i32.const 8)))
          (i32.const 0xCACA0011))
        (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))))
    (global.get $font_enum_ret_thunk))
  (func (export "test_accel_eip") (result i32) (global.get $eip))
  (func (export "test_accel_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_accel_eax") (result i32) (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_accel_set_esp") (param $v i32) (i32.store offset=16 (global.get $reg_base) (local.get $v)))
  (func (export "test_accel_read32") (param $guest i32) (result i32)
    (call $gl32 (local.get $guest)))

  (func (export "test_accel_post_count") (result i32)
    (global.get $post_queue_count))

  (func (export "test_accel_read16") (param $guest i32) (result i32)
    (call $gl16 (local.get $guest)))
`;

function writeAccel(wat, base, index, flags, key, command) {
  const entry = base + index * 6;
  wat.guest_write8(entry, flags);
  wat.guest_write8(entry + 1, 0xcc);
  wat.guest_write16(entry + 2, key);
  wat.guest_write16(entry + 4, command);
}

function readAccel(wat, base, index) {
  const entry = base + index * 6;
  return {
    flags: wat.guest_read8(entry),
    padding: wat.guest_read8(entry + 1),
    key: wat.test_accel_read16(entry + 2),
    command: wat.test_accel_read16(entry + 4),
  };
}

(async () => {
  const { exports: wat, renderer } = await bootRenderHarness({ extraWat });

  const firstSource = wat.guest_alloc(24) >>> 0;
  writeAccel(wat, firstSource, 0, 0x09, 0x42, 0x1234); // Ctrl+B, virtual key
  writeAccel(wat, firstSource, 1, 0x00, 0x71, 0x2222); // lowercase q
  writeAccel(wat, firstSource, 2, 0x00, 0x51, 0x3333); // uppercase Q
  writeAccel(wat, firstSource, 3, 0x08, 0x03, 0x4444); // Ctrl+C character

  assert.strictEqual(wat.test_accel_create(0, 1), 0,
    'CreateAcceleratorTable rejects a null ACCEL array');
  assert.strictEqual(wat.test_accel_create(firstSource, 0), 0,
    'CreateAcceleratorTable requires at least one entry');
  assert.strictEqual(wat.test_accel_create(firstSource, -1), 0,
    'CreateAcceleratorTable rejects a negative entry count');
  assert.strictEqual(wat.test_accel_create(firstSource, 32768), 0,
    'CreateAcceleratorTable enforces the documented 32767-entry limit');

  const first = wat.test_accel_create(firstSource, 4) >>> 0;
  assert(first >= 0x00600002, 'a valid dynamic table receives a repository handle');

  const secondSource = wat.guest_alloc(6) >>> 0;
  writeAccel(wat, secondSource, 0, 0x01, 0x71, 0x7777); // F2
  const second = wat.test_accel_create(secondSource, 1) >>> 0;
  assert(second && second !== first, 'multiple accelerator tables coexist');

  const wide = wat.test_accel_create_w(secondSource, 1) >>> 0;
  assert(wide && wide !== first && wide !== second,
    'CreateAcceleratorTableW reaches the shared repository with a distinct handle');

  assert.strictEqual(wat.test_accel_copy(first, 0, 0), 4,
    'a null CopyAcceleratorTable destination queries the original count');
  const copied = wat.guest_alloc(24) >>> 0;
  for (let offset = 0; offset < 24; offset++) wat.guest_write8(copied + offset, 0xaa);
  assert.strictEqual(wat.test_accel_copy(first, copied, 2), 2,
    'CopyAcceleratorTable bounds the copy by caller capacity');
  assert.deepStrictEqual(readAccel(wat, copied, 0),
    { flags: 0x09, padding: 0, key: 0x42, command: 0x1234 });
  assert.deepStrictEqual(readAccel(wat, copied, 1),
    { flags: 0x00, padding: 0, key: 0x71, command: 0x2222 });
  assert.strictEqual(wat.test_accel_copy_a(wide, copied, 1), 1,
    'CopyAcceleratorTableA shares the bounded copy contract');
  assert.deepStrictEqual(readAccel(wat, copied, 0),
    { flags: 0x01, padding: 0, key: 0x71, command: 0x7777 });
  assert.strictEqual(wat.guest_read8(copied + 12), 0xaa,
    'CopyAcceleratorTable does not write a third entry past capacity');
  assert.strictEqual(wat.test_accel_copy(first, copied, -1), 0,
    'a negative destination capacity copies no entries');
  assert.strictEqual(wat.test_accel_copy(0x7fffffff, copied, 4), 0,
    'CopyAcceleratorTable rejects an unknown handle');

  assert.strictEqual(wat.test_accel_match(first, 0x42, 2), 0x00011234,
    'the selected table matches its Ctrl+B virtual-key accelerator');
  assert.strictEqual(wat.test_accel_match(first, 0x42, 0), 0,
    'modifier requirements are exact');
  assert.strictEqual(wat.test_accel_match(second, 0x71, 0), 0x00017777,
    'a second handle selects a different table');
  assert.strictEqual(wat.test_accel_match(first, 0x51, 0), 0x00012222,
    'a lowercase character accelerator maps to an unshifted virtual key');
  assert.strictEqual(wat.test_accel_match(first, 0x51, 1), 0x00013333,
    'an uppercase character accelerator requires Shift');
  assert.strictEqual(wat.test_accel_match(first, 0x43, 2), 0x00014444,
    'control-character accelerators map to Ctrl+A through Ctrl+Z');

  const resourceData = wat.guest_alloc(8) >>> 0;
  wat.guest_write16(resourceData, 0x01);
  wat.guest_write16(resourceData + 2, 0x70);
  wat.guest_write16(resourceData + 4, 0x5151);
  wat.guest_write16(resourceData + 6, 0);
  const loadedOnce = wat.test_accel_load_data(resourceData, 1) >>> 0;
  const loadedTwice = wat.test_accel_load_data(resourceData, 1) >>> 0;
  assert(loadedOnce && loadedOnce === loadedTwice,
    'reloading one resource reuses its HACCEL and increments its reference count');
  assert.strictEqual(wat.test_accel_load_data(0, 1), 0,
    'a missing accelerator resource returns NULL');
  assert.strictEqual(wat.test_accel_destroy(loadedOnce), 0,
    'the first destroy of a twice-loaded resource reports it is still referenced');
  assert.strictEqual(wat.test_accel_copy(loadedOnce, 0, 0), 1,
    'the resource table remains live until its final reference is destroyed');
  assert.strictEqual(wat.test_accel_destroy(loadedOnce), 1,
    'the balanced destroy releases the resource handle');
  assert.strictEqual(wat.test_accel_copy(loadedOnce, 0, 0), 0,
    'a released resource handle is invalid');

  const msg = wat.guest_alloc(28) >>> 0;
  const hwnd = wat.test_accel_window() >>> 0;
  wat.guest_write32(msg, hwnd);
  wat.guest_write32(msg + 4, 0x0100); // WM_KEYDOWN
  wat.guest_write32(msg + 8, 0x42);   // B
  renderer.pokeKeyDownState(0x11, true);
  const queuedBefore = wat.test_accel_post_count();
  assert.strictEqual(wat.test_accel_translate(hwnd, first, msg), 1,
    'TranslateAccelerator consumes a matching key message');
  assert.strictEqual(wat.test_accel_post_count(), queuedBefore,
    'TranslateAccelerator sends synchronously instead of queuing WM_COMMAND');
  renderer.pokeKeyDownState(0x11, false);
  wat.guest_write32(msg + 4, 0x0101); // WM_KEYUP is not translated
  assert.strictEqual(wat.test_accel_translate(hwnd, first, msg), 0);
  assert.strictEqual(wat.test_accel_translate(hwnd, 0x7fffffff, msg), 0,
    'TranslateAccelerator rejects an unknown HACCEL');

  // Alt on WM_SYSKEYDOWN is the message's own context bit (lParam bit 29),
  // not the live key state: in a browser all four of Alt+L's events can be
  // queued before the guest pumps, so Alt already reads up by then.
  const altSource = wat.guest_alloc(6) >>> 0;
  writeAccel(wat, altSource, 0, 0x11, 0x4c, 0x5555); // FVIRTKEY|FALT, Alt+L
  const altTable = wat.test_accel_create(altSource, 1) >>> 0;
  wat.guest_write32(msg, hwnd);
  wat.guest_write32(msg + 4, 0x0104); // WM_SYSKEYDOWN
  wat.guest_write32(msg + 8, 0x4c);
  wat.guest_write32(msg + 12, 0x20000001);
  assert.strictEqual(wat.test_accel_translate(hwnd, altTable, msg), 1,
    'Alt+L matches from lParam bit 29 after Alt has been released');
  wat.guest_write32(msg + 12, 0x00000001);
  renderer.pokeKeyDownState(0x12, true);
  assert.strictEqual(wat.test_accel_translate(hwnd, altTable, msg), 0,
    'a WM_SYSKEYDOWN without the context bit (F10-style) is not an Alt key');
  renderer.pokeKeyDownState(0x12, false);
  wat.guest_write32(msg + 12, 0);
  assert.strictEqual(wat.test_accel_destroy(altTable), 1);

  // An x86 wndproc gets WM_COMMAND as a real guest call, not a nested run:
  // a nested run cannot block, so a handler that waits on another thread
  // (StarCraft's F1 Help, reading rez\helpmenu.bin through Storm's reader
  // thread) had its wait return early and took the game's fatal-error exit.
  const thunk = wat.test_accel_ret_thunk() >>> 0;
  assert(thunk, 'the accelerator continuation thunk is allocated');
  const WNDPROC = 0x00401234;
  const RET = 0x00405678;
  const x86Hwnd = wat.test_accel_x86_window(WNDPROC) >>> 0;
  wat.guest_write32(msg, x86Hwnd);
  wat.guest_write32(msg + 4, 0x0100); // WM_KEYDOWN
  wat.guest_write32(msg + 8, 0x42);   // Ctrl+B -> 0x1234
  renderer.pokeKeyDownState(0x11, true);
  const espBefore = wat.test_accel_esp() >>> 0;
  wat.test_accel_translate_frame(x86Hwnd, first, msg, RET);
  renderer.pokeKeyDownState(0x11, false);
  assert.strictEqual(wat.test_accel_eip() >>> 0, WNDPROC,
    'TranslateAccelerator enters the x86 wndproc directly');
  const esp = wat.test_accel_esp() >>> 0;
  assert.strictEqual(esp, (espBefore - 16 + 16 - 28) >>> 0,
    'the API frame is replaced by the wndproc call and its TACC context');
  assert.deepStrictEqual(
    [0, 4, 8, 12, 16, 20, 24].map(o => wat.test_accel_read32(esp + o) >>> 0),
    [thunk, x86Hwnd, 0x0111, 0x00011234, 0, 0x43434154, RET],
    'wndproc(hwnd, WM_COMMAND, MAKEWPARAM(id, 1), 0) returns into TACC');
  assert.strictEqual(wat.test_accel_post_count(), queuedBefore,
    'nothing is queued for the x86 path either');
  wat.test_accel_wndproc_return(0);
  assert.strictEqual(wat.test_accel_eip() >>> 0, RET,
    'the continuation resumes the TranslateAccelerator caller');
  assert.strictEqual(wat.test_accel_esp() >>> 0, espBefore,
    'the caller sees its three stdcall arguments popped');
  assert.strictEqual(wat.test_accel_eax(), 1,
    'TranslateAccelerator returns TRUE whatever LRESULT the wndproc gave');
  wat.test_accel_set_esp(espBefore);

  assert.strictEqual(wat.test_accel_destroy(0x7fffffff), 0,
    'DestroyAcceleratorTable rejects an unknown handle');
  assert.strictEqual(wat.test_accel_destroy(first), 1,
    'DestroyAcceleratorTable releases a dynamic table');
  assert.strictEqual(wat.test_accel_copy(first, 0, 0), 0,
    'a destroyed dynamic handle is invalid');
  assert.strictEqual(wat.test_accel_copy(second, 0, 0), 1,
    'destroying one table does not disturb another');
  assert.strictEqual(wat.test_accel_destroy(second), 1);
  assert.strictEqual(wat.test_accel_destroy(wide), 1);

  console.log('test-accelerator-tables: ok');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
