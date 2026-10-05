#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_insend_prepare") (param $hwnd i32) (param $proc i32)
    (global.set $image_base (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (global.set $current_thread_id (i32.const 2))
    (call $wnd_table_set (local.get $hwnd) (local.get $proc)))

  (func (export "test_call_InSendMessage") (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_InSendMessage
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_set_local_send_depth") (param $depth i32)
    (global.set $sync_msg_depth (local.get $depth)))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const hwnd = 0x18001;

  e.test_insend_prepare(hwnd, 0x00401000);
  assert.strictEqual(e.test_call_InSendMessage(), 0,
    'ordinary execution is not inside a cross-thread SendMessage');

  assert.strictEqual(e.thread_send_begin(hwnd, 0x500, 7, 9), 1,
    'owner-thread dispatcher enters the x86 window procedure');
  assert.strictEqual(e.test_call_InSendMessage(), 1,
    'the receiving window procedure sees the cross-thread SendMessage');

  e.thread_send_end();
  assert.strictEqual(e.test_call_InSendMessage(), 0,
    'the cross-thread state ends with the receiving window procedure');

  // $sync_msg_depth also covers a same-thread recursive SendMessage. The
  // documented API is narrower: the sender must be another thread.
  e.test_set_local_send_depth(1);
  assert.strictEqual(e.test_call_InSendMessage(), 0,
    'a same-thread recursive SendMessage does not report a remote sender');

  console.log('PASS  InSendMessage distinguishes remote from same-thread sends');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
