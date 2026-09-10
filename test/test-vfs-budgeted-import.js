#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const { BASE, GUEST_BASE } = require('../lib/region-map.generated');

(async () => {
  const page = 4096, guest = 0x30000000, image = 0x400000;
  const backings = [0x20000, 0x24000, 0x28000, 0x2c000];
  // Real translation table, not a mocked guestChunk: adjacent guest addresses
  // are backed by separated runs, with sentinel-filled gaps between them.
  const memory = new ArrayBuffer(Math.max(BASE.VIRTUAL_MAP_TABLE + 256,
    BASE.VIRTUAL_MAP_STATE + 16, 0x30000));
  const dv = new DataView(memory), heap = new Uint8Array(memory);
  dv.setUint32(BASE.VIRTUAL_MAP_STATE, 4, true);
  for (let i = 0; i < 4; i++) {
    const record = BASE.VIRTUAL_MAP_TABLE + i * 16;
    dv.setUint32(record, guest + i * page, true);
    dv.setUint32(record + 4, page, true);
    dv.setUint32(record + 8, backings[i], true);
  }
  const vfs = new VirtualFS(), invalidations = [];
  const imports = createFilesystemImports({ vfs, getMemory: () => memory,
    exports: { get_image_base: () => image,
      invalidate_code_range: (address, size) => invalidations.push([address, size]) },
  });
  const countGuest = image + 0x100, countWa = GUEST_BASE + 0x100;
  const payload = Uint8Array.from({ length: 4 * page }, (_, i) => i % 251);
  const budget = new ChunkCacheBudget({ maxBytes: 2 * page });
  function setup(fault = false, cacheOptions = { budget }) {
    const source = { size: payload.length, reads: 0,
      async readRange(offset, length) {
        this.reads++;
        if (fault) throw new Error('permanent provider failure');
        return payload.slice(offset, offset + length);
      },
    };
    const cache = new ChunkCache(source, { ...cacheOptions, chunkSize: page, readAhead: 0 });
    vfs.setProviderFile('c:\\save.dat', { provider: cache });
    const handle = vfs.createFile('c:\\save.dat', 0x80000000, 3);
    heap.fill(0xA5, backings[0], 0x30000);
    dv.setUint32(countWa, 0xFFFFFFFF, true); invalidations.length = 0;
    return { handle, source, cache };
  }
  async function read(handle, size) {
    for (let fills = 0; fills <= 2; fills++) {
      const ok = imports.fs_read_file(handle, guest, size, countGuest);
      if (ok || imports.fs_read_pending() !== 1) return { ok, fills };
      assert.strictEqual(dv.getUint32(countWa, true), 0, 'pending reports no completed read');
      if (fills === 2) assert.fail('whole import read must progress within two fill rounds');
      await vfs.fillPendingRead(vfs.pendingRead);
    }
  }
  function verify(expected) {
    for (let i = 0; i < 4; i++) {
      const start = i * page, n = Math.min(page, Math.max(0, expected.length - start));
      assert.deepStrictEqual(heap.slice(backings[i], backings[i] + n), expected.slice(start, start + n));
      assert(heap.subarray(backings[i] + n, backings[i] + page).every(x => x === 0xA5), 'EOF tail untouched');
      assert(heap.subarray(backings[i] + page, backings[i] + 4 * page).every(x => x === 0xA5), 'unrelated backing gap untouched');
    }
  }
  const whole = setup();
  assert.strictEqual((await read(whole.handle, payload.length)).ok, 1);
  assert.strictEqual(dv.getUint32(countWa, true), payload.length);
  assert.strictEqual(vfs.handles.get(whole.handle).pos, payload.length);
  assert.deepStrictEqual(invalidations, [[guest, payload.length]]);
  verify(payload);
  assert.strictEqual(whole.source.reads, 4, 'fetch each file chunk once, not repeated prefix refills');
  assert(budget.bytes <= 2 * page);

  // The legacy per-file LRU has the same oversized-read requirement even
  // without a shared pool: one import spans four chunks, but only two fit.
  const localOnly = setup(false, { maxChunks: 2 });
  assert.strictEqual(localOnly.cache.budget, null);
  assert.strictEqual((await read(localOnly.handle, payload.length)).ok, 1);
  assert.strictEqual(dv.getUint32(countWa, true), payload.length);
  assert.strictEqual(vfs.handles.get(localOnly.handle).pos, payload.length);
  assert.deepStrictEqual(invalidations, [[guest, payload.length]]);
  verify(payload);
  assert.strictEqual(localOnly.source.reads, 4, 'unbudgeted oversized read fetches each chunk once');
  assert(localOnly.cache._chunks.size <= 2, 'legacy local LRU remains bounded');

  const tail = setup();
  vfs.setFilePointer(tail.handle, 3 * page - 5, 0);
  assert.strictEqual((await read(tail.handle, payload.length)).ok, 1);
  const remaining = payload.slice(3 * page - 5);
  assert.strictEqual(dv.getUint32(countWa, true), remaining.length);
  assert.strictEqual(vfs.handles.get(tail.handle).pos, payload.length);
  assert.deepStrictEqual(invalidations, [[guest, remaining.length]]);
  verify(remaining);
  invalidations.length = 0;
  assert.strictEqual(imports.fs_read_file(tail.handle, guest, payload.length, countGuest), 1);
  assert.strictEqual(dv.getUint32(countWa, true), 0);
  assert.deepStrictEqual(invalidations, []);

  const failure = setup(true);
  assert.strictEqual((await read(failure.handle, payload.length)).ok, 0);
  assert.strictEqual(imports.fs_read_pending(), 2, 'permanent failure must not keep parking');
  assert.strictEqual(dv.getUint32(countWa, true), 0);
  assert.strictEqual(vfs.handles.get(failure.handle).pos, 0);
  assert.deepStrictEqual(invalidations, []);
  verify(new Uint8Array());
  vfs.files.clear();
  for (const sameRange of [false, true]) {
    const first = setup(false, { budget: new ChunkCacheBudget({ maxBytes: 0 }) });
    const second = vfs.createFile('c:\\save.dat', 0x80000000, 3);
    const secondPos = sameRange ? 0 : 2 * page;
    vfs.setFilePointer(second, secondPos, 0);
    const waiting = [];
    for (const handle of [first.handle, second]) {
      assert.strictEqual(imports.fs_read_file(handle, guest, 2 * page, countGuest), 0);
      waiting.push(vfs.pendingRead);
    }
    await Promise.all(waiting.map(p => vfs.fillPendingRead(p)));
    for (const [handle, offset] of [[first.handle, 0], [second, secondPos]]) {
      heap.fill(0xA5, backings[0], 0x30000);
      assert.strictEqual(imports.fs_read_file(handle, guest, 2 * page, countGuest), 1,
        'each handle consumes its own immutable fill result');
      verify(payload.slice(offset, offset + 2 * page));
      assert.strictEqual(vfs.handles.get(handle)._completedProviderRead, undefined);
    }
  }
  const closing = setup(false, { budget: new ChunkCacheBudget({ maxBytes: 0 }) });
  assert.strictEqual(imports.fs_read_file(closing.handle, guest, page, countGuest), 0);
  const abandoned = vfs.pendingRead;
  vfs.closeHandle(closing.handle);
  await vfs.fillPendingRead(abandoned);
  assert.strictEqual(vfs.handles.get(closing.handle)._completedProviderRead, undefined);
  const seeking = setup(false, { budget: new ChunkCacheBudget({ maxBytes: 0 }) });
  assert.strictEqual(imports.fs_read_file(seeking.handle, guest, page, countGuest), 0);
  await vfs.fillPendingRead(vfs.pendingRead);
  assert(vfs.handles.get(seeking.handle)._completedProviderRead);
  vfs.setFilePointer(seeking.handle, 0, 0);
  assert(vfs.handles.get(seeking.handle)._completedProviderRead, 'same-position retry seek preserves result');
  vfs.setFilePointer(seeking.handle, page, 0);
  assert.strictEqual(vfs.handles.get(seeking.handle)._completedProviderRead, undefined);
  vfs.files.clear();
  console.log('PASS budgeted filesystem import: multi-mapping scatter, bounded progress, byte/cursor/gap/invalidation correctness, fault and EOF');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
