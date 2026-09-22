#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { VirtualFS, createFilesystemImports } = require('../lib/filesystem');
const R = require('../lib/region-map.generated');
const memory = new WebAssembly.Memory({ initial: 8192 });
const bytes = new Uint8Array(memory.buffer);
const ptes = new Uint32Array(memory.buffer, R.BASE.GUEST_PAGE_TABLE, R.SIZE.GUEST_PAGE_TABLE >>> 2);
const page = 0x30000000, backing = R.BASE.VIRTUAL_BACKING_BASE;
ptes[page >>> 12] = backing | 0x800;
ptes[(page >>> 12) + 1] = (backing + 0x3000) | 0x800;
const translate = ga => ga < page + 4096 ? backing + ga - page : backing + 0x3000 + ga - page - 4096;
const vfs = new VirtualFS();
vfs.files.set('c:\\sample.txt', { data: Uint8Array.from([1, 2, 3]), attrs: 0x20 });
const notices = [];
const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
  exports: { get_image_base: () => 0x400000,
    invalidate_code_range: (ga, n) => notices.push([ga, n]) } });
const patternWA = R.BASE.GUEST_BASE + 0x100;
for (const wide of [0, 1]) {
  const size = wide ? 592 : 320;
  bytes.set(Buffer.from('c:\\sample.txt\0', wide ? 'utf16le' : 'latin1'), patternWA);
  const aligned = page + 0x100;
  const first = host.fs_find_first_file(patternWA, aligned, wide);
  assert.notStrictEqual(first >>> 0, 0xffffffff);
  host.fs_find_close(first);
  const expected = Array.from({ length: size }, (_, i) => bytes[translate(aligned + i)]);
  assert.strictEqual(new DataView(Uint8Array.from(expected).buffer).getUint32(32, true), 3);
  assert.strictEqual(expected[0], 0x20);
  assert.deepStrictEqual(expected.slice(44, 44 + (wide ? 20 : 10)),
    [...Buffer.from('sample.txt', wide ? 'utf16le' : 'latin1')]);
  for (let split = 1; split < size; split++) {
    const out = page + 4096 - split;
    for (let i = -1; i <= size; i++) bytes[translate(out + i)] = 0xcc;
    notices.length = 0;
    const handle = host.fs_find_first_file(patternWA, out, wide);
    assert.notStrictEqual(handle >>> 0, 0xffffffff);
    host.fs_find_close(handle);
    assert.deepStrictEqual(Array.from({ length: size + 2 }, (_, i) => bytes[translate(out - 1 + i)]),
      [0xcc, ...expected, 0xcc], `find data wide=${wide}, split=${split}`);
    assert.deepStrictEqual(notices, [[out, size]]);
  }
  const text = vfs.getCurrentDirectory();
  const encoded = Buffer.from(text + '\0', wide ? 'utf16le' : 'latin1');
  for (let split = 1; split < encoded.length; split++) {
    const out = page + 4096 - split;
    for (let i = -1; i <= encoded.length; i++) bytes[translate(out + i)] = 0xcc;
    notices.length = 0;
    assert.strictEqual(host.fs_get_current_directory(260, out, wide), text.length);
    assert.deepStrictEqual(Array.from({ length: encoded.length + 2 }, (_, i) => bytes[translate(out - 1 + i)]),
      [0xcc, ...encoded, 0xcc]);
    assert.deepStrictEqual(notices, [[out, encoded.length]], 'string includes terminator in notification');
  }
}
console.log('PASS  filesystem A/W find-data and string output sparse boundaries and notifications');
