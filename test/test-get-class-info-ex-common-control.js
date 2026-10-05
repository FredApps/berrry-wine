#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_get_class_info_ex_a")
      (param $instance i32) (param $name i32) (param $out i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetClassInfoExA
      (local.get $instance) (local.get $name) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))

  (func (export "test_get_class_info_ex_w")
      (param $instance i32) (param $name i32) (param $out i32) (result i32)
    (local $saved_esp i32)
    (local.set $saved_esp (i32.load offset=16 (global.get $reg_base)))
    (call $handle_GetClassInfoExW
      (local.get $instance) (local.get $name) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.store offset=16 (global.get $reg_base) (local.get $saved_esp))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const toWasm = guest => (guest - imageBase + guestBase) >>> 0;

  const ansi = text => {
    const ptr = e.guest_alloc(text.length + 1) >>> 0;
    bytes.set(Buffer.from(`${text}\0`, 'latin1'), toWasm(ptr));
    return ptr;
  };
  const wide = text => {
    const ptr = e.guest_alloc((text.length + 1) * 2) >>> 0;
    const wa = toWasm(ptr);
    for (let i = 0; i < text.length; i++) {
      view.setUint16(wa + i * 2, text.charCodeAt(i), true);
    }
    view.setUint16(wa + text.length * 2, 0, true);
    return ptr;
  };
  const output = () => {
    const ptr = e.guest_alloc(48) >>> 0;
    bytes.fill(0xa5, toWasm(ptr), toWasm(ptr) + 48);
    return ptr;
  };
  const assertClass = (name, out, ctrlClass) => {
    const wa = toWasm(out);
    assert.strictEqual(view.getUint32(wa, true), 48, 'WNDCLASSEX cbSize');
    assert.strictEqual(view.getUint32(wa + 8, true), (0xfffe0100 | ctrlClass) >>> 0,
      'common control must use its WAT system-class wndproc marker');
    assert.strictEqual(view.getUint32(wa + 40, true), name,
      'WNDCLASSEX must echo the caller\'s class-name pointer');
  };

  const nameA = ansi('msctls_trackbar32');
  const outA = output();
  assert.strictEqual(e.test_get_class_info_ex_a(0, nameA, outA), 1);
  assertClass(nameA, outA, 19);

  const nameW = wide('msctls_trackbar32');
  const outW = output();
  assert.strictEqual(e.test_get_class_info_ex_w(0, nameW, outW), 1);
  assertClass(nameW, outW, 19);

  const progressA = ansi('msctls_progress32');
  const progressOutA = output();
  assert.strictEqual(e.test_get_class_info_ex_a(0, progressA, progressOutA), 1);
  assertClass(progressA, progressOutA, 17);

  const progressW = wide('msctls_progress32');
  const progressOutW = output();
  assert.strictEqual(e.test_get_class_info_ex_w(0, progressW, progressOutW), 1);
  assertClass(progressW, progressOutW, 17);

  const richA = ansi('RICHEDIT');
  const richOutA = output();
  assert.strictEqual(e.test_get_class_info_ex_a(0, richA, richOutA), 1,
    'Win98 RICHEDIT is discoverable as a system class');
  assertClass(richA, richOutA, 24);

  const richW = wide('RichEdit20W');
  const richOutW = output();
  assert.strictEqual(e.test_get_class_info_ex_w(0, richW, richOutW), 1,
    'RichEdit 2.0 is discoverable through the Unicode query too');
  assertClass(richW, richOutW, 25);

  // Win98 COMCTL32 probes its own classes with the DLL HINSTANCE before it
  // calls RegisterClass. Reporting the browser fallback here suppresses that
  // native registration and leaves WinRAR with placeholder toolbar buttons.
  const toolbarA = ansi('ToolbarWindow32');
  const toolbarW = wide('ToolbarWindow32');
  assert.strictEqual(e.test_get_class_info_ex_a(0x0063f000, toolbarA, output()), 0,
    'an unregistered COMCTL class is not fabricated for a DLL instance');
  assert.strictEqual(e.test_get_class_info_ex_w(0x0063f000, toolbarW, output()), 0,
    'the wide COMCTL lookup has the same registration boundary');
  const toolbarOut = output();
  assert.strictEqual(e.test_get_class_info_ex_a(0, toolbarA, toolbarOut), 1,
    'NULL hInstance keeps the browser system-class fallback');
  assertClass(toolbarA, toolbarOut, 21);

  assert.strictEqual(e.test_get_class_info_ex_a(0, ansi('not_a_real_control'), output()), 0,
    'unknown classes must still fail');
  console.log('PASS  GetClassInfoExA/W describe implemented common controls and RichEdit classes');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
