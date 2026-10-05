#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  ;; which: 0=RegA, 1=SHA, 2=RegW, 3=SHW.  The sixth stdcall argument lives
  ;; on the guest stack; the first five are supplied by the dispatcher.
  (func (export "test_reg_query_value_ex_entry")
        (param $which i32) (param $hkey i32) (param $name i32)
        (param $reserved i32) (param $type i32) (param $data i32)
        (param $cb i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $gs32 (i32.add (i32.load offset=16 (global.get $reg_base)) (i32.const 24)) (local.get $cb))
    (if (i32.eq (local.get $which) (i32.const 0))
      (then (call $handle_RegQueryValueExA
        (local.get $hkey) (local.get $name) (local.get $reserved)
        (local.get $type) (local.get $data) (i32.const 0)))
      (else (if (i32.eq (local.get $which) (i32.const 1))
        (then (call $handle_SHQueryValueExA
          (local.get $hkey) (local.get $name) (local.get $reserved)
          (local.get $type) (local.get $data) (i32.const 0)))
        (else (if (i32.eq (local.get $which) (i32.const 2))
          (then (call $handle_RegQueryValueExW
            (local.get $hkey) (local.get $name) (local.get $reserved)
            (local.get $type) (local.get $data) (i32.const 0)))
          (else (call $handle_SHQueryValueExW
            (local.get $hkey) (local.get $name) (local.get $reserved)
            (local.get $type) (local.get $data) (i32.const 0))))))))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory, host } = await bootRenderHarness({
    extraWat,
    fonts: 'none',
  });
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const wa = guest => (guest - (e.get_image_base() >>> 0) +
    (e.get_guest_base() >>> 0)) >>> 0;
  const alloc32 = value => {
    const guest = e.guest_alloc(4) >>> 0;
    view.setUint32(wa(guest), value >>> 0, true);
    return guest;
  };
  const allocA = text => {
    const guest = e.guest_alloc(text.length + 1) >>> 0;
    bytes.set(Buffer.from(text, 'latin1'), wa(guest));
    bytes[wa(guest) + text.length] = 0;
    return guest;
  };
  const allocW = text => {
    const guest = e.guest_alloc(text.length * 2 + 2) >>> 0;
    for (let i = 0; i < text.length; i++) {
      view.setUint16(wa(guest) + i * 2, text.charCodeAt(i), true);
    }
    view.setUint16(wa(guest) + text.length * 2, 0, true);
    return guest;
  };
  const readA = guest => {
    let text = '';
    for (let i = 0; bytes[wa(guest) + i]; i++) {
      text += String.fromCharCode(bytes[wa(guest) + i]);
    }
    return text;
  };
  const readW = guest => {
    let text = '';
    for (let i = 0; ; i++) {
      const ch = view.getUint16(wa(guest) + i * 2, true);
      if (!ch) break;
      text += String.fromCharCode(ch);
    }
    return text;
  };

  const HKCU = 0x80000001;
  const keyOut = alloc32(0);
  assert.strictEqual(host.reg_create_key(
    HKCU, wa(allocA('Software\\QueryValueExTwinTest')), keyOut, 0, 0), 0);
  const hkey = e.guest_read32(keyOut) >>> 0;

  const ansiName = allocA('AnsiValue');
  const ansiValueText = 'browser98';
  const ansiValue = allocA(ansiValueText);
  assert.strictEqual(host.reg_set_value(
    hkey, wa(ansiName), 1, ansiValue, ansiValueText.length + 1, 0), 0);

  const wideName = allocW('WideValue');
  const wideValueText = 'wide browser';
  const wideValue = allocW(wideValueText);
  assert.strictEqual(host.reg_set_value(
    hkey, wa(wideName), 1, wideValue, (wideValueText.length + 1) * 2, 1), 0);

  const type = alloc32(0);
  const cb = alloc32(0);
  const out = e.guest_alloc(64) >>> 0;
  const invoke = (which, name, data) => {
    const result = e.test_reg_query_value_ex_entry(
      which, hkey, name, 0, type, data, cb) >>> 0;
    assert.strictEqual(e.get_esp() >>> 0, 0x0030001c,
      'each public entry performs exactly one six-argument stdcall cleanup');
    return result;
  };

  for (const which of [0, 1]) {
    e.guest_write32(type, 0xcccccccc);
    e.guest_write32(cb, 0);
    assert.strictEqual(invoke(which, ansiName, 0), 0);
    assert.strictEqual(e.guest_read32(type) >>> 0, 1);
    assert.strictEqual(e.guest_read32(cb) >>> 0, ansiValueText.length + 1,
      'ANSI size query includes the terminating byte');

    e.guest_write32(cb, 3);
    assert.strictEqual(invoke(which, ansiName, out), 234,
      'short ANSI buffers report ERROR_MORE_DATA');
    assert.strictEqual(e.guest_read32(cb) >>> 0, ansiValueText.length + 1);

    e.guest_write32(cb, 64);
    assert.strictEqual(invoke(which, ansiName, out), 0);
    assert.strictEqual(readA(out), ansiValueText);
    assert.strictEqual(e.guest_read32(cb) >>> 0, ansiValueText.length + 1);
  }

  for (const which of [2, 3]) {
    e.guest_write32(type, 0xcccccccc);
    e.guest_write32(cb, 0);
    assert.strictEqual(invoke(which, wideName, 0), 0);
    assert.strictEqual(e.guest_read32(type) >>> 0, 1);
    assert.strictEqual(e.guest_read32(cb) >>> 0, (wideValueText.length + 1) * 2,
      'wide size query is measured in bytes and includes the terminator');

    e.guest_write32(cb, 4);
    assert.strictEqual(invoke(which, wideName, out), 234,
      'short wide buffers report ERROR_MORE_DATA');
    assert.strictEqual(e.guest_read32(cb) >>> 0, (wideValueText.length + 1) * 2);

    e.guest_write32(cb, 64);
    assert.strictEqual(invoke(which, wideName, out), 0);
    assert.strictEqual(readW(out), wideValueText);
    assert.strictEqual(e.guest_read32(cb) >>> 0, (wideValueText.length + 1) * 2);
  }

  const missing = allocW('MissingValue');
  for (const which of [2, 3]) {
    e.guest_write32(type, 0xaaaaaaaa);
    e.guest_write32(cb, 0xbbbbbbbb);
    assert.strictEqual(invoke(which, missing, 0), 2,
      'missing values report ERROR_FILE_NOT_FOUND');
    assert.strictEqual(e.guest_read32(type) >>> 0, 0xaaaaaaaa);
    assert.strictEqual(e.guest_read32(cb) >>> 0, 0xbbbbbbbb,
      'failed queries leave optional output metadata undefined/untouched here');
  }

  console.log('PASS RegQueryValueExA/W and SHQueryValueExA/W share query semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
