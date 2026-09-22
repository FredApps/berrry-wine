#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "prepare_dib_clipboard")
    (global.set $clipboard_open (i32.const 1))
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
      (call $handle_GetClipboardData (i32.const 8) (i32.const 0)
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
    (i64.or (i64.extend_i32_u (i32.load (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const api = (op, arg = 0) => {
    const result = e.dib_api(op, arg);
    assert.strictEqual(Number(result >> 32n), 0x00300000 + (op < 2 ? 12 : op === 6 ? 4 : 8));
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
  const snapshot = api(2);
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
    assert.strictEqual(api(2), snapshot, 'failed store preserves clipboard');
  }
  // Host image injection deliberately accepts a trusted guest_alloc block.
  const injected = e.clipboard_store_binary_data(8, ordinaryHeap) >>> 0;
  assert(injected);
  assert.strictEqual(api(3, injected), injected, 'host-injected snapshot is also lockable');
  console.log('PASS CF_DIB public handle validation, return, lock/size, bytes, ESP and sequence');
})().catch(error => { console.error(error); process.exitCode = 1; });
