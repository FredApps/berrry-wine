#!/usr/bin/env node
'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_set_keyboard_state") (param $state i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_SetKeyboardState
      (local.get $state) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_set_keyboard_state_esp") (param $state i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $gs32 (i32.load offset=16 (global.get $reg_base)) (i32.const 0x12345678))
    (call $handle_SetKeyboardState
      (local.get $state) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_attach_thread_input") (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_AttachThreadInput
      (i32.const 1) (i32.const 1) (i32.const 1)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const api = apiTable.find(entry => entry.name === 'SetKeyboardState');
  assert(api && api.nargs === 1, 'SetKeyboardState is a one-argument stdcall API');
  const attachApi = apiTable.find(entry => entry.name === 'AttachThreadInput');
  assert(attachApi && attachApi.nargs === 3, 'AttachThreadInput is a three-argument stdcall API');

  const { exports: wat, renderer } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const state = 0x00412000;
  for (let i = 0; i < 256; i++) wat.guest_write8(state + i, 0);
  wat.guest_write8(state + 0x41, 0x80);
  wat.guest_write8(state + 0x42, 0x01);

  assert.strictEqual(wat.test_set_keyboard_state(state), 1);
  assert.strictEqual(renderer.peekAsyncKeyState(0x41), 0x8000,
    'keyboard virtual-key high bit is retained');
  assert.strictEqual(renderer.peekAsyncKeyState(0x42), 0,
    'toggle bit alone does not mark a key down');
  assert.strictEqual(wat.test_set_keyboard_state_esp(state) >>> 0, 0x074ff008,
    'SetKeyboardState pops return address and its one argument');
  assert.strictEqual(wat.test_set_keyboard_state(0), 0,
    'NULL keyboard table fails safely');
  assert.strictEqual(wat.test_attach_thread_input(), 0x074ff01000000000n,
    'unmodeled AttachThreadInput fails without a fatal stub and pops four stack words');

  console.log('PASS  SetKeyboardState updates the modeled 256-key snapshot');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
