#!/usr/bin/env node
'use strict';

// LZInit/LZRead/LZSeek/LZClose over an SZDD (COMPRESS.EXE) file, the format
// Daytona USA Deluxe ships 72 of its Resource\ files in, and LZInit's
// pass-through for an ordinary file.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func $lz_call_esp (i32.store offset=16 (global.get $reg_base) (i32.const 0x00430000)))
  (func (export "test_lzinit") (param $h i32) (result i32)
    (call $lz_call_esp)
    (call $handle_LZInit (local.get $h) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_lzread") (param $h i32) (param $buf i32) (param $n i32) (result i32)
    (call $lz_call_esp)
    (call $handle_LZRead (local.get $h) (local.get $buf) (local.get $n) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_lzseek") (param $h i32) (param $off i32) (param $origin i32) (result i32)
    (call $lz_call_esp)
    (call $handle_LZSeek (local.get $h) (local.get $off) (local.get $origin) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_lzclose") (param $h i32) (result i32)
    (call $lz_call_esp)
    (call $handle_LZClose (local.get $h) (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_lz_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_lz_alloc") (param $n i32) (result i32) (call $heap_alloc (local.get $n)))
`;

// SZDD encoder: literals, plus back references wherever the last 4 KB ring
// (prefilled with spaces, written from 4096-16) already holds >= 3 bytes.
function szdd(data) {
  const ring = Buffer.alloc(4096, 0x20);
  let pos = 4080;
  const body = [];
  let i = 0;
  while (i < data.length) {
    const ctlAt = body.length;
    body.push(0);
    for (let bit = 0; bit < 8 && i < data.length; bit++) {
      let best = 0, bestOff = 0;
      for (let off = 0; off < 4096; off++) {
        let n = 0;
        // A match may not read a ring byte this same reference overwrites.
        while (n < 18 && i + n < data.length && ring[(off + n) & 0xfff] === data[i + n] &&
               ((off + n) & 0xfff) !== ((pos + n) & 0xfff)) n++;
        if (n > best) { best = n; bestOff = off; }
      }
      if (best >= 3) {
        body.push(bestOff & 0xff, ((bestOff >> 4) & 0xf0) | (best - 3));
        for (let k = 0; k < best; k++) { ring[pos] = data[i + k]; pos = (pos + 1) & 0xfff; }
        i += best;
      } else {
        body[ctlAt] |= 1 << bit;
        body.push(data[i]);
        ring[pos] = data[i]; pos = (pos + 1) & 0xfff;
        i++;
      }
    }
  }
  const head = Buffer.alloc(14);
  head.write('SZDD', 0, 'latin1');
  head.writeUInt32LE(0x3327f088, 4);
  head[8] = 0x41;
  head[9] = 0x5f;
  head.writeUInt32LE(data.length, 10);
  return Buffer.concat([head, Buffer.from(body)]);
}

(async () => {
  // Leading spaces exercise references into the space-filled initial ring;
  // the repeated phrase exercises ordinary back references.
  const plain = Buffer.from('    model header ' + 'DAYTONA USA Deluxe '.repeat(40) + 'end\x00\x01\x02', 'latin1');
  const files = { 41: szdd(plain), 43: Buffer.from('not compressed at all', 'latin1') };
  assert(files[41].length < plain.length, 'the fixture really is compressed');
  const pos = { 41: 0, 43: 0 };
  const closed = [];
  let wat;
  const harness = await bootRenderHarness({
    extraWat,
    extraHostOverrides: {
      fs_read_file(handle, buffer, requested, count) {
        const file = files[handle];
        assert(file, `read from unexpected handle ${handle}`);
        const amount = Math.max(0, Math.min(requested, file.length - pos[handle]));
        for (let i = 0; i < amount; i++) wat.guest_write8(buffer + i, file[pos[handle] + i]);
        wat.guest_write32(count, amount);
        pos[handle] += amount;
        return 1;
      },
      fs_set_file_pointer(handle, offset, origin) {
        const file = files[handle];
        assert(file, `seek on unexpected handle ${handle}`);
        const base = origin === 1 ? pos[handle] : origin === 2 ? file.length : 0;
        pos[handle] = base + offset;
        return pos[handle];
      },
      fs_close_handle(handle) { closed.push(handle); return 1; },
    },
  });
  wat = harness.exports;

  assert.strictEqual(wat.test_lzinit(43), 43, 'an ordinary file is its own LZ handle');
  assert.strictEqual(pos[43], 0, 'LZInit rewinds an ordinary file');
  assert.strictEqual(wat.test_lz_esp() >>> 0, 0x00430008, 'LZInit pops one stdcall argument');

  const h = wat.test_lzinit(41);
  assert.strictEqual(h, 0x400, 'an SZDD file gets the first LZ handle');
  const buf = wat.test_lz_alloc(plain.length + 16);
  const readBack = n => Buffer.from(Array.from({ length: n }, (_, i) => wat.guest_read8(buf + i)));

  assert.strictEqual(wat.test_lzread(h, buf, 10), 10);
  assert.deepStrictEqual(readBack(10), plain.subarray(0, 10), 'the first bytes expand exactly');
  assert.strictEqual(wat.test_lzread(h, buf, plain.length), plain.length - 10,
    'a long read stops at the expanded size');
  assert.deepStrictEqual(readBack(plain.length - 10), plain.subarray(10),
    'the rest of the stream expands exactly, back references included');
  assert.strictEqual(wat.test_lzread(h, buf, 4), 0, 'reading at the end returns 0');

  assert.strictEqual(wat.test_lzseek(h, 0, 2), plain.length, 'SEEK_END reports the expanded size');
  assert.strictEqual(wat.test_lzseek(h, 17, 0), 17);
  assert.strictEqual(wat.test_lzseek(h, 2, 1), 19, 'SEEK_CUR is relative');
  assert.strictEqual(wat.test_lzread(h, buf, 7), 7);
  assert.deepStrictEqual(readBack(7), plain.subarray(19, 26), 'a read after a seek starts there');
  assert.strictEqual(wat.test_lzseek(h, plain.length + 1, 0), -7, 'past the end is LZERROR_BADVALUE');

  assert.strictEqual(wat.test_lzclose(h), 0);
  assert.deepStrictEqual(closed, [41], 'LZClose closes the source file');
  assert.strictEqual(wat.test_lz_esp() >>> 0, 0x00430008, 'LZClose pops one stdcall argument');
  assert.strictEqual(wat.test_lzinit(41), 0x400, 'a closed LZ slot is reused');
  console.log('PASS  LZInit expands SZDD files for LZRead/LZSeek and passes ordinary files through');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
