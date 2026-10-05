'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');
const { g2w } = require('../lib/region-map.generated');

// Native Win98 transcript, not expectations inferred from current NT docs.
// This test covers validation/status only. Shared addresses/coherence and W
// export behavior recorded in the same fixture remain separate work.
const transcript = fs.readFileSync(path.join(__dirname,
  'fixtures/win98-file-mapping/native.serial.txt'), 'utf8');
assert(transcript.startsWith('FILE_MAPPING_V1\n'));
assert(transcript.endsWith('FILE_MAPPING_DONE\n'));
const rows = transcript.trim().split('\n').filter(line => line.startsWith('VIEW ')).map(line =>
  Object.fromEntries([...line.matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)])));
assert.strictEqual(rows.length, 54);
assert.strictEqual(new Set(rows.map(r => [r.anon, r.protect, r.access, r.offset].join(':'))).size, 54);

const vfs = new VirtualFS();
vfs.files.set('c:\\native-map.bin', { data: new Uint8Array(131072), attrs: 0x20 });
const file = vfs.createFile('c:\\native-map.bin', 0xc0000000, 3);
const memory = new WebAssembly.Memory({ initial: 40 });
let allocations = 0;
const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
  exports: { get_image_base: () => 0x400000,
    guest_map_alloc: () => { allocations++; return 0x410000; } } });
const sections = new Map();
for (const row of rows) {
  const key = `${row.anon}:${row.protect}`;
  if (!sections.has(key)) {
    const handle = host.fs_create_file_mapping(row.anon ? -1 : file, row.protect, 0, 131072, 0);
    assert(handle, `native creation succeeded for ${key}`);
    sections.set(key, handle);
  }
  const before = allocations;
  const error = host.fs_map_view_of_file_result(sections.get(key), row.access, 0, row.offset, 16, 64, 1);
  const address = new DataView(memory.buffer).getUint32(64, true);
  const label = JSON.stringify(row);
  assert.strictEqual(!!address, !!row.address, label);
  assert.strictEqual(error, row.address ? 0 : row.error, label);
  assert.strictEqual(allocations - before, row.address ? 1 : 0, `validation before allocation: ${label}`);
  if (address) {
    if (row.access === 1) {
      new Uint8Array(memory.buffer)[g2w(address, 0x400000)] = 0x7b;
      assert.strictEqual(host.fs_flush_view(address, 1), 1);
    }
    assert.strictEqual(host.fs_unmap_view(address), 1);
    if (row.access === 1) assert.strictEqual(vfs.files.get('c:\\native-map.bin').data[row.offset], 0,
      'COPY flush/unmap must not write to the backing file');
  }
}
console.log('PASS  54 native Win98 mapping validation/status cases');
