#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
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
  (func (export "test_crt_stack") (param $sp i32)
    (global.set $esp (local.get $sp)) (global.set $eip (i32.const 0x200000)))
  (func (export "test_fgets_pending_count") (result i32)
    (local $p i32) (local $n i32)
    (local.set $p (global.get $crt_fgets_pending))
    (block $done (loop $walk
      (br_if $done (i32.eqz (local.get $p)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $p (call $gl32 (local.get $p))) (br $walk)))
    (local.get $n))
`;

(async () => {
  let e;
  let actualImports = null;
  let bytes, cursor, pending, failAt, failState, seekFails;
  const h = await bootRenderHarness({ fonts: 'none', extraWat,
    extraHostOverrides: {
      fs_read_file(handle, buffer, size, count) {
        if (actualImports) return actualImports.fs_read_file(handle, buffer, size, count);
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
      fs_read_pending: () => actualImports ? actualImports.fs_read_pending() : pending,
      fs_set_file_pointer(handle, offset, origin) {
        if (actualImports) return actualImports.fs_set_file_pointer(handle, offset, origin);
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
  e.run(2); parked(saved); assert.strictEqual(cursor, 4, 'retain progress at missing byte');
  e.test_crt_resume(); parked(saved); assert.strictEqual(cursor, 4, 'repeated miss cannot drift');
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
  setup('fgets', [BUFFER, 20, 41]); failAt = 2;
  e.run(2); assert.strictEqual(e.test_fgets_pending_count(), 1);
  seekFails = true; e.test_crt_resume(); completed(0);
  assert.strictEqual(e.test_fgets_pending_count(), 0, 'completed/error calls release all continuation frames');

  const vfs = new VirtualFS();
  actualImports = createFilesystemImports({ vfs, exports: e, getMemory: () => h.memory.buffer });
  const line = Buffer.from('x'.repeat(1025) + '\n');
  let fetches = 0, failOffset = Infinity;
  const cache = new ChunkCache({ size: line.length,
    async readRange(off, len) {
      fetches++;
      if (off >= failOffset) throw new Error('injected line fill failure');
      return line.slice(off, off + len);
    },
  }, { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 16, readAhead: 0 });
  vfs.setProviderFile('c:\\line.txt', { provider: cache });
  const open = () => vfs.createFile('c:\\line.txt', 0x80000000, 3);
  function start(sp, buffer, handle, capacity) {
    e.test_crt_begin(apis.find(a => a.name === 'fgets').id);
    e.test_crt_stack(sp);
    [0, buffer, capacity, handle, 0, 0].forEach((v, i) => e.guest_write32(sp + i * 4, v));
    e.run(2);
  }
  async function finish(sp, buffer, handle, expectedLength) {
    let parks = 0, lastPos = -1;
    while (e.get_yield_reason() === 12) {
      assert.strictEqual(e.test_crt_esp(), sp);
      assert.strictEqual(e.get_eip(), THUNK);
      const request = vfs.pendingRead;
      assert(request, 'park provides a real VFS operation');
      assert(request.pos > lastPos, 'a filled byte must never restart the line prefix');
      lastPos = request.pos;
      assert(++parks <= expectedLength + 1, 'zero-cache line read makes bounded progress');
      await vfs.fillPendingRead(request);
      e.test_crt_resume();
    }
    assert.strictEqual(e.test_crt_esp(), sp + 4);
    assert.strictEqual(e.test_crt_eax(), buffer);
    assert.strictEqual(vfs.handles.get(handle).pos, expectedLength);
    assert.strictEqual(e.guest_read8(buffer + expectedLength), 0);
    return parks;
  }
  const stream = open(); start(STACK, BUFFER, stream, line.length + 1);
  const parks = await finish(STACK, BUFFER, stream, line.length);
  assert.deepStrictEqual(Buffer.from(Array.from({ length: line.length }, (_, i) => e.guest_read8(BUFFER + i))), line);
  assert.strictEqual(parks, line.length);
  assert.strictEqual(fetches, line.length, 'one fill per byte at zero capacity, never a replayed prefix');
  assert.strictEqual(e.test_fgets_pending_count(), 0);

  // An inner fgets suspends independently while the outer frame remains live.
  const outer = open(), inner = open();
  start(STACK, BUFFER, outer, 5);
  const outerRequest = vfs.pendingRead;
  start(STACK - 128, BUFFER + 2048, inner, 4);
  assert.strictEqual(e.test_fgets_pending_count(), 2);
  await finish(STACK - 128, BUFFER + 2048, inner, 3);
  assert.strictEqual(e.test_fgets_pending_count(), 1);
  await vfs.fillPendingRead(outerRequest);
  e.test_crt_stack(STACK); e.test_crt_resume();
  await finish(STACK, BUFFER, outer, 4);
  assert.strictEqual(e.test_fgets_pending_count(), 0);

  // A permanent fault after earlier bytes must terminate and free its frame.
  failOffset = 16;
  const failing = open(); start(STACK, BUFFER, failing, 100);
  for (let rounds = 0; e.get_yield_reason() === 12; rounds++) {
    assert(rounds < 20);
    await vfs.fillPendingRead(vfs.pendingRead); e.test_crt_resume();
  }
  assert.strictEqual(e.test_crt_eax(), 0);
  assert.strictEqual(e.test_crt_esp(), STACK + 4);
  assert.strictEqual(e.test_fgets_pending_count(), 0);
  failOffset = Infinity;
  // Reusing a parked frame with different arguments abandons only that call.
  start(STACK, BUFFER, open(), 4);
  start(STACK, BUFFER + 2048, inner, 4);
  assert.strictEqual(e.test_fgets_pending_count(), 1);
  vfs.setFilePointer(inner, 0, 0);
  // Restart with a distinct handle to avoid intentionally repositioning a live call.
  const replacement = open(); start(STACK, BUFFER + 2048, replacement, 4);
  await finish(STACK, BUFFER + 2048, replacement, 3);
  assert.strictEqual(e.test_fgets_pending_count(), 0);
  vfs.files.clear();
  console.log('PASS CRT lazy reads: real thunk frames, durable/nested fgets, zero-cache1026-byte line, faults and EOF');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
