#!/usr/bin/env node
'use strict';

// A registered window message broadcast to HWND_BROADCAST reaches the other
// running apps, each under its OWN id for that name.
//
// InstallShield 3 is the case: the 32-bit engine (_INS0432._MP) closes the
// 16-bit SETUP.EXE launcher by sending LOGO_MSG_LOGOCLOSE_30 to HWND_BROADCAST.
// On Windows the id comes from the global atom table, so both processes agree
// on it; here each app interns into its own table, so the two ids differ and
// the broadcast has to travel by name. Without it the launcher's "preparing
// the InstallShield Wizard" window and its progress box stayed up for good.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_register") (param $name i32) (result i32)
    (call $register_window_message (local.get $name)))
  (func (export "test_window") (param $h i32) (param $parent i32) (param $style i32)
    (call $wnd_table_set (local.get $h) (i32.const 0x12345678))
    (drop (call $wnd_set_style (local.get $h) (local.get $style)))
    (call $wnd_set_parent (local.get $h) (local.get $parent)))
  (func (export "test_post") (param $h i32) (param $msg i32) (param $w i32) (param $l i32)
    (local $sp i32)
    (local.set $sp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_PostMessageA (local.get $h) (local.get $msg) (local.get $w)
      (local.get $l) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp)))
`;

function writeName(h, guest, text) {
  const bytes = new Uint8Array(h.memory.buffer, h.exports.get_guest_base() + guest, text.length + 1);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  bytes[text.length] = 0;
  return guest;
}

function queue(h) {
  const e = h.exports;
  const out = [];
  for (let i = 0; i < e.post_queue_depth(); i++) {
    out.push([0, 1, 2, 3].map(f => e.post_queue_peek(i, f) >>> 0));
  }
  return out;
}

(async () => {
  const sender = await bootRenderHarness({ extraWat, fonts: 'none' });
  const receiver = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stranger = await bootRenderHarness({ extraWat, fonts: 'none' });
  const sameProcess = await bootRenderHarness({ extraWat, fonts: 'none' });

  // Registration order differs, so the ids differ -- the whole point.
  sender.exports.test_register(writeName(sender, 0x3100, 'Some_Other_Message'));
  const idSender = sender.exports.test_register(writeName(sender, 0x3140, 'LOGO_MSG_LOGOCLOSE_30'));
  const idReceiver = receiver.exports.test_register(writeName(receiver, 0x3140, 'logo_msg_logoclose_30'));
  sameProcess.exports.test_register(writeName(sameProcess, 0x3140, 'LOGO_MSG_LOGOCLOSE_30'));
  assert.ok(idSender >= 0xC000 && idReceiver >= 0xC000, 'registered ids are in the 0xC000 range');
  assert.notStrictEqual(idSender, idReceiver, 'the two apps number the name differently');

  // Receiver: a visible top-level, its child, and a hidden popup (InstallShield's
  // listener is the hidden "InstallShieldSetup30" popup).
  receiver.exports.test_window(0x2001, 0, 0x10CF0000);
  receiver.exports.test_window(0x2002, 0x2001, 0x50000000);
  receiver.exports.test_window(0x2003, 0, 0x80000000);
  stranger.exports.test_window(0x2001, 0, 0x10CF0000);
  sameProcess.exports.test_window(0x2001, 0, 0x10CF0000);

  // One shared renderer, as in the browser: windows of every running app.
  const windows = {
    0x1001: { wasm: sender.instance, processId: 1 },
    0x2001: { wasm: receiver.instance, processId: 2 },
    0x2003: { wasm: receiver.instance, processId: 2 },
    0x3001: { wasm: stranger.instance, processId: 3 },
    // Another instance of the SENDER's process (a worker-mode host shadow):
    // delivering there would hand the broadcast back to the sender.
    0x4001: { wasm: sameProcess.instance, processId: 1 },
  };
  sender.hostCtx.renderer.windows = windows;
  sender.hostCtx.processId = 1;

  const before = queue(receiver).length;
  sender.exports.test_post(0xFFFF, idSender, 7, 9);
  const got = queue(receiver).slice(before);
  assert.deepStrictEqual(got.map(m => m[0]).sort(), [0x2001, 0x2003],
    'every top-level window of the other app gets it, hidden ones included, children not');
  for (const m of got) {
    assert.strictEqual(m[1], idReceiver, "delivered under the receiver's own id");
    assert.strictEqual(m[2], 7, 'wParam carried');
    assert.strictEqual(m[3], 9, 'lParam carried');
  }
  assert.strictEqual(queue(stranger).length, 0,
    'an app that never registered the name gets nothing');
  assert.strictEqual(queue(sameProcess).length, 0,
    "the sender's own process is not a broadcast target");

  // HWND_BROADCAST spelled -1 (InstallShield pushes 6a ff) goes the same way.
  const before2 = queue(receiver).length;
  sender.exports.test_post(-1, idSender, 1, 2);
  assert.strictEqual(queue(receiver).length - before2, 2, 'HWND -1 is HWND_BROADCAST too');

  // A plain WM_USER message has no meaning outside its own process.
  const before3 = queue(receiver).length;
  sender.exports.test_post(0xFFFF, 0x0400, 0, 0);
  assert.strictEqual(queue(receiver).length, before3, 'an unregistered message stays home');

  // A message posted to a specific window never crosses.
  sender.exports.test_post(0x1001, idSender, 0, 0);
  assert.strictEqual(queue(receiver).length, before3, 'a directed post stays home');

  console.log('PASS test-registered-broadcast-cross-instance');
})().catch(err => { console.error(err); process.exit(1); });
