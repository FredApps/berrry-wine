#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "prepare_dib_clipboard")
    (global.set $clipboard_open (i32.const 1))
    (global.set $clipboard_open_hwnd (i32.const 0x10001))
    (global.set $clipboard_owner_hwnd (i32.const 0x10001))
    (global.set $clipboard_emptied_by_opener (i32.const 1)))
  (func (export "dib_api") (param $op i32) (param $arg i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (if (i32.eq (local.get $op) (i32.const 0)) (then
      (call $handle_GlobalAlloc (i32.const 0x42) (local.get $arg)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 1)) (then
      (call $handle_SetClipboardData (i32.const 8) (local.get $arg)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 2)) (then
      (call $handle_GetClipboardData (local.get $arg) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 3)) (then
      (call $handle_GlobalLock (local.get $arg) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 4)) (then
      (call $handle_GlobalSize (local.get $arg) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 5)) (then
      (call $handle_GlobalFree (local.get $arg) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 6)) (then
      (call $handle_GetClipboardSequenceNumber (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 7)) (then
      (call $handle_SetClipboardData (i32.const 1) (local.get $arg)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 8)) (then
      (call $handle_EnumClipboardFormats (local.get $arg) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (if (i32.eq (local.get $op) (i32.const 9)) (then
      (call $handle_EmptyClipboard (i32.const 0) (i32.const 0)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (i64.or (i64.extend_i32_u (i32.load (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
  (func (export "synthesize_clipboard_rtf")
    (call $clipboard_build_basic_rtf_from_text_clipboard))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const api = (op, arg = 0) => {
    const result = e.dib_api(op, arg);
    assert.strictEqual(Number(result >> 32n), 0x00300000 + (op < 2 || op === 7 ? 12 : op === 6 || op === 9 ? 4 : 8));
    return Number(result & 0xffffffffn);
  };
  e.prepare_dib_clipboard();
  const source = api(0, 44); // BITMAPINFOHEADER + one padded 24-bit pixel
  assert(source);
  const size = api(4, source);
  assert(size >= 44);
  const bytes = new Uint8Array(memory.buffer);
  const wa = e.guest_to_wasm(source) >>> 0;
  const dv = new DataView(memory.buffer);
  dv.setUint32(wa, 40, true);
  dv.setInt32(wa + 4, 1, true);
  dv.setInt32(wa + 8, 1, true);
  dv.setUint16(wa + 12, 1, true);
  dv.setUint16(wa + 14, 24, true);
  bytes.set([11, 22, 33, 0], wa + 40);
  const expected = Buffer.from(bytes.subarray(wa, wa + size));
  const before = api(6);
  assert.strictEqual(api(1, source), source, 'SetClipboardData returns the supplied handle');
  assert.strictEqual(api(6), before + 1);
  const snapshot = api(2, 8);
  assert(snapshot);
  assert.strictEqual(api(3, snapshot), snapshot, 'GetClipboardData result can be GlobalLocked');
  assert.strictEqual(api(4, snapshot), size, 'GlobalSize preserves the copied extent');
  const target = e.guest_to_wasm(snapshot) >>> 0;
  assert(Buffer.from(bytes.subarray(target, target + size)).equals(expected));

  const ordinaryHeap = e.guest_alloc(80) >>> 0;
  // A forged tagged header inside payload must not pass provenance validation.
  e.guest_write32(ordinaryHeap + 4, 49);
  const stale = api(0, 44);
  assert.strictEqual(api(5, stale), 0);
  for (const invalid of [0, ordinaryHeap, ordinaryHeap + 8, stale, 0x30000000, source + 8]) {
    assert.strictEqual(api(1, invalid), 0, `reject invalid HGLOBAL 0x${invalid.toString(16)}`);
    assert.strictEqual(api(6), before + 1, 'failed store preserves sequence');
    assert.strictEqual(api(2, 8), snapshot, 'failed store preserves clipboard');
  }
  // Host image injection deliberately accepts a trusted guest_alloc block.
  const injected = e.clipboard_store_binary_data(8, ordinaryHeap) >>> 0;
  assert(injected);
  assert.strictEqual(api(3, injected), injected, 'host-injected snapshot is also lockable');

  const putString = text => {
    const data = Buffer.from(text + '\0');
    const ptr = api(0, data.length);
    bytes.set(data, e.guest_to_wasm(ptr) >>> 0);
    return ptr;
  };
  const lockFormat = (fmt, minimumSize) => {
    const sequence = api(6);
    const handle = api(2, fmt);
    assert(handle, `format ${fmt} has a handle`);
    assert.strictEqual(api(3, handle), handle, `format ${fmt} is GlobalLock-able`);
    assert(api(4, handle) >= minimumSize, `format ${fmt} GlobalSize covers bytes and terminator`);
    assert.strictEqual(api(2, fmt), handle, 'repeated publication keeps identity');
    assert.strictEqual(api(6), sequence, 'reading a format does not mutate its sequence');
    return handle;
  };
  const text = putString('clipboard text');
  assert.strictEqual(api(7, text), text);
  lockFormat(1, 15);
  lockFormat(7, 15); // ASCII only: no code-page-conversion claim.
  const rtf = putString('{\\rtf1 explicit}');
  e.clipboard_store_rtf_data(rtf);
  const format = e.clipboard_get_rtf_format_id();
  lockFormat(format, 17);
  // This is the same synthesis helper used by native Edit/RichEdit copy.
  e.synthesize_clipboard_rtf();
  lockFormat(format, e.clipboard_rtf_len() + 1);
  const absent = () => {
    assert.strictEqual(e.clipboard_count_formats(), 0);
    for (const fmt of [1, 7, format]) {
      assert.strictEqual(e.clipboard_is_format_available(fmt), 0);
      assert.strictEqual(api(2, fmt), 0);
    }
    assert.strictEqual(api(8, 0), 0);
  };
  const wrappedEmpty = fmt => {
    const object = e.test_ole_clipboard_wrap_win32() >>> 0;
    assert(object, 'present empty payload wraps as an OLE data object');
    const fe = e.guest_alloc(20) >>> 0;
    const medium = e.guest_alloc(12) >>> 0;
    for (let i = 0; i < 20; i++) e.guest_write8(fe + i, 0);
    e.guest_write32(fe, fmt);
    e.guest_write32(fe + 8, 1); // DVASPECT_CONTENT
    e.guest_write32(fe + 12, -1);
    e.guest_write32(fe + 16, 1); // TYMED_HGLOBAL
    assert.strictEqual(e.test_ole_data_query(object, fe), 0);
    assert.strictEqual(e.test_ole_data_get(object, fe, medium), 0);
    const data = e.guest_read32(medium + 4) >>> 0;
    assert(data);
    assert.strictEqual(e.guest_read8(data), 0, 'OLE copies the empty payload terminator');
  };
  assert.strictEqual(api(9), 1);
  absent();
  e.prepare_dib_clipboard(); // Restore the synthetic owner's open transaction.
  const empty = putString('');
  assert.strictEqual(api(7, empty), empty);
  assert.strictEqual(e.clipboard_text_len(), 0);
  assert(e.clipboard_count_formats() > 0, 'empty text is a present format');
  for (const fmt of [1, 7]) {
    assert.strictEqual(e.clipboard_is_format_available(fmt), 1);
    const handle = lockFormat(fmt, 1);
    assert.strictEqual(e.guest_read8(handle), 0);
  }
  assert.strictEqual(api(8, 0), 1);
  assert.strictEqual(api(8, 1), 7);
  assert.strictEqual(api(8, 7), 0);
  wrappedEmpty(1);
  e.synthesize_clipboard_rtf();
  assert(e.clipboard_rtf_len() > 0, 'present empty text can synthesize an empty RTF document');
  lockFormat(format, e.clipboard_rtf_len() + 1);
  assert.strictEqual(api(9), 1);
  absent();
  assert(e.clipboard_store_rtf_data(empty));
  assert.strictEqual(e.clipboard_rtf_len(), 0);
  assert.strictEqual(e.clipboard_is_format_available(format), 1);
  assert(e.clipboard_count_formats() > 0);
  lockFormat(format, 1);
  assert.strictEqual(api(8, 0), format);
  assert.strictEqual(api(8, format), 0);
  wrappedEmpty(format);
  assert.strictEqual(api(9), 1);
  absent();
  // Force a replacement and a larger synthesized allocation after publication.
  api(7, putString('larger '.repeat(200)));
  lockFormat(1, 1401);
  e.synthesize_clipboard_rtf();
  lockFormat(format, e.clipboard_rtf_len() + 1);
  console.log('PASS clipboard public handles: DIB validation, text/RTF lockability, ESP and sequence');
})().catch(error => { console.error(error); process.exitCode = 1; });
