#!/usr/bin/env node

'use strict';

// The winmm timer thread (0xCACA003B, $mm_timer_thread_step): timeSetEvent
// callbacks run on a guest thread of their own, as on Windows, instead of
// borrowing the application's thread through its message pump or an
// injection between slices. Once that thread exists the two main-thread
// paths must stand down, or a callback would run twice.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func $t_clear
    (local $i i32)
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (global.get $MM_TIMER_MAX)))
      (i32.store (call $mm_timer_slot (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan))))
  ;; One periodic timer whose last tick is $ago ms before now.
  (func (export "t_set_timer") (param $interval i32) (param $ago i32)
    (local $p i32)
    (call $t_clear)
    (local.set $p (call $mm_timer_slot (i32.const 0)))
    (i32.store (local.get $p) (i32.const 9))
    (i32.store offset=4 (local.get $p) (local.get $interval))
    (i32.store offset=8 (local.get $p) (i32.const 0x00406000))
    (i32.store offset=12 (local.get $p) (i32.const 0xD00D))
    (i32.store offset=16 (local.get $p) (i32.sub (call $host_get_ticks) (local.get $ago)))
    (i32.store offset=20 (local.get $p) (i32.const 0)))
  (func (export "t_clear_timers") (call $t_clear))
  ;; The thread as timeSetEvent would have started it: owned, its loop thunk
  ;; known, its loop ESP not yet recorded.
  (func (export "t_own_thread") (param $owned i32)
    (global.set $image_base (i32.const 0x00400000))
    (i32.store (global.get $MM_TIMER_THREAD) (i32.const 1))
    (i32.store offset=4 (global.get $MM_TIMER_THREAD) (local.get $owned))
    (i32.store offset=8 (global.get $MM_TIMER_THREAD) (i32.const 0x00402000))
    (i32.store offset=12 (global.get $MM_TIMER_THREAD) (i32.const 0))
    (i32.store (global.get $THUNK_BASE) (i32.const 0xCACA003B))
    (i32.store offset=4 (global.get $THUNK_BASE) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (global.set $eip (i32.const 0x00402000))
    (global.set $sleep_yielded (i32.const 0))
    (global.set $sleep_timeout (i32.const 0)))
  (func (export "t_set_esp") (param $v i32)
    (i32.store offset=16 (global.get $reg_base) (local.get $v)))
  (func (export "t_dispatch")
    (global.set $handler_set_eip (i32.const 0))
    (call $win32_dispatch (i32.const 0)))
  (func (export "t_handler_set_eip") (result i32) (global.get $handler_set_eip))
  (func (export "t_sleep_timeout") (result i32)
    (select (global.get $sleep_timeout) (i32.const -1) (global.get $sleep_yielded)))
  (func (export "t_check_due") (result i32)
    (call $timer_check_due (i32.const 0x00510000) (i32.const 0)))
  (func (export "t_mm_slot_last") (result i32)
    (i32.sub (call $host_get_ticks) (i32.load offset=16 (call $mm_timer_slot (i32.const 0)))))
`;

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat });

  // --- host-facing deadline, the quick fix's quantum cap ---------------------
  wat.t_own_thread(0);
  wat.set_mm_timer_thread_mode(0);
  wat.t_clear_timers();
  assert.strictEqual(wat.mm_timer_ms_until_due(), -1, 'no timer: no deadline');
  wat.t_set_timer(5, 2);
  assert.strictEqual(wat.mm_timer_ms_until_due(), 3, 'a 5ms timer 2ms in is due in 3ms');
  wat.t_set_timer(5, 7);
  assert.strictEqual(wat.mm_timer_ms_until_due(), 0, 'an overdue timer is due now');

  // --- main-thread paths deliver while no thread owns the timers -------------
  assert.strictEqual(wat.t_check_due(), 1, 'without the thread, GetMessage synthesizes MM_TIMER');

  // --- once the thread exists the main thread stands down --------------------
  wat.t_own_thread(0x1234);
  wat.t_set_timer(5, 7);
  assert.strictEqual(wat.t_check_due(), 0, 'the pump no longer synthesizes MM_TIMER');
  assert.strictEqual(wat.fire_mm_timer(), 0, 'the slice-boundary injection refuses');
  assert.strictEqual(wat.mm_timer_ms_until_due(), -1, 'the host is told there is nothing to serve');
  assert.strictEqual(wat.next_timer_due_ms(), -1, 'a parked GetMessage does not wake for the thread\'s timer');
  assert.strictEqual(wat.get_mm_timer_thread(), 0x1234, 'the thread handle is published');

  // --- a due timer: call TimeProc, return to the loop thunk ------------------
  wat.t_own_thread(0x1234);
  wat.t_set_timer(5, 7);
  wat.t_dispatch();
  assert.strictEqual(wat.get_eip() >>> 0, 0x00406000, 'the thread enters the due TimeProc');
  const esp = wat.get_esp() >>> 0;
  assert.strictEqual(esp, 0x00500000 - 24, 'return address + five arguments pushed');
  assert.strictEqual(wat.guest_read32(esp) >>> 0, 0x00402000, 'TimeProc returns to the loop thunk');
  assert.strictEqual(wat.guest_read32(esp + 4) >>> 0, 9, 'uTimerID');
  assert.strictEqual(wat.guest_read32(esp + 8) >>> 0, 0, 'uMsg');
  assert.strictEqual(wat.guest_read32(esp + 12) >>> 0, 0xD00D, 'dwUser');
  assert.strictEqual(wat.t_sleep_timeout(), -1, 'calling a callback is not a sleep');
  assert.ok(wat.t_mm_slot_last() < 5, 'the period was consumed, phase kept');

  // --- callback returned (stdcall RET 20): nothing due, sleep to deadline ----
  wat.t_set_esp(0x00500000);
  wat.t_dispatch();
  assert.strictEqual(wat.get_eip() >>> 0, 0x00402000, 'the thread re-enters its loop after sleeping');
  // Without this the run loop treats an unchanged EIP as an API that did not
  // redirect and pops [ESP] -- the thread's 0 return address -- so the thread
  // exited on its first sleep.
  assert.strictEqual(wat.t_handler_set_eip(), 1, 're-entering the same thunk opts out of the auto-pop');
  const slept = wat.t_sleep_timeout();
  assert.ok(slept >= 1 && slept <= 5, `sleeps until the next 5ms boundary (slept ${slept})`);
  wat.clear_yield();

  // --- a cdecl-style return that left the arguments: ESP is re-pinned --------
  wat.t_set_timer(5, 7);
  wat.t_set_esp(0x00500000 - 20);
  wat.t_dispatch();
  assert.strictEqual(wat.get_esp() >>> 0, 0x00500000 - 24, 'the loop ESP is pinned, not walked');
  wat.clear_yield();

  // --- no timers left: idle sleeps -------------------------------------------
  wat.t_clear_timers();
  wat.t_set_esp(0x00500000);
  wat.t_dispatch();
  assert.strictEqual(wat.t_sleep_timeout(), 50, 'an idle timer thread sleeps 50ms at a time');
  wat.clear_yield();

  console.log('PASS  winmm timer thread owns timeSetEvent callbacks');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
