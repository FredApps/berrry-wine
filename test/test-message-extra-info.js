#!/usr/bin/env node
'use strict';

// GetMessageExtraInfo / SetMessageExtraInfo are per-thread USER state: the
// extra-info word of the last message this thread retrieved, or whatever
// SetMessageExtraInfo stored since. Set returns the previous value; a
// PeekMessage that finds nothing leaves it alone; retrieving a message (with or
// without PM_REMOVE) replaces it with that message's extra info, which is 0 for
// ordinary input. ScummVM calls GetMessageExtraInfo on every mouse click to
// tell pen/touch-synthesized mouse input apart from a real mouse.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const WM_KEYDOWN = 0x0100;
const PM_NOREMOVE = 0;
const PM_REMOVE = 1;
const SP = 0x00300000;

const extraWat = String.raw`
  (global $test_mx_msg (mut i32) (i32.const 0))

  (func (export "test_mx_target") (param $hwnd i32)
    (global.set $main_hwnd (local.get $hwnd))
    (global.set $focus_hwnd (local.get $hwnd)))

  (func (export "test_mx_get") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${SP}))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x5a5a5a5a))
    (call $handle_GetMessageExtraInfo (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mx_set") (param $v i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${SP}))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x5a5a5a5a))
    (call $handle_SetMessageExtraInfo (local.get $v) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mx_peek") (param $remove i32) (result i32)
    (if (i32.eqz (global.get $test_mx_msg))
      (then (global.set $test_mx_msg (call $heap_alloc (i32.const 28)))))
    (i32.store offset=16 (global.get $reg_base) (i32.const ${SP}))
    (call $handle_PeekMessageA
      (global.get $test_mx_msg) (i32.const 0)
      (i32.const 0) (i32.const 0) (local.get $remove) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_mx_msg_field") (param $field i32) (result i32)
    (call $gl32 (i32.add (global.get $test_mx_msg)
      (i32.mul (local.get $field) (i32.const 4)))))
`;

(async () => {
  const pending = [];
  let last = null;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      check_input: () => {
        last = pending.shift() || null;
        return last ? ((last.wParam << 16) | (last.msg & 0xffff)) : 0;
      },
      check_input_hwnd: () => last ? last.hwnd : 0,
      check_input_lparam: () => last ? last.lParam : 0,
      check_input_wparam: () => last ? last.wParam : 0,
    },
  });
  const { exports: e } = harness;
  e.test_mx_target(0x10002);

  assert.strictEqual(e.test_mx_get(), 0, 'a thread starts with no extra info');
  assert.strictEqual(e.get_esp() >>> 0, SP + 4, 'GetMessageExtraInfo pops only its return address');

  assert.strictEqual(e.test_mx_set(0x12345678), 0, 'Set returns the previous value (0)');
  assert.strictEqual(e.get_esp() >>> 0, SP + 8, 'SetMessageExtraInfo pops one argument');
  assert.strictEqual(e.test_mx_get() >>> 0, 0x12345678, 'Get reads back what Set stored');
  assert.strictEqual(e.test_mx_set(0xcafef00d) >>> 0, 0x12345678, 'Set returns the value it replaced');

  assert.strictEqual(e.test_mx_peek(PM_REMOVE), 0, 'nothing is queued');
  assert.strictEqual(e.test_mx_get() >>> 0, 0xcafef00d,
    'a PeekMessage that retrieves nothing leaves the extra info alone');

  pending.push({ hwnd: 0x10002, msg: WM_KEYDOWN, wParam: 0x41, lParam: 0x001e0001 });
  assert.strictEqual(e.test_mx_peek(PM_NOREMOVE), 1, 'PM_NOREMOVE sees the key');
  assert.strictEqual(e.test_mx_msg_field(1), WM_KEYDOWN);
  assert.strictEqual(e.test_mx_get(), 0,
    'retrieving input (even without removing it) takes that message\'s extra info, 0');

  e.test_mx_set(0x55aa55aa);
  assert.strictEqual(e.test_mx_peek(PM_REMOVE), 1, 'PM_REMOVE takes the same key');
  assert.strictEqual(e.test_mx_msg_field(2), 0x41);
  assert.strictEqual(e.test_mx_get(), 0, 'a removed input message resets the extra info to 0');

  console.log('PASS GetMessageExtraInfo/SetMessageExtraInfo per-thread state and retrieval reset');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
