#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const HWND = 0x10001;
const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_window_from_dc") (param $hdc i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_WindowFromDC
      (local.get $hdc) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_remove_window") (param $hwnd i32)
    (call $wnd_table_remove (local.get $hwnd)))
`;

(async () => {
  const { exports: e, renderer, instance, memory } = await bootRenderHarness({ extraWat });
  renderer.windows[HWND] = {
    hwnd: HWND, x: 20, y: 30, w: 200, h: 120, zOrder: 1,
    style: 0x10000000, visible: true, isChild: false,
    clientRect: { x: 20, y: 30, w: 200, h: 120 },
    wasm: instance, wasmMemory: memory,
  };
  e.wnd_table_set(HWND, 0);
  e.ctrl_set_geom(HWND, 20, 30, 200, 120);
  e.wnd_set_style_export(HWND, 0x10000000);
  e.test_gdi_client_rect_set(HWND, 4, 20, 196, 116);

  const client = e.test_call_GetDC(HWND) >>> 0;
  const whole = e.test_call_GetWindowDC(HWND) >>> 0;
  const memoryDc = e.test_call_CreateCompatibleDC(0) >>> 0;
  const screenDc = e.test_call_GetDC(0) >>> 0;
  assert(client && whole && memoryDc && screenDc, 'all test DCs allocate');

  for (const [label, hdc] of [
    ['client DC', client],
    ['whole-window DC', whole],
    ['legacy client DC', HWND + 0x40000],
    ['legacy nonclient DC', HWND + 0xc0000],
  ]) {
    assert.strictEqual(e.test_window_from_dc(hdc) >>> 0, HWND,
      `${label} resolves its associated HWND`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      `${label} preserves one-argument stdcall cleanup`);
  }

  for (const [label, hdc] of [
    ['NULL', 0],
    ['forged', 0x12345678],
    ['memory DC', memoryDc],
    ['screen DC', screenDc],
  ]) {
    assert.strictEqual(e.test_window_from_dc(hdc) >>> 0, 0,
      `${label} has no associated window`);
    assert.strictEqual(e.get_esp() >>> 0, STACK + 8,
      `${label} preserves one-argument stdcall cleanup`);
  }

  assert.strictEqual(e.test_call_ReleaseDC(HWND, client), 1,
    'client DC releases normally');
  assert.strictEqual(e.test_window_from_dc(client) >>> 0, 0,
    'a released transient DC no longer retains its window association');

  e.test_remove_window(HWND);
  assert.strictEqual(e.test_window_from_dc(whole) >>> 0, 0,
    'a DC cannot return a destroyed/stale window handle');

  assert.strictEqual(e.test_call_DeleteDC(memoryDc), 1, 'memory DC deletes normally');
  assert.strictEqual(e.test_call_ReleaseDC(0, screenDc), 1, 'screen DC releases normally');

  console.log('PASS  WindowFromDC resolves only live window-bound display DCs');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
