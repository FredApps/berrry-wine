#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const STACK = 0x110100, THUNK = 0x200000, BUFFER = 0x120000;
const extraWat = String.raw`
  (func (export "lz_begin") (param $id i32) (param $stack i32)
    (global.set $thunk_guest_base (i32.const 0x200000))
    (global.set $thunk_guest_end (i32.const 0x200008))
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
    (global.set $esp (local.get $stack))
    (global.set $eip (i32.const 0x200000))
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0)))
  (func (export "lz_resume")
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (call $run (i32.const 2)))
  (func (export "lz_eax") (result i32) (global.get $eax))
  (func (export "lz_esp") (result i32) (global.get $esp))
  (func (export "lz_pending") (result i32) (global.get $lz_copy_pending))
`;
(async () => {
  let e, status = 0, available = 0, fail = false, writeFail = false, shortWrite = false;
  const source = Uint8Array.from({ length: 25000 }, (_, i) => i % 251);
  let cursor = 0, output = [], writes = 0;
  const h = await bootRenderHarness({ fonts: 'none', extraWat, extraHostOverrides: {
    fs_read_pending: () => status,
    fs_read_file(handle, buffer, size, count) {
      assert.strictEqual(handle, 41); status = 0; e.guest_write32(count, 0);
      if (cursor >= available && cursor < source.length) { status = fail ? 2 : 1; return 0; }
      const n = Math.min(size, source.length - cursor, available - cursor);
      for (let i = 0; i < n; i++) e.guest_write8(buffer + i, source[cursor + i]);
      cursor += n; e.guest_write32(count, n); return 1;
    },
    fs_write_file(handle, buffer, size, count) {
      assert.strictEqual(handle, 42); e.guest_write32(count, 0);
      if (writeFail) return 0;
      if (shortWrite) size = Math.max(0, size - 1);
      for (let i = 0; i < size; i++) output.push(e.guest_read8(buffer + i));
      writes++; e.guest_write32(count, size); return 1;
    },
  } });
  e = h.exports;
  function begin(name, args, stack = STACK) {
    e.lz_begin(apis.find(a => a.name === name).id, stack);
    [0, ...args].forEach((v, i) => e.guest_write32(stack + 4 * i, v));
  }
  function parked(stack = STACK) {
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.get_eip(), THUNK);
    assert.strictEqual(e.lz_esp(), stack);
  }
  begin('LZCopy', [41, 42]);
  available = 8192; e.lz_resume(); parked();
  assert.strictEqual(output.length, 8192);
  assert.strictEqual(writes, 2);
  const frame = e.lz_pending(); assert(frame);
  e.lz_resume(); parked(); assert.strictEqual(writes, 2, 'repeated miss cannot rewrite prefix');
  available = 16384; e.lz_resume(); parked();
  assert.strictEqual(writes, 4); assert.strictEqual(output.length, 16384);
  available = source.length; e.lz_resume();
  assert.strictEqual(e.lz_eax(), source.length);
  assert.strictEqual(e.lz_esp(), STACK + 12);
  assert.strictEqual(e.lz_pending(), 0, 'completed continuation is removed');
  assert.deepStrictEqual(Uint8Array.from(output), source);

  cursor = 10; available = 10; output = []; writes = 0;
  begin('LZCopy', [41, 42]); e.lz_resume(); parked();
  fail = true; e.lz_resume();
  assert.strictEqual(e.lz_eax(), -3); assert.strictEqual(e.lz_pending(), 0);
  assert.strictEqual(e.lz_esp(), STACK + 12);
  fail = false; available = source.length; writeFail = true;
  begin('LZCopy', [41, 42]); e.lz_resume(); assert.strictEqual(e.lz_eax(), -4);
  assert.strictEqual(e.lz_pending(), 0); writeFail = false;

  // Independent suspended call frames may share handles, but cannot share
  // accumulated totals. Complete the older non-head record first to exercise
  // unlinking through its predecessor without losing the newer continuation.
  cursor = 0; available = 4096; output = []; writes = 0;
  begin('LZCopy', [41,42]); e.lz_resume(); parked();
  const outer = e.lz_pending();
  begin('LZCopy', [41,42], STACK + 0x4000);
  available = 8192; e.lz_resume(); parked(STACK + 0x4000);
  const inner = e.lz_pending();
  assert.notStrictEqual(inner, outer);
  assert.strictEqual(e.guest_read32(inner), outer);
  assert.strictEqual(e.guest_read32(inner + 16), 4096, 'nested ESP cannot inherit outer total');
  begin('LZCopy', [41,42]); available = source.length; e.lz_resume();
  assert.strictEqual(e.lz_eax(), source.length - 4096);
  assert.strictEqual(e.lz_pending(), inner, 'non-head removal preserves head');
  assert.strictEqual(e.guest_read32(inner), 0, 'predecessor no longer points to freed outer frame');
  begin('LZCopy', [41,42], STACK + 0x4000); e.lz_resume();
  assert.strictEqual(e.lz_eax(), 4096);
  assert.strictEqual(e.lz_pending(), 0);
  assert.deepStrictEqual(Uint8Array.from(output), source);

  for (const failure of ['read', 'write', 'short-write']) {
    cursor = 0; available = 4096; output = []; writes = 0;
    begin('LZCopy', [41,42]); e.lz_resume(); parked();
    if (failure === 'read') fail = true;
    else { available = source.length; writeFail = failure === 'write'; shortWrite = failure === 'short-write'; }
    e.lz_resume();
    assert.strictEqual(e.lz_eax(), failure === 'read' ? -3 : -4);
    assert.strictEqual(e.lz_esp(), STACK + 12);
    assert.strictEqual(e.lz_pending(), 0, 'fault removes committed-prefix continuation');
    assert.deepStrictEqual(Uint8Array.from(output), source.slice(0, failure === 'short-write' ? 8191 : 4096));
    fail = writeFail = shortWrite = false;
  }

  cursor = 123; available = 123;
  begin('LZRead', [41, BUFFER, 7]); e.lz_resume(); parked();
  assert.strictEqual(cursor, 123);
  available = source.length; e.lz_resume();
  assert.strictEqual(e.lz_eax(), 7); assert.strictEqual(e.lz_esp(), STACK + 16);
  assert.strictEqual(cursor, 130);
  assert.deepStrictEqual(Uint8Array.from({ length: 7 }, (_, i) => e.guest_read8(BUFFER + i)), source.slice(123, 130));
  console.log('PASS compiled LZ pending copy: no duplicate prefix, total/cursor/frame preservation, faults and cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
