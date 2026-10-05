#!/usr/bin/env node

'use strict';

// CloseWindow/OpenIcon are a paired USER transition. The former makes the
// window iconic without destroying it; the latter asks WM_QUERYOPEN before
// restoring and activating it. Both browser and guest-visible state must move
// together.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const ROOT = path.join(__dirname, '..');
const extraWat = String.raw`
  (func (export "test_mouse_default") (param $h i32) (param $top i32) (param $lp i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DefWindowProcA (local.get $h) (i32.const 0x21) (local.get $top)
      (local.get $lp) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load (global.get $reg_base)))
  (func (export "test_mouse_parent") (param $h i32) (param $p i32) (param $style i32)
    (call $wnd_set_parent (local.get $h) (local.get $p))
    (drop (call $wnd_set_style (local.get $h) (local.get $style))))
  (func (export "test_thunk") (param $id i32) (result i32)
    (local $p i32)
    (global.set $thunk_guest_base (call $w2g (global.get $THUNK_BASE)))
    (local.set $p (i32.add (global.get $THUNK_BASE) (i32.mul (global.get $num_thunks) (i32.const 8))))
    (i32.store (local.get $p) (i32.const 0))
    (i32.store offset=4 (local.get $p) (local.get $id))
    (global.set $num_thunks (i32.add (global.get $num_thunks) (i32.const 1)))
    (call $update_thunk_end)
    (call $w2g (local.get $p)))
  (func (export "test_live") (param $h i32) (result i32)
    (i32.ge_s (call $wnd_table_find (local.get $h)) (i32.const 0)))
  (func (export "test_sys") (param $h i32) (param $sc i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (call $handle_DefWindowProcA (local.get $h) (i32.const 0x0112) (local.get $sc)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved)))
  (func (export "test_make_icon_window") (param $proc i32) (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $hwnd)
      (select (local.get $proc) (global.get $WNDPROC_BUILTIN)
        (i32.ne (local.get $proc) (i32.const 0))))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x10CF0000)))
    (local.get $hwnd))

  (func (export "test_close_window") (param $hwnd i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (call $handle_CloseWindow
      (local.get $hwnd) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_open_icon") (param $hwnd i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (call $handle_OpenIcon
      (local.get $hwnd) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_def_query_open") (param $wide i32) (result i32)
    (local $saved i32)
    (local.set $saved (i32.load offset=16 (global.get $reg_base)))
    (if (local.get $wide)
      (then (call $handle_DefWindowProcW
        (i32.const 0) (i32.const 0x0013) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0)))
      (else (call $handle_DefWindowProcA
        (i32.const 0) (i32.const 0x0013) (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0))))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_set_active_raw") (param $hwnd i32)
    (global.set $active_hwnd (local.get $hwnd))
    (global.set $focus_hwnd (local.get $hwnd)))
  (func (export "test_set_max_raw") (param $hwnd i32) (param $value i32)
    (call $wnd_max_set (local.get $hwnd) (local.get $value)))
  (func (export "test_min") (param $hwnd i32) (result i32)
    (call $wnd_min_get (local.get $hwnd)))
  (func (export "test_max") (param $hwnd i32) (result i32)
    (call $wnd_max_get (local.get $hwnd)))
  (func (export "test_active") (result i32) (global.get $active_hwnd))
  (func (export "test_last_error") (result i32) (global.get $last_error))
`;

const u32 = value => [value, value >>> 8, value >>> 16, value >>> 24]
  .map(byte => byte & 0xff);

(async () => {
  const hostCalls = [];
  const rendererHwnd = 0x70001;
  const { exports: e, memory } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      sys_command(hwnd, command) {
        hostCalls.push(['sys', hwnd >>> 0, command >>> 0]);
      },
      activate_window(hwnd) {
        hostCalls.push(['activate', hwnd >>> 0]);
        return 1;
      },
      get_window_info: (hwnd, prop) =>
        ((hwnd >>> 0) === rendererHwnd && prop === 4 ? 1 : 0),
      invalidate_frame() {},
    },
  });

  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE initializes synchronous wndproc dispatch');
  e.init_dx_com_thunks();

  assert.strictEqual(e.test_def_query_open(0), 1,
    'DefWindowProcA must permit WM_QUERYOPEN by default');
  assert.strictEqual(e.test_def_query_open(1), 1,
    'DefWindowProcW must permit WM_QUERYOPEN by default');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;
  const mouseChild = e.test_make_icon_window(0);
  for (const hit of [1, 2, 3, 8, 9]) for (const msg of [0x201, 0x204, 0xa1]) {
    assert.strictEqual(e.test_mouse_default(mouseChild, mouseChild, (msg << 16) | hit),
      hit === 2 && msg === 0x201 ? 3 : 1, `native default hit=${hit} msg=${msg}`);
  }
  const mouseRecord = e.guest_alloc(20);
  for (const answer of [0, 1, 2, 3, 4, 0x10000]) {
    const proc = e.guest_alloc(64);
    const code = [];
    const dword = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
    // Record actual stdcall args before returning the selected LONG.
    for (let i = 0; i < 4; i++) code.push(0x8b, 0x44, 0x24, 4 + i * 4,
      0xa3, ...dword(mouseRecord + i * 4));
    code.push(0xff, 0x05, ...dword(mouseRecord + 16), 0xb8, ...dword(answer), 0xc2, 16, 0);
    new Uint8Array(memory.buffer).set(code, toWasm(proc));
    const parent = e.test_make_icon_window(proc);
    for (const hit of [1, 2]) {
      new Uint8Array(memory.buffer).fill(0, toWasm(mouseRecord), toWasm(mouseRecord) + 20);
      e.test_mouse_parent(mouseChild, parent, 0x50000000);
      const lp = 0x02010000 | hit;
      assert.strictEqual(e.test_mouse_default(mouseChild, parent, lp), answer || (hit === 2 ? 3 : 1));
      const data = new DataView(memory.buffer, toWasm(mouseRecord), 20);
      assert.deepStrictEqual(Array.from({length: 5}, (_, i) => data.getUint32(i * 4, true)),
        [parent, 0x21, parent, lp, 1], 'parent called once with unchanged parameters');
    }
    e.test_mouse_parent(mouseChild, parent, 0x90000000);
    assert.strictEqual(e.test_mouse_default(mouseChild, parent, 0x02010001), 1,
      'owned popup does not forward as a WS_CHILD');
  }
  const allowProc = e.guest_alloc(8) >>> 0;
  new Uint8Array(memory.buffer).set(Uint8Array.from([
    0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax,1
    0xc2, 0x10, 0x00,             // ret 16
  ]), toWasm(allowProc));

  // Use a real x86 wndproc so activation messages exercise the same
  // synchronous callback route as an application window.
  const hwnd = e.test_make_icon_window(allowProc) >>> 0;
  assert.strictEqual(e.test_open_icon(hwnd), 0,
    'OpenIcon does nothing to a window that is not iconic');
  assert.deepStrictEqual(hostCalls, []);

  e.test_set_active_raw(hwnd);
  assert.strictEqual(e.test_close_window(hwnd), 1);
  assert.strictEqual(e.test_min(hwnd), 1,
    'CloseWindow must update the guest IsIconic state');
  assert.strictEqual(e.test_active(), 0,
    'minimizing the active window deactivates it');
  assert.deepStrictEqual(hostCalls, [['sys', hwnd, 0xF020]]);

  assert.strictEqual(e.test_open_icon(hwnd), 1);
  assert.strictEqual(e.test_min(hwnd), 0,
    'OpenIcon clears the guest iconic state');
  assert.strictEqual(e.test_active() >>> 0, hwnd,
    'OpenIcon activates the restored top-level');
  assert.deepStrictEqual(hostCalls.slice(-2), [
    ['sys', hwnd, 0xF120],
    ['activate', hwnd],
  ]);

  e.test_set_max_raw(hwnd, 1);
  assert.strictEqual(e.test_close_window(hwnd), 1);
  assert.strictEqual(e.test_open_icon(hwnd), 1);
  assert.strictEqual(e.test_max(hwnd), 1,
    'restoring an iconified maximized window keeps it maximized');

  const observed = e.guest_alloc(4) >>> 0;
  const vetoProc = e.guest_alloc(32) >>> 0;
  const code = Uint8Array.from([
    0x8b, 0x44, 0x24, 0x08,             // mov eax,[esp+8] (message)
    0xa3, ...u32(observed),              // mov [observed],eax
    0x31, 0xc0,                          // xor eax,eax (veto)
    0xc2, 0x10, 0x00,                    // ret 16
  ]);
  new Uint8Array(memory.buffer).set(code, toWasm(vetoProc));

  const veto = e.test_make_icon_window(vetoProc) >>> 0;
  assert.strictEqual(e.test_close_window(veto), 1);
  const callsBeforeVeto = hostCalls.length;
  assert.strictEqual(e.test_open_icon(veto), 0,
    'a zero WM_QUERYOPEN result vetoes restoration');
  assert.strictEqual(e.test_min(veto), 1,
    'vetoed OpenIcon leaves the window iconic');
  assert.strictEqual(hostCalls.length, callsBeforeVeto,
    'vetoed OpenIcon must not touch renderer state');
  assert.strictEqual(new DataView(memory.buffer).getUint32(toWasm(observed), true), 0x0013,
    'OpenIcon synchronously sent WM_QUERYOPEN');

  const apiTable = require('../src/api_table.json');
  for (const command of [0xF120, 0xF030]) {
    const before = hostCalls.length;
    e.test_sys(veto, command);
    assert.strictEqual(e.test_min(veto), 1, 'system restore/maximize honors query veto');
    assert.strictEqual(hostCalls.length, before, 'veto does not publish host state');
    const allowed = e.test_make_icon_window(allowProc);
    e.test_close_window(allowed);
    e.test_sys(allowed, command);
    assert.strictEqual(e.test_min(allowed), 0, 'allowed query restores iconic window');
    assert.strictEqual(e.test_max(allowed), command === 0xF030 ? 1 : 0);
    const native = e.test_make_icon_window(0);
    e.test_close_window(native);
    e.test_sys(native, command);
    assert.strictEqual(e.test_min(native), 0, 'builtin uses default TRUE query result');
    e.test_close_window(native);
    assert.strictEqual(e.test_open_icon(native), 1, 'OpenIcon shares builtin default query handling');
  }
  const destroyThunk = e.test_thunk(apiTable.find(api => api.name === 'DestroyWindow').id);
  const destroyProc = e.guest_alloc(64) >>> 0;
  // Only WM_QUERYOPEN destroys the target; nested destroy notifications
  // return normally. Return TRUE afterward to catch a stale restore commit.
  new Uint8Array(memory.buffer).set(Uint8Array.from([
    0x83, 0x7c, 0x24, 8, 0x13, 0x75, 11,
    0xff, 0x74, 0x24, 4, // push hwnd
    0xb8, ...u32(destroyThunk), 0xff, 0xd0,
    0xb8, ...u32(1), 0xc2, 0x10, 0,
  ]), toWasm(destroyProc));
  const retired = e.test_make_icon_window(destroyProc) >>> 0;
  assert.strictEqual(e.test_close_window(retired), 1);
  const beforeRetired = hostCalls.length;
  assert.strictEqual(e.test_open_icon(retired), 0,
    'a target destroyed inside WM_QUERYOPEN cannot be restored');
  assert.strictEqual(e.test_live(retired), 0, 'callback actually retired the HWND');
  assert.strictEqual(hostCalls.length, beforeRetired,
    'outer OpenIcon must not restore or activate a retired target');
  for (const command of [0xF120, 0xF030]) {
    const target = e.test_make_icon_window(destroyProc);
    e.test_close_window(target);
    const before = hostCalls.length;
    e.test_sys(target, command);
    assert.strictEqual(e.test_live(target), 0, 'system query callback retires target');
    assert.strictEqual(hostCalls.length, before, 'system query cannot commit a retired target');
  }

  assert.strictEqual(e.test_close_window(rendererHwnd), 1,
    'CloseWindow accepts a live renderer-owned window from another process');
  assert.deepStrictEqual(hostCalls.at(-1), ['sys', rendererHwnd, 0xF020],
    'a foreign window is minimized through the shared renderer');

  assert.strictEqual(e.test_close_window(0x7fffffff), 0);
  assert.strictEqual(e.test_last_error(), 1400);
  assert.strictEqual(e.test_open_icon(0x7fffffff), 0);
  assert.strictEqual(e.test_last_error(), 1400);

  console.log('PASS  OpenIcon/CloseWindow synchronize local and renderer-owned Win98 state');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
