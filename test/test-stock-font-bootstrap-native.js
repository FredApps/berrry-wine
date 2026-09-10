#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { BUNDLED_BITMAP_FONTS } = require('../lib/font-substitutions');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const Bootstrap = require('../lib/stock-font-bootstrap');
const { stageAndLoadPe } = require('../lib/process-boot');
const extraWat = String.raw`
  (func (export "bootstrap_ensure") (result i32) (call $gdi_bitmap_font_ensure_stock))
  (func (export "bootstrap_state_set") (param i32) (param i32)
    (i32.store (call $stock_font_state_ptr (local.get 0)) (local.get 1)))
  (func (export "bootstrap_heap_end") (result i32)
    (call $w2g (i32.add (global.get $GUEST_HEAP_BASE) (global.get $GUEST_HEAP_BASE_SIZE))))
  (func (export "bootstrap_heap_floor") (result i32)
    (call $w2g (global.get $GUEST_HEAP_BASE)))
`;
(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'bitmap' });
  const e = h.exports, vfs = h.hostCtx.vfs;
  stageAndLoadPe(e, h.memory.buffer, fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe')), () => {});
  let reads = 0;
  const entries = BUNDLED_BITMAP_FONTS.map(file => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', file)));
    const provider = new ChunkCache({ size: bytes.length,
      async readRange(off, len) { reads++; assert(len <= 65536); return bytes.slice(off, off + len); }
    }, { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 1024, readAhead: 0 });
    return vfs.setProviderFile(`c:\\windows\\fonts\\${file.toLowerCase()}`, { provider });
  });
  const states = () => Array.from({ length: 5 }, (_, i) => e.stock_font_state(i));
  assert.deepStrictEqual(states(), [0, 0, 0, 0, 0]);
  const scratch = e.guest_alloc(128);
  assert(scratch > 0 && scratch < e.bootstrap_heap_floor(),
    'real PE allocation exercises the below-nominal-heap regression');
  for (let i = 0; i < 128; i++) e.guest_write8(scratch + i, 0);
  for (const index of [-1, 5, 0x7fffffff]) {
    assert.strictEqual(e.stock_font_state(index), -1);
    assert.strictEqual(e.stock_font_install(index, scratch, 128), 0);
  }
  for (const [data, size] of [[0, 128], [scratch, 0], [scratch, 1], [scratch, 0xf0001],
    [scratch, -1], [scratch, 256], [1, 2], [-1, 2], [e.bootstrap_heap_end() - 1, 2], [scratch, 128]]) {
    assert.strictEqual(e.stock_font_install(0, data, size), 0);
    assert.deepStrictEqual(states(), [0, 0, 0, 0, 0]);
    assert.strictEqual(e.test_gdi_bitmap_font_count(), 0);
  }
  for (const state of [1, 2, 3]) {
    e.bootstrap_state_set(0, state);
    assert.strictEqual(e.stock_font_install(0, scratch, 128), 0);
    assert.strictEqual(e.stock_font_state(0), state);
  }
  e.bootstrap_state_set(0, 0);
  const batch = await Bootstrap.prepare(vfs);
  assert.strictEqual(batch.count, 5);
  assert(batch.isCurrent());
  assert.deepStrictEqual(states(), [0, 0, 0, 0, 0], 'preparation cannot publish font state');
  const beforeReads = reads;
  const readFile = vfs.readFile;
  vfs.readFile = () => { throw Error('native bootstrap or ensure performed filesystem I/O'); };
  try {
    for (let index = 0; index < 5; index++) {
      assert(batch.isCurrent());
      const bytes = batch.read(index), data = e.guest_alloc(bytes.length);
      try {
        for (let off = 0; off < bytes.length; off += 4096) {
          bytes.subarray(off, off + 4096).forEach((b, j) => e.guest_write8(data + off + j, b));
        }
        assert(batch.isCurrent(), 'validate immediately before synchronous publication');
        assert(e.stock_font_install(index, data, bytes.length) > 0, BUNDLED_BITMAP_FONTS[index]);
        assert.strictEqual(e.stock_font_state(index), 2);
        const count = e.test_gdi_bitmap_font_count();
        assert.strictEqual(e.stock_font_install(index, data, bytes.length), 0, 'duplicate refused');
        assert.strictEqual(e.test_gdi_bitmap_font_count(), count);
        // Simulate an explicit registry entry with no stock bootstrap state.
        e.bootstrap_state_set(index, 0);
        assert.strictEqual(e.stock_font_install(index, data, bytes.length), 0, 'existing path records preserved');
        assert.strictEqual(e.test_gdi_bitmap_font_count(), count);
        assert.strictEqual(e.stock_font_state(index), 0);
        e.bootstrap_state_set(index, 2);
      } finally { e.guest_free(data); }
    }
    assert.deepStrictEqual(states(), [2, 2, 2, 2, 2]);
    assert.strictEqual(e.bootstrap_ensure(), 1, 'ordinary ensure observes completed publication');
    assert.strictEqual(reads, beforeReads);
    assert(entries.every(entry => entry._provider), 'batch handoff preserves lazy entries');
  } finally { vfs.readFile = readFile; batch.release(); e.guest_free(scratch); }
  assert(!batch.isCurrent());
  const peer = await bootRenderHarness({ extraWat, fonts: 'none', memory: h.memory });
  peer.exports.init_thread(1, e.get_image_base(), e.get_code_start(), e.get_code_end(),
    e.get_thunk_base(), e.get_thunk_end(), e.get_num_thunks());
  peer.hostCtx.vfs.readFile = () => { throw Error('peer must observe shared stock publication'); };
  assert.deepStrictEqual(Array.from({length:5}, (_, i) => peer.exports.stock_font_state(i)), [2,2,2,2,2]);
  assert.strictEqual(peer.exports.bootstrap_ensure(), 1);
  console.log('PASS native stock bootstrap: five zero-cache FON leases, guarded install, malformed/state/path rejection, I/O-free ensure');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
