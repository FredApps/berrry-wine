#!/usr/bin/env node
'use strict';
// A synchronous send ($wnd_send_message: UpdateWindow's WM_PAINT, SendMessage)
// runs the target procedure in bounded $run rounds. Every guest Sleep ends a
// round, and the old cap of 64 rounds abandoned any procedure that slept more
// often than that: Unreal Tournament's first-run wizard probes each 3D device
// from WM_PAINT and polls for the probe's log with Sleep(100) up to 100 times,
// so the paint was dropped mid-probe and "Detecting 3D video devices" stayed up
// forever. Sleep-ended rounds now have their own, larger cap; a procedure that
// never returns is still abandoned.
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
  (func (export "test_sleep_yielded") (result i32) (global.get $sleep_yielded))
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

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const sleepId = apiTable.findIndex(a => a.name === 'Sleep');
  assert(sleepId >= 0, 'Sleep is in the API table');
  const sleep = e.test_thunk(sleepId);
  const counter = e.guest_alloc(4);

  const proc = bytes => {
    const at = e.guest_alloc(bytes.length);
    bytes.forEach((b, i) => e.guest_write8(at + i, b));
    return at;
  };

  // mov ecx,N / loop: push ecx; push 1; mov eax,Sleep; call eax; pop ecx;
  // inc dword [counter]; dec ecx; jnz loop / mov eax,0x1234 / ret 16
  const sleeper = n => proc([
    0xb9, ...u32(n),
    0x51, 0x6a, 0x01, 0xb8, ...u32(sleep), 0xff, 0xd0, 0x59,
    0xff, 0x05, ...u32(counter),
    0x49, 0x75, 0xec,
    0xb8, ...u32(0x1234), 0xc2, 0x10, 0x00,
  ]);

  // 200 sleeps: more than the 64 rounds that used to abandon the send.
  e.guest_write32(counter, 0);
  const h = e.test_window(sleeper(200));
  const result = e.send_message(h, 0x000f, 0, 0);
  assert.strictEqual(e.guest_read32(counter), 200, 'the procedure ran every one of its sleeps');
  assert.strictEqual(result >>> 0, 0x1234, 'the send returns the procedure\'s own result');
  assert.strictEqual(e.test_send_completed(), 1, 'the send completed rather than being abandoned');
  assert.strictEqual(e.get_sync_msg_depth(), 0, 'send depth is restored');
  assert.strictEqual(e.test_sleep_yielded(), 0,
    'sleeps inside the send are not reported to the outer scheduler as the caller sleeping');
  console.log('ok: a procedure that sleeps 200 times inside a synchronous send completes');

  // A procedure that sleeps forever is still bounded.
  e.guest_write32(counter, 0);
  const h2 = e.test_window(sleeper(0x7fffffff));
  e.send_message(h2, 0x000f, 0, 0);
  assert.strictEqual(e.test_send_completed(), 0, 'an endless sleeper is abandoned');
  const ran = e.guest_read32(counter);
  // The counter increments after Sleep returns, so the sleep that reaches the
  // cap is not counted.
  assert(ran >= 4095 && ran < 4200, `it is cut at the sleep-round cap (ran ${ran} sleeps)`);
  assert.strictEqual(e.get_sync_msg_depth(), 0, 'send depth is restored after abandoning');
  console.log('ok: an endless sleeper is abandoned at the sleep-round cap');
  console.log('PASS test-sync-send-sleep-rounds');
})().catch(err => { console.error(err); process.exit(1); });
