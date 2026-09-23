#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_monitor_screen_dc") (result i32) (call $host_alloc_screen_dc))
  (func (export "test_monitor_pixel") (param $hdc i32) (param $x i32) (param $y i32)
      (param $color i32) (result i32)
    (call $gdi_hdc_set_pixel (local.get $hdc) (local.get $x) (local.get $y) (local.get $color)))
  (func (export "test_monitor_viewport") (param $hdc i32) (param $x i32) (result i32)
    (call $gdi_dc_set_field (local.get $hdc) (i32.const 56) (local.get $x) (i32.const 0)))
  (func (export "test_monitor_save_level") (param $hdc i32) (result i32)
    (local $level i32)
    (local.set $level (call $gdi_dc_save (local.get $hdc)))
    (drop (call $gdi_dc_restore (local.get $hdc) (local.get $level)))
    (local.get $level))
  (func (export "test_monitor_clip") (param $hdc i32) (param $rect i32) (param $exclude i32)
    (if (local.get $exclude)
      (then (drop (call $gdi_dc_clip_exclude_rect (local.get $hdc)
        (call $gl32 (local.get $rect)) (call $gl32 (i32.add (local.get $rect) (i32.const 4)))
        (call $gl32 (i32.add (local.get $rect) (i32.const 8)))
        (call $gl32 (i32.add (local.get $rect) (i32.const 12))))))
      (else (drop (call $gdi_dc_clip_intersect_rect (local.get $hdc)
        (call $gl32 (local.get $rect)) (call $gl32 (i32.add (local.get $rect) (i32.const 4)))
        (call $gl32 (i32.add (local.get $rect) (i32.const 8)))
        (call $gl32 (i32.add (local.get $rect) (i32.const 12))))))))
  (func (export "test_monitor_visible") (param $hdc i32) (param $x i32) (param $y i32) (result i32)
    (call $gdi_dc_clip_device_point_visible (local.get $hdc) (local.get $x) (local.get $y)))
  (func (export "test_monitor_color") (param $hdc i32) (param $color i32) (result i32)
    (call $gdi_native_set_text_color (local.get $hdc) (local.get $color)))
  (func (export "test_monitor_window_dc") (result i32)
    (local $hwnd i32)
    (local.set $hwnd (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (local.get $hwnd) (i32.const 1)))
    (call $host_register_dialog_frame (local.get $hwnd) (i32.const 0)
      (i32.const 0) (i32.const 100) (i32.const 100) (i32.const 0))
    (call $wnd_table_set (local.get $hwnd) (i32.const 0x00401000))
    (drop (call $wnd_set_style (local.get $hwnd) (i32.const 0x90000000)))
    (call $host_move_window (local.get $hwnd) (i32.const -20) (i32.const 10)
      (i32.const 100) (i32.const 100) (i32.const 0))
    (call $host_alloc_window_dc (local.get $hwnd) (i32.const 1)))
  (func (export "test_monitor_begin")
      (param $esp i32) (param $hdc i32) (param $clip i32)
      (param $callback i32) (param $data i32)
    (global.set $eip (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs32 (local.get $esp) (i32.const 0))
    (call $handle_EnumDisplayMonitors (local.get $hdc) (local.get $clip)
      (local.get $callback) (local.get $data) (i32.const 0) (i32.const 0)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none', width: 800, height: 600 });
  const pe = fs.readFileSync(path.join(__dirname, 'binaries', 'calc.exe'));
  new Uint8Array(memory.buffer).set(pe, e.get_staging());
  assert(e.load_pe(pe.length));
  const out = e.guest_alloc(64), clip = e.guest_alloc(16);
  const stack = 0x07000000;
  const readRect = p => [0, 4, 8, 12].map(i => e.guest_read32(p + i) | 0);
  const putRect = values => values.forEach((v, i) => e.guest_write32(clip + i * 4, v));
  function callback(result) {
    // Record the real stdcall arguments and dereference the guest RECT.
    const code = [0x8b,0x4c,0x24,0x10, 0x8b,0x44,0x24,4, 0x89,1,
      0x8b,0x44,0x24,8, 0x89,0x41,4, 0x8b,0x54,0x24,12, 0x89,0x51,24];
    for (let i = 0; i < 4; i++) code.push(0x8b,0x42,i*4, 0x89,0x41,8+i*4);
    code.push(0xff,0x41,28, 0xb8,result,0,0,0, 0xc2,16,0);
    const p = e.guest_alloc(code.length);
    code.forEach((b, i) => e.guest_write8(p + i, b));
    return p;
  }
  const yes = callback(7), no = callback(0);
  function begin(cb, clipping = 0, esp = stack, hdc = 0) {
    e.guest_write32(out + 28, 0);
    e.guest_write32(esp + 20, 0x1234abcd);
    e.test_monitor_begin(esp, hdc, clipping, cb, out);
  }
  function finish() { for (let i = 0; e.get_eip() && i < 20; i++) e.run(100); assert.strictEqual(e.get_eip(), 0); }
  begin(yes); finish();
  assert.strictEqual(e.guest_read32(out), 0x10000, 'same primary handle as MonitorFromPoint');
  assert.strictEqual(e.guest_read32(out + 4), 0);
  assert.deepStrictEqual(readRect(out + 8), [0, 0, 800, 600], 'live screen dimensions');
  assert.strictEqual(e.guest_read32(out + 28), 1);
  assert.strictEqual(e.get_esp(), stack + 20);
  assert.strictEqual(e.guest_read32(stack + 20), 0x1234abcd, 'caller stack is not scratch');
  assert.strictEqual(e.guest_read32(out + 24), stack - 4, 'RECT lives in this invocation frame');
  assert.strictEqual(e.get_eax(), 1);
  begin(no); finish(); assert.strictEqual(e.get_eax(), 0, 'callback FALSE stops enumeration');
  putRect([-10, 20, 300, 700]); begin(yes, clip); finish();
  assert.deepStrictEqual(readRect(out + 8), [0, 0, 800, 600],
    'NULL-HDC clip selects monitors but callback receives the full monitor RECT');
  for (const r of [[800,0,900,600], [10,10,10,20], [30,30,20,20]]) {
    putRect(r); begin(yes, clip); finish();
    assert.strictEqual(e.guest_read32(out + 28), 0);
    assert.strictEqual(e.get_eax(), 1, 'empty intersection succeeds without callback');
    assert.strictEqual(e.get_esp(), stack + 20);
  }
  begin(0); finish(); assert.strictEqual(e.get_eax(), 0, 'NULL callback rejected');
  begin(yes, 0, stack, 123); finish();
  assert.strictEqual(e.get_eax(), 0, 'invalid DC must not fabricate success');
  assert.strictEqual(e.guest_read32(out + 28), 0);
  // Suspend an outer call, complete a nested invocation lower on its stack,
  // then resume the outer x86 callback through the real return thunk.
  begin(yes);
  const outerEsp = e.get_esp(), outerRect = e.guest_read32(outerEsp + 12);
  e.guest_write32(outerRect, 123); // simulate the outer callback using its mutable RECT
  putRect([20,30,40,50]); begin(yes, clip, outerEsp - 64); finish();
  assert.deepStrictEqual(readRect(out + 8), [0,0,800,600]);
  assert.deepStrictEqual(readRect(outerRect), [123,0,800,600], 'nested call preserves outer RECT');
  e.set_esp(outerEsp); e.set_eip(yes); finish();
  assert.deepStrictEqual(readRect(out + 8), [123,0,800,600]);
  assert.strictEqual(e.get_esp(), stack + 20);
  const dc = e.test_monitor_screen_dc();
  assert(dc);
  putRect([10,20,300,400]); e.test_monitor_clip(dc, clip, 0);
  putRect([50,60,80,90]); e.test_monitor_clip(dc, clip, 1);
  e.test_monitor_color(dc, 0x112233);
  e.test_monitor_viewport(dc, 10);
  putRect([30,40,200,250]); begin(yes, clip, stack, dc);
  assert(e.get_eip(), 'nonempty DC selection invokes callback');
  assert.strictEqual(e.test_monitor_visible(dc, 20,30), 0, 'callback is clipped to selection');
  assert.strictEqual(e.test_monitor_visible(dc, 60,70), 0, 'complex clip hole survives');
  assert.strictEqual(e.test_monitor_visible(dc, 90,100), 1);
  assert.strictEqual(e.test_monitor_pixel(dc, 80,100,0x123456), 0x123456,
    'callback can draw through the mapped DC inside the clip');
  assert.strictEqual(e.test_monitor_pixel(dc, 50,70,0x123456), -1,
    'rasterizer rejects drawing in the complex clip hole');
  assert.strictEqual(e.test_monitor_pixel(dc, 10,30,0x123456), -1,
    'rasterizer rejects drawing outside enumeration selection');
  e.test_monitor_color(dc, 0x445566); // state change made during the callback
  e.test_monitor_viewport(dc, 99);
  finish();
  assert.strictEqual(e.guest_read32(out + 4), dc, 'callback receives a real display DC');
  assert.deepStrictEqual(readRect(out + 8), [30,40,200,250]);
  assert.strictEqual(e.test_monitor_color(dc, 0x112233), 0x112233, 'caller attributes restored');
  assert.strictEqual(e.test_monitor_viewport(dc, 0), 10, 'caller mapping restored');
  assert.strictEqual(e.test_monitor_visible(dc, 20,30), 1, 'caller clip restored');
  assert.strictEqual(e.test_monitor_visible(dc, 60,70), 0, 'caller clip hole restored');
  putRect([50,60,80,90]); begin(yes, clip, stack, dc); finish();
  assert.strictEqual(e.guest_read32(out + 28), 0, 'selection wholly in a clip hole skips callback');
  assert.strictEqual(e.get_eax(), 1);
  begin(no, 0, stack, dc); finish();
  assert.strictEqual(e.get_eax(), 0);
  assert.strictEqual(e.test_monitor_visible(dc, 20,30), 1, 'FALSE callback restores clip');
  for (const r of [[300,20,400,40], [90,100,80,90], [40,40,40,50]]) {
    putRect(r); begin(yes, clip, stack, dc); finish();
    assert.strictEqual(e.guest_read32(out + 28), 0, 'empty DC selection has no callback');
    assert.strictEqual(e.get_eax(), 1);
  }
  putRect([30,40,200,250]); begin(yes, clip, stack, dc);
  const savedOuterEsp = e.get_esp();
  putRect([90,100,120,130]); begin(yes, clip, savedOuterEsp - 64, dc);
  assert.strictEqual(e.test_monitor_visible(dc, 40,50), 0);
  finish();
  assert.deepStrictEqual(readRect(out + 8), [90,100,120,130]);
  assert.strictEqual(e.test_monitor_visible(dc, 40,50), 1, 'inner return restores outer clip');
  assert.strictEqual(e.test_monitor_visible(dc, 20,30), 0, 'outer selection still applies');
  e.set_esp(savedOuterEsp); e.set_eip(yes); finish();
  assert.strictEqual(e.test_monitor_visible(dc, 20,30), 1, 'outer return restores original clip');
  const windowDC = e.test_monitor_window_dc();
  assert(windowDC);
  begin(yes, 0, stack, windowDC); finish();
  assert.deepStrictEqual(readRect(out + 8), [20,0,100,100],
    'off-screen window DC clips against monitor bounds in DC coordinates');
  for (let i = 0; i < 300; i++) {
    begin(yes, 0, stack, dc); finish();
    assert.strictEqual(e.guest_read32(out + 28), 1, 'temporary regions must not exhaust the pool');
  }
  assert.strictEqual(e.test_monitor_save_level(dc), 1, 'enumeration leaves no saved DC frames');
  console.log('PASS monitor enumeration: real callbacks, geometry, clipping, FALSE, stack restoration and nesting');
})().catch(error => { console.error(error); process.exit(1); });
