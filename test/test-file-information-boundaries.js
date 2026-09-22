#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const extraWat = String.raw`
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
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
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
  vfs.closeHandle(handle);
  console.log('PASS  file information and timestamps: real WAT ABI, all sparse splits and failure preservation');
})().catch(error => { console.error(error); process.exit(1); });
