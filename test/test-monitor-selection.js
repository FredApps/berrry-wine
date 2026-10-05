#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_monitor_from_point")
      (param $x i32) (param $y i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_MonitorFromPoint
      (local.get $x) (local.get $y) (local.get $flags)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_monitor_from_rect")
      (param $rect i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_MonitorFromRect
      (local.get $rect) (local.get $flags) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_monitor_from_window")
      (param $hwnd i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_MonitorFromWindow
      (local.get $hwnd) (local.get $flags) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_monitor_info")
      (param $monitor i32) (param $info i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_GetMonitorInfoA
      (local.get $monitor) (local.get $info) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_get_work_area") (param $rect i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
    (call $handle_SystemParametersInfoA
      (i32.const 0x30) (i32.const 0) (local.get $rect)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_monitor_last_error") (result i32)
    (global.get $last_error))
`;

(async () => {
  const { exports: wat, renderer } = await bootRenderHarness({
    extraWat,
    width: 640,
    height: 480,
  });
  const monitor = 0x00010000;
  const rect = 0x00420000;
  const info = 0x00420100;

  const writeRect = (left, top, right, bottom) => {
    wat.guest_write32(rect, left);
    wat.guest_write32(rect + 4, top);
    wat.guest_write32(rect + 8, right);
    wat.guest_write32(rect + 12, bottom);
  };
  const readRect = address => [0, 4, 8, 12]
    .map(offset => wat.guest_read32(address + offset) | 0);

  assert.strictEqual(wat.test_monitor_from_point(0, 0, 0) >>> 0, monitor);
  assert.strictEqual(wat.test_monitor_from_point(639, 479, 0) >>> 0, monitor);
  assert.strictEqual(wat.test_monitor_from_point(-1, 0, 0) >>> 0, 0,
    'MONITOR_DEFAULTTONULL returns NULL outside the virtual screen');
  assert.strictEqual(wat.test_monitor_from_point(640, 479, 1) >>> 0, monitor,
    'MONITOR_DEFAULTTOPRIMARY selects the one primary monitor');
  assert.strictEqual(wat.test_monitor_from_point(640, 480, 2) >>> 0, monitor,
    'MONITOR_DEFAULTTONEAREST selects the one nearest monitor');

  writeRect(-10, -10, 1, 1);
  assert.strictEqual(wat.test_monitor_from_rect(rect, 0) >>> 0, monitor,
    'one intersecting pixel selects the monitor');
  writeRect(640, 0, 700, 20);
  assert.strictEqual(wat.test_monitor_from_rect(rect, 0) >>> 0, 0,
    'a rectangle touching only the exclusive right edge does not intersect');
  assert.strictEqual(wat.test_monitor_from_rect(rect, 2) >>> 0, monitor);
  writeRect(20, 20, 20, 30);
  assert.strictEqual(wat.test_monitor_from_rect(rect, 0) >>> 0, 0,
    'an empty rectangle has no monitor intersection');

  renderer.windows[0x20001] = {
    hwnd: 0x20001, x: 100, y: 100, w: 80, h: 60,
    visible: true, enabled: true, isChild: false,
  };
  renderer.windows[0x20002] = {
    hwnd: 0x20002, x: 700, y: 40, w: 80, h: 60,
    visible: true, enabled: true, isChild: false,
  };
  assert.strictEqual(wat.test_monitor_from_window(0x20001, 0) >>> 0, monitor);
  assert.strictEqual(wat.test_monitor_from_window(0x20002, 0) >>> 0, 0);
  assert.strictEqual(wat.test_monitor_from_window(0x20002, 1) >>> 0, monitor);
  assert.strictEqual(wat.test_monitor_from_window(0xdead, 0) >>> 0, 0,
    'an invalid HWND has no monitor under DEFAULTTONULL');

  wat.guest_write32(info, 40);
  assert.strictEqual(wat.test_get_monitor_info(monitor, info), 1);
  assert.deepStrictEqual(readRect(info + 4), [0, 0, 640, 480]);
  assert.deepStrictEqual(readRect(info + 20), [0, 0, 640, 452],
    'MONITORINFO.rcWork excludes the browser desktop taskbar');
  assert.strictEqual(wat.guest_read32(info + 36), 1,
    'the sole monitor is marked MONITORINFOF_PRIMARY');

  wat.guest_write32(info, 72);
  assert.strictEqual(wat.test_get_monitor_info(monitor, info), 1);
  let deviceName = '';
  for (let i = 0; i < 32; i++) {
    const ch = wat.guest_read8(info + 40 + i);
    if (!ch) break;
    deviceName += String.fromCharCode(ch);
  }
  assert.strictEqual(deviceName, '\\\\.\\DISPLAY1');

  wat.guest_write32(info, 39);
  assert.strictEqual(wat.test_get_monitor_info(monitor, info), 0);
  assert.strictEqual(wat.test_monitor_last_error(), 87,
    'GetMonitorInfo rejects an undeclared structure size');
  wat.guest_write32(info, 40);
  assert.strictEqual(wat.test_get_monitor_info(0x9999, info), 0);
  assert.strictEqual(wat.test_monitor_last_error(), 1461,
    'GetMonitorInfo rejects a non-monitor handle');
  assert.strictEqual(wat.test_get_monitor_info(monitor, 0), 0);
  assert.strictEqual(wat.test_monitor_last_error(), 87,
    'GetMonitorInfo rejects a null output pointer as an invalid parameter');

  assert.strictEqual(wat.test_get_work_area(rect), 1);
  assert.deepStrictEqual(readRect(rect), [0, 0, 640, 452],
    'SPI_GETWORKAREA and MONITORINFO agree on the taskbar-reserved desktop');

  console.log('PASS  single-monitor selection and work-area behavior match Win98');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
