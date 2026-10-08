#!/usr/bin/env node
'use strict';
// mmioDescend on a streamed (lazy) .wav parks instead of failing.
//
// It reads chunk headers through the host filesystem directly, and returned
// MMIOERR_CHUNKNOTFOUND for a nonresident file: Little Fighter 2 put up
// "Could not Descend into Wave File" once sound files began to stream. Its
// search moves the file pointer and writes into lpck, so the parked call has
// to put both back before the rerun.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "t_open") (param $path i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (call $handle_mmioOpenA (local.get $path) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_descend") (param $h i32) (param $ck i32) (param $flags i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x30000))
    (global.set $current_thunk_eip (i32.const 0x0013579b))
    (global.set $eip (i32.const 0))
    (global.set $handler_set_eip (i32.const 0))
    (global.set $yield_reason (i32.const 0))
    (global.set $yield_flag (i32.const 0))
    (call $handle_mmioDescend (local.get $h) (local.get $ck) (i32.const 0) (local.get $flags)
      (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "t_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

const fourcc = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = harness.exports;
  const vfs = harness.hostCtx.vfs;
  // RIFF....WAVEfmt ...data....
  const wav = new Uint8Array(48);
  const dv = new DataView(wav.buffer);
  dv.setUint32(0, fourcc('RIFF'), true); dv.setUint32(4, 40, true); dv.setUint32(8, fourcc('WAVE'), true);
  dv.setUint32(12, fourcc('fmt '), true); dv.setUint32(16, 16, true);
  dv.setUint32(36, fourcc('data'), true); dv.setUint32(40, 4, true);
  vfs.setProviderFile('c:\\lazy.wav', {
    provider: { size: wav.length, readRange: async (off, len) => wav.subarray(off, off + len) },
  });
  const path = e.guest_alloc(32) >>> 0;
  Array.from('C:\\LAZY.WAV\0').forEach((c, i) => e.guest_write8(path + i, c.charCodeAt(0)));
  const h = e.t_open(path) >>> 0;
  assert.ok(h, 'mmioOpenA opens the streamed file');

  const ck = e.guest_alloc(20) >>> 0;
  e.guest_write32(ck, 0);
  e.guest_write32(ck + 8, fourcc('WAVE') >>> 0);
  e.t_descend(h, ck, 0x20); // MMIO_FINDRIFF
  assert.strictEqual(e.get_yield_reason(), 12, 'a nonresident chunk header parks on IO_WAIT');
  assert.strictEqual(e.t_esp() >>> 0, 0x30000, 'the frame is left for the rerun');
  assert.strictEqual(e.get_eip() >>> 0, 0x0013579b, 'the rerun goes through the original thunk');
  assert.strictEqual(e.guest_read32(ck) >>> 0, 0, 'lpck->ckid is put back');
  assert.strictEqual(e.guest_read32(ck + 8) >>> 0, fourcc('WAVE') >>> 0, 'the searched form type is put back');

  // The run loop's fill, through the pending record the parked call leaves.
  const pending = vfs.getPendingRead(1);
  assert.ok(pending, 'the parked descend leaves a pending read for the host to fill');
  assert.strictEqual(await vfs.fillPendingRead(pending), true);

  assert.strictEqual(e.t_descend(h, ck, 0x20), 0, 'the rerun finds the RIFF WAVE chunk');
  assert.strictEqual(e.guest_read32(ck) >>> 0, fourcc('RIFF') >>> 0);
  assert.strictEqual(e.guest_read32(ck + 4), 40);
  assert.strictEqual(e.guest_read32(ck + 12), 8, 'dwDataOffset is just past cksize');
  assert.strictEqual(e.t_esp() >>> 0, 0x30014, 'the rerun pops its four arguments once');
  console.log('PASS test-mmio-descend-lazy');
})().catch(err => { console.error(err); process.exit(1); });
