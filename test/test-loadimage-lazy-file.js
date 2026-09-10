#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const STACK = 0x110100, PATH = 0x120000, THUNK = 0x200000;
const extraWat = String.raw`
 (func (export "image_begin") (param $id i32) (param $stack i32)
   (global.set $thunk_guest_base (i32.const 0x200000))
   (global.set $thunk_guest_end (i32.const 0x200008))
   (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
   (global.set $esp (local.get $stack)) (global.set $eip (i32.const 0x200000)))
 (func (export "image_resume")
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
   (call $run (i32.const 2)))
 (func (export "image_eax") (result i32) (global.get $eax))
 (func (export "image_esp") (result i32) (global.get $esp))
 (func (export "image_pending") (result i32) (global.get $load_image_pending))
 (func (export "image_frames") (result i32) (local $p i32) (local $n i32)
   (local.set $p (global.get $load_image_pending))
   (block $done (loop $walk
     (br_if $done (i32.eqz (local.get $p)))
     (local.set $n (i32.add (local.get $n) (i32.const 1)))
     (local.set $p (call $gl32 (local.get $p))) (br $walk)))
   (local.get $n))
`;
(async () => {
  const h = await bootRenderHarness({ fonts: 'none', extraWat });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const payload = Buffer.alloc(54 + 64 * 64 * 3);
  payload.write('BM'); payload.writeUInt32LE(payload.length, 2);
  payload.writeUInt32LE(54, 10); payload.writeUInt32LE(40, 14);
  payload.writeInt32LE(64, 18); payload.writeInt32LE(64, 22);
  payload.writeUInt16LE(1, 26); payload.writeUInt16LE(24, 28);
  for (let i = 54; i < payload.length; i++) payload[i] = (i * 13) & 255;
  let opens = 0, closes = 0, fetches = 0;
  const create = vfs.createFile.bind(vfs), close = vfs.closeHandle.bind(vfs);
  vfs.createFile = (...args) => { opens++; return create(...args); };
  vfs.closeHandle = (...args) => { closes++; return close(...args); };
  function mount(path, { budgetBytes = 0, failAt = -1, invalid = false } = {}) {
    const bytes = new Uint8Array(payload); if (invalid) bytes[0] = 0;
    const budget = new ChunkCacheBudget({ maxBytes: budgetBytes });
    const provider = new ChunkCache({ size: bytes.length, readRange: async (off, len) => {
      fetches++; if (off === failAt) throw new Error('injected BMP read failure');
      return bytes.slice(off, off + len);
    } }, { chunkSize: 4096, readAhead: 0, maxChunks: 1, budget });
    vfs.setProviderFile(path, { provider });
    return provider;
  }
  function begin(name, path, stack = STACK, pathPtr = PATH) {
    const encoded = Buffer.from(path + '\0', name.endsWith('W') ? 'utf16le' : 'latin1');
    encoded.forEach((b, i) => e.guest_write8(pathPtr + i, b));
    e.image_begin(apis.find(a => a.name === name).id, stack);
    [0, 0, pathPtr, 0, 0, 0, 0x10].forEach((v, i) => e.guest_write32(stack + i * 4, v));
  }
  async function finish(stack = STACK, otherFrames = 0) {
    let parks = 0;
    for (;;) {
      e.image_resume();
      if (e.get_yield_reason() !== 12) break;
      assert(++parks <= 5, 'read progress must be monotonic with zero cache');
      assert.strictEqual(e.image_esp(), stack); assert.strictEqual(e.get_eip(), THUNK);
      assert.strictEqual(e.image_frames(), otherFrames + 1);
      const frame = e.image_pending(), pending = vfs.pendingRead;
      e.image_resume(); // Retry before fill must reuse exactly the same frame.
      assert.strictEqual(e.get_yield_reason(), 12);
      assert.strictEqual(e.image_pending(), frame);
      assert.strictEqual(e.image_frames(), otherFrames + 1);
      await vfs.fillPendingRead(pending);
    }
    assert.strictEqual(e.image_esp(), stack + 28);
    assert.strictEqual(e.image_frames(), otherFrames);
    return parks;
  }
  function pixels() {
    const bitmap = e.image_eax(); assert(bitmap, 'explicit file must produce a bitmap');
    const storage = e.test_gdi_bitmap_storage(bitmap);
    assert.deepStrictEqual(new Uint8Array(h.memory.buffer, storage, payload.length - 54), new Uint8Array(payload.subarray(54)));
    e.test_call_DeleteObject(bitmap);
  }
  for (const name of ['LoadImageA', 'LoadImageW']) for (const budgetBytes of [0, 4096]) {
    const path = name.endsWith('W') ? 'c:\\图片.bmp' : 'c:\\picture.bmp';
    const provider = mount(path, { budgetBytes });
    const before = [opens, closes, fetches]; begin(name, path);
    assert.strictEqual(await finish(), 4); pixels();
    assert.deepStrictEqual([opens - before[0], closes - before[1], fetches - before[2]], [1, 1, 4]);
    assert(provider.budget.bytes <= budgetBytes);
    assert.strictEqual(provider.tryRead(0, payload.length), null, 'entry was not materialized');
  }
  for (const failAt of [0, 4096, 8192, 12288]) {
    mount('c:\\bad.bmp', { failAt }); const before = closes;
    begin('LoadImageA', 'c:\\bad.bmp'); await finish();
    assert.strictEqual(e.image_eax(), 0); assert.strictEqual(closes, before + 1);
  }
  mount('c:\\bad.bmp', { invalid: true }); begin('LoadImageA', 'c:\\bad.bmp');
  await finish(); assert.strictEqual(e.image_eax(), 0, 'invalid file cannot become a dummy bitmap');
  for (const mutate of [
    b => b.writeUInt32LE(0xFFFFFFFF, 14), // Header extends beyond file.
    b => b.writeUInt32LE(100000, 22), // Pixel plan extends beyond file.
    b => { b.writeUInt16LE(8, 28); b.writeUInt32LE(256, 46); return b.subarray(0, 60); },
    b => { b.writeUInt16LE(16, 28); b.writeUInt32LE(3, 30); return b.subarray(0, 54); },
    b => b.subarray(0, 54), // Complete read of a header-only truncated BMP.
  ]) {
    const source = Buffer.from(payload), result = mutate(source);
    const bytes = Buffer.isBuffer(result) ? result : source;
    vfs.setProviderFile('c:\\malformed.bmp', { provider: new ChunkCache({
      size: bytes.length, readRange: async (off, len) => bytes.slice(off, off + len),
    }, { chunkSize: 4096, maxChunks: 1, readAhead: 0 }) });
    begin('LoadImageA', 'c:\\malformed.bmp'); await finish();
    assert.strictEqual(e.image_eax(), 0, 'malformed BMP must not read outside staging');
  }
  begin('LoadImageW', 'c:\\missing.bmp'); assert.strictEqual(await finish(), 0); assert.strictEqual(e.image_eax(), 0);
  mount('c:\\short.bmp');
  const read = vfs.readFile.bind(vfs);
  vfs.readFile = (handle, target, count) => vfs.handles.get(handle)?.pos >= 4096 ? 0 : read(handle, target, count);
  begin('LoadImageA', 'c:\\short.bmp'); assert.strictEqual(await finish(), 1);
  assert.strictEqual(e.image_eax(), 0, 'short EOF must not parse incomplete staging'); vfs.readFile = read;
  // Nested API frames independently retain their files and staging buffers.
  mount('c:\\outer.bmp'); mount('c:\\inner.bmp');
  begin('LoadImageA', 'c:\\outer.bmp'); e.image_resume(); const outer = vfs.pendingRead;
  begin('LoadImageW', 'c:\\inner.bmp', STACK + 0x1000, PATH + 0x1000);
  await finish(STACK + 0x1000, 1); pixels();
  await vfs.fillPendingRead(outer); begin('LoadImageA', 'c:\\outer.bmp'); await finish(); pixels();
  // Changed arguments at a reused frame abandon and release the old operation.
  mount('c:\\outer.bmp'); begin('LoadImageA', 'c:\\outer.bmp'); e.image_resume();
  const before = closes; begin('LoadImageW', 'c:\\missing.bmp'); await finish();
  assert.strictEqual(closes, before + 1); assert.strictEqual(e.image_eax(), 0);
  assert.strictEqual([...vfs.handles.values()].filter(handle => !handle.closed).length, 0);
  console.log('PASS LoadImageA/W actual thunk: Unicode, zero/tiny cache, exact BMP pixels, repeated misses, faults, EOF, independent frames and cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
