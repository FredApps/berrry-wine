#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
  (func (export "test_file_to_local") (param $src i32) (param $dst i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_FileTimeToLocalFileTime (local.get $src) (local.get $dst)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_local_to_file") (param $src i32) (param $dst i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_LocalFileTimeToFileTime (local.get $src) (local.get $dst)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_disk_free_ex") (param $available i32) (param $total i32) (param $free i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetDiskFreeSpaceExA (i32.const 0) (local.get $available) (local.get $total)
      (local.get $free) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_system_to_file") (param $st i32) (param $ft i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_SystemTimeToFileTime (local.get $st) (local.get $ft)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_calendar") (param $dos i32) (param $ft i32) (param $out i32) (param $time i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (if (local.get $dos)
      (then (call $handle_FileTimeToDosDateTime (local.get $ft) (local.get $out) (local.get $time)
        (i32.const 0) (i32.const 0) (i32.const 0)))
      (else (call $handle_FileTimeToSystemTime (local.get $ft) (local.get $out)
        (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
    (i32.load (global.get $reg_base)))
  (func (export "test_size_high") (param $h i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetFileSize (local.get $h) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_compressed_high") (param $path i32) (param $out i32) (result i32)
    (call $get_compressed_file_size (local.get $path) (local.get $out) (i32.const 0)))
  (func (export "test_seek_high") (param $h i32) (param $low i32)
      (param $high i32) (param $method i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_SetFilePointer (local.get $h) (local.get $low) (local.get $high)
      (local.get $method) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))
  (func (export "test_file_times") (param $set i32) (param $handle i32)
      (param $c i32) (param $a i32) (param $w i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (if (local.get $set)
      (then (call $handle_SetFileTime (local.get $handle) (local.get $c) (local.get $a) (local.get $w)
        (i32.const 0) (i32.const 0)))
      (else (call $handle_GetFileTime (local.get $handle) (local.get $c) (local.get $a) (local.get $w)
        (i32.const 0) (i32.const 0))))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x00300014))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_info_map") (param $ga i32) (result i32)
    (call $virtual_map_commit (local.get $ga) (i32.const 4096)))
  (func (export "test_info") (param $handle i32) (param $out i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00300000))
    (call $handle_GetFileInformationByHandle (local.get $handle) (local.get $out)
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const 0x0030000c))
      (then (unreachable)))
    (i32.load (global.get $reg_base)))
  (func (export "test_info_error") (result i32) (global.get $last_error))
`;
(async () => {
  // A fixed, nonzero zone Bias (UTC = local + Bias) so the FILETIME shift is
  // exercised across the page splits; the host's own zone may well be UTC.
  const BIAS = 420;
  let clockCtx = null;
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none',
    extraHostOverrides: { wall_clock: (out, kind) => {
      if (kind !== 3) return 0;
      new DataView(clockCtx.getMemory()).setInt32(out, BIAS, true);
      return 1;
    } } });
  clockCtx = hostCtx;
  const page = 0x30000000;
  for (const ga of [page, 0x28000000, page + 4096]) {
    assert.strictEqual(e.test_info_map(ga) >>> 0, ga);
  }
  assert.notStrictEqual(e.guest_to_wasm(page + 4095) + 1, e.guest_to_wasm(page + 4096));
  const notices = [];
  hostCtx.exports = { ...e, invalidate_code_range: (ga, n) => {
    notices.push([ga, n]); e.invalidate_code_range(ga, n);
  } };
  const vfs = hostCtx.vfs;
  vfs.files.set('c:\\info.bin', { data: Uint8Array.from([1, 2, 3]), attrs: 0x20 });
  const handle = vfs.createFile('c:\\info.bin', 0xc0000100, 3);
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  const aligned = page + 0x100;
  const fileTimeBytes = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0x01];
  const fileTime = fileTimeBytes.reduce((v, b, i) => v | (BigInt(b) << BigInt(i * 8)), 0n);
  const bytesOf = v => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(i * 8)) & 255n));
  const shift = BigInt(BIAS) * 600000000n;
  for (const [convert, want] of [[e.test_local_to_file, bytesOf(fileTime + shift)],
    [e.test_file_to_local, bytesOf(fileTime - shift)]]) for (let split = 1; split < 8; split++) {
    const edge = page + 4096 - split;
    for (const [src, dst] of [[aligned, edge], [edge, aligned], [edge, edge],
      [edge, edge + 1], [edge + 1, edge]]) {
      for (let i = -1; i <= 8; i++) e.guest_write8(dst + i, 0xcc);
      fileTimeBytes.forEach((b, i) => e.guest_write8(src + i, b));
      const before = e.guest_read8(dst - 1), after = e.guest_read8(dst + 8);
      assert.strictEqual(convert(src, dst), 1);
      assert.deepStrictEqual(read(dst - 1, 10), [before, ...want, after], `local FILETIME split ${split}`);
      assert.strictEqual(e.get_esp(), 0x0030000c);
    }
  }
  fileTimeBytes.forEach((b, i) => e.guest_write8(aligned + i, b));
  for (const [src, dst] of [[0, aligned], [aligned, 0], [0, 0]]) {
    assert.strictEqual(e.test_local_to_file(src, dst), 0);
    assert.deepStrictEqual(read(aligned, 8), fileTimeBytes);
    assert.strictEqual(e.get_esp(), 0x0030000c);
  }
  // Fixed-disk geometry policy is unchanged; verify all three optional
  // ULARGE_INTEGER outputs, not just an aligned high/low pair.
  const diskSizes = [262143n * 4096n, 524287n * 4096n, 262143n * 4096n];
  for (let field = 0; field < 3; field++) {
    const expectedBytes = Array.from({ length: 8 }, (_, i) => Number((diskSizes[field] >> BigInt(i * 8)) & 255n));
    for (let split = 1; split < 8; split++) {
      const out = page + 4096 - split;
      const pointers = [0, 0, 0]; pointers[field] = out;
      for (let i = -1; i <= 8; i++) e.guest_write8(out + i, 0xcc);
      assert.strictEqual(e.test_disk_free_ex(...pointers), 1);
      assert.deepStrictEqual(read(out - 1, 10), [0xcc, ...expectedBytes, 0xcc], `disk field ${field}, split ${split}`);
      assert.strictEqual(e.get_esp(), 0x00300014);
    }
  }
  assert.strictEqual(e.test_disk_free_ex(aligned, aligned + 8, aligned + 16), 1);
  for (let field = 0; field < 3; field++) {
    assert.strictEqual(BigInt(e.guest_read32(aligned + field * 8) >>> 0) |
      (BigInt(e.guest_read32(aligned + field * 8 + 4) >>> 0) << 32n), diskSizes[field]);
  }
  assert.strictEqual(e.test_disk_free_ex(0, 0, 0), 1);
  assert.strictEqual(e.test_info(handle, aligned), 1);
  const expected = read(aligned, 52);
  assert.strictEqual(e.guest_read32(aligned), 0x20);
  assert.strictEqual(e.guest_read32(aligned + 36), 3);
  assert.strictEqual(e.guest_read32(aligned + 40), 1);
  for (let split = 1; split < 52; split++) {
    const out = page + 4096 - split;
    for (let i = -1; i <= 52; i++) e.guest_write8(out + i, 0xcc);
    notices.length = 0;
    assert.strictEqual(e.test_info(handle, out), 1);
    assert.deepStrictEqual(read(out - 1, 54), [0xcc, ...expected, 0xcc], `split ${split}`);
    assert.deepStrictEqual(notices, [[out, 52]]);
    notices.length = 0;
    assert.strictEqual(e.test_info(0xdead, out), 0);
    assert.strictEqual(e.test_info_error(), 6);
    assert.deepStrictEqual(read(out - 1, 54), [0xcc, ...expected, 0xcc]);
    assert.deepStrictEqual(notices, [], 'failed query leaves destination untouched');
  }
  assert.strictEqual(e.test_info(handle, 0), 0);
  assert.strictEqual(e.test_info_error(), 87);
  for (let field = 0; field < 3; field++) {
    for (let split = 1; split < 8; split++) {
      const out = page + 4096 - split;
      const pointers = [0, 0, 0];
      pointers[field] = out;
      const vector = [0x12345670 + field, 0x01bf5300 + split];
      e.guest_write32(out, vector[0]); e.guest_write32(out + 4, vector[1]);
      notices.length = 0;
      assert.strictEqual(e.test_file_times(1, handle, ...pointers), 1);
      assert.deepStrictEqual(vfs.getFileTimes(handle)[['creationTime', 'lastAccessTime', 'lastWriteTime'][field]],
        { lo: vector[0], hi: vector[1] }, 'SetFileTime gathers the exact split input');
      assert.deepStrictEqual(notices, [], 'setting file metadata does not write guest output');
      for (let i = -1; i <= 8; i++) e.guest_write8(out + i, 0xcc);
      assert.strictEqual(e.test_file_times(0, handle, ...pointers), 1);
      const expectedTime = Buffer.alloc(8);
      expectedTime.writeUInt32LE(vector[0]); expectedTime.writeUInt32LE(vector[1], 4);
      assert.deepStrictEqual(read(out - 1, 10), [0xcc, ...expectedTime, 0xcc],
        `FILETIME field ${field}, split ${split}`);
      assert.deepStrictEqual(notices, [[out, 8]]);
      notices.length = 0;
      assert.strictEqual(e.test_file_times(0, 0xdead, ...pointers), 0);
      assert.strictEqual(e.test_info_error(), 6);
      assert.deepStrictEqual(read(out - 1, 10), [0xcc, ...expectedTime, 0xcc]);
      assert.deepStrictEqual(notices, []);
    }
  }
  // Independent calendar expectation: 2000-02-29 Tuesday, 12:34:56.789 UTC.
  const ticks = BigInt(Date.UTC(2000, 1, 29, 12, 34, 56, 789)) * 10000n + 116444736000000000n;
  const putTime = ga => { e.guest_write32(ga, Number(ticks & 0xffffffffn));
    e.guest_write32(ga + 4, Number(ticks >> 32n)); };
  const expectedCalendar = [2000, 2, 2, 29, 12, 34, 56, 789].flatMap(w => [w & 255, w >> 8]);
  const expectedTicks = Array.from({ length: 8 }, (_, i) => Number((ticks >> BigInt(i * 8)) & 255n));
  for (let split = 1; split < 8; split++) {
    const ft = page + 4096 - split;
    expectedCalendar.forEach((b, i) => e.guest_write8(aligned + i, b));
    for (let i = -1; i <= 8; i++) e.guest_write8(ft + i, 0xcc);
    assert.strictEqual(e.test_system_to_file(aligned, ft), 1);
    assert.deepStrictEqual(read(ft - 1, 10), [0xcc, ...expectedTicks, 0xcc], `converted FILETIME split ${split}`);
    assert.strictEqual(e.get_esp(), 0x0030000c);
  }
  for (let split = 1; split < 16; split++) {
    const st = page + 4096 - split;
    expectedCalendar.forEach((b, i) => e.guest_write8(st + i, b));
    assert.strictEqual(e.test_system_to_file(st, aligned), 1);
    assert.deepStrictEqual(read(aligned, 8), expectedTicks, `SYSTEMTIME input split ${split}`);
    // Existing invalid-field failure must not partially write the output.
    e.guest_write8(st + 2, 13);
    for (let i = 0; i < 8; i++) e.guest_write8(aligned + i, 0xcc);
    assert.strictEqual(e.test_system_to_file(st, aligned), 0);
    assert.deepStrictEqual(read(aligned, 8), new Array(8).fill(0xcc));
  }
  for (let split = 1; split < 16; split++) {
    const out = page + 4096 - split;
    putTime(aligned);
    for (let i = -1; i <= 16; i++) e.guest_write8(out + i, 0xcc);
    notices.length = 0;
    assert.strictEqual(e.test_calendar(0, aligned, out, 0), 1);
    assert.deepStrictEqual(read(out - 1, 18), [0xcc, ...expectedCalendar, 0xcc], `SYSTEMTIME split ${split}`);
    assert.deepStrictEqual(notices, [[out, 16]]);
    assert.strictEqual(e.get_esp(), 0x0030000c);
  }
  for (let split = 1; split < 8; split++) {
    const ft = page + 4096 - split;
    putTime(ft);
    assert.strictEqual(e.test_calendar(0, ft, aligned, 0), 1);
    assert.deepStrictEqual(read(aligned, 16), expectedCalendar, `FILETIME split ${split}`);
    assert.strictEqual(e.test_calendar(1, ft, aligned, aligned + 2), 1);
    assert.deepStrictEqual(read(aligned, 4), [0x5d, 0x28, 0x5c, 0x64]);
    assert.strictEqual(e.get_esp(), 0x00300010);
  }
  for (const timeOutput of [false, true]) {
    const out = page + 4095;
    putTime(aligned);
    for (let i = -1; i <= 2; i++) e.guest_write8(out + i, 0xcc);
    assert.strictEqual(e.test_calendar(1, aligned, timeOutput ? aligned + 32 : out,
      timeOutput ? out : aligned + 32), 1);
    assert.deepStrictEqual(read(out - 1, 4), [0xcc, ...(timeOutput ? [0x5c, 0x64] : [0x5d, 0x28]), 0xcc]);
  }
  const largeSize = 0x23456789a;
  vfs.setProviderFile('c:\\large.bin', { provider: { size: largeSize,
    readRange() { throw new Error('metadata must not read file data'); } } });
  const large = vfs.createFile('c:\\large.bin', 0x80000000, 3);
  const path = e.guest_alloc(32) >>> 0;
  [...Buffer.from('c:\\large.bin'), 0].forEach((byte, i) => e.guest_write8(path + i, byte));
  for (const split of [1, 2, 3]) {
    const high = page + 4096 - split;
    for (let i = -1; i <= 4; i++) e.guest_write8(high + i, 0xcc);
    assert.strictEqual(e.test_size_high(large, high) >>> 0, largeSize >>> 0);
    assert.deepStrictEqual(read(high - 1, 6), [0xcc, 2, 0, 0, 0, 0xcc]);
    assert.strictEqual(e.get_esp(), 0x0030000c);
    e.guest_write32(high, 0xcccccccc);
    assert.strictEqual(e.test_compressed_high(path, high) >>> 0, largeSize >>> 0);
    assert.strictEqual(e.guest_read32(high), 2);
    e.guest_write32(high, 1);
    assert.strictEqual(e.test_seek_high(large, 0xfffffff0, high, 0) >>> 0, 0xfffffff0);
    assert.strictEqual(vfs.handles.get(large).pos, 0x1fffffff0);
    e.guest_write32(high, 0);
    assert.strictEqual(e.test_seek_high(large, 0x30, high, 1), 0x20);
    assert.deepStrictEqual(read(high - 1, 6), [0xcc, 2, 0, 0, 0, 0xcc]);
    assert.strictEqual(e.get_esp(), 0x00300014);
    for (const fail of [() => e.test_size_high(0xdead, high),
      () => e.test_seek_high(0xdead, 7, high, 0)]) {
      e.guest_write32(high, 0x12345678);
      assert.strictEqual(fail() >>> 0, 0xffffffff);
      assert.strictEqual(e.test_info_error(), 6);
      assert.strictEqual(e.guest_read32(high), 0x12345678);
    }
  }
  for (const badHigh of [page + 8191, 0xfffffffe]) {
    const handlesBefore = vfs.handles.size;
    assert.strictEqual(e.test_compressed_high(path, badHigh) >>> 0, 0xffffffff);
    assert.strictEqual(e.test_info_error(), 87, 'missing second page or wrap is rejected');
    assert.strictEqual(vfs.handles.size, handlesBefore, 'invalid output does not open a handle');
  }
  e.guest_free(path);
  vfs.closeHandle(large);
  vfs.closeHandle(handle);
  console.log('PASS  file metadata: information, timestamps, calendar conversion, size/seek high words and sparse boundaries');
})().catch(error => { console.error(error); process.exit(1); });
