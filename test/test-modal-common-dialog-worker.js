#!/usr/bin/env node
'use strict';

// Browser Worker mode has two WebAssembly instances over one process memory:
// the guest Worker owns the parked MessageBox call, while the main-thread
// renderer shadow hit-tests and dispatches its WAT-built button. Private WASM
// globals cannot carry modal completion between those instances.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_seed_completion") (param $seed i32)
    (global.set $modal_result (local.get $seed))
    (global.set $modal_ret_addr (i32.add (i32.const 0x401000) (local.get $seed)))
    (global.set $modal_saved_esp (i32.add (i32.const 0x120000) (local.get $seed)))
    (global.set $modal_esp_adjust (i32.add (i32.const 20) (local.get $seed)))
    (global.set $modal_restore_pending (i32.eqz (local.get $seed)))
    (global.set $modal_saved_ebx (i32.add (i32.const 11) (local.get $seed)))
    (global.set $modal_saved_esi (i32.add (i32.const 22) (local.get $seed)))
    (global.set $modal_saved_edi (i32.add (i32.const 33) (local.get $seed)))
    (global.set $modal_saved_ebp (i32.add (i32.const 44) (local.get $seed))))
  (func (export "test_restore_pending") (result i32) (global.get $modal_restore_pending))
  (func (export "test_complete_api")
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA0006))
    (call $win32_dispatch (i32.const 0)))
  (func (export "test_modal_begin") (param $hwnd i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00120000))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00401000))
    (call $modal_begin (local.get $hwnd) (i32.const 20)))

  (func (export "test_modal_done") (param $result i32)
    (call $modal_done (local.get $result)))

  (func (export "test_modal_pump") (result i32)
    (call $modal_pump_step (global.get $modal_loop_thunk)))

  (func (export "test_modal_result") (result i32)
    (global.get $modal_result))
`;

(async () => {
  const memory = new WebAssembly.Memory({
    initial: 8192, maximum: 8192, shared: true,
  });
  let onDestroy = () => {};
  const worker = await bootRenderHarness({ extraWat, memory,
    extraHostOverrides: { destroy_window: hwnd => onDestroy(hwnd) } });
  const shadow = await bootRenderHarness({ extraWat, memory });
  const guest = worker.exports;
  const ui = shadow.exports;
  const hwnd = 0x10002;

  guest.test_modal_begin(hwnd);
  assert.strictEqual(guest.modal_dialog_hwnd() >>> 0, hwnd,
    'guest Worker publishes its common-modal hwnd');
  assert.strictEqual(ui.modal_dialog_hwnd() >>> 0, hwnd,
    'renderer shadow observes the Worker modal through shared memory');

  assert.strictEqual(guest.test_modal_pump(), 1, 'open modal remains in its pump');
  assert.strictEqual(guest.get_yield_reason(), 15, 'idle native modal uses queue sleep');
  guest.clear_yield();

  ui.test_modal_done(1);
  assert.strictEqual(ui.modal_dialog_hwnd() >>> 0, hwnd,
    'shadow only signals completion; the owning Worker performs teardown');
  assert.strictEqual(guest.test_modal_pump(), 0,
    'owning Worker consumes the shared completion on its next pump turn');
  assert.strictEqual(guest.test_modal_result(), 1,
    'MessageBox returns the button result in the owning instance');
  assert.strictEqual(guest.modal_dialog_hwnd(), 0,
    'Worker teardown clears the shared modal hwnd for the renderer');

  guest.test_modal_begin(hwnd);
  ui.modal_cancel_if_hwnd(hwnd);
  assert.strictEqual(guest.test_modal_pump(), 0,
    'renderer-side modal cancellation also resumes the owning Worker');
  assert.strictEqual(guest.test_modal_result(), 0,
    'renderer-side cancellation preserves the cancel result');

  // A reentrant teardown can finish another dialog on the same instance.
  // Inject its continuation writes, then exercise the actual CACA0006 return.
  for (const fromShadow of [false, true]) {
    guest.test_modal_begin(hwnd);
    guest.test_seed_completion(0);
    let reentries = 0;
    onDestroy = target => {
      assert.strictEqual(target >>> 0, hwnd);
      reentries++;
      guest.test_seed_completion(256);
    };
    (fromShadow ? ui : guest).test_modal_done(42);
    if (fromShadow) assert.strictEqual(guest.test_modal_pump(), 0);
    assert.strictEqual(reentries, 1);
    assert.strictEqual(guest.test_modal_result(), 42, 'outer completion owns the result');
    assert.strictEqual(guest.test_restore_pending(), 1, 'outer restore marker survives reentry');
    guest.test_complete_api();
    assert.strictEqual(guest.get_eax(), 42);
    assert.strictEqual(guest.get_eip(), 0x401000);
    assert.strictEqual(guest.get_esp(), 0x120000 + 20);
    assert.deepStrictEqual([guest.get_ebx(), guest.get_esi(), guest.get_edi(), guest.get_ebp()],
      [11, 22, 33, 44], 'outer nonvolatile registers survive nested completion');
    assert.strictEqual(guest.test_restore_pending(), 0);
  }
  console.log('PASS  common modal Worker completion and reentrant API frame ownership');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
