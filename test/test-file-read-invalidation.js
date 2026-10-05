#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');
const RegionMap = require('../lib/region-map.generated');

const memory = new WebAssembly.Memory({ initial: 8192 });
const ptes = new Uint32Array(memory.buffer, RegionMap.BASE.GUEST_PAGE_TABLE,
  RegionMap.SIZE.GUEST_PAGE_TABLE >>> 2);
const page = 0x30000000;
const backing = RegionMap.BASE.VIRTUAL_BACKING_BASE;
ptes[page >>> 12] = backing | 0x800;
ptes[(page >>> 12) + 1] = (backing + 0x3000) | 0x800;
const bytes = new Uint8Array(memory.buffer);

for (const outcome of ['pending', 'fault', 'error', 'success']) {
  const vfs = new VirtualFS();
  vfs.files.set('c:\\read.bin', { data: Uint8Array.from([11, 22, 33, 44]), attrs: 0x20 });
  const handle = vfs.createFile('c:\\read.bin', 0x80000000, 3);
  const notices = [];
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      invalidate_code_range: (address, length) => notices.push([address, length]) },
  });
  const readFile = vfs.readFile.bind(vfs);
  let calls = 0;
  // A controlled second-chunk outcome isolates the import's early exits;
  // the first chunk uses the real VFS and really mutates guest memory.
  vfs.readFile = (...args) => {
    if (++calls === 2) {
      if (outcome === 'pending') return { pending: { test: true } };
      if (outcome === 'fault') return { faulted: true, error: 30 };
      if (outcome === 'error') return { ok: false, error: 30 };
    }
    return readFile(...args);
  };
  bytes.fill(0xcc, backing + 4094, backing + 4096);
  bytes.fill(0xcc, backing + 0x3000, backing + 0x3002);
  const result = imports.fs_read_file_result(handle, page + 4094, 4, 0);
  assert.strictEqual(calls, 2, 'noncontiguous backing forces two read chunks');
  assert.strictEqual(result, outcome === 'pending' ? 997 : outcome === 'success' ? 0 : 30);
  assert.deepStrictEqual([...bytes.slice(backing + 4094, backing + 4096)], [11, 22]);
  assert.deepStrictEqual([...bytes.slice(backing + 0x3000, backing + 0x3002)],
    outcome === 'success' ? [33, 44] : [0xcc, 0xcc]);
  assert.deepStrictEqual(notices, [[page + 4094, outcome === 'success' ? 4 : 2]],
    `${outcome}: invalidate exactly the already-written prefix, once`);
  assert.strictEqual(vfs.handles.get(handle).pos,
    outcome === 'pending' ? 0 : outcome === 'success' ? 4 : 2);
  notices.length = 0;
  assert.strictEqual(imports.fs_read_file_result(handle, page, 0, 0), 0);
  assert.deepStrictEqual(notices, [], 'empty reads do not invalidate');
}
// The byte-count output is guest memory too, including on a zero-byte read.
for (const split of [1, 2, 3]) {
  const vfs = new VirtualFS();
  vfs.files.set('c:\\count.bin', { data: Uint8Array.from([11, 22, 33, 44]), attrs: 0x20 });
  const handle = vfs.createFile('c:\\count.bin', 0x80000000, 3);
  const count = page + 4096 - split;
  const notices = [];
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      invalidate_code_range: (address, length) => notices.push([address, length]) },
  });
  const translate = ga => ga < page + 4096 ? backing + ga - page : backing + 0x3000 + ga - page - 4096;
  for (let i = -1; i <= 4; i++) bytes[translate(count + i)] = 0xcc;
  assert.strictEqual(imports.fs_read_file_result(handle, page + 0x100, 4, count), 0);
  assert.deepStrictEqual(Array.from({ length: 6 }, (_, i) => bytes[translate(count - 1 + i)]),
    [0xcc, 4, 0, 0, 0, 0xcc], `split ${split}: byte count scatters without touching neighbors`);
  assert(notices.some(([ga, n]) => ga === count && n === 4), 'count writes notify invalidation');
  assert.strictEqual(imports.fs_read_file_result(handle, page + 0x100, 0, count), 0);
  assert.deepStrictEqual(Array.from({ length: 4 }, (_, i) => bytes[translate(count + i)]), [0, 0, 0, 0]);
}
// Verify production delegation separately from the lightweight-host fallback.
// The exported writer owns both the write and its notification.
{
  const vfs = new VirtualFS();
  vfs.files.set('c:\\delegate.bin', { data: Uint8Array.from([7]), attrs: 0x20 });
  const handle = vfs.createFile('c:\\delegate.bin', 0x80000000, 3);
  const writes = [], notices = [];
  const count = page + 0x80;
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_write32: (ga, value) => writes.push([ga, value]),
      invalidate_code_range: (ga, n) => notices.push([ga, n]) },
  });
  assert.strictEqual(imports.fs_read_file_result(handle, page + 0x100, 1, count), 0);
  assert.deepStrictEqual(writes, [[count, 0], [count, 1]], 'delegate each scalar output once');
  assert.deepStrictEqual(notices, [[page + 0x100, 1]], 'do not duplicate exported-writer notifications');
}
console.log('PASS  ReadFile sparse data/count writes notify on success, park and failure');
