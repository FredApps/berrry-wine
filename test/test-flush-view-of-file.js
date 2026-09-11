#!/usr/bin/env node
//
// FlushViewOfFile writes a mapped view back to the file it came from.
//
// Kodak Imaging keeps one mapping open for the whole session and calls this to
// make its edits durable without giving the pointer up, so the interesting
// part is that the writeback happens while the view stays mapped -- and that a
// pointer into the *middle* of a view, with a byte count, still lands at the
// right offset in the file. Both are MSDN behaviour and both are easy to get
// wrong by reusing UnmapViewOfFile's whole-view path.
'use strict';

const assert = require('assert');
const { createFilesystemImports } = require('../lib/filesystem');
const { bootRenderHarness } = require('./render-helper');

const IMAGE_BASE = 0x400000;
// From the map declared in src/00-regions.wat.
const GUEST_BASE = require('../lib/region-map.generated.js').GUEST_BASE;

// A stand-in for the emulator: flat linear memory and a bump guest_alloc, which
// is all the mapping path touches.
function makeCtx() {
  const memory = new WebAssembly.Memory({ initial: 64 });
  let next = IMAGE_BASE + 0x10000;
  const ctx = {
    getMemory: () => memory.buffer,
    exports: {
      get_image_base: () => IMAGE_BASE,
      guest_alloc: (size) => { const at = next; next += (size + 0xFFF) & ~0xFFF; return at; },
      guest_free: base => ctx.freed.push(base),
    },
    freed: [],
  };
  ctx.g2w = (guest) => guest - IMAGE_BASE + GUEST_BASE;
  ctx.bytes = () => new Uint8Array(memory.buffer);
  return ctx;
}

(async () => {
  // --- the writeback itself -------------------------------------------------
  const ctx = makeCtx();
  const imports = createFilesystemImports(ctx);
  const original = new Uint8Array(512).fill(0x41);
  ctx.vfs.files.set('c:\\cache.dat', { data: original, attrs: 0x20 });

  const hFile = ctx.vfs.createFile('c:\\cache.dat', 0xC0000000, 3);
  assert(hFile, 'the fixture file opens');
  const hMap = imports.fs_create_file_mapping(hFile, 4, 0, 0, 0);
  assert(hMap, 'CreateFileMapping over a VFS file');
  const base = imports.fs_map_view_of_file(hMap, 6, 0, 0, 0);
  assert(base, 'MapViewOfFile hands back a guest address');

  const mem = ctx.bytes();
  mem.fill(0x5A, ctx.g2w(base + 100), ctx.g2w(base + 108));

  assert.strictEqual(imports.fs_flush_view(base + 100, 8), 1,
    'a flush inside a live view succeeds');
  const stored = ctx.vfs.files.get('c:\\cache.dat').data;
  assert.deepStrictEqual(Array.from(stored.subarray(98, 110)),
    [0x41, 0x41, 0x5A, 0x5A, 0x5A, 0x5A, 0x5A, 0x5A, 0x5A, 0x5A, 0x41, 0x41],
    'exactly the flushed span reaches the file, at the view-relative offset');

  // The view is still mapped: further writes flush again through the same
  // pointer, which is the whole reason an app calls this instead of unmapping.
  mem.fill(0x7E, ctx.g2w(base), ctx.g2w(base + 4));
  assert.strictEqual(imports.fs_flush_view(base, 0), 1,
    'zero bytes means "to the end of the view"');
  assert.deepStrictEqual(Array.from(stored.subarray(0, 4)), [0x7E, 0x7E, 0x7E, 0x7E],
    'the second flush works on the still-mapped view');

  assert.strictEqual(imports.fs_flush_view(base + 0x100000, 4), 0,
    'an address outside every view fails instead of silently writing nowhere');

  // A pagefile-backed section has no file behind it; flushing one is a no-op
  // that must not throw on the missing VFS entry.
  const anon = imports.fs_create_file_mapping(0xFFFFFFFF, 4, 0, 256, 0);
  const anonBase = imports.fs_map_view_of_file(anon, 6, 0, 0, 0);
  assert.strictEqual(imports.fs_flush_view(anonBase, 0), 1,
    'flushing a pagefile-backed view succeeds');

  // --- async provider-backed read-only mapping ----------------------------
  // A browser File cannot answer synchronously. MapViewOfFile must park on
  // the existing IO_WAIT path, stream into the guest allocation, then return
  // that completed view when the exact API call retries.
  const lazyCtx = makeCtx();
  const lazyImports = createFilesystemImports(lazyCtx);
  const lazyBytes = Uint8Array.from({ length: 700000 }, (_, i) => (i * 37) & 0xff);
  let rangeReads = 0;
  lazyCtx.vfs.setProviderFile('d:\\game\\data.res', {
    provider: {
      size: lazyBytes.length,
      readRange(offset, length) {
        rangeReads++;
        return Promise.resolve(lazyBytes.slice(offset, offset + length));
      },
    },
    attrs: 0x01,
  });
  const lazyFile = lazyCtx.vfs.createFile('d:\\game\\data.res', 0x80000000, 3);
  const lazyMap = lazyImports.fs_create_file_mapping(lazyFile, 2, 0, 0, 0);
  assert.strictEqual(lazyImports.fs_map_view_of_file(lazyMap, 4, 0, 0, 0), 0,
    'the first mapping attempt parks instead of touching async-only entry.data');
  assert.strictEqual(lazyImports.fs_read_pending(), 1,
    'the ordinary IO_WAIT status channel reports the pending mapping');
  const pendingMap = lazyCtx.vfs.pendingRead;
  assert(pendingMap && /data\.res$/.test(pendingMap.path));
  await lazyCtx.vfs.fillPendingRead(pendingMap);
  lazyCtx.vfs.pendingRead = null;
  const lazyBase = lazyImports.fs_map_view_of_file(lazyMap, 4, 0, 0, 0);
  assert(lazyBase, 'retry returns the view filled while the guest was parked');
  assert(rangeReads > 0, 'the parked fill reads the asynchronous provider');
  assert.deepStrictEqual(
    Array.from(lazyCtx.bytes().subarray(lazyCtx.g2w(lazyBase + 12345),
      lazyCtx.g2w(lazyBase + 12361))),
    Array.from(lazyBytes.subarray(12345, 12361)),
    'the provider bytes land at the corresponding guest mapping offset');
  assert(lazyCtx.vfs.files.get('d:\\game\\data.res')._provider,
    'read-only mapping does not retain a duplicate eager JavaScript copy');
  assert.strictEqual(lazyImports.fs_unmap_view(lazyBase), 1,
    'unmapping a read-only provider view needs no synchronous writeback');
  assert.deepStrictEqual(lazyCtx.freed,[lazyBase],'unmap releases backing with the matching allocator');
  assert.strictEqual(lazyImports.fs_unmap_view(lazyBase),0,'double unmap fails');
  assert.deepStrictEqual(lazyCtx.freed,[lazyBase],'double unmap does not double free');
  const sparseCtx=makeCtx(), sparseFreed=[];
  sparseCtx.exports.guest_map_alloc=sparseCtx.exports.guest_alloc;
  sparseCtx.exports.guest_map_free=p=>{sparseFreed.push(p);return 1;};
  const sparseImports=createFilesystemImports(sparseCtx);
  const sparseMap=sparseImports.fs_create_file_mapping(0xffffffff,4,0,4096,0);
  const sparseBase=sparseImports.fs_map_view_of_file(sparseMap,6,0,0,0);
  assert.strictEqual(sparseImports.fs_unmap_view(sparseBase),1);
  assert.deepStrictEqual(sparseFreed,[sparseBase]);assert.deepStrictEqual(sparseCtx.freed,[]);
  lazyCtx.vfs.setProviderFile('d:\\bad.dat',{
    provider:{size:4096,readRange:()=>Promise.reject(new Error('read failed'))},attrs:1});
  const badFile=lazyCtx.vfs.createFile('d:\\bad.dat',0x80000000,3);
  const badMap=lazyImports.fs_create_file_mapping(badFile,2,0,0,0);
  assert.strictEqual(lazyImports.fs_map_view_of_file(badMap,4,0,0,0),0);
  await assert.rejects(lazyCtx.vfs.pendingRead.provider.fill(),/read failed/);
  assert.strictEqual(lazyCtx.freed.length,2,'failed provider fill releases unpublished allocation');
  assert.strictEqual(lazyImports.fs_map_view_of_file(badMap,4,0,0,0),0);
  assert.strictEqual(lazyCtx.freed.length,2,'failed retry does not free twice');

  // --- the WAT handler ------------------------------------------------------
  const seen = [];
  let mapAttempts = 0;
  const { exports: wat } = await bootRenderHarness({
    extraWat: String.raw`
      (func (export "g2w") (param $g i32) (result i32) (call $g2w (local.get $g)))
      (func (export "map_count") (result i32) (i32.load (global.get $VIRTUAL_MAP_STATE)))
      (func (export "backing_top") (result i32)
        (i32.load offset=4 (global.get $VIRTUAL_MAP_STATE)))
      (func (export "exhaust_bump") (result i32)
        (i32.store offset=4 (global.get $VIRTUAL_MAP_STATE) (region.end $VIRTUAL_BACKING_BASE))
        (region.end $VIRTUAL_BACKING_BASE))
      (func (export "test_flush_view_of_file") (param $base i32) (param $bytes i32) (result i64)
        (global.set $esp (i32.const 0x00300000))
        (call $handle_FlushViewOfFile
          (local.get $base) (local.get $bytes)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
        (i64.or
          (i64.extend_i32_u (global.get $eax))
          (i64.shl (i64.extend_i32_u (global.get $esp)) (i64.const 32))))
      (func (export "test_map_view_of_file") (result i64)
        (global.set $esp (i32.const 0x00300000))
        (call $handle_MapViewOfFile
          (i32.const 0xfb000001) (i32.const 4) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0))
        (i64.or
          (i64.extend_i32_u (global.get $eax))
          (i64.shl (i64.extend_i32_u (global.get $esp)) (i64.const 32))))
    `,
    extraHostOverrides: {
      fs_flush_view: (...args) => { seen.push(args); return 1; },
      fs_map_view_of_file: () => (++mapAttempts === 1 ? 0 : 0x00420000),
      fs_read_pending: () => (mapAttempts === 1 ? 1 : 0),
    },
  });

  const r = wat.test_flush_view_of_file(0x00420000, 0x1000);
  assert.strictEqual(Number(r & 0xffffffffn), 1, 'the host result becomes EAX');
  assert.strictEqual(Number(r >> 32n), 0x0030000c,
    'FlushViewOfFile pops its return address and two stdcall arguments');
  assert.deepStrictEqual(seen, [[0x00420000, 0x1000]],
    'both arguments reach the host untouched');

  const parked = wat.test_map_view_of_file();
  assert.strictEqual(Number(parked & 0xffffffffn), 0);
  assert.strictEqual(Number(parked >> 32n), 0x00300000,
    'a pending mapping restores its complete stdcall frame');
  assert.strictEqual(wat.get_yield_reason(), 12,
    'a pending mapping uses the existing lazy-VFS IO_WAIT reason');
  wat.clear_yield();
  const retried = wat.test_map_view_of_file();
  assert.strictEqual(Number(retried & 0xffffffffn), 0x00420000,
    'the retried mapping returns the host-completed guest address');
  assert.strictEqual(Number(retried >> 32n), 0x00300018,
    'the successful retry pops five arguments and its return address once');

  // Real sparse allocator, not the JS test double: sequential map/unmap
  // cycles must recover the map slot and physical backing each time.
  const pinned=wat.guest_map_alloc(4096);
  assert(pinned);wat.guest_write32(pinned,0x12345678);
  const count=wat.map_count(),top=wat.backing_top();
  for(let i=0;i<1100;i++){
    const view=wat.guest_map_alloc(65536);assert(view,'mapping cycle '+i);
    assert.strictEqual(wat.guest_read32(view),0,'reused backing is zeroed');
    wat.guest_write32(view,0xdeadbeef);
    assert.strictEqual(wat.guest_map_free(view),1);
    assert.strictEqual(wat.map_count(),count);
    assert.strictEqual(wat.backing_top(),top);
  }
  assert.strictEqual(wat.guest_read32(pinned),0x12345678,'live mapping survives');
  assert.strictEqual(wat.guest_map_free(pinned),1);
  assert.strictEqual(wat.guest_map_free(pinned),0,'exact release is not repeatable');
  const first=wat.guest_map_alloc(65536),live=wat.guest_map_alloc(65536);
  assert(first && live);wat.guest_write32(live,0x23456789);
  const firstBacking=wat.g2w(first);
  assert.strictEqual(wat.guest_map_free(first),1,'release a non-top extent');
  const exhausted=wat.exhaust_bump(), reused=wat.guest_map_alloc(65536);
  assert(reused,'exhausted bump allocator reuses a released gap');
  assert.strictEqual(wat.g2w(reused),firstBacking,'exact freed extent is reused');
  assert.strictEqual(wat.backing_top(),exhausted,'gap reuse cannot lower high water into live backing');
  assert.strictEqual(wat.guest_read32(reused),0);
  assert.strictEqual(wat.guest_read32(live),0x23456789);
  const second=wat.guest_map_alloc(65536);assert(second);
  assert.notStrictEqual(wat.g2w(second),wat.g2w(reused),'consecutive gap allocations do not overlap');
  assert.strictEqual(wat.guest_map_free(second),1);
  assert.strictEqual(wat.guest_map_free(reused),1);
  assert.strictEqual(wat.guest_map_free(live),1);

  console.log('PASS  FlushViewOfFile writes a live view back at the right offset');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
