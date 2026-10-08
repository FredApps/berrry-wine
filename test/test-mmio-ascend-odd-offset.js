#!/usr/bin/env node
'use strict';

// mmioAscend seeks to the end of the chunk plus one pad byte when cksize is
// odd. The pad is relative to the chunk, not the file: Daytona USA Deluxe
// packs WAVE files back to back at odd offsets, and aligning the absolute
// end left the next mmioDescend one byte past 'fmt ' so 'data' was missed.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_mmio_ascend") (param $h i32) (param $ck i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00430000))
    (call $handle_mmioAscend (local.get $h) (local.get $ck) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_mmio_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const seeks = [];
  const harness = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      fs_set_file_pointer(handle, offset, origin) {
        assert.strictEqual(handle, 41);
        seeks.push([offset, origin]);
        return offset;
      },
    },
  });
  const wat = harness.exports;
  const ck = wat.guest_alloc(20) >>> 0;
  const ascend = (dataOffset, cksize) => {
    wat.guest_write32(ck, 0x20746d66);       // 'fmt '
    wat.guest_write32(ck + 4, cksize);
    wat.guest_write32(ck + 12, dataOffset);
    seeks.length = 0;
    assert.strictEqual(wat.test_mmio_ascend(41, ck), 0);
    assert.strictEqual(seeks.length, 1);
    return seeks[0];
  };

  // A WAVE at file offset 0x1507b: its 'fmt ' data starts at 0x1507b + 20.
  assert.deepStrictEqual(ascend(0x1508f, 16), [0x1509f, 0],
    'an even-sized chunk ends exactly at dwDataOffset + cksize, even from an odd base');
  assert.deepStrictEqual(ascend(0x1508f, 15), [0x1509f, 0],
    'an odd-sized chunk skips its one pad byte');
  assert.deepStrictEqual(ascend(0x14, 16), [0x24, 0], 'even base, even size');
  assert.deepStrictEqual(ascend(0x14, 3), [0x18, 0], 'even base, odd size pads');
  assert.strictEqual(wat.test_mmio_esp() >>> 0, 0x00430010,
    'mmioAscend pops its return address and three stdcall arguments');
  console.log('PASS  mmioAscend pads by chunk size, not by absolute file position');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
