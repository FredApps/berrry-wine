#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const { SparseByteProvider, ChunkCache, DEFAULT_CHUNK_SIZE } = require('../lib/byte-provider');

const pattern = (off, len) => Uint8Array.from({ length: len }, (_, i) => ((off + i) * 17 + 3) & 255);
function asyncBase(size) {
  return { size, calls: [], async readRange(off, len) {
    this.calls.push([off, len]);
    return pattern(off, Math.min(len, Math.max(0, this.size - off)));
  } };
}
function mount(provider, options = {}) {
  const vfs = new VirtualFS();
  vfs.setProviderFile('C:\\data.bin', { provider, ...options });
  const handle = vfs.createFile('C:\\data.bin', 0xC0000000, 3);
  assert(handle);
  return { vfs, handle };
}
async function read(vfs, handle, off, len) {
  vfs.setFilePointer(handle, off, 0);
  const out = new Uint8Array(len);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = vfs.readFile(handle, out, len);
    if (!result.pending) {
      assert(result.ok, 'read succeeds after pending fill');
      return out.subarray(0, result.bytesRead);
    }
    await vfs.fillPendingRead(result.pending);
  }
  assert.fail('pending read never became resident: range exceeds backing-cache capacity');
}
function write(vfs, handle, off, bytes) {
  vfs.setFilePointer(handle, off, 0);
  assert.deepStrictEqual(vfs.writeFile(handle, bytes, bytes.length),
    { ok: true, bytesWritten: bytes.length });
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('large asynchronous sparse write preserves base bytes without whole-file reads', async () => {
  const base = asyncBase(3 * 1024 ** 3);
  const { vfs, handle } = mount(base);
  const offset = base.size - 2;
  write(vfs, handle, offset, Uint8Array.of(91, 92, 93));
  assert.strictEqual(base.calls.length, 0, 'write does not fetch base');
  assert.strictEqual(vfs.getFileSize(handle), base.size + 1);
  const expected = pattern(offset - 2, 5);
  expected.set([91, 92, 93], 2);
  assert.deepStrictEqual(await read(vfs, handle, offset - 2, 5), expected);
  assert(base.calls.every(([, len]) => len <= DEFAULT_CHUNK_SIZE), 'only bounded base reads');
  const sparse = vfs.files.get('c:\\data.bin')._provider;
  assert(sparse instanceof SparseByteProvider);
  assert.strictEqual(sparse.pages.size, 2, 'cross-page edit allocates only two pages');
});

test('copy is independent, including dirty pages and a sliced base', async () => {
  const { vfs, handle } = mount(asyncBase(1024), { offset: 100, length: 500 });
  write(vfs, handle, 20, Uint8Array.of(99));
  assert(vfs.copyFile('C:\\data.bin', 'C:\\copy.bin', true));
  const copy = vfs.createFile('C:\\copy.bin', 0xC0000000, 3);
  write(vfs, handle, 20, Uint8Array.of(42));
  write(vfs, copy, 21, Uint8Array.of(55));
  assert.deepStrictEqual(await read(vfs, handle, 19, 4), Uint8Array.of(pattern(119, 1)[0], 42, pattern(121, 1)[0], pattern(122, 1)[0]));
  assert.deepStrictEqual(await read(vfs, copy, 19, 4), Uint8Array.of(pattern(119, 1)[0], 99, 55, pattern(122, 1)[0]));
});

test('truncate then reextend does not resurrect base or dirty tail', async () => {
  const { vfs, handle } = mount(asyncBase(300000));
  write(vfs, handle, 65534, Uint8Array.of(7, 8, 9, 10));
  vfs.setFilePointer(handle, 65535, 0);
  assert(vfs.setEndOfFile(handle));
  vfs.setFilePointer(handle, 300000, 0);
  assert(vfs.setEndOfFile(handle));
  assert.deepStrictEqual(await read(vfs, handle, 65534, 5), Uint8Array.of(7, 0, 0, 0, 0));
  assert.deepStrictEqual(await read(vfs, handle, 200000, 16), new Uint8Array(16));
});

test('zero-byte writes beyond EOF do not extend eager or sparse entries', () => {
  for (const sparse of [false, true]) {
    const vfs = new VirtualFS();
    vfs.files.set('c:\\zero.bin', { data: Uint8Array.of(1, 2, 3), attrs: 0x20 });
    if (sparse) vfs.prepareSparseFile('C:\\zero.bin');
    const handle = vfs.createFile('C:\\zero.bin', 0xC0000000, 3);
    write(vfs, handle, 100, new Uint8Array(0));
    assert.strictEqual(vfs.getFileSize(handle), 3, `${sparse ? 'sparse' : 'eager'} null write leaves EOF`);
    assert.strictEqual(vfs.handles.get(handle).pos, 100);
  }
});

test('one pending read can exceed the LRU or span an extra unaligned chunk', async () => {
  for (const config of [
    { chunkSize: 65536, maxChunks: 1, offset: 0, length: 131072 },
    { chunkSize: 65536, maxChunks: 1, offset: 1, length: 131072 },
    { chunkSize: DEFAULT_CHUNK_SIZE, maxChunks: 4, offset: 1, length: 4 * DEFAULT_CHUNK_SIZE },
    { chunkSize: DEFAULT_CHUNK_SIZE, maxChunks: 4, offset: 3, length: 6 * DEFAULT_CHUNK_SIZE },
  ]) {
    const base = asyncBase(8 * DEFAULT_CHUNK_SIZE);
    const cache = new ChunkCache(base, { ...config, readAhead: 0 });
    const { vfs, handle } = mount(cache);
    vfs.prepareSparseFile('C:\\data.bin');
    assert.deepStrictEqual(await read(vfs, handle, config.offset, config.length), pattern(config.offset, config.length));
  }
});

test('async read snapshots dirty bytes before concurrent same-size writes', async () => {
  const base = asyncBase(128);
  let resume;
  base.readRange = (off, len) => new Promise(resolve => { resume = () => resolve(pattern(off, len)); });
  const sparse = new SparseByteProvider(base);
  sparse.write(127, Uint8Array.of(11));
  const pending = sparse.readRange(0, 128);
  assert(resume);
  sparse.write(127, Uint8Array.of(22));
  resume();
  const bytes = await pending;
  assert.strictEqual(bytes[127], 11);
  assert.strictEqual(sparse.tryRead(127, 1)[0], 22);
});

test('materialize rejects concurrent same-size mutation and preserves latest data', async () => {
  const base = asyncBase(128);
  let resume;
  base.readRange = (off, len) => new Promise(resolve => { resume = () => resolve(pattern(off, len)); });
  const { vfs, handle } = mount(base);
  vfs.prepareSparseFile('C:\\data.bin');
  const pending = vfs.materialize('C:\\data.bin');
  assert(resume);
  write(vfs, handle, 127, Uint8Array.of(33));
  resume();
  await assert.rejects(pending, /changed during read/);
  const provider = vfs.files.get('c:\\data.bin')._provider;
  assert(provider instanceof SparseByteProvider);
  assert.strictEqual(provider.tryRead(127, 1)[0], 33);
  base.readRange = async (off, len) => pattern(off, len);
  const materialized = await vfs.materialize('C:\\data.bin');
  const expected = pattern(0, 128);
  expected[127] = 33;
  assert.deepStrictEqual(materialized, expected, 'retry materializes the newest revision');
  assert.strictEqual(vfs.files.get('c:\\data.bin')._provider, null);
});

test('partial-line rewind preserves a later permanent fill fault', async () => {
  const vfs = new VirtualFS();
  vfs.setProviderFile('C:\\line.txt', { provider: {
    size: 4,
    tryRead(off, len) { return off < 2 ? Uint8Array.of(65 + off).subarray(0, len) : null; },
    async fill() { throw new Error('disk failure'); },
  } });
  const handle = vfs.createFile('C:\\line.txt', 0x80000000, 3);
  const buffer = new Uint8Array(1);
  assert(vfs.readFile(handle, buffer, 1).ok);
  assert(vfs.readFile(handle, buffer, 1).ok);
  const missing = vfs.readFile(handle, buffer, 1);
  assert(missing.pending);
  vfs.setFilePointer(handle, -2, 1); // fgets retries the entire partial line
  assert.strictEqual(await vfs.fillPendingRead(missing.pending), false);
  assert(vfs.readFile(handle, buffer, 1).ok);
  assert(vfs.readFile(handle, buffer, 1).ok);
  const failure = vfs.readFile(handle, buffer, 1);
  assert.strictEqual(failure.faulted, true, 'cached prefix must not erase the suffix fault');
  assert.strictEqual(failure.pending, undefined);
});

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
  }
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
