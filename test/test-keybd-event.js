#!/usr/bin/env node
'use strict';

// keybd_event is input synthesis, not PostMessage. Its messages must enter the
// same system-input path as browser keys so queue ordering, hot keys and
// keyboard hooks observe them before the application receives the MSG.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const WM_HOTKEY = 0x0312;
const PM_REMOVE = 1;

const extraWat = String.raw`
  (global $test_keybd_msg (mut i32) (i32.const 0))

  (func (export "test_keybd_target") (param $hwnd i32)
    (global.set $main_hwnd (local.get $hwnd))
    (global.set $focus_hwnd (local.get $hwnd)))

  (func (export "test_keybd_event")
      (param $vk i32) (param $scan i32) (param $flags i32) (param $extra i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x5a5a5a5a))
    (call $handle_keybd_event
      (local.get $vk) (local.get $scan) (local.get $flags) (local.get $extra)
      (i32.const 0) (i32.const 0))
    (i32.load offset=16 (global.get $reg_base)))

  (func (export "test_keybd_peek") (result i32)
    (if (i32.eqz (global.get $test_keybd_msg))
      (then (global.set $test_keybd_msg (call $heap_alloc (i32.const 28)))))
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_PeekMessageA
      (global.get $test_keybd_msg) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const ${PM_REMOVE}) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_keybd_msg_field") (param $field i32) (result i32)
    (call $gl32 (i32.add (global.get $test_keybd_msg)
      (i32.mul (local.get $field) (i32.const 4)))))

  (func (export "test_keybd_key_state") (param $vk i32) (result i32)
    (call $host_get_key_down_state (local.get $vk)))

  (func (export "test_keybd_register_hotkey")
      (param $id i32) (param $mods i32) (param $vk i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_RegisterHotKey
      (i32.const 0) (local.get $id) (local.get $mods) (local.get $vk)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

function msg(e) {
  assert.strictEqual(e.test_keybd_peek(), 1, 'a synthesized key is retrievable');
  return {
    hwnd: e.test_keybd_msg_field(0) >>> 0,
    message: e.test_keybd_msg_field(1) >>> 0,
    wParam: e.test_keybd_msg_field(2) >>> 0,
    lParam: e.test_keybd_msg_field(3) >>> 0,
  };
}

(async () => {
  let rendererRef = null;
  let lastInput = null;
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      check_input: () => {
        lastInput = rendererRef && rendererRef.takeInput();
        return lastInput
          ? ((lastInput.wParam << 16) | (lastInput.msg & 0xffff))
          : 0;
      },
      check_input_hwnd: () => lastInput ? lastInput.hwnd : 0,
      check_input_lparam: () => lastInput ? lastInput.lParam : 0,
      check_input_wparam: () => lastInput ? lastInput.wParam : 0,
    },
  });
  const { exports: e, renderer } = harness;
  rendererRef = renderer;
  e.test_keybd_target(0x10002);

  assert.strictEqual(e.test_keybd_event(0, 0, 0, 0), 0x00300014);
  assert.strictEqual(e.test_keybd_event(0xff, 0, 0, 0), 0x00300014);
  assert.strictEqual(renderer.inputQueue.length, 0,
    'virtual-key values outside the documented 1..254 range are ignored');

  assert.strictEqual(e.test_keybd_event(0x41, 0x1e, 0, 0x12345678), 0x00300014,
    'the void stdcall pops four arguments');
  assert.strictEqual(renderer.inputQueue.length, 1,
    'keydown enters the renderer system-input FIFO');
  assert.deepStrictEqual({
    hwnd: renderer.inputQueue[0].hwnd,
    msg: renderer.inputQueue[0].msg,
    wParam: renderer.inputQueue[0].wParam,
    lParam: renderer.inputQueue[0].lParam >>> 0,
    extraInfo: renderer.inputQueue[0].extraInfo >>> 0,
  }, {
    hwnd: 0x10002,
    msg: WM_KEYDOWN,
    wParam: 0x41,
    lParam: 0x001e0001,
    extraInfo: 0x12345678,
  }, 'the event retains its target, scan code and caller metadata');
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_KEYDOWN, wParam: 0x41, lParam: 0x001e0001,
  });
  assert.strictEqual(e.test_keybd_key_state(0x41), 0x8000,
    'the dequeued keydown exposes its event-time down state');

  e.test_keybd_event(0x41, 0x1e, 0x02, 0);
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_KEYUP, wParam: 0x41, lParam: 0xc01e0001,
  }, 'keyup sets previous-state and transition bits');
  assert.strictEqual(e.test_keybd_key_state(0x41), 0,
    'the dequeued keyup exposes its event-time up state');

  e.test_keybd_event(0x26, 0x48, 0x01, 0);
  e.test_keybd_event(0x26, 0x48, 0x01, 0);
  assert.strictEqual(renderer.inputQueue[0].lParam >>> 0, 0x01480001,
    'an extended first press carries scan and extended bits');
  assert.strictEqual(renderer.inputQueue[1].lParam >>> 0, 0x41480001,
    'a repeated press additionally carries previous-state');
  assert.strictEqual(msg(e).message, WM_KEYDOWN);
  assert.strictEqual(msg(e).message, WM_KEYDOWN);
  e.test_keybd_event(0x26, 0x48, 0x03, 0);
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_KEYUP, wParam: 0x26, lParam: 0xc1480001,
  });

  e.test_keybd_event(0x12, 0x38, 0, 0);       // Alt down
  e.test_keybd_event(0x58, 0x2d, 0, 0);       // Alt+X down
  e.test_keybd_event(0x58, 0x2d, 0x02, 0);    // Alt+X up
  e.test_keybd_event(0x12, 0x38, 0x02, 0);    // Alt up
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_SYSKEYDOWN, wParam: 0x12, lParam: 0x00380001,
  }, 'Alt itself starts a system-key sequence');
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_SYSKEYDOWN, wParam: 0x58, lParam: 0x202d0001,
  }, 'Alt-modified keydown carries the context bit');
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_SYSKEYUP, wParam: 0x58, lParam: 0xe02d0001,
  });
  assert.deepStrictEqual(msg(e), {
    hwnd: 0x10002, message: WM_SYSKEYUP, wParam: 0x12, lParam: 0xe0380001,
  });

  assert.strictEqual(e.test_keybd_register_hotkey(7, 0x02, 0x4b), 1,
    'the test registers Ctrl+K');
  e.test_keybd_event(0x11, 0x1d, 0, 0);       // Ctrl down
  e.test_keybd_event(0x4b, 0x25, 0, 0);       // K down
  e.test_keybd_event(0x11, 0x1d, 0x02, 0);    // Ctrl up before dequeue
  assert.strictEqual(renderer.peekKeyDownState(0x11), 0,
    'physical state already reflects the later synthetic release');
  assert.strictEqual(msg(e).message, WM_KEYDOWN,
    'the modifier event itself remains an ordinary key message');
  assert.strictEqual(e.test_keybd_key_state(0x11), 0x8000,
    'message-time state retains Ctrl for the earlier queued event');
  assert.deepStrictEqual(msg(e), {
    hwnd: 0, message: WM_HOTKEY, wParam: 7, lParam: 0x004b0002,
  }, 'the K event matches Ctrl from its own queue-time snapshot');
  assert.strictEqual(msg(e).message, WM_KEYUP);

  console.log('PASS keybd_event synthesizes ordered Win98 keyboard input');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
