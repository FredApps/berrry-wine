#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const STACK = 0x00110100;
const BUFFER = 0x00120000;
const THUNK = 0x00200000;
const extraWat = String.raw`
  (func (export "test_crt_begin") (param $id i32)
    (global.set $thunk_guest_base (i32.const 0x00200000))
    (global.set $thunk_guest_end (i32.const 0x00200008))
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
    (global.set $esp (i32.const 0x00110100))
    (global.set $eip (i32.const 0x00200000))
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0)))
  (func (export "test_crt_resume")
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (call $run (i32.const 2)))
  (func (export "test_crt_esp") (result i32) (global.get $esp))
  (func (export "test_crt_eax") (result i32) (global.get $eax))
`;

(async () => {
  let e;
  let bytes, cursor, pending, failAt, failState, seekFails;
  const h = await bootRenderHarness({ fonts: 'none', extraWat,
    extraHostOverrides: {
      fs_read_file(handle, buffer, size, count) {
        assert.strictEqual(handle, 41);
        e.guest_write32(count, 0);
        pending = 0;
        if (cursor >= failAt) { pending = failState; return 0; }
        const n = Math.min(size, bytes.length - cursor);
        for (let i = 0; i < n; i++) e.guest_write8(buffer + i, bytes[cursor + i]);
        cursor += n;
        e.guest_write32(count, n);
        return 1;
      },
      fs_read_pending: () => pending,
      fs_set_file_pointer(handle, offset, origin) {
        assert.strictEqual(handle, 41);
        if (seekFails) return -1;
        cursor = (origin === 1 ? cursor : origin === 2 ? bytes.length : 0) + offset;
        return cursor;
      },
    },
  });
  e = h.exports;
  function setup(name, args, text = 'abcd\nrest', offset = 0) {
    bytes = Buffer.from(text);
    cursor = offset; pending = 0; failAt = Infinity; failState = 1; seekFails = false;
    e.test_crt_begin(apis.find(a => a.name === name).id);
    [0, ...args, 0, 0].forEach((x, i) => e.guest_write32(STACK + i * 4, x));
  }
  function frame() { return Array.from({ length: 6 }, (_, i) => e.guest_read32(STACK + i * 4)); }
  function parked(saved) {
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.get_eip(), THUNK);
    assert.strictEqual(e.test_crt_esp(), STACK);
    assert.deepStrictEqual(frame(), saved, 'return address and caller-owned args stay intact');
  }
  function completed(result) {
    assert.strictEqual(e.get_yield_reason(), 0, 'EOF/errors must not park');
    assert.strictEqual(e.get_eip(), 0, 'real thunk auto-return reaches caller');
    assert.strictEqual(e.test_crt_esp(), STACK + 4, 'pop exactly one cdecl return address');
    assert.strictEqual(e.test_crt_eax(), result);
  }
  const cases = [
    ['feof', [41], 0, 0],
    ['fread', [BUFFER, 2, 2, 41], 2, 4],
    ['_read', [41, BUFFER, 4], 4, 4],
    ['fgets', [BUFFER, 20, 41], BUFFER, 5],
  ];
  for (const [name, args, result, consumed] of cases) {
    setup(name, args);
    const saved = frame();
    failAt = 0;
    e.run(2); parked(saved);
    e.test_crt_resume(); parked(saved);
    assert.strictEqual(cursor, 0, `${name}: pending read must not consume bytes`);
    failAt = Infinity;
    e.test_crt_resume(); completed(result);
    assert.strictEqual(cursor, consumed, `${name}: retry consumes bytes once`);
    if (consumed) assert.deepStrictEqual(
      Buffer.from(Array.from({ length: consumed }, (_, i) => e.guest_read8(BUFFER + i))),
      bytes.subarray(0, consumed));
    if (name === 'fgets') assert.strictEqual(e.guest_read8(BUFFER + consumed), 0);
    for (const state of [0, 2]) {
      setup(name, args); failAt = 0; failState = state;
      e.run(2); completed(name === '_read' ? -1 : name === 'feof' ? 1 : 0);
    }
    setup(name, args, ''); e.run(2); completed(name === 'feof' ? 1 : 0);
  }
  // Nonzero initial offset and a miss after two successful one-byte reads.
  setup('fgets', [BUFFER, 20, 41], 'xxabcd\nrest', 2);
  const saved = frame(); failAt = 4;
  e.run(2); parked(saved); assert.strictEqual(cursor, 2, 'rewind to original offset');
  e.test_crt_resume(); parked(saved); assert.strictEqual(cursor, 2, 'repeated miss cannot drift');
  failAt = Infinity; e.test_crt_resume(); completed(BUFFER);
  assert.strictEqual(cursor, 7);
  assert.strictEqual(Buffer.from(Array.from({ length: 6 }, (_, i) => e.guest_read8(BUFFER + i))).toString(), 'abcd\n\0');
  setup('fgets', [BUFFER, 20, 41], 'abc');
  e.run(2); completed(BUFFER); assert.strictEqual(cursor, 3, 'EOF returns final partial line');
  for (const state of [0, 2]) {
    setup('fgets', [BUFFER, 20, 41]); failAt = 2; failState = state;
    e.run(2); completed(0); assert.strictEqual(cursor, 2, 'mid-line fault does not retry');
  }
  setup('fgets', [BUFFER, 20, 41]); failAt = 2; seekFails = true;
  e.run(2); completed(0);
  console.log('PASS CRT lazy reads: real thunk retries, cdecl frames, bytes/cursors, mid-line rewind, faults and EOF');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
