#!/usr/bin/env node
'use strict';

// WH_KEYBOARD is not a window procedure: USER calls the installed thread hook
// while GetMessage/PeekMessage retrieves a hardware key, before returning the
// MSG to the application. Jazz Jackrabbit 2 keeps its entire private keyboard
// snapshot in this hook, so returning a plausible HHOOK without calling it
// makes every game key permanently up.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const apiTable = require('../src/api_table.json');

const ROOT = path.join(__dirname, '..');
const VK_ESCAPE = 0x1b;
const WM_KEYDOWN = 0x0100;
const KEY_LPARAM = 0x00010001; // repeat=1, Escape scan code=1

const extraWat = String.raw`
  (func (export "test_install_keyboard_hook") (param $proc i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookA
      (i32.const 2) (local.get $proc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_install_wide_hook")
      (param $id_hook i32) (param $proc i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookW
      (local.get $id_hook) (local.get $proc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_uninstall_legacy_hook")
      (param $id_hook i32) (param $proc i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_UnhookWindowsHook
      (local.get $id_hook) (local.get $proc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_install_ex_hook")
      (param $id_hook i32) (param $proc i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_SetWindowsHookExA
      (local.get $id_hook) (local.get $proc) (i32.const 0) (i32.const 1)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_uninstall_ex_hook") (param $hook i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_UnhookWindowsHookEx
      (local.get $hook) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_hook_proc") (param $id_hook i32) (result i32)
    (select
      (global.get $keyboard_hook_proc)
      (global.get $cbt_hook_proc)
      (i32.eq (local.get $id_hook) (i32.const 2))))

  (func (export "test_begin_keyboard_peek")
      (param $msg_ptr i32) (param $remove i32) (result i32)
    ;; A zero saved return lets the continuation stop the interpreter cleanly
    ;; after proving that it restored PeekMessage's caller and BOOL result.
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 64)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (call $handle_PeekMessageA
      (local.get $msg_ptr) (i32.const 0) (i32.const 0) (i32.const 0)
      (local.get $remove) (i32.const 0))
    (global.get $eip))

  (func (export "test_begin_keyboard_get") (param $msg_ptr i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.sub (i32.load offset=16 (global.get $reg_base)) (i32.const 64)))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0))
    (call $handle_GetMessageA
      (local.get $msg_ptr) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (global.get $eip))

  ;; Queue a key into this thread's shared posted queue, flagged as hardware
  ;; input (what $input_route_to_owner does when another thread's pump took
  ;; it) or as an ordinary PostMessage.
  (func (export "test_queue_key") (param $msg i32) (param $wparam i32)
      (param $lparam i32) (param $flags i32) (result i32)
    (call $post_queue_push_flags (i32.const 0) (local.get $msg)
      (local.get $wparam) (local.get $lparam) (local.get $flags)))

  (func (export "test_keyboard_hook_thunk") (result i32)
    (global.get $font_enum_ret_thunk))

  (func (export "test_make_api_thunk") (param $api_id i32) (result i32)
    (local $addr i32)
    (local.set $addr (i32.add (global.get $THUNK_BASE)
      (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $addr) (i32.const 0))
    (i32.store offset=4 (local.get $addr) (local.get $api_id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (i32.add (i32.sub (local.get $addr) (global.get $GUEST_BASE))
             (global.get $image_base)))
`;

function u32(value) {
  return [value, value >>> 8, value >>> 16, value >>> 24].map(v => v & 0xff);
}

(async () => {
  let pending = true;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      check_input: () => {
        if (!pending) return 0;
        pending = false;
        return ((VK_ESCAPE << 16) | WM_KEYDOWN) >>> 0;
      },
      check_input_hwnd: () => 0,
      check_input_lparam: () => KEY_LPARAM,
    },
  });
  const { exports: e, memory } = harness;

  // Loading a PE initializes the shared CACA0011 continuation thunk and gives
  // the injected x86 hook a normal guest-code mapping.
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes callback support');
  e.init_dx_com_thunks();

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const observed = e.guest_alloc(20) >>> 0;
  const olderHook = e.guest_alloc(64) >>> 0;
  const newerHook = e.guest_alloc(96) >>> 0;
  const selfRemovingHook = e.guest_alloc(96) >>> 0;
  const msg = e.guest_alloc(28) >>> 0;
  const callNextApi = apiTable.find(entry => entry.name === 'CallNextHookEx');
  const unhookExApi = apiTable.find(entry => entry.name === 'UnhookWindowsHookEx');
  assert(callNextApi, 'CallNextHookEx is registered');
  assert(unhookExApi, 'UnhookWindowsHookEx is registered');
  const callNextThunk = e.test_make_api_thunk(callNextApi.id) >>> 0;
  const unhookExThunk = e.test_make_api_thunk(unhookExApi.id) >>> 0;

  // The older KeyboardProc records the forwarded tuple and returns a
  // distinctive LRESULT. The newer proc calls CallNextHookEx with a bogus
  // HHOOK (the parameter is documented as ignored), records that exact
  // result, then returns another value. The USER continuation must still
  // restore PeekMessage's BOOL result.
  bytes.set(Uint8Array.from([
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4]  (nCode)
    0xa3, ...u32(observed),              // mov [observed],eax
    0x8b, 0x44, 0x24, 0x08,             // mov eax,[esp+8]  (wParam)
    0xa3, ...u32(observed + 4),
    0x8b, 0x44, 0x24, 0x0c,             // mov eax,[esp+12] (lParam)
    0xa3, ...u32(observed + 8),
    0xb8, ...u32(0x2468ace0),
    0xc2, 0x0c, 0x00,
  ]), toWasm(olderHook));

  bytes.set(Uint8Array.from([
    0x8b, 0x44, 0x24, 0x04,             // mov eax,[esp+4]  (nCode)
    0x8b, 0x4c, 0x24, 0x08,             // mov ecx,[esp+8]  (wParam)
    0x8b, 0x54, 0x24, 0x0c,             // mov edx,[esp+12] (lParam)
    0x52,                               // push edx
    0x51,                               // push ecx
    0x50,                               // push eax
    0x68, ...u32(0xdeadbeef),            // ignored hhk
    0xb8, ...u32(callNextThunk),         // mov eax,CallNextHookEx thunk
    0xff, 0xd0,                         // call eax
    0xa3, ...u32(observed + 12),         // record next hook's LRESULT
    0x83, 0xc0, 0x07,                   // return a different value
    0xc2, 0x0c, 0x00,
  ]), toWasm(newerHook));

  const olderHandle = e.test_install_keyboard_hook(olderHook) >>> 0;
  const newerHandle = e.test_install_ex_hook(2, newerHook) >>> 0;
  assert.notStrictEqual(olderHandle, 0,
    'SetWindowsHookA(WH_KEYBOARD) returns an opaque hook handle');
  assert.notStrictEqual(newerHandle, 0,
    'SetWindowsHookExA(WH_KEYBOARD) returns an opaque hook handle');
  assert.notStrictEqual(newerHandle, olderHandle,
    'each installed hook has a distinct handle');
  assert.strictEqual(e.test_hook_proc(2) >>> 0, newerHook,
    'the newest KeyboardProc is at the beginning of the chain');
  assert.notStrictEqual(e.test_keyboard_hook_thunk() >>> 0, 0,
    'generic callback continuation is initialized');
  assert.strictEqual(e.test_begin_keyboard_peek(msg, 1) >>> 0, newerHook,
    'PM_REMOVE enters the newest KeyboardProc before PeekMessage returns');
  assert.strictEqual(e.guest_read32(e.get_esp()) >>> 0,
    e.test_keyboard_hook_thunk() >>> 0,
    'the head KeyboardProc returns through the generic callback thunk');

  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(e.get_eip() >>> 0, 0,
    'KeyboardProc returns through the USER continuation to its caller');
  assert.strictEqual(e.get_eax() >>> 0, 1,
    'PeekMessage returns TRUE rather than the hook callback result');
  assert.deepStrictEqual([
    view.getUint32(toWasm(observed), true),
    view.getUint32(toWasm(observed + 4), true),
    view.getUint32(toWasm(observed + 8), true),
  ], [0, VK_ESCAPE, KEY_LPARAM],
  'CallNextHookEx forwards HC_ACTION, VK_ESCAPE, and the original key lParam');
  assert.strictEqual(view.getUint32(toWasm(observed + 12), true), 0x2468ace0,
    'CallNextHookEx returns the older hook procedure\'s exact LRESULT');
  assert.strictEqual(view.getUint32(toWasm(msg + 4), true), WM_KEYDOWN,
    'PeekMessage still returns WM_KEYDOWN in MSG');
  assert.strictEqual(view.getUint32(toWasm(msg + 8), true), VK_ESCAPE,
    'PeekMessage still returns VK_ESCAPE in MSG.wParam');
  assert.strictEqual(view.getUint32(toWasm(msg + 12), true), KEY_LPARAM,
    'PeekMessage preserves the hardware key flags in MSG.lParam');

  assert.strictEqual(e.test_uninstall_legacy_hook(2, olderHook + 4), 0,
    'UnhookWindowsHook rejects a different procedure');
  assert.strictEqual(e.test_hook_proc(2) >>> 0, newerHook,
    'a failed legacy unhook leaves the chain head installed');
  assert.strictEqual(e.test_uninstall_legacy_hook(2, olderHook), 1,
    'UnhookWindowsHook removes a matching non-head procedure');
  assert.strictEqual(e.test_hook_proc(2) >>> 0, newerHook,
    'removing an older hook preserves the newer chain head');
  assert.strictEqual(e.test_uninstall_legacy_hook(2, olderHook), 0,
    'UnhookWindowsHook rejects an already-removed procedure');

  pending = true;
  view.setUint32(toWasm(observed + 12), 0xffffffff, true);
  assert.strictEqual(e.test_begin_keyboard_peek(msg, 1) >>> 0, newerHook,
    'the remaining head still dispatches after a middle unlink');
  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(e.get_eip() >>> 0, 0,
    'a no-next CallNextHookEx path resumes the current hook synchronously');
  assert.strictEqual(view.getUint32(toWasm(observed + 12), true), 0,
    'CallNextHookEx returns zero when no next procedure remains');
  assert.strictEqual(e.test_uninstall_ex_hook(olderHandle), 0,
    'a stale opaque hook handle cannot remove another chain member');
  assert.strictEqual(e.test_uninstall_ex_hook(newerHandle), 1,
    'UnhookWindowsHookEx removes the exact remaining hook handle');
  assert.strictEqual(e.test_hook_proc(2), 0,
    'the empty keyboard chain is no longer dispatchable');

  // A procedure may remove itself while it is being called. USER unlinks it
  // immediately but cannot release the backing chain state until the outer
  // dispatch returns: CallNextHookEx must still find the older procedure.
  const selfOlderHandle = e.test_install_keyboard_hook(olderHook) >>> 0;
  const selfHandle = e.test_install_ex_hook(2, selfRemovingHook) >>> 0;
  bytes.set(Uint8Array.from([
    0x68, ...u32(selfHandle),             // push self HHOOK
    0xb8, ...u32(unhookExThunk),
    0xff, 0xd0,                          // UnhookWindowsHookEx(self)
    0xa3, ...u32(observed + 16),          // record BOOL
    0x8b, 0x44, 0x24, 0x04,
    0x8b, 0x4c, 0x24, 0x08,
    0x8b, 0x54, 0x24, 0x0c,
    0x52, 0x51, 0x50,
    0x6a, 0x00,                          // hhk=NULL is also ignored
    0xb8, ...u32(callNextThunk),
    0xff, 0xd0,
    0xa3, ...u32(observed + 12),
    0xc2, 0x0c, 0x00,
  ]), toWasm(selfRemovingHook));
  pending = true;
  view.setUint32(toWasm(observed + 12), 0xffffffff, true);
  view.setUint32(toWasm(observed + 16), 0, true);
  assert.strictEqual(e.test_begin_keyboard_peek(msg, 1) >>> 0, selfRemovingHook,
    'the self-removing hook begins as the newest chain member');
  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(e.get_eip() >>> 0, 0,
    'self-unhook plus nested CallNextHookEx unwinds safely');
  assert.strictEqual(view.getUint32(toWasm(observed + 16), true), 1,
    'an active hook can unlink its own opaque handle');
  assert.strictEqual(view.getUint32(toWasm(observed + 12), true), 0x2468ace0,
    'a self-unlinked hook can still delegate to the retained older node');
  assert.strictEqual(e.test_hook_proc(2) >>> 0, olderHook,
    'the unlinked active hook is gone when the dispatch completes');
  assert.strictEqual(e.test_uninstall_ex_hook(selfHandle), 0,
    'the self-unlinked handle is stale after callback retirement');
  assert.strictEqual(e.test_uninstall_ex_hook(selfOlderHandle), 1,
    'the older procedure remains independently removable');

  const wideCbtHandle = e.test_install_wide_hook(5, olderHook) >>> 0;
  const exCbtHandle = e.test_install_ex_hook(5, newerHook) >>> 0;
  assert.notStrictEqual(wideCbtHandle, 0,
    'SetWindowsHookW shares the CBT chain installation path');
  assert.notStrictEqual(exCbtHandle, wideCbtHandle,
    'multiple CBT hooks receive distinct handles');
  assert.strictEqual(e.test_hook_proc(5) >>> 0, newerHook,
    'the newest CBTProc is at the beginning of its independent chain');
  assert.strictEqual(e.test_uninstall_ex_hook(wideCbtHandle), 1,
    'UnhookWindowsHookEx removes an older CBT hook by exact handle');
  assert.strictEqual(e.test_hook_proc(5) >>> 0, newerHook,
    'removing the older CBT hook preserves its chain head');
  assert.strictEqual(e.test_uninstall_legacy_hook(5, newerHook), 1,
    'the legacy remover clears the remaining matching CBTProc');

  assert.strictEqual(e.test_install_keyboard_hook(0), 0,
    'a null legacy hook procedure fails instead of returning a fake handle');
  assert.strictEqual(e.test_install_wide_hook(3, olderHook), 0,
    'an unsupported legacy hook class fails instead of returning a fake handle');

  // A hardware key that reached this thread through the shared posted queue
  // (a sibling thread's pump took it from the host and routed it here) still
  // runs this thread's WH_KEYBOARD. Moorhuhn's hook is the game's only key
  // source: with the main thread in a Worker the keyup was routed by its
  // WinSock thread and skipped the hook, so Space stayed down forever.
  const WM_KEYUP = 0x0101;
  const WM_KEYDOWN_POSTED_LPARAM = 0x00390001;
  const KEYUP_LPARAM = 0xc0390001; // transition + previous state, Space scan
  const routedHandle = e.test_install_ex_hook(2, olderHook) >>> 0;
  assert.notStrictEqual(routedHandle, 0, 'a fresh keyboard hook installs');
  const resetObserved = () => {
    for (let i = 0; i < 3; i++) view.setUint32(toWasm(observed + i * 4), 0xffffffff, true);
  };
  const observedTuple = () => [0, 4, 8].map(off => view.getUint32(toWasm(observed + off), true));

  pending = false;
  resetObserved();
  assert.strictEqual(e.test_queue_key(WM_KEYUP, 0x20, KEYUP_LPARAM, 1), 1,
    'a routed hardware keyup enters the shared queue');
  assert.strictEqual(e.test_begin_keyboard_peek(msg, 1) >>> 0, olderHook,
    'PeekMessage(PM_REMOVE) of a routed hardware key enters KeyboardProc');
  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(e.get_eip() >>> 0, 0, 'the routed-key hook returns to the caller');
  assert.strictEqual(e.get_eax() >>> 0, 1, 'PeekMessage still returns TRUE');
  assert.deepStrictEqual(observedTuple(), [0, 0x20, KEYUP_LPARAM],
    'the hook sees HC_ACTION and the routed keyup\'s own lParam (transition bit set)');
  assert.strictEqual(view.getUint32(toWasm(msg + 4), true), WM_KEYUP,
    'PeekMessage returns the routed WM_KEYUP');

  resetObserved();
  e.test_queue_key(WM_KEYUP, 0x20, KEYUP_LPARAM, 1);
  assert.strictEqual(e.test_begin_keyboard_peek(msg, 0) >>> 0, olderHook,
    'PM_NOREMOVE also enters KeyboardProc');
  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.deepStrictEqual(observedTuple(), [3, 0x20, KEYUP_LPARAM],
    'a peek that leaves the key queued reports HC_NOREMOVE');

  resetObserved();
  assert.strictEqual(e.test_begin_keyboard_get(msg) >>> 0, olderHook,
    'GetMessage of the still-queued routed key enters KeyboardProc');
  for (let i = 0; i < 20 && e.get_eip(); i++) e.run(5000);
  assert.strictEqual(e.get_eip() >>> 0, 0, 'the GetMessage hook returns to the caller');
  assert.strictEqual(e.get_eax() >>> 0, 1, 'GetMessage returns TRUE for a key');
  assert.deepStrictEqual(observedTuple(), [0, 0x20, KEYUP_LPARAM],
    'GetMessage runs the hook with HC_ACTION');

  // PostMessage(WM_KEYDOWN) is not hardware input: USER does not run
  // WH_KEYBOARD for it.
  resetObserved();
  e.test_queue_key(WM_KEYDOWN, 0x20, WM_KEYDOWN_POSTED_LPARAM, 0);
  e.test_begin_keyboard_peek(msg, 1);
  assert.strictEqual(e.get_eip() >>> 0, 0, 'a posted key does not redirect into the hook');
  assert.deepStrictEqual(observedTuple(), [0xffffffff, 0xffffffff, 0xffffffff],
    'a posted WM_KEYDOWN does not reach KeyboardProc');
  assert.strictEqual(view.getUint32(toWasm(msg + 4), true), WM_KEYDOWN,
    'the posted WM_KEYDOWN is still retrieved');
  assert.strictEqual(e.test_uninstall_ex_hook(routedHandle), 1, 'routed-key hook removes');

  console.log('PASS  legacy and Ex keyboard/CBT hook chains install, delegate, and unhook');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
