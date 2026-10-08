#!/usr/bin/env node
'use strict';
// A LoadLibraryA inside a synchronous send ($wnd_send_message: CreateDialog's
// WM_INITDIALOG, SendMessage, UpdateWindow's WM_PAINT). The handler yields
// (reason 5) for the host to map the DLL, and a nested send cannot return to
// the host's loop, so every later $run round stopped on the same yield until
// the 64-round cap abandoned the procedure with LoadLibraryA "returning" a
// stack address. Diablo's Select Connection dialog loads every *.snp from
// WM_INITDIALOG and rendered entirely black for exactly this reason.
//
// The send now asks the host (service_load_library) to finish the load in
// place, as it already does for a LoadLibraryA inside a DllMain. A host that
// cannot (bytes need I/O, or a Worker-side instance) answers 0 and the old
// bounded behaviour stands.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const extraWat = `
  (func (export "test_window") (param $proc i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $h) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $h) (i32.const 0)
      (i32.const 0) (i32.const 32) (i32.const 24) (i32.const 0))
    (call $wnd_table_set (local.get $h) (local.get $proc))
    (drop (call $wnd_set_style (local.get $h) (i32.const 0x90000000)))
    (local.get $h))
  (func (export "test_send_completed") (result i32) (global.get $wnd_send_completed))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
`;

const u32 = v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => b & 255);
const MODULE = 0x10000000;

(async () => {
  let e = null;
  let serviceCalls = 0;
  let canService = true;
  const { exports } = await bootRenderHarness({ extraWat, fonts: 'none', extraHostOverrides: {
    // The DLL "exists", so LoadLibraryA takes the yield path.
    has_dll_file: () => 1,
    // What serviceLoadLibraryYieldSync leaves behind: the handler already
    // popped the argument and parked EIP on the return address, so finishing
    // the load is the module handle in EAX and the yield cleared.
    service_load_library: () => {
      serviceCalls++;
      if (!canService) return 0;
      assert.strictEqual(e.get_yield_reason(), 5, 'asked only for a pending LoadLibrary yield');
      e.set_eax(MODULE);
      e.clear_yield();
      return 1;
    },
  } });
  e = exports;
  const loadLibrary = e.test_thunk(apiTable.findIndex(a => a.name === 'LoadLibraryA'));
  assert(loadLibrary, 'LoadLibraryA thunk');
  const name = e.guest_alloc(16);
  'net.snp\0'.split('').forEach((c, i) => e.guest_write8(name + i, c.charCodeAt(0)));
  const seen = e.guest_alloc(4);

  const proc = bytes => {
    const at = e.guest_alloc(bytes.length);
    bytes.forEach((b, i) => e.guest_write8(at + i, b));
    return at;
  };
  // push name; mov eax,LoadLibraryA; call eax; mov [seen],eax;
  // mov eax,0x1234; ret 16
  const loader = proc([
    0x68, ...u32(name), 0xb8, ...u32(loadLibrary), 0xff, 0xd0,
    0xa3, ...u32(seen),
    0xb8, ...u32(0x1234), 0xc2, 0x10, 0x00,
  ]);

  e.guest_write32(seen, 0xdeadbeef);
  const h = e.test_window(loader);
  const result = e.send_message(h, 0x0110, 0, 0);   // WM_INITDIALOG
  assert.strictEqual(serviceCalls, 1, 'the host was asked once');
  assert.strictEqual(e.guest_read32(seen) >>> 0, MODULE, 'LoadLibraryA returned the module the host mapped');
  assert.strictEqual(result >>> 0, 0x1234, 'the procedure ran to its own return');
  assert.strictEqual(e.test_send_completed(), 1, 'the send completed rather than being abandoned');
  assert.strictEqual(e.get_sync_msg_depth(), 0, 'send depth is restored');
  console.log('ok: LoadLibraryA inside a synchronous send is finished in place');

  // A host that cannot finish the load keeps the old, bounded behaviour.
  canService = false;
  serviceCalls = 0;
  e.guest_write32(seen, 0xdeadbeef);
  e.send_message(e.test_window(loader), 0x0110, 0, 0);
  assert.strictEqual(e.test_send_completed(), 0, 'an unserviceable load still ends the send');
  assert.strictEqual(e.guest_read32(seen) >>> 0, 0xdeadbeef, 'and the procedure never resumed');
  assert(serviceCalls >= 1, 'the host was asked');
  assert.strictEqual(e.get_sync_msg_depth(), 0, 'send depth is restored after abandoning');
  console.log('ok: a load the host cannot finish is abandoned at the round cap, as before');
  console.log('PASS test-sync-send-loadlibrary');
})().catch(err => { console.error(err); process.exit(1); });
