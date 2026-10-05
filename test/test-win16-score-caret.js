#!/usr/bin/env node
'use strict';
// Exercise WEPUTIL's actual name-entry resource, not the Hall of Fame viewer.
// This isolates template/control/compositor behavior; it does not fake a score
// in a running game or claim to test Safari's keyboard activation policy.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('../tools/ne-dump');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { b, h } = parse(path.join(__dirname, 'binaries/wep16/WEP2/WEPUTIL.DLL'));
  let resource;
  const shift = b.readUInt16LE(h.resTableOff);
  for (let p = h.resTableOff + 2; b.readUInt16LE(p);) {
    const type = b.readUInt16LE(p), count = b.readUInt16LE(p + 2);
    p += 8;
    for (let i = 0; i < count; i++, p += 12) {
      if (type === 0x8005 && b.readUInt16LE(p + 6) === 0x80c8) {
        const off = b.readUInt16LE(p) << shift, len = b.readUInt16LE(p + 2) << shift;
        resource = b.subarray(off, off + len);
      }
    }
  }
  assert(resource && resource.includes(Buffer.from('Please enter your name:')));
  const harness = await bootRenderHarness({ fonts: 'bitmap', extraWat: `
    (func (export "score_template") (param $src i32) (param $len i32)
      (global.set $is_win16 (i32.const 1))
      (call $wnd_table_set (i32.const 0x10001) (global.get $WNDPROC_DIALOG))
      (global.set $next_hwnd (i32.const 0x10002))
      (global.set $dlg_indirect_template_ptr
        (call $win16_dlg_to32 (local.get $src) (local.get $len)))
      (drop (call $dlg_load (i32.const 0x10001) (i32.const 0)))
      (drop (call $wnd_set_style (i32.const 0x10001) (i32.const 0x90c80000)))
      (call $host_dialog_loaded (i32.const 0x10001) (i32.const 0))
      (call $defwndproc_do_nccalcsize (i32.const 0x10001))
      (drop (call $host_show_window (i32.const 0x10001) (i32.const 1))))
  ` });
  const { exports: e, renderer, memory } = harness;
  const ptr = e.guest_alloc(resource.length);
  new Uint8Array(memory.buffer, e.guest_to_wasm(ptr), resource.length).set(resource);
  e.score_template(e.guest_to_wasm(ptr), resource.length);
  const edit = e.get_focus_hwnd();
  assert.strictEqual(e.ctrl_get_class(edit), 2);
  assert.strictEqual(e.ctrl_get_id(edit), 500);
  assert.strictEqual(e.get_caret_hwnd(), edit);
  assert.strictEqual(e.get_caret_visible(), 1);
  assert.strictEqual(renderer.windows[edit], undefined, 'control exists only in USER');
  renderer._paintCaretOverlay();
  assert(renderer.caretRect(), 'the compositor exposes the real name-entry caret');
  for (const ch of 'Phone') e.send_message(edit, 0x102, ch.charCodeAt(0), 0);
  assert.strictEqual(e.send_message(edit, 0x0e, 0, 0), 5, 'name reaches the real Edit state');
  renderer._paintCaretOverlay();
  assert(renderer.caretRect(), 'typing retains the mobile keyboard anchor');
  renderer.windows[0x10001].visible = false;
  renderer._paintCaretOverlay();
  assert.strictEqual(renderer.caretRect(), null, 'hidden prompt has no keyboard anchor');
  e.guest_free(ptr);
  console.log('PASS WEPUTIL name-entry resource: Edit 500 focus, caret, typing and compositor');
})().catch(err => { console.error(err); process.exitCode = 1; });
