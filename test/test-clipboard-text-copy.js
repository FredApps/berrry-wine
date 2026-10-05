#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// Exercise the public handler; these globals only arrange the open transaction.
const extraWat = String.raw`
  (func (export "prepare_text_clipboard") (param $open i32)
    (global.set $clipboard_open (local.get $open))
    (global.set $clipboard_owner_hwnd (i32.const 0x10001))
    (global.set $clipboard_emptied_by_opener (i32.const 1)))
  (func (export "set_text_clipboard") (param $fmt i32) (param $src i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_SetClipboardData (local.get $fmt) (local.get $src)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i64.or (i64.extend_i32_u (i32.load (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
  (func (export "text_clipboard_sequence") (result i32)
    (call $handle_GetClipboardSequenceNumber (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const bytes = new Uint8Array(memory.buffer);
  const put = text => {
    const encoded = Buffer.from(text + '\0', 'ascii');
    const ptr = e.guest_alloc(encoded.length) >>> 0;
    assert(ptr);
    bytes.set(encoded, e.guest_to_wasm(ptr) >>> 0);
    return ptr;
  };
  const set = (fmt, src, succeeds = true) => {
    const before = e.text_clipboard_sequence() >>> 0;
    const result = e.set_text_clipboard(fmt, src);
    assert.strictEqual(Number(result >> 32n), 0x0030000c, 'stdcall pops 12 bytes');
    assert.strictEqual(Number(result & 0xffffffffn), succeeds ? src : 0, 'return handle');
    assert.strictEqual(e.text_clipboard_sequence() >>> 0, before + Number(succeeds), 'sequence');
  };
  const check = (text, label) => {
    assert.strictEqual(e.clipboard_text_len(), text.length, label + ': full length');
    const ptr = e.clipboard_get_data_handle(1) >>> 0;
    assert(ptr, label + ': materialized handle');
    const start = e.guest_to_wasm(ptr) >>> 0;
    assert(Buffer.from(bytes.subarray(start, start + text.length + 1))
      .equals(Buffer.from(text + '\0', 'ascii')), label + ': complete bytes and NUL');
    return ptr;
  };

  e.prepare_text_clipboard(1);
  // ASCII is shared by ANSI/OEM; this does not certify code-page conversion.
  for (const fmt of [1, 7]) {
    for (const length of [1, 65535, 65536, 65537, 70000]) {
      const text = 'Abc123'.repeat(Math.ceil(length / 6)).slice(0, length);
      const src = put(text);
      set(fmt, src);
      const owned = check(text, `${fmt}/${length}`);
      assert.notStrictEqual(owned, src, 'current emulator snapshot is independently owned');
    }
  }

  for (const addr of [0x30000000, 0x28000000, 0x30001000]) {
    assert.strictEqual(e.test_virtual_map_commit(addr, 4096) >>> 0, addr);
  }
  assert.notStrictEqual(e.guest_to_wasm(0x30001000) >>> 0,
    (e.guest_to_wasm(0x30000000) >>> 0) + 4096, 'noncontiguous backing fixture');
  const sparse = 0x30001000 - 9;
  const text = 'sparse clipboard text crosses a guest page';
  for (const [i, byte] of Buffer.from(text + '\0').entries()) e.guest_write8(sparse + i, byte);
  for (const fmt of [1, 7]) {
    set(fmt, sparse);
    check(text, `${fmt}/sparse`);
  }

  // Internal robustness, not a claim that Windows permits retransferring a
  // clipboard-owned handle or an interior pointer as a new HGLOBAL.
  let owned = e.clipboard_get_data_handle(1) >>> 0;
  set(1, owned);
  owned = check(text, 'self copy');
  set(1, owned + 7);
  check(text.slice(7), 'overlapping suffix');
  set(1, 0, false);
  check(text.slice(7), 'NULL preserves snapshot (delayed rendering remains unsupported)');
  e.prepare_text_clipboard(0);
  set(1, sparse, false);
  check(text.slice(7), 'closed transaction preserves snapshot');
  console.log('PASS public clipboard text: long/sparse copies, alias safety, return/ESP/sequence');
})().catch(error => { console.error(error); process.exitCode = 1; });
