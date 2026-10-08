// Unit tests for VirtualFS — findFirstFile, createFile basename fallback, path resolution
const assert = require('assert');

// VirtualFS is exported. It used not to be, and this file used to slice the
// class body out of the source and eval it -- which silently drops every
// module-level helper the class calls, so the day filesystem.js grew an
// entrySize() helper these tests started failing with "entrySize is not
// defined" against working code. Require the module.
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');

function makeVFS(files) {
  const vfs = new VirtualFS();
  for (const [key, size] of Object.entries(files)) {
    vfs.files.set(key, { data: new Uint8Array(size), attrs: 0x20 });
  }
  return vfs;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

console.log('VFS tests:');

test('file creation and duplication share collision-safe handle allocation across wrap', () => {
  const vfs = makeVFS({ 'c:\\first.bin': 4, 'c:\\second.bin': 8 });
  const first = vfs.createFile('c:\\first.bin', 0x80000000, 3);
  const record = vfs.getOpenFile(first);
  vfs.setFilePointer(first, 2, 0);
  vfs._nextHandle = 0x7fffffff;
  assert.strictEqual(vfs.createFile('c:\\second.bin', 0x80000000, 3), 0x7fffffff);
  const afterWrap = vfs.createFile('c:\\second.bin', 0x80000000, 3);
  assert.strictEqual(afterWrap, first + 1, 'wrap skips occupied first handle');
  assert.strictEqual(vfs.getOpenFile(first), record, 'original record is not overwritten');
  assert.strictEqual(vfs.getFileSize(first), 4);
  assert.strictEqual(record.pos, 2);
  vfs.closeHandle(afterWrap);
  vfs._nextHandle = first;
  const duplicate = vfs.duplicateFileHandle(first, 0, false, 2);
  assert.strictEqual(duplicate, first + 2, 'duplicate skips live and tombstone records');
  vfs._nextHandle = first;
  const opened = vfs.createFile('c:\\second.bin', 0x80000000, 3);
  assert.strictEqual(opened, first + 3, 'ordinary open uses the same collision policy');
  assert.strictEqual(vfs.getOpenFile(afterWrap), null);
  for (const seed of [0, 4, 0x80000000, 0xffffffff]) {
    vfs._nextHandle = seed;
    const h = vfs.createFile('c:\\second.bin', 0x80000000, 3);
    assert(h >= 0x70000001 && h <= 0x7fffffff, 'disk handles stay in their positive namespace');
    assert.strictEqual(vfs.getOpenFile(first), record);
  }
});

test('handle allocation failure cannot truncate files and still honors duplicate close-source', () => {
  const vfs = makeVFS({ 'c:\\original.bin': 8 });
  const h = vfs.createFile('c:\\original.bin', 0xc0000000, 3);
  // Exercise exhaustion without allocating a quarter billion handle records.
  vfs._allocateFileHandle = () => 0;
  assert.strictEqual(vfs.createFile('c:\\original.bin', 0xc0000000, 2), 0);
  assert.strictEqual(vfs.getFileSize(h), 8);
  assert.strictEqual(vfs.createFile('c:\\new.bin', 0xc0000000, 1), 0);
  assert(!vfs.files.has('c:\\new.bin'));
  assert.strictEqual(vfs.duplicateFileHandle(h, 0, false, 2), -4);
  assert(vfs.getOpenFile(h));
  assert.strictEqual(vfs.duplicateFileHandle(h, 0, false, 3), -4);
  assert.strictEqual(vfs.getOpenFile(h), null);
});

test('file data access is enforced before bytes, providers or cursors change', () => {
  const vfs = makeVFS({ 'c:\\rights.bin': 4 });
  const bytes = Uint8Array.from([9, 9]);
  for (const access of [0, 0x80000000, 0x40000000, 0xc0000000, 0x10000000, 1, 2, 3, 0x80, 0x100]) {
    const h = vfs.createFile('c:\\rights.bin', access, 3);
    assert(h);
    assert.strictEqual(vfs.getFileSize(h), 4, 'metadata remains queryable');
    for (const count of [0, 2]) {
      vfs.setFilePointer(h, 1, 0);
      const dest = Uint8Array.from([7, 7]);
      const read = vfs.readFile(h, dest, count);
      if (access & 0x90000001) assert(read.ok);
      else {
        assert.strictEqual(read.error, 5);
        assert.deepStrictEqual([...dest], [7, 7]);
        assert.strictEqual(vfs.getOpenFile(h).pos, 1);
      }
      vfs.setFilePointer(h, 1, 0);
      const before = [...vfs.files.get('c:\\rights.bin').data];
      const write = vfs.writeFile(h, bytes, count);
      if (access & 0x50000002) assert(write.ok);
      else {
        assert.strictEqual(write.error, 5);
        assert.deepStrictEqual([...vfs.files.get('c:\\rights.bin').data], before);
        assert.strictEqual(vfs.getOpenFile(h).pos, 1);
      }
    }
  }
  const memory = new WebAssembly.Memory({ initial: 40 });
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 } });
  vfs.setProviderFile('c:\\no-data.bin', { provider: { size: 8,
    tryRead: () => { throw Error('unauthorized provider access'); }, fill: async () => {},
  } });
  const query = vfs.createFile('c:\\no-data.bin', 0, 3);
  assert.strictEqual(vfs.createFile('c:\\no-data.bin', 0, 5), 0);
  assert.strictEqual(vfs.setEndOfFile(query), false);
  assert.strictEqual(imports.fs_set_end_of_file_result(query), 5);
  assert.strictEqual(imports.fs_set_end_of_file(query), 0);
  assert.strictEqual(vfs.getFileSize(query), 8);
  for (const count of [0, 2]) {
    assert.strictEqual(imports.fs_read_file_result(query, 0xffffffff, count, 0), 5);
    assert.strictEqual(imports.fs_read_pending(), 0);
    assert.strictEqual(imports.fs_write_file_result(query, 0xffffffff, count, 0), 5);
  }
});

test('generic and specific file rights compare by meaning without granting extra rights', () => {
  const GENERIC_EXECUTE = 1 << 29;
  const vfs = makeVFS({ 'c:\\rights.bin': 4 });
  const open = access => vfs.createFile('c:\\rights.bin', access, 3);
  for (const [generic, specific] of [[0x80000000, 0x120089],
    [0x40000000, 0x120116], [GENERIC_EXECUTE, 0x1200a0], [0x10000000, 0x1f01ff]]) {
    const h = open(generic);
    const alias = vfs.duplicateFileHandle(h, specific, false, 0);
    assert(alias > 0);
    const reverse = vfs.duplicateFileHandle(open(specific), generic, false, 0);
    assert(reverse > 0, 'equivalent explicit rights allow the generic request');
    assert.strictEqual(vfs.getOpenFile(alias).access, specific);
  }
  const read = open(0x80000000);
  const narrowed = vfs.duplicateFileHandle(read, 1, false, 0);
  assert(narrowed > 0);
  assert.strictEqual(vfs.duplicateFileHandle(narrowed, 0x80000000, false, 0), -5,
    'data-only read cannot acquire attributes, EA, or standard rights');
  assert.strictEqual(vfs.duplicateFileHandle(read, 2, false, 0), -5);
  assert.strictEqual(vfs.duplicateFileHandle(read, 0x10000000, false, 0), -5);
  const all = open(0x10000000);
  assert(vfs.duplicateFileHandle(all, 0x80000000, false, 0) > 0);
  assert.strictEqual(vfs.flushFileBuffers(all), 0);
  assert.strictEqual(vfs.setFileTimes(all, null, null, null), 0);
  assert.strictEqual(vfs.flushFileBuffers(open(2)), 0);
  assert.strictEqual(vfs.setFileTimes(open(2), null, null, null), 5);
  assert.strictEqual(vfs.setFileTimes(open(0x100), null, null, null), 0);
  vfs.setDriveReadOnly('c', true);
  for (const access of [2, 4, 0x10, 0x100, 0x10000000, 0x40000000]) {
    assert.strictEqual(open(access), 0, 'write intent cannot open protected media');
  }
  for (const access of [0, 1, 0x80, 0x80000000, GENERIC_EXECUTE]) assert(open(access) > 0);
});

test('creation dispositions validate truncation before mutation and permit protected existing opens', () => {
  const vfs = makeVFS({ 'c:\\disposition.bin': 4 });
  const entry = vfs.files.get('c:\\disposition.bin');
  entry.data.set([1, 2, 3, 4]);
  const nextHandle = vfs._nextHandle;
  for (const access of [0, 1, 4, 0x80, 0x100, 0x80000000]) {
    assert.strictEqual(vfs.createFile('c:\\disposition.bin', access, 5), 0);
    assert.strictEqual(vfs.files.get('c:\\disposition.bin'), entry);
    assert.deepStrictEqual([...entry.data], [1, 2, 3, 4]);
    assert.strictEqual(vfs._nextHandle, nextHandle);
  }
  for (const disposition of [0, 6, -1, 1.5]) {
    assert.strictEqual(vfs.createFile('c:\\disposition.bin', 0x40000000, disposition), 0);
    assert.deepStrictEqual([...entry.data], [1, 2, 3, 4]);
  }
  vfs.setDriveReadOnly('c', true);
  assert(vfs.createFile('c:\\disposition.bin', 0x80000000, 4) > 0,
    'OPEN_ALWAYS of an existing file need not write the medium');
  assert.strictEqual(vfs.createFile('c:\\new.bin', 0x80000000, 4), 0);
  assert.strictEqual(vfs.files.has('c:\\new.bin'), false);
  for (const disposition of [1, 2, 5]) {
    assert.strictEqual(vfs.createFile('c:\\disposition.bin', 0x40000000, disposition), 0);
    assert.deepStrictEqual([...entry.data], [1, 2, 3, 4]);
  }
  vfs.setDriveReadOnly('c', false);
  assert(vfs.createFile('c:\\disposition.bin', 0x40000000, 5) > 0);
  assert.strictEqual(entry.data.length, 0);
});

test('named mapping handles close independently and views retain the section', () => {
  const vfs = makeVFS({ 'c:\\lifetime.bin': 16 });
  const memory = new WebAssembly.Memory({ initial: 40 });
  const bytes = new Uint8Array(memory.buffer);
  const regions = require('../lib/region-map.generated');
  const wa = guest => regions.g2w(guest, 0x400000);
  let next = 0x410000;
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_map_alloc: () => { const address = next; next += 65536; return address; } } });
  bytes.set(Buffer.from('section-lifetime\0'), 64);
  const first = host.fs_create_file_mapping(-1, 4, 0, 16, 64);
  const second = host.fs_create_file_mapping(-1, 4, 0, 32, 64);
  const third = host.fs_open_file_mapping(64);
  assert(first && second && third);
  assert.strictEqual(new Set([first, second, third]).size, 3);
  const view = host.fs_map_view_of_file(first, 2, 0, 0, 0);
  assert(view);
  assert.strictEqual(host.fs_close_handle(first >>> 0), 1);
  assert.strictEqual(host.fs_close_handle(first), 0, 'double close is invalid');
  assert.strictEqual(host.fs_map_view_of_file(first, 2, 0, 0, 16), 0);
  assert.strictEqual(host.fs_map_view_of_file(second, 2, 0, 0, 32), 0,
    'reopening ignores the new maximum and retains the original section size');
  assert.strictEqual(host.fs_close_handle(second), 1);
  assert.strictEqual(host.fs_close_handle(third), 1);
  bytes[wa(view)] = 0x5a;
  assert.strictEqual(host.fs_flush_view(view, 1), 1);
  const reopened = host.fs_open_file_mapping(64);
  assert(reopened, 'a view alone keeps the name and section alive');
  const reader = host.fs_map_view_of_file(reopened, 4, 0, 0, 0);
  assert.strictEqual(bytes[wa(reader)], 0x5a, 'flush works after originating handle closes');
  assert.strictEqual(host.fs_unmap_view(view), 1);
  assert.strictEqual(host.fs_unmap_view(reader), 1);
  assert.strictEqual(host.fs_close_handle(reopened), 1);
  assert.strictEqual(host.fs_open_file_mapping(64), 0, 'last view plus last handle retires name');
  const replacement = host.fs_create_file_mapping(-1, 4, 0, 32, 64);
  const fresh = host.fs_map_view_of_file(replacement, 4, 0, 0, 32);
  assert(fresh);
  assert.strictEqual(bytes[wa(fresh)], 0, 'recreated name has new backing');
  assert.strictEqual(host.fs_close_handle(replacement), 1);
  assert.strictEqual(host.fs_unmap_view(fresh), 1);
  assert.strictEqual(host.fs_open_file_mapping(64), 0, 'reverse release order also retires name');

  const file = vfs.createFile('c:\\lifetime.bin', 0xc0000000, 3);
  const section = host.fs_create_file_mapping(file, 4, 0, 0, 0);
  const fileView = host.fs_map_view_of_file(section, 2, 0, 0, 16);
  assert.strictEqual(host.fs_close_handle(file), 1);
  assert.strictEqual(host.fs_close_handle(section), 1);
  bytes[wa(fileView)] = 0x7b;
  assert.strictEqual(host.fs_unmap_view(fileView), 1);
  assert.strictEqual(vfs.files.get('c:\\lifetime.bin').data[0], 0x7b);
});

test('file sections retain backing identity across rename and path replacement', () => {
  const originalPath = 'c:\\identity.bin', renamedPath = 'c:\\renamed.bin';
  const vfs = makeVFS({ [originalPath]: 16 });
  const entry = vfs.files.get(originalPath);
  entry.data.fill(0x41);
  const memory = new WebAssembly.Memory({ initial: 40 });
  const bytes = new Uint8Array(memory.buffer);
  const { g2w } = require('../lib/region-map.generated');
  let next = 0x410000;
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_map_alloc: () => { const address = next; next += 65536; return address; } } });
  const file = vfs.createFile(originalPath, 0xc0000000, 3);
  const section = host.fs_create_file_mapping(file, 4, 0, 0, 0);
  assert(section);
  const before = host.fs_map_view_of_file(section, 2, 0, 0, 16);
  assert(before);
  assert.strictEqual(host.fs_close_handle(file), 1);
  assert(vfs.moveFile(originalPath, renamedPath));
  const replacement = { data: new Uint8Array(16).fill(0x62), attrs: 0x20 };
  vfs.files.set(originalPath, replacement);
  const after = host.fs_map_view_of_file(section, 2, 0, 0, 16);
  assert(after);
  assert.strictEqual(bytes[g2w(after, 0x400000)], 0x41);
  bytes[g2w(before, 0x400000)] = 0x73;
  assert.strictEqual(host.fs_flush_view(before, 1), 1);
  assert.strictEqual(entry.data[0], 0x73);
  assert.strictEqual(replacement.data[0], 0x62, 'flush must not modify the new path occupant');
  vfs.files.delete(renamedPath);
  assert.strictEqual(host.fs_close_handle(section), 1);
  bytes[g2w(after, 0x400000)] = 0x74;
  assert.strictEqual(host.fs_unmap_view(after), 1);
  assert.strictEqual(entry.data[0], 0x74, 'view owns backing even without any directory entry');
  assert.strictEqual(replacement.data[0], 0x62);
  assert.strictEqual(host.fs_unmap_view(before), 1);
});

test('file mapping and view access cannot exceed file or section rights', () => {
  const vfs = makeVFS({ 'c:\\mapped.bin': 16 });
  let allocations = 0;
  const memory = new WebAssembly.Memory({ initial: 40 });
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_map_alloc: () => { allocations++; return 0x410000; } } });
  for (const access of [0, 1, 2, 3, 4, 0x80000000, 0xc0000000, 0x10000000]) {
    const h = vfs.createFile('c:\\mapped.bin', access, 3);
    const read = !!(access & 0x90000001), write = !!(access & 0x50000002);
    for (const protect of [2, 4, 8]) {
      const mapping = host.fs_create_file_mapping(h, protect, 0, 0, 0);
      assert.strictEqual(mapping !== 0, read && (protect !== 4 || write));
      if (!mapping) continue;
      for (const view of [1, 2, 4, 0xf001f, 0x24]) {
        const before = allocations;
        const allowed = !(view & 0x20) && (!(view & 2) || protect === 4) &&
          ((view & 7) !== 1 || protect === 8);
        const address = host.fs_map_view_of_file(mapping, view, 0, 0, 16);
        assert.strictEqual(address !== 0, allowed);
        assert.strictEqual(allocations - before, allowed ? 1 : 0);
        if (address) host.fs_unmap_view(address);
      }
    }
  }
  const anon = host.fs_create_file_mapping(-1, 2, 0, 16, 0);
  assert(anon);
  assert.strictEqual(host.fs_map_view_of_file(anon, 2, 0, 0, 16), 0);
  assert.strictEqual(host.fs_create_file_mapping(-1, 0, 0, 16, 0), 0);
  vfs.setProviderFile('c:\\lazy-map.bin', { provider: { size: 16,
    tryRead: () => { throw Error('denied view must not read provider'); }, fill: async () => {},
  } });
  const lazy = vfs.createFile('c:\\lazy-map.bin', 0x80000000, 3);
  assert.strictEqual(host.fs_create_file_mapping(lazy, 4, 0, 0, 0), 0);
  const section = host.fs_create_file_mapping(lazy, 2, 0, 0, 0);
  assert(section);
  const before = allocations;
  assert.strictEqual(host.fs_map_view_of_file(section, 2, 0, 0, 16), 0);
  assert.strictEqual(allocations, before);
  assert.strictEqual(host.fs_read_pending(), 0);
  const all = vfs.createFile('c:\\mapped.bin', 0x10000000, 3);
  for (const protection of [0x20, 0x40, 0x80]) {
    const executable = host.fs_create_file_mapping(all, protection, 0, 0, 0);
    assert(executable);
    assert(host.fs_map_view_of_file(executable, 0x24, 0, 0, 16));
    host.fs_unmap_view(0x410000);
  }
});

test('mapping views remain within the section size captured at creation', () => {
  const vfs = makeVFS({ 'c:\\bounds.bin': 32 });
  const sizes = [];
  const memory = new WebAssembly.Memory({ initial: 40 });
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_map_alloc: n => { sizes.push(n); return 0x410000; } } });
  const h = vfs.createFile('c:\\bounds.bin', 0xc0000000, 3);
  const section = host.fs_create_file_mapping(h, 2, 0, 16, 0);
  assert(section);
  assert.strictEqual(host.fs_map_view_of_file(section, 4, 0, 0, 17), 0);
  assert.deepStrictEqual(sizes, []);
  assert(host.fs_map_view_of_file(section, 4, 0, 0, 0));
  assert.deepStrictEqual(sizes, [16]);
  host.fs_unmap_view(0x410000);
  vfs.setFilePointer(h, 64, 0);
  vfs.setEndOfFile(h);
  assert(host.fs_map_view_of_file(section, 4, 0, 0, 0));
  assert.deepStrictEqual(sizes, [16, 16], 'file growth cannot grow the section');
  host.fs_unmap_view(0x410000);
  const anon = host.fs_create_file_mapping(-1, 4, 0, 16, 0);
  assert.strictEqual(host.fs_map_view_of_file(anon, 2, 0, 16, 1), 0);
  assert.strictEqual(host.fs_map_view_of_file(anon, 2, 0, 0, 17), 0);
  assert.strictEqual(host.fs_create_file_mapping(-1, 4, 1, 16, 0), 0,
    'unsupported high sizes must not wrap to a small section');
  assert.strictEqual(host.fs_create_file_mapping(h, 2, 0, 65, 0), 0);
  const empty = vfs.createFile('c:\\empty-section.bin', 0xc0000000, 2);
  assert.strictEqual(host.fs_create_file_mapping(empty, 2, 0, 0, 0), 0);
  assert(host.fs_create_file_mapping(empty, 4, 0, 8, 0));
  assert.strictEqual(vfs.getFileSize(empty), 8);
  const original = vfs.files.get('c:\\bounds.bin');
  original.data.set([1, 2, 3, 4]);
  vfs.setFilePointer(h, 3, 0);
  assert(host.fs_create_file_mapping(h, 4, 0, 80, 0));
  assert.strictEqual(vfs.files.get('c:\\bounds.bin'), original);
  assert.strictEqual(vfs.getOpenFile(h).pos, 3);
  assert.strictEqual(vfs.getFileSize(h), 80);
  assert.deepStrictEqual([...original.data.slice(0, 4)], [1, 2, 3, 4]);
  assert(original.data.slice(64).every(n => n === 0));
});

test('mapped offsets require allocation granularity, not just page alignment', () => {
  const vfs = makeVFS({ 'c:\\aligned.bin': 131072 });
  let allocations = 0, reads = 0;
  const memory = new WebAssembly.Memory({ initial: 40 });
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000,
      guest_map_alloc: () => { allocations++; return 0x410000; } } });
  vfs.setProviderFile('c:\\lazy-aligned.bin', { provider: { size: 131072,
    tryRead: () => { reads++; return null; },
    fill: async () => { reads++; },
  } });
  const eager = vfs.createFile('c:\\aligned.bin', 0x80000000, 3);
  const lazy = vfs.createFile('c:\\lazy-aligned.bin', 0x80000000, 3);
  for (const h of [eager, lazy, -1]) {
    const section = host.fs_create_file_mapping(h, 2, 0, 131072, 0);
    assert(section);
    for (const offset of [1, 4096, 65535, 65537]) {
      assert.strictEqual(host.fs_map_view_of_file(section, 4, 0, offset, 1), 0);
      assert.strictEqual(allocations, 0);
      assert.strictEqual(reads, 0);
      assert.strictEqual(host.fs_read_pending(), 0);
    }
  }
  vfs.files.get('c:\\aligned.bin').data[65536] = 0x7b;
  const section = host.fs_create_file_mapping(eager, 2, 0, 0, 0);
  assert.strictEqual(host.fs_map_view_of_file(section, 4, 0, 65536, 1), 0x410000,
    'view length need not be page aligned');
  assert.strictEqual(allocations, 1);
  const { g2w } = require('../lib/region-map.generated');
  assert.strictEqual(new Uint8Array(memory.buffer)[g2w(0x410000, 0x400000)], 0x7b);
});

test('append-only writes cannot overwrite and null writes cannot extend', () => {
  const vfs = makeVFS({ 'c:\\append.bin': 4 });
  const h = vfs.createFile('c:\\append.bin', 4, 3);
  assert(vfs.writeFile(h, Uint8Array.from([9]), 1).ok);
  assert.deepStrictEqual([...vfs.files.get('c:\\append.bin').data], [0, 0, 0, 0, 9]);
  assert.strictEqual(vfs.getOpenFile(h).pos, 5);
  for (const access of [4, 0x40000000]) {
    const alias = vfs.createFile('c:\\append.bin', access, 3);
    vfs.setFilePointer(alias, 100, 0);
    assert(vfs.writeFile(alias, new Uint8Array(0), 0).ok);
    assert.strictEqual(vfs.getOpenFile(alias).pos, 100);
    assert.strictEqual(vfs.getFileSize(alias), 5);
  }
});

test('closed file handles reject I/O and metadata without harming live duplicates', () => {
  const vfs = makeVFS({ 'c:\\lifetime.bin': 4 });
  const h = vfs.createFile('c:\\lifetime.bin', 0xc0000000, 3);
  vfs.writeFile(h, Uint8Array.from([1, 2, 3, 4]), 4);
  vfs.setFilePointer(h, 1, 0);
  const alias = vfs.duplicateFileHandle(h, 0, false, 2);
  assert(vfs.closeHandle(h));
  assert.strictEqual(vfs.closeHandle(h), false, 'double close fails');
  const buffer = Uint8Array.from([99]);
  assert.strictEqual(vfs.readFile(h, buffer, 1).ok, false);
  assert.strictEqual(vfs.readFile(h, buffer, 0).error, 6);
  assert.strictEqual(buffer[0], 99, 'closed read leaves destination untouched');
  assert.strictEqual(vfs.writeFile(h, buffer, 1).ok, false);
  assert.strictEqual(vfs.writeFile(h, buffer, 0).error, 6);
  assert.strictEqual(vfs.setFilePointer(h, 100, 0) >>> 0, 0xffffffff);
  assert.strictEqual(vfs.setEndOfFile(h), false);
  assert.strictEqual(vfs.getFileSize(h) >>> 0, 0xffffffff);
  assert.strictEqual(vfs.getFileTimes(h).error, 6);
  assert.strictEqual(vfs.setFileTimes(h, null, null, null), 6);
  assert.strictEqual(vfs.flushFileBuffers(h), 6);
  assert.strictEqual(vfs.handles.get(alias).pos, 1, 'rejected I/O cannot move the shared cursor');
  assert.deepStrictEqual([...vfs.files.get('c:\\lifetime.bin').data], [1, 2, 3, 4]);
  assert.strictEqual(vfs.readFile(alias, buffer, 1).bytesRead, 1);
  assert.strictEqual(buffer[0], 2);
});

test('closed host I/O rejects even zero-length requests and new file mappings', () => {
  const vfs = makeVFS({ 'c:\\mapping.bin': 4 });
  const memory = new ArrayBuffer(0x1000);
  const imports = createFilesystemImports({ vfs, getMemory: () => memory });
  const h = vfs.createFile('c:\\mapping.bin', 0xc0000000, 3);
  const mapping = imports.fs_create_file_mapping(h, 2, 0, 0, 0);
  assert(mapping, 'a live file can create a mapping');
  vfs.closeHandle(h);
  assert.strictEqual(imports.fs_create_file_mapping(h, 2, 0, 0, 0), 0);
  // No output pointer: validation must happen before guest-buffer translation.
  assert.strictEqual(imports.fs_read_file(h, 0xdeadbeef, 0, 0), 0);
  assert.strictEqual(imports.fs_write_file(h, 0xdeadbeef, 0, 0), 0);
  assert.strictEqual(imports.fs_read_file_at(h, 0xdeadbeef, 0, 0, 0, 0), 6);
});

test('standard Win98 shell folders exist before an installer runs', () => {
  const vfs = makeVFS({});
  assert(vfs.dirs.has('c:\\windows\\start menu'));
  assert(vfs.dirs.has('c:\\windows\\start menu\\programs'));
  assert(vfs.dirs.has('c:\\windows\\start menu\\programs\\startup'));
  assert(vfs.dirs.has('c:\\windows\\desktop'));
});

test('GetFileAttributes rejects an empty path instead of resolving the CWD', () => {
  const vfs = makeVFS({});
  assert.strictEqual(vfs.getFileAttributes('') >>> 0, 0xFFFFFFFF,
    'an empty ANSI or Unicode filename is invalid');
  assert.strictEqual(vfs.getFileAttributes(null) >>> 0, 0xFFFFFFFF,
    'a missing filename is invalid');
  assert.strictEqual(vfs.getFileAttributes('.'), 0x10,
    'an explicit current-directory path remains valid');
});

function watch(vfs, handle, path, subtree, filter) {
  const state = { signaled: false, signals: 0, resets: 0, closes: 0 };
  assert(vfs.registerChangeNotification(handle, path, subtree, filter, {
    signal: () => { state.signaled = true; state.signals++; return true; },
    reset: () => { state.signaled = false; state.resets++; return true; },
    close: () => { state.closes++; return true; },
  }));
  return state;
}

test('directory notification latches one change and records another until rearm', () => {
  const vfs = new VirtualFS();
  vfs.dirs.add('c:\\watch');
  const state = watch(vfs, 0xE001, 'C:\\watch', false, 0x01);
  assert(vfs.createFile('C:\\watch\\first.txt', 0x40000000, 2));
  assert.strictEqual(state.signaled, true);
  assert.strictEqual(state.signals, 1);
  assert(vfs.createFile('C:\\watch\\second.txt', 0x40000000, 2));
  assert.strictEqual(state.signals, 1, 'a signalled manual-reset watch coalesces changes');
  assert(vfs.nextChangeNotification(0xE001));
  assert.strictEqual(state.resets, 1);
  assert.strictEqual(state.signaled, true,
    'a change recorded before FindNext immediately satisfies the rearmed watch');
  assert.strictEqual(state.signals, 2);
  assert(vfs.nextChangeNotification(0xE001));
  assert.strictEqual(state.signaled, false, 'a rearm with no pending change becomes nonsignalled');
  assert(vfs.closeChangeNotification(0xE001));
  assert.strictEqual(state.closes, 1);
  assert.strictEqual(vfs.nextChangeNotification(0xE001), false,
    'a closed notification handle cannot be rearmed');
});

test('directory notifications honor filter and subtree boundaries', () => {
  const vfs = new VirtualFS();
  vfs.dirs.add('c:\\watch');
  vfs.dirs.add('c:\\watch\\nested');
  const fileName = watch(vfs, 0xE011, 'C:\\watch', false, 0x01);
  const size = watch(vfs, 0xE012, 'C:\\watch', false, 0x08);
  const attrs = watch(vfs, 0xE013, 'C:\\watch', false, 0x04);
  const dirName = watch(vfs, 0xE014, 'C:\\watch', false, 0x02);
  const shallow = watch(vfs, 0xE015, 'C:\\watch', false, 0x01);
  const tree = watch(vfs, 0xE016, 'C:\\watch', true, 0x01);

  const handle = vfs.createFile('C:\\watch\\data.bin', 0x40000000, 2);
  assert.strictEqual(fileName.signals, 1);
  assert.strictEqual(size.signals, 0, 'creating an empty name is not a size change');
  assert.strictEqual(attrs.signals, 0);
  assert.strictEqual(dirName.signals, 0);
  assert.deepStrictEqual(vfs.writeFile(handle, Uint8Array.of(1, 2, 3), 3),
    { ok: true, bytesWritten: 3 });
  assert.strictEqual(size.signals, 1, 'extending a file satisfies FILE_NOTIFY_CHANGE_SIZE');
  assert(vfs.setFileAttributes('C:\\watch\\data.bin', 0x21));
  assert.strictEqual(attrs.signals, 1);
  assert(vfs.createDirectory('C:\\watch\\newdir'));
  assert.strictEqual(dirName.signals, 1);

  assert(vfs.nextChangeNotification(0xE015));
  assert(vfs.nextChangeNotification(0xE016));
  assert(vfs.createFile('C:\\watch\\nested\\deep.txt', 0x40000000, 2));
  assert.strictEqual(shallow.signals, 1,
    'the shallow file-name watch saw only the earlier direct child');
  assert.strictEqual(tree.signals, 2,
    'the rearmed subtree watch observes a nested file-name change');
  assert(vfs.nextChangeNotification(0xE013));
  vfs.setFileAttributes('C:\\watch', 0x10);
  assert.strictEqual(attrs.signals, 1,
    'changes to the watched directory itself do not satisfy its notification');
  assert.strictEqual(attrs.signaled, false);
});

// --- findFirstFile ---

test('CreateFile on an existing directory fails ERROR_ACCESS_DENIED under every disposition', () => {
  // Win9x behavior. Myth: The Fallen Lords probes a directory with
  // CreateFile(dir, GENERIC_READ, OPEN_EXISTING) and reads error 5 (or 32) as
  // "exists"; FILE_NOT_FOUND sent it to CreateDirectory and recursion.
  const vfs = makeVFS({ 'c:\\tags\\tags.gor': 4 });
  vfs.dirs.add('c:\\tags');
  vfs.dirs.add('c:\\tags\\local');
  for (const creation of [1, 2, 3, 4, 5]) {
    const access = creation === 5 ? 0xC0000000 : 0x80000000;
    assert.deepStrictEqual(vfs.createFileResult('C:\\TAGS\\LOCAL', access, creation),
      { handle: 0, error: 5 }, `disposition ${creation}`);
  }
  assert(!vfs.files.has('c:\\tags\\local'), 'no file is created over the directory');
  assert.deepStrictEqual(vfs.createFileResult('c:\\tags\\missing', 0x80000000, 3),
    { handle: 0, error: 2 }, 'a missing path is still FILE_NOT_FOUND');
  assert(vfs.createFile('c:\\tags\\tags.gor', 0x80000000, 3), 'files beside it still open');
});

test('a directory implied by a mounted file exists for chdir, attributes and CreateFile', () => {
  // Manifest mounts write file keys only. Myth's UBER.DLL chdirs to C:\\Modules,
  // whose only content is a mounted TCPIP.DLL, to enumerate network modules.
  const vfs = makeVFS({ 'c:\\modules\\tcpip.dll': 4 });
  assert(!vfs.dirs.has('c:\\modules'), 'precondition: never declared');
  assert.strictEqual(vfs.getFileAttributes('C:\\Modules'), 0x10);
  assert.strictEqual(vfs.createFileResult('C:\\MODULES', 0x80000000, 3).error, 5);
  assert.strictEqual(vfs.setCurrentDirectory('C:\\Modules'), true);
  assert.strictEqual(vfs.getCurrentDirectory().toLowerCase().replace(/\\$/, ''), 'c:\\modules');
  assert.strictEqual(vfs.setCurrentDirectory('C:\\Modul'), false, 'a name prefix is not a directory');
  assert.strictEqual(vfs.getFileAttributes('C:\\modules\\tcpip.dll') & 0x10, 0, 'the file stays a file');
});

test('wildcard *.* in CWD finds files in c:\\', () => {
  const vfs = makeVFS({ 'c:\\foo.txt': 10, 'c:\\bar.dat': 20 });
  const r = vfs.findFirstFile('.\\*.*');
  assert(r.handle, 'should find files');
  assert((r.handle >>> 0) <= 0x7fffffff,
    'search handle must remain nonnegative for MSVCRT _findfirst');
  const names = [r.entry.name];
  let next;
  while ((next = vfs.findNextFile(r.handle))) names.push(next.name);
  assert.deepStrictEqual(names.slice(0, 2), ['.', '..'],
    'Win9x wildcard enumeration exposes dot directory records first');
});

test('wildcard enumeration of an empty directory still returns . and ..', () => {
  const vfs = makeVFS({});
  vfs.dirs.add('c:\\empty');
  const r = vfs.findFirstFile('C:\\empty\\*.*');
  assert(r.handle, 'dot entries make an empty existing directory enumerable');
  assert.strictEqual(r.entry.name, '.');
  assert.strictEqual(r.entry.attrs, 0x10);
  assert.strictEqual(vfs.findNextFile(r.handle).name, '..');
  assert.strictEqual(vfs.findNextFile(r.handle), null);
});

test('wildcard *.* on different drive letter finds nothing', () => {
  const vfs = makeVFS({ 'c:\\foo.txt': 10 });
  const r = vfs.findFirstFile('D:\\*.*');
  assert(!r.handle, 'should not find files on D:');
});

test('exact drive-root lookup returns the existing root directory', () => {
  const vfs = makeVFS({ 'c:\\fall.exe': 10 });
  const r = vfs.findFirstFile('C:\\');
  assert(r.handle, 'a mounted drive root should be discoverable');
  assert.strictEqual(r.entry.attrs, 0x10);
});

test('manifest parent registration makes a non-C drive enumerable', () => {
  const vfs = makeVFS({ 'd:\\cd2\\data\\iwdcd.2': 1 });
  vfs.ensureParentDirs('D:\\CD2\\Data\\IWDCD.2');
  assert.strictEqual(vfs.setCurrentDirectory('D:\\'), true,
    'the mounted drive root must be a real directory');
  const root = vfs.findFirstFile('D:\\*.*');
  assert(root.handle, 'the mounted drive root must be enumerable');
  assert.strictEqual(root.entry.name, '.');
  assert.strictEqual(root.entry.attrs, 0x10);
  assert.strictEqual(vfs.findNextFile(root.handle).name, '..');
  assert.strictEqual(vfs.findNextFile(root.handle).name, 'cd2');
});

test('a file of the same name on another drive is not found', () => {
  // There was a basename fallback here. It served Colin McRae Rally
  // c:\demo\english.txt for Q:\Game\language\english.txt.
  const vfs = makeVFS({ 'c:\\demoopen.ddv': 100 });
  const r = vfs.findFirstFile('D:\\abe\\demoopen.ddv');
  assert(!r.handle, 'FindFirstFile is exact');
  assert.strictEqual(r.entry, null);
});

test('missing C-drive directories cannot borrow an exact filename from a cache', () => {
  const vfs = makeVFS({ 'c:\\game\\cache\\data\\area.bif': 6586 });
  vfs.ensureParentDirs('C:\\game\\cache\\data\\area.bif');
  assert(vfs.setCurrentDirectory('C:\\game'));
  for (const missing of ['C:\\game\\override\\data\\area.bif', '.\\override\\data\\area.bif']) {
    const found = vfs.findFirstFile(missing);
    assert.strictEqual(found.handle, 0, `${missing} must not enumerate the cached archive`);
    assert.strictEqual(found.entry, null);
    assert.strictEqual(vfs.createFile(missing, 0x80000000, 3), 0,
      'enumeration and opening must agree about the missing path');
  }
  const exact = vfs.findFirstFile('C:\\game\\cache\\data\\area.bif');
  assert(exact.handle, 'the actual cached file remains discoverable');
  assert.strictEqual(exact.entry.size, 6586);
  assert(vfs.createFile('C:\\game\\cache\\data\\area.bif', 0x80000000, 3));
});

test('exact lookup in an existing directory does not find a nested basename', () => {
  const vfs = makeVFS({
    'c:\\windows\\temp\\_istmp0.dir\\isuninst.exe': 314880,
  });
  vfs.dirs.add('c:\\windows\\temp\\_istmp0.dir');
  const r = vfs.findFirstFile('C:\\WINDOWS\\IsUninst.exe');
  assert(!r.handle, 'FindFirstFile must not recurse below an existing directory');
});

test('wildcard *.ddv finds only .ddv files', () => {
  const vfs = makeVFS({ 'c:\\a.ddv': 1, 'c:\\b.txt': 2, 'c:\\c.ddv': 3 });
  const r = vfs.findFirstFile('.\\*.ddv');
  assert(r.handle, 'should find .ddv files');
  // Enumerate all
  const names = [r.entry.name];
  let next;
  while ((next = vfs.findNextFile(r.handle))) names.push(next.name);
  assert.strictEqual(names.length, 2);
  assert(names.includes('a.ddv'));
  assert(names.includes('c.ddv'));
});

test('parent traversal clamps at drive root for sibling asset wildcards', () => {
  const vfs = makeVFS({ 'c:\\maps\\entry.dx': 10, 'c:\\maps\\training.dx': 20 });
  vfs.dirs.add('c:\\maps');
  const r = vfs.findFirstFile('..\\Maps\\*.dx');
  assert(r.handle, 'C:\\..\\Maps must resolve to C:\\Maps');
  const names = [r.entry.name];
  let next;
  while ((next = vfs.findNextFile(r.handle))) names.push(next.name);
  assert.deepStrictEqual(names, ['entry.dx', 'training.dx']);
});

test('a wildcard in a missing relative directory finds nothing', () => {
  // AoE used to depend on the current directory standing in for campaign;
  // its registry entry now mounts the .cpn files at c:\campaign.
  const vfs = makeVFS({ 'c:\\armies_1.cpn': 1, 'c:\\readme.txt': 2, 'c:\\reigno_1.cpn': 3 });
  assert(!vfs.findFirstFile('campaign\\*.cpn').handle, 'no current-directory retry');
  const mounted = makeVFS({ 'c:\\campaign\\armies_1.cpn': 1, 'c:\\campaign\\reigno_1.cpn': 3 });
  mounted.dirs.add('c:\\campaign');
  const r = mounted.findFirstFile('campaign\\*.cpn');
  assert(r.handle, 'the mounted layout enumerates');
  const names = [r.entry.name];
  let next;
  while ((next = mounted.findNextFile(r.handle))) names.push(next.name);
  assert.deepStrictEqual(names.filter(n => n.endsWith('.cpn')), ['armies_1.cpn', 'reigno_1.cpn']);
});

test('broad wildcard in a missing relative directory does not enumerate the root', () => {
  const vfs = makeVFS({ 'c:\\game.exe': 1, 'c:\\readme.txt': 2 });
  const r = vfs.findFirstFile('palettes\\*');
  assert(!r.handle, 'a missing palettes directory must not expose root entries');
});

test('absolute missing subdir wildcard does not use flat fallback', () => {
  const vfs = makeVFS({ 'c:\\armies_1.cpn': 1 });
  const r = vfs.findFirstFile('D:\\campaign\\*.cpn');
  assert(!r.handle, 'absolute wildcard should not fall back across drives');
});

test('case insensitive matching', () => {
  const vfs = makeVFS({ 'c:\\readme.txt': 5 });
  const r = vfs.findFirstFile('.\\README.TXT');
  assert(r.handle, 'should find case-insensitively');
});

// --- createFile basename fallback ---

test('createFile OPEN_EXISTING on another drive is exact, with the Win32 error', () => {
  const vfs = makeVFS({ 'c:\\level.lvl': 50, 'c:\\game\\other.lvl': 1 });
  vfs.dirs.add('c:\\game');
  const wrongDrive = vfs.createFileResult('D:\\game\\level.lvl', 0x80000000, 3);
  assert.strictEqual(wrongDrive.handle, 0, 'no basename fallback');
  assert.strictEqual(wrongDrive.error, 3, 'a missing directory is ERROR_PATH_NOT_FOUND');
  const missingFile = vfs.createFileResult('C:\\game\\level.lvl', 0x80000000, 3);
  assert.strictEqual(missingFile.handle, 0);
  assert.strictEqual(missingFile.error, 2, 'a missing file in a real directory is ERROR_FILE_NOT_FOUND');
  const truncate = vfs.createFileResult('D:\\game\\level.lvl', 0xC0000000, 5);
  assert.strictEqual(truncate.error, 3, 'TRUNCATE_EXISTING reports the same');
  assert(vfs.createFile('C:\\level.lvl', 0x80000000, 3), 'the exact path still opens');
});

test('createFile OPEN_EXISTING without match returns error', () => {
  const vfs = makeVFS({ 'c:\\other.txt': 5 });
  const h = vfs.createFile('D:\\game\\level.lvl', 0x80000000, 3);
  assert(!h || h === -1 || h === null, 'should fail when file not found');
});

test('writable opens never basename-fallback onto a read-only source drive', () => {
  const vfs = makeVFS({ 'd:\\readme.txt': 50 });
  vfs.dirs.add('d:');
  vfs.dirs.add('d:\\');
  vfs.setDriveReadOnly('D:');
  vfs.dirs.add('c:\\program files\\warwind');

  assert.strictEqual(vfs.createFile(
    'C:\\Program Files\\WarWind\\Data\\readme.txt', 0x80000000, 3), 0,
  'a missing C: install subtree must not borrow a mounted-media basename');
  assert.strictEqual(vfs.createFile(
    'C:\\Program Files\\WarWind\\readme.txt', 0x80000000, 3), 0,
  'an exact probe in an existing destination directory must not find the CD basename');
  assert.strictEqual(vfs.createFile(
    'C:\\Program Files\\WarWind\\readme.txt', 0x40000000, 3), 0,
  'writable OPEN_EXISTING must not substitute an identically named CD file');
  const h = vfs.createFile(
    'C:\\Program Files\\WarWind\\readme.txt', 0x40000000, 4);
  assert(h, 'writable OPEN_ALWAYS should create the requested destination');
  assert.strictEqual(vfs.handles.get(h).path,
    'c:\\program files\\warwind\\readme.txt');
  assert.deepStrictEqual(vfs.writeFile(h, Uint8Array.of(1, 2, 3), 3),
    { ok: true, bytesWritten: 3 });
  assert.strictEqual(vfs.files.get('d:\\readme.txt').data.length, 50,
    'creating the C: destination must leave the mounted source unchanged');
});

test('read-only drive permits reads and rejects every write path', () => {
  const vfs = makeVFS({ 'd:\\manual.hlp': 50 });
  vfs.dirs.add('d:');
  vfs.dirs.add('d:\\');
  vfs.setDriveReadOnly('D:');

  const readHandle = vfs.createFile('D:\\manual.hlp', 0x80000000, 3);
  assert(readHandle, 'existing file should remain readable');
  assert.strictEqual(vfs.getFileAttributes('D:\\manual.hlp'), 0x21,
    'immutable-media files advertise FILE_ATTRIBUTE_READONLY');
  assert.strictEqual(vfs.createFile('D:\\cache.tmp', 0x40000000, 2), 0,
    'CREATE_ALWAYS must fail');
  assert.strictEqual(vfs.createFile('D:\\manual.hlp', 0x40000000, 3), 0,
    'GENERIC_WRITE OPEN_EXISTING must fail');
  assert.deepStrictEqual(vfs.writeFile(readHandle, Uint8Array.of(1), 1),
    { ok: false, bytesWritten: 0, error: 5 }, 'a read-only handle denies writes before checking the medium');
  assert.strictEqual(vfs.setFileAttributes('D:\\manual.hlp', 0x20), false);
  assert.strictEqual(vfs.deleteFile('D:\\manual.hlp'), false);
  assert.strictEqual(vfs.createDirectory('D:\\cache'), false);
  assert.strictEqual(vfs.removeDirectory('D:\\'), false);
  assert.strictEqual(vfs.moveFile('D:\\manual.hlp', 'C:\\manual.hlp'), false);
  assert.strictEqual(vfs.copyFile('D:\\manual.hlp', 'D:\\copy.hlp', false), false);

  vfs.setDriveReadOnly('D', false);
  assert(vfs.createFile('D:\\cache.tmp', 0x40000000, 2),
    'making the drive writable restores normal creation');
});

test('chunked writes grow capacity geometrically but expose exact file size', () => {
  const vfs = makeVFS({});
  const handle = vfs.createFile('C:\\cache\\data\\area.bif', 0x40000000, 2);
  assert(vfs.dirs.has('c:\\cache') && vfs.dirs.has('c:\\cache\\data'),
    'creating a nested cache file registers every parent directory');
  for (let chunk = 0; chunk < 4096; chunk++) {
    const data = new Uint8Array(257).fill(chunk & 0xff);
    assert.deepStrictEqual(vfs.writeFile(handle, data, data.length),
      { ok: true, bytesWritten: 257 });
  }
  const entry = vfs.files.get('c:\\cache\\data\\area.bif');
  assert.strictEqual(entry.data.length, 4096 * 257,
    'logical length must not expose spare capacity');
  assert(entry._capacityData.length >= entry.data.length);
  assert(entry._capacityData.length < entry.data.length * 2,
    'doubling keeps spare capacity bounded');
  assert.strictEqual(vfs.getFileSize(handle), entry.data.length);
  assert.strictEqual(entry.data[256], 0);
  assert.strictEqual(entry.data[257], 1);

  vfs.setFilePointer(handle, 100, 0);
  assert(vfs.setEndOfFile(handle));
  assert.strictEqual(entry.data.length, 100);
  vfs.setFilePointer(handle, 200, 0);
  assert(vfs.setEndOfFile(handle));
  assert.strictEqual(entry.data.length, 200);
  assert(entry.data.subarray(100).every(byte => byte === 0),
    'extending a truncated file zero-fills the restored range');
});

// --- path resolution ---

test('relative path resolves against CWD', () => {
  const vfs = new VirtualFS();
  assert.strictEqual(vfs._resolvePath('foo.txt'), 'c:\\foo.txt');
  vfs.dirs.add('c:\\game');
  assert.strictEqual(vfs.setCurrentDirectory('C:\\game'), true);
  assert.strictEqual(vfs._resolvePath('data.dat'), 'c:\\game\\data.dat');
});

test('drive-relative paths resolve against that drive current directory', () => {
  const vfs = new VirtualFS();
  assert.strictEqual(vfs._resolvePath('C:defaults.nh'), 'c:\\defaults.nh');
  vfs.dirs.add('c:\\games');
  assert.strictEqual(vfs.setCurrentDirectory('C:\\games'), true);
  assert.strictEqual(vfs._resolvePath('C:save\\player.0'),
    'c:\\games\\save\\player.0');
  assert.strictEqual(vfs._resolvePath('C:'), 'c:\\games');
  assert.strictEqual(vfs._resolvePath('D:data.dat'), 'd:\\data.dat');
});

test('GetCurrentDirectory omits a trailing backslash except at a drive root', () => {
  const vfs = new VirtualFS();
  vfs.dirs.add('c:\\game');
  assert.strictEqual(vfs.setCurrentDirectory('C:\\game\\'), true);
  assert.strictEqual(vfs.getCurrentDirectory(), 'c:\\game');
  assert.strictEqual(vfs.setCurrentDirectory('C:\\'), true);
  assert.strictEqual(vfs.getCurrentDirectory(), 'c:\\');
});

test('setCurrentDirectory rejects files and missing alias paths without changing CWD', () => {
  const vfs = makeVFS({ 'c:\\dialog.tlk': 16 });
  assert.strictEqual(vfs.setCurrentDirectory('C:\\dialog.tlk'), false,
    'an existing file is not a directory');
  assert.strictEqual(vfs.setCurrentDirectory('hd0:\\dialog.tlk'), false,
    'a failed application alias probe must not become the process directory');
  assert.strictEqual(vfs.getCurrentDirectory(), 'C:\\');
  assert.strictEqual(vfs.getFullPathName('.\\dialog.tlk'), 'C:\\dialog.tlk');
});

test('GetFullPathName rejects an empty filename instead of fabricating the drive', () => {
  const memory = new ArrayBuffer(0x1000);
  const bytes = new Uint8Array(memory);
  bytes.fill(0x5a, 0x200, 0x220);
  const imports = createFilesystemImports({ getMemory: () => memory });
  assert.strictEqual(imports.fs_get_full_path_name(0x100, 16, 0x200, 0, 1), 0);
  assert.strictEqual(bytes[0x200], 0x5a, 'failure must not replace the output with C:');
});

test('SearchPath finds an installed DLL in the Win98 system directory', () => {
  const memory = new ArrayBuffer(0x1000);
  const bytes = new Uint8Array(memory);
  const writeA = (addr, value) => {
    for (let i = 0; i < value.length; i++) bytes[addr + i] = value.charCodeAt(i);
    bytes[addr + value.length] = 0;
  };
  const vfs = makeVFS({ 'c:\\windows\\system\\shell32.dll': 64 });
  const imports = createFilesystemImports({ vfs, getMemory: () => memory });
  writeA(0x100, 'shell32.dll');
  assert.strictEqual(imports.fs_search_path(0, 0x100, 0, 260, 0x200, 0, 0), 29);
  assert.strictEqual(
    Buffer.from(bytes.subarray(0x200, 0x200 + 29)).toString('latin1').toLowerCase(),
    'c:\\windows\\system\\shell32.dll'
  );
});

// --- AbeDemo specific scenario ---

test('AbeDemo: wildcard scan after loading exe sibling files', () => {
  const vfs = new VirtualFS();
  const abeFiles = ['abedemo.exe', 'demoopen.ddv', 'gamebgn.ddv', 'r1p18p19.ddv',
    'r1p19p18.ddv', 'readme.txt', 'c1.lvl', 'r1.lvl', 's1.lvl'];
  for (const f of abeFiles) {
    vfs.files.set('c:\\' + f, { data: new Uint8Array(100), attrs: 0x20 });
  }
  // The game probes D:..Z:\abe\demoopen.ddv for its CD. With no CD those
  // miss, as on Windows, and it carries on with the installed copy.
  const r1 = vfs.findFirstFile('D:\\abe\\demoopen.ddv');
  assert(!r1.handle, 'no CD copy is found on D:');

  // Game scans .\*.* — should find all files in c:\
  const r2 = vfs.findFirstFile('.\\*.*');
  assert(r2.handle, 'wildcard in CWD should find files');
  const names = [r2.entry.name];
  let next;
  while ((next = vfs.findNextFile(r2.handle))) names.push(next.name);
  assert(names.length >= 9, `expected >=9 files, got ${names.length}: ${names}`);

  // Game scans D:\*.* — should NOT find files (different drive)
  const r3 = vfs.findFirstFile('D:\\*.*');
  assert(!r3.handle, 'D:\\ wildcard should find nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
