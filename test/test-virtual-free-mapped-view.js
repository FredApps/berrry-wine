#!/usr/bin/env node
'use strict';

// VirtualFree must refuse a MapViewOfFile view, the way Windows does.
//
// A view handed out by guest_map_alloc lives in the same high address space as
// a VirtualAlloc commit and gets an ordinary VIRTUAL_MAP_TABLE record, so by
// the time VirtualFree sees an address there is nothing in the record to say
// which it is. Windows cares: a view is released with UnmapViewOfFile, and
// VirtualFree on one fails with ERROR_INVALID_ADDRESS without touching a byte.
//
// Age of Empires leans on exactly that. Its allocator wraps a "decommit these
// bytes" helper at 0x46ef00 that calls VirtualFree(ptr, size, MEM_DECOMMIT) on
// whatever it is handed, and it hands it unaligned interior pointers into the
// memory-mapped .drs archives -- measured: 0x7de5d197 size 0x183e, inside the
// guest 0x7d1b0000 view whose 0xdc3000 is Interfac.drs rounded up to a page.
// On Windows those calls do nothing at all. Before this fixture they reached
// $virtual_map_decommit_zero, which cleared the interface shapes straight out
// of the mapped archive; the shape count then read 0 and the game put up
// "Could not initialize graphics system", which is a long way from the cause.
//
// What this pins: a decommit or a release aimed at a view changes no bytes and
// reports failure, an interior pointer is recognized as part of its view, the
// guard is lifted once the view is freed, and -- the reason the zeroing exists
// -- a decommit of ordinary VirtualAlloc'd memory still clears it.

const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');

const extraWat = String.raw`
  (func (export "test_mv_backed_bytes") (result i32)
    (local $i i32) (local $sum i32)
    (block $done (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (i32.load (global.get $VIRTUAL_MAP_STATE))))
      (local.set $sum (i32.add (local.get $sum)
        (i32.load offset=4 (i32.add (global.get $VIRTUAL_MAP_TABLE)
          (i32.shl (local.get $i) (i32.const 4))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan)))
    (local.get $sum))
  (func (export "test_mv_fill_registry")
    (i32.store (global.get $MAPPED_VIEW_TABLE) (global.get $MAX_MAPPED_VIEWS)))
  (func (export "test_mv_cursor") (result i32)
    (i32.load offset=8 (global.get $VIRTUAL_MAP_STATE)))
  (func (export "test_mv_force_gap")
    (i32.store offset=8 (global.get $VIRTUAL_MAP_STATE) (call $virtual_alloc_min))
    (global.set $virtual_alloc_top (call $virtual_alloc_min)))
  (func (export "test_mv_reset")
    (call $zero_memory (global.get $VIRTUAL_MAP_STATE)
      (i32.add (global.get $VIRTUAL_MAP_STATE_SIZE)
        (global.get $VIRTUAL_MAP_TABLE_SIZE)))
    (call $zero_memory (global.get $MAPPED_VIEW_TABLE)
      (global.get $MAPPED_VIEW_TABLE_SIZE))
    (call $zero_memory (global.get $GUEST_PAGE_TABLE)
      (global.get $GUEST_PAGE_TABLE_SIZE))
    (i32.store (i32.add (global.get $VIRTUAL_MAP_STATE) (i32.const 4))
      (global.get $VIRTUAL_BACKING_BASE))
    (global.set $virtual_alloc_top (global.get $VIRTUAL_ALLOC_TOP_INIT))
    (global.set $heap_sparse_ptr (i32.const 0))
    (global.set $heap_sparse_end (i32.const 0)))
  (func (export "test_mv_alloc") (param $size i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (call $handle_VirtualAlloc
      (i32.const 0) (local.get $size) (i32.const 0x3000)
      (i32.const 0x04) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_mv_free") (param $guest i32) (param $size i32) (param $type i32)
      (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x00500000))
    (global.set $last_error (i32.const 0))
    (call $handle_VirtualFree
      (local.get $guest) (local.get $size) (local.get $type)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_mv_last_error") (result i32) (global.get $last_error))
  (func (export "test_mv_write32") (param $guest i32) (param $value i32)
    (call $gs32 (local.get $guest) (local.get $value)))
  (func (export "test_mv_read32") (param $guest i32) (result i32)
    (call $gl32 (local.get $guest)))
`;

const PAGE = 0x1000;
const MEM_DECOMMIT = 0x4000;
const MEM_RELEASE = 0x8000;
const ERROR_INVALID_ADDRESS = 487;

async function main() {
  const wasmBytes = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = {
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  for (const name of ['create_thread', 'exit_thread', 'terminate_thread',
    'create_event', 'set_event', 'reset_event', 'wait_single', 'wait_multiple']) {
    imports.host[name] = () => 0;
  }
  imports.host.com_create_instance = () => 0x80004002;
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const wasm = instance.exports;
  context.exports = wasm;

  const fill = (base, bytes, seed) => {
    for (let off = 0; off < bytes; off += 4) {
      wasm.test_mv_write32(base + off, (seed + off) >>> 0);
    }
  };
  const matches = (base, bytes, seed) => {
    for (let off = 0; off < bytes; off += 4) {
      if ((wasm.test_mv_read32(base + off) >>> 0) !== ((seed + off) >>> 0)) return false;
    }
    return true;
  };

  const VIEW_BYTES = 8 * PAGE;

  // One section address spans a large lazy file without backing all its bytes.
  // Commit tail first, then overlapping/growing ranges, with another allocation
  // interleaved so preserving bytes cannot depend on contiguous WASM backing.
  wasm.test_mv_reset();
  const sectionSize = 600 * 1024 * 1024;
  const section = wasm.guest_section_reserve(sectionSize) >>> 0;
  assert(section);
  assert.strictEqual(section % 65536, 0);
  assert.strictEqual(wasm.test_mv_backed_bytes(), 0, 'reservation is not materialization');
  assert.strictEqual(wasm.guest_section_commit(section, 65536, 16) >>> 0, section + 65536);
  wasm.test_mv_write32(section + 65536, 0x12345678);
  const neighbor = wasm.guest_map_alloc(PAGE) >>> 0;
  assert(neighbor);
  wasm.test_mv_write32(neighbor, 0x76543210);
  assert.strictEqual(wasm.guest_section_commit(section, 0, 16) >>> 0, section);
  wasm.test_mv_write32(section, 0x1234);
  assert.strictEqual(wasm.guest_section_commit(section, 0, 131072) >>> 0, section);
  assert.strictEqual(wasm.test_mv_read32(section), 0x1234, 'growth preserves the first page');
  assert.strictEqual(wasm.test_mv_read32(section + 65536), 0x12345678, 'growth preserves tail');
  assert.strictEqual(wasm.test_mv_backed_bytes(), 131072 + PAGE, 'only mapped ranges are backed');
  for (const [offset, size] of [[sectionSize, 1], [sectionSize - PAGE, PAGE + 1], [1, PAGE], [0, 0], [0, 0xffffffff]]) {
    assert.strictEqual(wasm.guest_section_commit(section, offset, size), 0, 'invalid commit rejected');
  }
  assert.strictEqual(wasm.test_mv_free(section + 65536, PAGE, MEM_DECOMMIT), 0);
  assert.strictEqual(wasm.test_mv_read32(section + 65536), 0x12345678);
  assert.strictEqual(wasm.guest_section_free(section), 1);
  assert.strictEqual(wasm.test_mv_backed_bytes(), PAGE, 'all section extents retired');
  assert.strictEqual(wasm.test_mv_read32(neighbor), 0x76543210, 'neighbor remains intact');
  assert.strictEqual(wasm.guest_section_free(section), 0, 'double release rejected');
  assert(wasm.guest_map_free(neighbor));
  const emptySection = wasm.guest_section_reserve(sectionSize) >>> 0;
  assert(emptySection, 'large reservation is reusable after release');
  assert.strictEqual(wasm.guest_section_free(emptySection), 1, 'uncommitted section can be released');
  for (const size of [0, 0xffffffff]) assert.strictEqual(wasm.guest_section_reserve(size), 0);
  console.log('PASS  stable sparse section growth, bounded commits and complete retirement');

  wasm.test_mv_reset();
  const vfs = new VirtualFS();
  const fsHost = createFilesystemImports({ vfs, exports: wasm, getMemory: () => memory.buffer });
  const map = (handle, access, offset, bytes, thread = 1) => {
    const error = fsHost.fs_map_view_of_file_result(handle, access, 0, offset, bytes, 64, thread);
    return { error, address: new DataView(memory.buffer).getUint32(64, true) };
  };
  vfs.files.set('c:\\shared.bin', { data: new Uint8Array(131072).fill(0x41), attrs: 0x20 });
  const file = vfs.createFile('c:\\shared.bin', 0xc0000000, 3);
  for (const protection of [4, 8]) {
    const handle = fsHost.fs_create_file_mapping(file, protection, 0, 131072, 0);
    const first = map(handle, 4, 0, 16);
    const mode = protection === 4 ? 2 : 1;
    assert.strictEqual(first.error, 0);
    const second = map(handle, mode, 0, 131072);
    const tail = map(handle, mode, 65536, 16);
    assert.strictEqual(second.address, first.address, 'native same-base identity');
    assert.strictEqual(tail.address, first.address + 65536, 'native offset identity');
    wasm.test_mv_write32(first.address + 65536, 0x12345678);
    assert.strictEqual(wasm.test_mv_read32(tail.address), 0x12345678, 'immediate peer visibility');
    const again = map(handle, mode, 0, 16);
    assert.strictEqual(again.address, first.address);
    assert.strictEqual(wasm.test_mv_read32(tail.address), 0x12345678, 'new map does not reload dirty bytes');
    assert.strictEqual(fsHost.fs_close_handle(handle), 1);
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(fsHost.fs_unmap_view(first.address), 1, 'each repeated base owns a reference');
      assert.strictEqual(wasm.test_mv_read32(tail.address), 0x12345678, 'tail survives base unmaps');
    }
    assert.strictEqual(fsHost.fs_unmap_view(first.address), 0);
    assert.strictEqual(fsHost.fs_unmap_view(tail.address), 1);
    assert.strictEqual(wasm.test_mv_backed_bytes(), 0, 'last handle/view releases backing');
    const data = vfs.files.get('c:\\shared.bin').data;
    assert.strictEqual(new DataView(data.buffer).getUint32(65536, true),
      protection === 4 ? 0x12345678 : 0x41414141, 'COPY never writes back');
    data.fill(0x41);
  }
  console.log('PASS  runtime shared READWRITE/WRITECOPY identity, coherence and counted unmaps');

  const retained = fsHost.fs_create_file_mapping(file, 8, 0, 131072, 0);
  const beforeUnmap = map(retained, 1, 0, 16);
  wasm.test_mv_write32(beforeUnmap.address, 0x12345678);
  assert.strictEqual(fsHost.fs_unmap_view(beforeUnmap.address), 1);
  assert.strictEqual(wasm.test_mv_backed_bytes(), PAGE, 'native open handle retains committed section');
  const reopened = map(retained, 1, 0, 16);
  assert.strictEqual(reopened.address, beforeUnmap.address);
  assert.strictEqual(wasm.test_mv_read32(reopened.address), 0x12345678, 'COPY edits survive last-view unmap');
  assert.strictEqual(fsHost.fs_unmap_view(reopened.address), 1);
  assert.strictEqual(fsHost.fs_close_handle(retained), 1);
  assert.strictEqual(wasm.test_mv_backed_bytes(), 0, 'closing final handle retires viewless backing');

  // Race two reads of one lazy section, then retire one while its provider is
  // parked. A late completion must not touch a surviving view's dirty bytes.
  const waits = [];
  vfs.setProviderFile('c:\\lazy.bin', { length: sectionSize, provider: {
    size: sectionSize,
    tryRead: () => null,
    fill: () => { throw new Error('readRange expected'); },
    readRange: (offset, size) => new Promise(resolve => waits.push({ offset, size, resolve })),
  } });
  const lazyFile = vfs.createFile('c:\\lazy.bin', 0x80000000, 3);
  const lazyHandle = fsHost.fs_create_file_mapping(lazyFile, 8, 0, 0, 0);
  assert.strictEqual(map(lazyHandle, 1, 0, 16, 2).error, 997);
  assert.strictEqual(map(lazyHandle, 1, 0, 16, 3).error, 997);
  assert.strictEqual(map(lazyHandle, 1, 0, 16, 4).error, 997);
  const fillA = vfs.getIoState(2).pendingRead.provider.fill();
  const fillB = vfs.getIoState(3).pendingRead.provider.fill();
  const fillC = vfs.getIoState(4).pendingRead.provider.fill();
  waits[1].resolve(new Uint8Array(waits[1].size).fill(0x41));
  await fillB;
  const survivor = map(lazyHandle, 1, 0, 16, 3);
  assert.strictEqual(survivor.error, 0);
  wasm.test_mv_write32(survivor.address, 0x12345678);
  waits[2].resolve(new Uint8Array(waits[2].size).fill(0x43));
  await fillC;
  const peer = map(lazyHandle, 1, 0, 16, 4);
  assert.strictEqual(peer.address, survivor.address);
  assert.strictEqual(wasm.test_mv_read32(peer.address), 0x12345678,
    'late successful overlapping fill also preserves dirty bytes');
  vfs.releaseIoState(2);
  fsHost.fs_close_handle(lazyHandle);
  waits[0].resolve(new Uint8Array(waits[0].size).fill(0x42));
  await fillA;
  assert.strictEqual(wasm.test_mv_read32(survivor.address), 0x12345678);
  assert.strictEqual(wasm.test_mv_backed_bytes(), PAGE, 'large lazy section backs only the mapped page');
  assert(vfs.files.get('c:\\lazy.bin')._provider, 'COPY does not materialize the file');
  assert.strictEqual(fsHost.fs_unmap_view(survivor.address), 1);
  assert.strictEqual(wasm.test_mv_read32(peer.address), 0x12345678);
  assert.strictEqual(fsHost.fs_unmap_view(peer.address), 1);
  assert.strictEqual(wasm.test_mv_backed_bytes(), 0);
  console.log('PASS  canceled lazy shared fill cannot overwrite or free a surviving view');

  vfs.setProviderFile('c:\\bad-map.bin', { length: PAGE, provider: {
    size: PAGE, tryRead: () => null, fill: () => {},
    readRange: async () => new Uint8Array(1),
  } });
  const badFile = vfs.createFile('c:\\bad-map.bin', 0x80000000, 3);
  const badSection = fsHost.fs_create_file_mapping(badFile, 2, 0, 0, 0);
  assert.strictEqual(map(badSection, 4, 0, 16, 5).error, 997);
  await assert.rejects(vfs.getIoState(5).pendingRead.provider.fill(), /short provider read/);
  assert.strictEqual(map(badSection, 4, 0, 16, 5).error, 30);
  vfs.releaseIoState(5); // failed operation already released its own reference
  assert.strictEqual(fsHost.fs_close_handle(badSection), 1);
  assert.strictEqual(wasm.test_mv_backed_bytes(), 0, 'failed fill has no leaked view reference');

  const writeBytes = new Uint8Array(131072).fill(0x41);
  vfs.setProviderFile('c:\\write-map.bin', { provider: {
    size: writeBytes.length, tryRead: () => null, fill: () => {},
    readRange: async (offset, length) => writeBytes.slice(offset, offset + length),
  } });
  const writeFile = vfs.createFile('c:\\write-map.bin', 0xc0000000, 3);
  const writeSection = fsHost.fs_create_file_mapping(writeFile, 4, 0, 0, 0);
  assert.strictEqual(map(writeSection, 4, 0, 16, 6).error, 997);
  await vfs.getIoState(6).pendingRead.provider.fill();
  const readView = map(writeSection, 4, 0, 16, 6);
  assert.strictEqual(map(writeSection, 2, 0, 131072, 7).error, 997);
  await vfs.getIoState(7).pendingRead.provider.fill();
  const writeView = map(writeSection, 2, 0, 131072, 7);
  assert.strictEqual(writeView.address, readView.address);
  wasm.test_mv_write32(writeView.address, 0x12345678);
  assert.strictEqual(wasm.test_mv_read32(readView.address), 0x12345678);
  assert.strictEqual(fsHost.fs_flush_view(writeView.address, 4), 1);
  const written = vfs.files.get('c:\\write-map.bin').data;
  assert.strictEqual(new DataView(written.buffer).getUint32(0, true), 0x12345678);
  fsHost.fs_close_handle(writeSection);
  fsHost.fs_unmap_view(readView.address);
  fsHost.fs_unmap_view(writeView.address);
  assert.strictEqual(wasm.test_mv_backed_bytes(), 0);
  console.log('PASS  lazy shared write promotion, flush and failed-fill retirement');

  // Exhausted view bookkeeping must not hand out an unguarded allocation.
  // Simulate capacity directly: the rejection must not inspect or alter slots.
  wasm.test_mv_reset();
  wasm.test_mv_fill_registry();
  const fullCursor = wasm.test_mv_cursor();
  assert.strictEqual(wasm.guest_map_alloc(PAGE), 0,
    'full view registry must reject allocation instead of losing VirtualFree protection');
  assert.strictEqual(wasm.guest_section_reserve(sectionSize), 0,
    'section reservations also require tracked VirtualFree protection');
  assert.strictEqual(wasm.test_mv_cursor(), fullCursor,
    'registry exhaustion must fail before reserving address space');
  console.log('PASS  full mapped-view registry refuses allocation without reserving memory');

  // Mapping sizes are page-rounded, but their bases must honor the larger
  // allocation granularity. Interleave awkward sizes to catch cursor drift.
  wasm.test_mv_reset();
  const views = [];
  for (const bytes of [1, PAGE - 1, PAGE, PAGE + 1, 65535, 65536, 65537, 131073]) {
    if (views.length === 7) wasm.test_mv_force_gap();
    const base = wasm.guest_map_alloc(bytes) >>> 0;
    assert(base, `mapping allocation ${bytes}`);
    assert.strictEqual(base % 65536, 0, 'mapping base is allocation-granularity aligned');
    const rounded = Math.ceil(bytes / PAGE) * PAGE;
    for (const other of views) {
      assert(base + rounded <= other.base || other.base + other.rounded <= base,
        'concurrent mapped ranges must not overlap');
    }
    const seed = views.length + 1;
    wasm.test_mv_write32(base, seed);
    wasm.test_mv_write32(base + rounded - 4, seed + 100);
    views.push({ base, rounded, seed });
  }
  for (const { base, rounded, seed } of views) {
    assert.strictEqual(wasm.test_mv_read32(base), seed);
    assert.strictEqual(wasm.test_mv_read32(base + rounded - 4), seed + 100);
    assert(wasm.guest_map_free(base), 'each allocated view releases independently');
  }
  console.log('PASS  mapped bases stay 64K aligned across page-rounded sizes and gap fallback without overlap');

  // 1. A decommit aimed at the middle of a view changes nothing and fails.
  //    The offsets are AoE's own shape: unaligned base, size that is not a
  //    whole number of pages.
  wasm.test_mv_reset();
  const view = wasm.guest_map_alloc(VIEW_BYTES) >>> 0;
  assert(view, 'guest_map_alloc must hand back a view');
  fill(view, VIEW_BYTES, 0x11110000);

  const decommit = wasm.test_mv_free(view + 0x197, 0x183e, MEM_DECOMMIT) >>> 0;
  assert.strictEqual(decommit, 0,
    'VirtualFree(MEM_DECOMMIT) on a mapped view must report failure');
  assert.strictEqual(wasm.test_mv_last_error() >>> 0, ERROR_INVALID_ADDRESS,
    'a refused view free must set ERROR_INVALID_ADDRESS');
  assert(matches(view, VIEW_BYTES, 0x11110000),
    'a refused decommit must not touch a byte of the view');
  console.log('PASS  a decommit into a mapped view is refused and changes nothing');

  // 2. So is a release, and so is one aimed at the view's own base address.
  assert.strictEqual(wasm.test_mv_free(view, 0, MEM_RELEASE) >>> 0, 0,
    'VirtualFree(MEM_RELEASE) on a mapped view must report failure');
  assert(matches(view, VIEW_BYTES, 0x11110000),
    'a refused release must not touch a byte of the view');
  console.log('PASS  a release of a mapped view is refused and changes nothing');

  // 3. The guard is about views, not about the address range: once the view is
  //    handed back, the same addresses are ordinary memory again.
  assert(wasm.guest_map_free(view), 'guest_map_free must accept its own view');
  wasm.test_mv_reset();
  const plain = wasm.test_mv_alloc(VIEW_BYTES) >>> 0;
  assert(plain, 'fixture VirtualAlloc');
  fill(plain, VIEW_BYTES, 0x22220000);
  assert.strictEqual(wasm.test_mv_free(plain, 2 * PAGE, MEM_DECOMMIT) >>> 0, 1,
    'a decommit of ordinary VirtualAlloc memory still succeeds');
  for (let off = 0; off < 2 * PAGE; off += 4) {
    assert.strictEqual(wasm.test_mv_read32(plain + off) >>> 0, 0,
      'the B&W2 behaviour must survive: a real decommit still zeroes its range');
  }
  assert(matches(plain + 2 * PAGE, VIEW_BYTES - 2 * PAGE, 0x22220000 + 2 * PAGE),
    'a real decommit must leave the rest of the allocation alone');
  console.log('PASS  a decommit of ordinary VirtualAlloc memory still zeroes it');

  console.log('PASS  VirtualFree refuses mapped views');
}

main().catch(error => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exit(1);
});
