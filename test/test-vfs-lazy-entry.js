// Lazy (provider-backed) VFS entries — phase ① of docs/design-byo-media.md.
//
// The claim under test is a strong one: a file mounted through a byte provider
// must be indistinguishable from the same file mounted eagerly. Every check
// here is therefore a *comparison* against an eager mount of identical bytes
// rather than a hand-written expectation — a lazy path that quietly returns a
// short read is the failure mode that matters, and only a byte-for-byte
// comparison catches it.
//
// The second half covers the part the CLI would otherwise never exercise. A
// Node provider can read synchronously, so a headless run of a lazy mount
// never parks; `{sync: false}` takes that fast path away and forces the
// pending → fill → retry dance the browser always uses.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { VirtualFS } = require('../lib/filesystem');
const bp = require('../lib/byte-provider');
const RegionMap = require('../lib/region-map.generated');

let passed = 0, failed = 0;
const async_tests = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      async_tests.push(r.then(
        () => { passed++; console.log(`  PASS: ${name}`); },
        e => { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }));
      return;
    }
    passed++; console.log(`  PASS: ${name}`);
  } catch (e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

// A deterministic megabyte with no repeating period shorter than the file, so
// a read that lands at the wrong offset cannot accidentally match.
const SIZE = 1024 * 1024 + 4321;
const BYTES = new Uint8Array(SIZE);
{
  let x = 0x13579bdf;
  for (let i = 0; i < SIZE; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    BYTES[i] = (x >>> 16) & 0xff;
  }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lazy-'));
const FILE = path.join(TMP, 'media.dat');
fs.writeFileSync(FILE, BYTES);

const GUEST = 'C:\\GAME\\MEDIA.DAT';
const NORM = 'c:\\game\\media.dat';

function eagerVfs() {
  const vfs = new VirtualFS();
  vfs.files.set(NORM, { data: new Uint8Array(BYTES), attrs: 0x20 });
  vfs.ensureParentDirs(NORM);
  return vfs;
}

function lazyVfs(opts) {
  const vfs = new VirtualFS();
  const provider = new bp.NodeFileProvider(FILE, opts || {});
  vfs.setProviderFile(GUEST, { provider, attrs: 0x20 });
  return vfs;
}

// Read a whole file through the public handle API in `step`-sized chunks.
// Returns the concatenated bytes, or the first pending record encountered.
function readAll(vfs, step) {
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  assert(h, 'createFile failed');
  const out = new Uint8Array(SIZE);
  let got = 0;
  for (;;) {
    const buf = new Uint8Array(step);
    const r = vfs.readFile(h, buf, step);
    if (r.pending) return { pending: r.pending, handle: h, got };
    assert(r.ok, 'readFile failed');
    if (!r.bytesRead) break;
    out.set(buf.subarray(0, r.bytesRead), got);
    got += r.bytesRead;
    assert(got <= SIZE, 'read past end of file');
  }
  vfs.closeHandle(h);
  return { bytes: out.subarray(0, got) };
}

console.log('Lazy VFS entry tests:');

test('mounting through a provider does not materialize the file', () => {
  const vfs = lazyVfs();
  const entry = vfs.files.get(NORM);
  assert(entry._provider, 'entry should carry a provider');
  assert.strictEqual(entry._size, SIZE);
  // Nothing has been read yet: the chunk cache is empty.
  assert.strictEqual(entry._provider.stats.fetches, 0,
    'mounting must not read any bytes');
});

test('GetFileSize / size fields agree with an eager mount', () => {
  const lazy = lazyVfs(), eager = eagerVfs();
  const hl = lazy.createFile(GUEST, 0x80000000, 3);
  const he = eager.createFile(GUEST, 0x80000000, 3);
  assert.strictEqual(lazy.getFileSize(hl), eager.getFileSize(he));
  assert.strictEqual(lazy.getFileSize(hl), SIZE);
  // Seeking to FILE_END must not need the bytes either.
  assert.strictEqual(lazy.setFilePointer(hl, 0, 2), eager.setFilePointer(he, 0, 2));
  assert.strictEqual(lazy.files.get(NORM)._provider.stats.fetches, 0,
    'size and seek must not pull any chunk in');
});

test('GetFileAttributes agrees with an eager mount', () => {
  assert.strictEqual(lazyVfs().getFileAttributes(GUEST),
    eagerVfs().getFileAttributes(GUEST));
});

test('FindFirstFile agrees with an eager mount', () => {
  const lazy = lazyVfs(), eager = eagerVfs();
  const l = lazy.findFirstFile('C:\\GAME\\*.DAT');
  const e = eager.findFirstFile('C:\\GAME\\*.DAT');
  assert(l.handle && e.handle, 'both mounts should find the file');
  assert.strictEqual(l.entry.name, e.entry.name);
  assert.strictEqual(l.entry.size, e.entry.size);
  assert.strictEqual(l.entry.size, SIZE);
  assert.strictEqual(lazy.findNextFile(l.handle), null);
  assert.strictEqual(lazy.files.get(NORM)._provider.stats.fetches, 0,
    'enumeration must not materialize the file');
});

for (const step of [1, 512, 4096, 300000, SIZE + 1]) {
  test(`ReadFile in ${step}-byte chunks is byte-for-byte the eager result`, () => {
    const lazyBytes = readAll(lazyVfs(), step).bytes;
    const eagerBytes = readAll(eagerVfs(), step).bytes;
    assert.strictEqual(lazyBytes.length, SIZE, 'lazy short read');
    assert.strictEqual(eagerBytes.length, SIZE, 'eager short read');
    assert(Buffer.compare(Buffer.from(lazyBytes), Buffer.from(eagerBytes)) === 0,
      'lazy bytes differ from eager bytes');
  });
}

test('a read that straddles a chunk boundary is contiguous', () => {
  const vfs = lazyVfs();
  const chunk = vfs.files.get(NORM)._provider.chunkSize;
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  vfs.setFilePointer(h, chunk - 7, 0);
  const buf = new Uint8Array(21);
  const r = vfs.readFile(h, buf, 21);
  assert(r.ok && r.bytesRead === 21, 'straddling read failed');
  assert(Buffer.compare(Buffer.from(buf),
    Buffer.from(BYTES.subarray(chunk - 7, chunk + 14))) === 0,
    'straddling read returned the wrong bytes');
});

test('reading past EOF returns 0 bytes, not a failure', () => {
  const vfs = lazyVfs();
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  vfs.setFilePointer(h, SIZE, 0);
  const r = vfs.readFile(h, new Uint8Array(16), 16);
  assert(r.ok, 'read at EOF should succeed');
  assert.strictEqual(r.bytesRead, 0);
});

test('the LRU bound keeps a big file from becoming resident', () => {
  const vfs = new VirtualFS();
  const provider = new bp.NodeFileProvider(FILE);
  // 4 chunks of 64KB resident: reading the whole file must evict, not grow.
  vfs.setProviderFile(GUEST, {
    provider: new bp.ChunkCache(provider, { chunkSize: 65536, maxChunks: 4, readAhead: 0 }),
  });
  const got = readAll(vfs, 4096).bytes;
  assert.strictEqual(got.length, SIZE);
  const cache = vfs.files.get(NORM)._provider;
  assert(cache._chunks.size <= 4, `resident chunks ${cache._chunks.size} exceeded the bound`);
  assert(cache.stats.fetches >= 16, 'the whole file should have been fetched in chunks');
});

test('writing to a lazy entry materializes it (copy-on-write)', () => {
  const vfs = lazyVfs();
  const h = vfs.createFile(GUEST, 0x40000000, 3);
  vfs.setFilePointer(h, 10, 0);
  vfs.writeFile(h, new Uint8Array([1, 2, 3]), 3);
  const entry = vfs.files.get(NORM);
  assert(!entry._provider, 'the provider should be dropped once written');
  assert.strictEqual(entry.data.length, SIZE, 'size must survive the copy');
  const expect = new Uint8Array(BYTES);
  expect.set([1, 2, 3], 10);
  assert(Buffer.compare(Buffer.from(entry.data), Buffer.from(expect)) === 0,
    'copy-on-write lost or reordered the original bytes');
});

test('TRUNCATE_EXISTING drops the provider without reading it', () => {
  const vfs = lazyVfs();
  const before = vfs.files.get(NORM)._provider;
  const h = vfs.createFile(GUEST, 0x40000000, 5);
  assert(h, 'truncating open failed');
  const entry = vfs.files.get(NORM);
  assert(!entry._provider, 'truncation should drop the provider');
  assert.strictEqual(entry.data.length, 0);
  assert.strictEqual(before.stats.fetches, 0, 'truncation must not read the file');
});

test('CopyFile off a lazy mount shares the provider instead of materializing', () => {
  const vfs = lazyVfs();
  assert(vfs.copyFile(GUEST, 'C:\\GAME\\COPY.DAT', false), 'copyFile failed');
  const copy = vfs.files.get('c:\\game\\copy.dat');
  assert(copy._provider, 'the copy should share the source provider');
  assert.strictEqual(copy._size, SIZE);
  assert.strictEqual(vfs.files.get(NORM)._provider.stats.fetches, 0,
    'copying must not pull the whole file in');
  // Independent all the same: writing to the copy must not touch the source.
  const h = vfs.createFile('C:\\GAME\\COPY.DAT', 0x40000000, 3);
  vfs.writeFile(h, new Uint8Array([9]), 1);
  assert(!copy._provider, 'the written copy should have materialized');
  assert(vfs.files.get(NORM)._provider, 'the source must still be lazy');
});

test('entry.data materializes a sync-capable provider', () => {
  const vfs = lazyVfs();
  const data = vfs.files.get(NORM).data;
  assert(Buffer.compare(Buffer.from(data), Buffer.from(BYTES)) === 0,
    'whole-file materialization returned the wrong bytes');
});

// ---- the async arm: pending → fill → retry ------------------------------

test('an async-only provider reports pending, never a short read', () => {
  const vfs = lazyVfs({ sync: false });
  const r = readAll(vfs, 4096);
  assert(r.pending, 'the first read should have parked');
  assert.strictEqual(r.got, 0, 'nothing should have been reported before the park');
  assert.strictEqual(r.pending.path, NORM);
  assert.strictEqual(r.pending.offset, 0);
  assert(r.pending.length > 0);
  // The file position must be untouched, so the retry is the same call.
  assert.strictEqual(vfs.handles.get(r.handle >>> 0).pos, 0);
});

test('a mid-file park rewinds nothing and resumes at the same offset', async () => {
  const vfs = lazyVfs({ sync: false });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  const buf = new Uint8Array(64);
  let r = vfs.readFile(h, buf, 64);
  assert(r.pending, 'expected a park');
  await vfs.fillPendingRead(r.pending);
  r = vfs.readFile(h, buf, 64);
  assert(r.ok && r.bytesRead === 64, 'the retried read should hit the cache');
  assert(Buffer.compare(Buffer.from(buf), Buffer.from(BYTES.subarray(0, 64))) === 0);
  // Now seek far away, into a chunk nothing has fetched, and park again.
  const far = 900000;
  vfs.setFilePointer(h, far, 0);
  r = vfs.readFile(h, buf, 64);
  assert(r.pending, 'a fresh chunk should park again');
  assert.strictEqual(r.pending.offset, far, 'the park should name the wanted offset');
  assert.strictEqual(vfs.handles.get(h >>> 0).pos, far, 'a park must not move the file pointer');
  await vfs.fillPendingRead(r.pending);
  r = vfs.readFile(h, buf, 64);
  assert(r.ok && r.bytesRead === 64);
  assert(Buffer.compare(Buffer.from(buf), Buffer.from(BYTES.subarray(far, far + 64))) === 0,
    'the retried read returned the wrong bytes');
});

test('driving the whole file through park/fill/retry matches the eager bytes',
  async () => {
    const vfs = lazyVfs({ sync: false });
    const h = vfs.createFile(GUEST, 0x80000000, 3);
    const out = new Uint8Array(SIZE);
    const step = 7777;
    let got = 0, parks = 0;
    for (;;) {
      const buf = new Uint8Array(step);
      const r = vfs.readFile(h, buf, step);
      if (r.pending) {
        parks++;
        assert(parks < 200, 'too many parks — fill is not satisfying the read');
        await vfs.fillPendingRead(r.pending);
        continue;
      }
      assert(r.ok, 'read failed');
      if (!r.bytesRead) break;
      out.set(buf.subarray(0, r.bytesRead), got);
      got += r.bytesRead;
    }
    assert.strictEqual(got, SIZE, 'short read across the park path');
    assert(Buffer.compare(Buffer.from(out), Buffer.from(BYTES)) === 0,
      'park/fill/retry produced different bytes than an eager mount');
    // One park per chunk, not one per ReadFile: ~4 chunks of 256KB, halved
    // again by read-ahead. The point of the cache is that this number stays
    // far below the 135 ReadFile calls it served.
    assert(parks <= 8, `expected a handful of parks, got ${parks}`);
  });

test('the host import reports pending separately from failure', () => {
  const { createFilesystemImports } = require('../lib/filesystem');
  const vfs = lazyVfs({ sync: false });
  // A 1MB scratch "guest" memory; g2w is identity-ish for this harness, which
  // is all the read path needs.
  const memory = new WebAssembly.Memory({ initial: 40 });
  const imports = createFilesystemImports({
    getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 },
    vfs,
  });
  const GUEST_BASE = 0x400000; // maps to WASM 0x12000
  const handle = vfs.createFile(GUEST, 0x80000000, 3);
  const ok = imports.fs_read_file(handle, GUEST_BASE, 4096, 0);
  assert.strictEqual(ok, 0, 'a parked read must return 0 from fs_read_file');
  assert.strictEqual(imports.fs_read_pending(), 1,
    'fs_read_pending must distinguish a park from a failure');
  // A genuine failure (bad handle) must not look like a park.
  assert.strictEqual(imports.fs_read_file(0xdead, GUEST_BASE, 16, 0), 0);
  assert.strictEqual(imports.fs_read_pending(), 0,
    'a failed read must not report pending');
});

test('a provider whose fill rejects latches a read failure, not a park loop',
  async () => {
    let asked = 0;
    const broken = {
      size: SIZE,
      readRange() { asked++; return Promise.reject(new Error('network went away')); },
    };
    const vfs = new VirtualFS();
    vfs.setProviderFile(GUEST, { provider: broken });
    const h = vfs.createFile(GUEST, 0x80000000, 3);
    let r = vfs.readFile(h, new Uint8Array(64), 64);
    assert(r.pending, 'the first read should park');
    assert.strictEqual(await vfs.fillPendingRead(r.pending), false, 'fill should report failure');
    r = vfs.readFile(h, new Uint8Array(64), 64);
    assert(!r.ok && r.faulted, 'the retry must fail, not park again');
    assert.strictEqual(r.error, 30, 'ERROR_READ_FAULT');
    assert(asked > 0, 'the provider should actually have been asked');
  });

test('a short Range response faults instead of becoming zero-filled bytes',
  async () => {
    let asked = 0;
    const short = {
      size: SIZE,
      readRange(off, len) {
        asked++;
        return Promise.resolve(BYTES.subarray(off, off + Math.max(0, len - 1)));
      },
    };
    const vfs = new VirtualFS();
    vfs.setProviderFile(GUEST, {
      provider: new bp.ChunkCache(short, { readAhead: 0 }),
    });
    const h = vfs.createFile(GUEST, 0x80000000, 3);
    let r = vfs.readFile(h, new Uint8Array(4096), 4096);
    assert(r.pending, 'the first read should park on an empty cache');
    assert.strictEqual(await vfs.fillPendingRead(r.pending), false,
      'a short chunk must reject the pending fill');
    r = vfs.readFile(h, new Uint8Array(4096), 4096);
    assert(!r.ok && r.faulted, 'the retry must fail instead of returning padded bytes');
    assert.strictEqual(r.error, 30, 'short provider data is ERROR_READ_FAULT');
    assert.strictEqual(vfs.handles.get(h >>> 0).pos, 0,
      'the failed read must not advance the file position');
    assert.strictEqual(asked, 1, 'the bad chunk is not cached and retried as if complete');
  });

test('a fill that never satisfies the read gives up instead of spinning', async () => {
  // Resolves without caching the requested bytes.
  const liar = { size: SIZE, tryRead: () => null, fill: async () => {} };
  const vfs = new VirtualFS();
  vfs.setProviderFile(GUEST, { provider: liar });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  let r;
  for (let i = 0; i < 6; i++) {
    r = vfs.readFile(h, new Uint8Array(64), 64);
    if (!r.pending) break;
    vfs.pendingRead = r.pending;
    await vfs.fillPendingRead(r.pending);
  }
  assert(r && r.faulted, 'a read that never becomes servable must fault');
  assert.strictEqual(r.error, 30);
});

test('host-import retries remain bounded after fills and peer reads clear the slot', async () => {
  const { createFilesystemImports } = require('../lib/filesystem');
  const vfs = new VirtualFS();
  let fills = 0, ready = false;
  vfs.setProviderFile(GUEST, { provider: {
    size: 64, tryRead: (_off, len) => ready ? new Uint8Array(len).fill(0x5a) : null,
    fill: async () => { fills++; },
  } });
  const memory = new WebAssembly.Memory({ initial: 40 });
  const imports = createFilesystemImports({ getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 }, vfs });
  const a = vfs.createFile(GUEST, 0x80000000, 3);
  const b = vfs.createFile(GUEST, 0x80000000, 3);
  const read = h => imports.fs_read_file_result(h, 0x400000, 16, 0x401000);
  for (let round = 1; round <= 3; round++) {
    for (const h of [a, b]) {
      assert.strictEqual(read(h), 997);
      const pending = vfs.pendingRead;
      assert.strictEqual(pending.attempts, round, 'retry history survives slot retirement/peer reads');
      assert.strictEqual(await vfs.fillPendingRead(pending), true);
      assert.strictEqual(vfs.pendingRead, null);
    }
  }
  for (const h of [a, b]) {
    assert.strictEqual(read(h), 30, 'unsatisfied fills eventually report ERROR_READ_FAULT');
    assert.strictEqual(vfs.getOpenFile(h).pos, 0);
    assert.strictEqual(new DataView(memory.buffer).getUint32(0x13000, true), 0);
    assert.strictEqual(imports.fs_read_pending(), 2);
  }
  assert.strictEqual(fills, 6, 'three fills per handle, no fourth fill');
  ready = true;
  assert.strictEqual(read(a), 0, 'a new call can recover after the reported failure');
  assert.strictEqual(new DataView(memory.buffer).getUint32(0x13000, true), 16);
  vfs.setFilePointer(a, 0, 0);
  ready = false;
  assert.strictEqual(read(a), 997);
  assert.strictEqual(vfs.pendingRead.attempts, 1, 'successful progress resets retry history');
});

test('retry history survives cached prefixes but isolates ranges and file identities', async () => {
  const vfs = new VirtualFS();
  const provider = { size: 64,
    tryRead: (off, len) => off === 0 ? new Uint8Array(len) : null,
    fill: async () => {},
  };
  vfs.setProviderFile(GUEST, { provider });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  const buf = new Uint8Array(16);
  for (let round = 1; round <= 3; round++) {
    vfs.setFilePointer(h, 0, 0); // scatter retry replays its cached prefix
    assert.strictEqual(vfs.readFile(h, buf, 8).bytesRead, 8);
    const pending = vfs.readFile(h, buf, 8).pending;
    assert.strictEqual(pending.attempts, round);
    await vfs.fillPendingRead(pending);
  }
  const peer = vfs.readFile(vfs.duplicateFileHandle(h, 0, false, 2), buf, 8).pending;
  assert.strictEqual(peer.attempts, 1, 'a duplicate has its own retry lifetime');
  vfs.pendingRead = peer;
  assert.strictEqual(vfs.readFile(h, buf, 8).error, 30);
  assert.strictEqual(vfs.pendingRead, peer, 'exhaustion does not clear a peer');
  assert.strictEqual(vfs.readFile(h, buf, 8).pending.attempts, 1,
    'report the failure once, then permit a new call');
  assert.strictEqual(vfs.readFile(h, buf, 16).pending.attempts, 1,
    'a different requested range starts fresh');
  vfs.setProviderFile(GUEST, { provider });
  assert.strictEqual(vfs.readFile(h, buf, 16).pending.attempts, 1,
    'replacement entry does not inherit old retry history');
  vfs.closeHandle(h);
  vfs.handles.delete(h); // simulate future tombstone reclamation before reuse
  vfs._nextHandle = h;
  const reused = vfs.createFile(GUEST, 0x80000000, 3);
  assert.strictEqual(reused, h);
  vfs.setFilePointer(reused, 8, 0);
  assert.strictEqual(vfs.readFile(reused, buf, 16).pending.attempts, 1);
});

test('scheduler retries without provider fills cannot exhaust the read budget', async () => {
  const { createFilesystemImports } = require('../lib/filesystem');
  const { ThreadManager } = require('../lib/thread-manager');
  const vfs = new VirtualFS();
  let fills = 0, ready = false;
  vfs.setProviderFile(GUEST, { provider: { size: 16,
    tryRead: (_off, len) => ready ? new Uint8Array(len) : null,
    fill: async () => { fills++; ready = true; },
  } });
  const memory = new WebAssembly.Memory({ initial: 40 });
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 } });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  const peer = vfs.createFile(GUEST, 0x80000000, 3);
  const manager = Object.create(ThreadManager.prototype);
  manager._getVfs = () => vfs;
  const link = { callExport: async name => assert.strictEqual(name, 'clear_yield') };
  let pending;
  for (let i = 0; i < 8; i++) {
    assert.strictEqual(imports.fs_read_file_result(h, 0x400000, 16, 0), 997);
    pending = vfs.pendingRead;
    // Simulate lost selection explicitly; this test must remain useful once
    // production request selection is made thread-owned.
    vfs.pendingRead = null;
    assert.strictEqual(imports.fs_read_file_result(peer, 0x400100, 0, 0), 0);
    await manager.resolveThreadSendYield(link, { yield: 12 }, { tid: 1 }, new Set());
  }
  assert.strictEqual(fills, 0);
  assert.strictEqual(pending.attempts, 1);
  assert.strictEqual(await vfs.fillPendingRead(pending), true);
  assert.strictEqual(imports.fs_read_file_result(h, 0x400000, 16, 0), 0);
  assert.strictEqual(fills, 1);
});

test('thread-owned reads isolate pending selection, faults and same-handle positional retries', async () => {
  const { createFilesystemImports } = require('../lib/filesystem');
  const { ThreadManager } = require('../lib/thread-manager');
  const vfs = new VirtualFS(), ready = new Set();
  let rejectZero = false;
  vfs.setProviderFile(GUEST, { provider: { size: 32,
    tryRead: (off, len) => ready.has(off) ? new Uint8Array(len).fill(off + 1) : null,
    fill: async off => { if (!off && rejectZero) throw Error('range zero failed'); ready.add(off); },
  } });
  const memory = new WebAssembly.Memory({ initial: 40 });
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 } });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  assert.strictEqual(imports.fs_read_file(h, 0x400000, 8, 0, 2), 0);
  const a = vfs.getPendingRead(2);
  assert(a);
  assert.strictEqual(imports.fs_read_file_result(h, 0x400100, 0, 0, 3), 0);
  assert.strictEqual(imports.fs_read_pending(2), 1, 'peer success cannot erase legacy status');
  assert.strictEqual(imports.fs_read_pending(3), 0);
  assert.strictEqual(vfs.pendingRead, null, 'main thread has no borrowed pending request');
  const manager = Object.create(ThreadManager.prototype);
  manager._getVfs = () => vfs;
  const link = { callExport: async name => assert.strictEqual(name, 'clear_yield') };
  await manager.resolveThreadSendYield(link, { yield: 12 }, { tid: 1 }, new Set());
  assert.strictEqual(imports.fs_read_file_result(h, 0x400000, 8, 0, 2), 0);
  ready.clear(); rejectZero = true;
  assert.strictEqual(imports.fs_read_file_at(h, 0x400000, 8, 0, 0, 0, 2), 997);
  assert.strictEqual(imports.fs_read_file_at(h, 0x400100, 8, 0, 8, 0, 3), 997);
  const pa = vfs.getPendingRead(2), pb = vfs.getPendingRead(3);
  assert.notStrictEqual(pa, pb);
  assert.strictEqual(await vfs.fillPendingRead(pa), false);
  assert.strictEqual(vfs.getPendingRead(3), pb);
  assert.strictEqual(await vfs.fillPendingRead(pb), true);
  assert.strictEqual(imports.fs_read_file_at(h, 0x400100, 8, 0, 8, 0, 3), 0);
  assert.strictEqual(imports.fs_read_file_at(h, 0x400000, 8, 0, 0, 0, 2), 30);
  assert.strictEqual(imports.fs_read_pending(3), 0);
  assert.strictEqual(imports.fs_read_pending(2), 2);
  assert.strictEqual(vfs.getOpenFile(h).pos, 8, 'positional calls preserve shared cursor');
  assert.strictEqual(imports.fs_read_file_at(h, 0x400000, 8, 0, 16, 0, 2), 997);
  const retired = vfs.getPendingRead(2);
  vfs.releaseIoState(2);
  assert.strictEqual(await vfs.fillPendingRead(retired), false);
  assert.strictEqual(vfs.getPendingRead(2), null);
  assert.strictEqual(imports.fs_read_pending(2), 0, 'new thread state has no retired fault');
  assert.strictEqual(imports.fs_read_file_at(h, 0x400000, 8, 0, 16, 0, 2), 997);
  assert.strictEqual(imports.fs_read_file_at(h, 0x400100, 8, 0, 24, 0, 3), 997);
  vfs.closeHandle(h);
  assert.strictEqual(vfs.getPendingRead(2), null);
  assert.strictEqual(vfs.getPendingRead(3), null);
});

test('two real Workers preserve I/O ownership through compiled adapters and the shared RPC table', async () => {
  const { Worker } = require('worker_threads');
  const { compileClosure } = require('../tools/watx-closure');
  const RPC = require('../lib/guest-rpc');
  const { createFilesystemImports } = require('../lib/filesystem');
  const names = ['fs_read_file', 'fs_read_file_at', 'fs_read_pending',
    'fs_read_file_result', 'fs_map_view_of_file'];
  const header = fs.readFileSync(path.join(__dirname, '../src/01-header.wat'), 'utf8');
  const importsWat = header.split('\n').filter(line => names.some(name =>
    line.includes(`(import "host" "${name}"`))).join('\n');
  const base = fs.readFileSync(path.join(__dirname, '../src/09a0b-handlers-base-late.wat'), 'utf8');
  const adapters = base.slice(0, base.indexOf('  ;; ============================================================'));
  assert.strictEqual((adapters.match(/\(func \$host_fs_/g) || []).length, 5);
  const wat = `
    (import "host" "memory" (memory 8192 8192 shared))
    ${importsWat}
    (global $current_thread_id (mut i32) (i32.const 1))
    ${adapters}
    (func (export "tid") (param i32) (global.set $current_thread_id (local.get 0)))
    (func (export "read") (param i32 i32) (result i32)
      (call $host_fs_read_file (local.get 0) (i32.const 0x400000) (local.get 1) (i32.const 0)))
    (export "pending" (func $host_fs_read_pending))
    (export "result" (func $host_fs_read_file_result))
    (export "at" (func $host_fs_read_file_at))
    (export "map" (func $host_fs_map_view_of_file))`;
  const compiled = compileClosure({ source: wat, vfs: new Map() }, { tailCalls: true });
  assert(compiled.success, compiled.error || 'I/O adapter compilation failed');
  const module = await WebAssembly.compile(compiled.wasmBinary);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const vfs = new VirtualFS(), handles = [];
  for (const file of ['c:\\a.bin', 'c:\\b.bin']) {
    let ready = false;
    vfs.setProviderFile(file, { provider: { size: 16,
      tryRead: (_off, len) => ready ? new Uint8Array(len) : null,
      fill: async () => { ready = true; },
    } });
    handles.push(vfs.createFile(file, 0x80000000, 3));
    assert(handles[handles.length - 1], 'Worker fixture file must open');
  }
  const allSigs = require('../lib/host-import-sigs.generated.json').sigs;
  const sigs = Object.fromEntries(names.map(name => [name, allSigs[name]]));
  const host = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000 } });
  const callers = [];
  for (const name of names) {
    const original = host[name];
    host[name] = (...args) => {
      callers.push({ name, threadId: args[args.length - 1] });
      return original(...args);
    };
  }
  const errors = [];
  const broker = RPC.createMainBroker(memory, host, sigs, { onError: (name, e) => errors.push([name, String(e)]) });
  const workers = [];
  try {
    for (const threadId of [2, 3]) {
      const worker = new Worker(`
        const { parentPort, workerData: d } = require('worker_threads');
        const RPC = require(d.rpc);
        const rpc = RPC.createWorkerImports(d.memory, d.sigs,
          message => parentPort.postMessage(message), { slot: d.threadId - 1 });
        const instance = new WebAssembly.Instance(d.module, rpc.imports);
        instance.exports.tid(d.threadId);
        parentPort.on('message', ({ method, args }) => {
          parentPort.postMessage({ result: instance.exports[method](...args) });
        });
      `, { eval: true, workerData: { rpc: require.resolve('../lib/guest-rpc'),
        memory, module, sigs, threadId } });
      workers.push(worker);
      worker.on('message', msg => { if (msg.t === 'rpc') broker.serveRpc(msg.slot); });
    }
    const ask = (worker, method, ...args) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error('I/O Worker reply timed out')), 90000);
      const onMessage = msg => { if ('result' in msg) finish(null, msg.result); };
      const finish = (error, value) => {
        clearTimeout(timer); worker.off('message', onMessage); worker.off('error', finish);
        error ? reject(error) : resolve(value);
      };
      worker.on('error', finish); worker.on('message', onMessage);
      worker.postMessage({ method, args });
    });
    assert.strictEqual(await ask(workers[0], 'read', handles[0], 8), 0, 'worker A parks');
    assert.deepStrictEqual(errors, [], 'first broker call');
    assert.strictEqual(await ask(workers[1], 'read', handles[1], 0), 1, 'worker B zero-byte read succeeds');
    assert.deepStrictEqual(errors, [], 'second broker call');
    assert.strictEqual(await ask(workers[0], 'pending'), 1, 'A pending survives B zero-byte read');
    assert.strictEqual(await ask(workers[1], 'read', handles[1], 8), 0);
    assert.strictEqual(await ask(workers[0], 'pending'), 1, 'A pending survives B park');
    assert.strictEqual(await ask(workers[1], 'pending'), 1, 'B owns its park');
    assert.strictEqual(vfs.getPendingRead(2).handle, handles[0]);
    assert.strictEqual(vfs.getPendingRead(3).handle, handles[1]);
    await vfs.fillPendingRead(vfs.getPendingRead(2));
    assert.strictEqual(await ask(workers[0], 'read', handles[0], 8), 1);
    assert.strictEqual(await ask(workers[1], 'pending'), 1);
    await vfs.fillPendingRead(vfs.getPendingRead(3));
    assert.strictEqual(await ask(workers[1], 'read', handles[1], 8), 1);
    assert.strictEqual(await ask(workers[0], 'result', handles[0], 0x400000, 0, 0), 0);
    assert.strictEqual(await ask(workers[1], 'at', handles[1], 0x400000, 0, 0, 0, 0), 0);
    assert.strictEqual(await ask(workers[0], 'map', 0, 4, 0, 0, 16), 0);
    assert.deepStrictEqual([...new Set(callers.map(call => call.name))].sort(), names.slice().sort());
    assert(callers.every(call => call.threadId === 2 || call.threadId === 3),
      'every adapter supplies the calling WASM instance identity over RPC');
    assert.deepStrictEqual(errors, []);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});

test('concurrent lazy mappings of the same section keep distinct thread-owned completions', async () => {
  const { createFilesystemImports } = require('../lib/filesystem');
  const vfs = new VirtualFS();
  vfs.setProviderFile(GUEST, { provider: { size: 16,
    readRange: async (_off, len) => new Uint8Array(len).fill(0x6a),
  } });
  const memory = new WebAssembly.Memory({ initial: 40 });
  let next = 0x410000;
  const imports = createFilesystemImports({ vfs, getMemory: () => memory.buffer,
    exports: { get_image_base: () => 0x400000, guest_map_alloc: () => (next += 0x1000) } });
  const h = vfs.createFile(GUEST, 0x80000000, 3);
  const mapping = imports.fs_create_file_mapping(h, 2, 0, 0, 0);
  assert(mapping);
  const map = tid => imports.fs_map_view_of_file(mapping, 4, 0, 0, 16, tid);
  assert.strictEqual(map(2), 0);
  const a = vfs.getPendingRead(2);
  assert.strictEqual(map(3), 0);
  const b = vfs.getPendingRead(3);
  assert(a && b && a !== b);
  await vfs.fillPendingRead(a);
  assert.strictEqual(vfs.getPendingRead(3), b);
  await vfs.fillPendingRead(b);
  // Reverse completion consumption used to let either caller take the one
  // shared requestKey's address, leaking the other allocation.
  const addrB = map(3), addrA = map(2);
  assert.strictEqual(addrA, 0x411000);
  assert.strictEqual(addrB, 0x412000);
  for (const addr of [addrA, addrB]) {
    assert.deepStrictEqual([...new Uint8Array(memory.buffer, RegionMap.g2w(addr, 0x400000), 16)],
      Array(16).fill(0x6a));
  }
});

test('the pending record names the handle and position it belongs to', () => {
  const vfs = lazyVfs({ sync: false });
  const a = vfs.createFile(GUEST, 0x80000000, 3);
  const b = vfs.createFile(GUEST, 0x80000000, 3);
  assert(a !== b, 'two handles on one file');
  vfs.setFilePointer(b, 700000, 0);
  const ra = vfs.readFile(a, new Uint8Array(16), 16);
  const rb = vfs.readFile(b, new Uint8Array(16), 16);
  assert(ra.pending && rb.pending);
  assert.strictEqual(ra.pending.handle, a >>> 0);
  assert.strictEqual(rb.pending.handle, b >>> 0);
  assert.strictEqual(ra.pending.pos, 0);
  assert.strictEqual(rb.pending.pos, 700000);
});

test('late file fills cannot publish faults after close, reuse, or entry replacement', async () => {
  for (const mutation of ['close', 'reuse', 'replace']) {
    const vfs = new VirtualFS();
    let rejectFill;
    const provider = {
      size: 16, tryRead: () => null,
      fill: () => new Promise((resolve, reject) => { rejectFill = reject; }),
    };
    vfs.setProviderFile(GUEST, { provider });
    const handle = vfs.createFile(GUEST, 0x80000000, 3) >>> 0;
    const pending = vfs.readFile(handle, new Uint8Array(4), 4).pending;
    vfs.pendingRead = pending;
    const filling = vfs.fillPendingRead(pending);
    if (mutation !== 'replace') {
      vfs.closeHandle(handle);
      assert.strictEqual(vfs.pendingRead, null, 'close retires only its own pending slot');
    }
    if (mutation !== 'close') {
      vfs.setProviderFile(GUEST, { provider: {
        size: 16, tryRead: (off, len) => new Uint8Array(len).fill(0x55),
        fill: () => Promise.resolve(),
      } });
      if (mutation === 'reuse') {
        // Simulate future tombstone reclamation and numeric handle reuse.
        vfs.handles.delete(handle);
        vfs._nextHandle = handle;
        assert.strictEqual(vfs.createFile(GUEST, 0x80000000, 3) >>> 0, handle);
      }
    }
    rejectFill(new Error('old provider failed late'));
    assert.strictEqual(await filling, false);
    assert.strictEqual(vfs.readFaults.has(handle), false, `${mutation}: no stale fault publication`);
    if (mutation === 'close') {
      assert.strictEqual(vfs.readFile(handle, new Uint8Array(4), 4).error, 6);
    } else {
      const bytes = new Uint8Array(4);
      assert.strictEqual(vfs.readFile(handle, bytes, 4).ok, true);
      assert.deepStrictEqual([...bytes], [0x55, 0x55, 0x55, 0x55]);
    }
  }
});

test('closed pending reads skip fills and late success preserves a peer pending slot', async () => {
  const vfs = new VirtualFS();
  let complete;
  let fills = 0;
  const provider = {
    size: 16, tryRead: () => null,
    fill: () => { fills++; return new Promise(resolve => { complete = resolve; }); },
  };
  vfs.setProviderFile(GUEST, { provider });
  const closed = vfs.createFile(GUEST, 0x80000000, 3);
  const neverStarted = vfs.readFile(closed, new Uint8Array(4), 4).pending;
  vfs.closeHandle(closed);
  assert.strictEqual(await vfs.fillPendingRead(neverStarted), false);
  assert.strictEqual(fills, 0, 'do not start provider I/O for an already closed read');
  const a = vfs.createFile(GUEST, 0x80000000, 3);
  const b = vfs.createFile(GUEST, 0x80000000, 3);
  const pa = vfs.readFile(a, new Uint8Array(4), 4).pending;
  const filling = vfs.fillPendingRead(pa);
  const pb = vfs.readFile(b, new Uint8Array(4), 4).pending;
  vfs.pendingRead = pb;
  vfs.closeHandle(a);
  assert.strictEqual(vfs.pendingRead, pb, 'closing A does not retire B');
  complete();
  assert.strictEqual(await filling, false, 'late success does not revive closed A');
  assert.strictEqual(vfs.pendingRead, pb, 'A completion cannot clear B pending slot');
  assert.strictEqual(vfs.getOpenFile(b).pos, 0);
});

test('a latched fault is discarded when its file entry is replaced', async () => {
  const vfs = new VirtualFS();
  vfs.setProviderFile(GUEST, { provider: {
    size: 16, tryRead: () => null, fill: () => Promise.reject(new Error('read fault')),
  } });
  const handle = vfs.createFile(GUEST, 0x80000000, 3);
  const pending = vfs.readFile(handle, new Uint8Array(4), 4).pending;
  assert.strictEqual(await vfs.fillPendingRead(pending), false);
  assert(vfs.readFaults.has(handle));
  vfs.setProviderFile(GUEST, { provider: {
    size: 16, tryRead: (off, len) => new Uint8Array(len), fill: () => Promise.resolve(),
  } });
  assert.strictEqual(vfs.readFile(handle, new Uint8Array(4), 4).ok, true);
  assert.strictEqual(vfs.readFaults.has(handle), false);
});

test('an immediate provider exception uses the same guarded failure completion', async () => {
  const vfs = new VirtualFS();
  vfs.setProviderFile(GUEST, { provider: {
    size: 16, tryRead: () => null, fill: () => { throw new Error('immediate provider error'); },
  } });
  const handle = vfs.createFile(GUEST, 0x80000000, 3);
  const pending = vfs.readFile(handle, new Uint8Array(4), 4).pending;
  vfs.pendingRead = pending;
  assert.strictEqual(await vfs.fillPendingRead(pending), false);
  assert.strictEqual(vfs.pendingRead, null);
  const retry = vfs.readFile(handle, new Uint8Array(4), 4);
  assert.strictEqual(retry.error, 30);
  assert.strictEqual(retry.faulted, true);
});

test('browser and CLI io-wait completion blocks preserve a newer pending request', async () => {
  // Execute the actual inline await blocks, without booting the surrounding
  // browser/CLI. This catches a host clearing the slot again after the VFS's
  // identity-guarded completion has deliberately left a peer request alone.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const blocks = [
    ['browser worker', path.join(__dirname, '..', 'host.js'),
      'const pvfs = self._helpCtx && self._helpCtx.vfs;',
      "await self.guestWorker.callExport('clear_yield');"],
    ['browser cooperative', path.join(__dirname, '..', 'host.js'),
      'const vfs = self._helpCtx && self._helpCtx.vfs;\n          const pending = vfs && vfs.getPendingRead(1);',
      'self.instance.exports.clear_yield();'],
    ['CLI', path.join(__dirname, 'run.js'),
      'const pending = ctx.vfs && ctx.vfs.getPendingRead(1);',
      'instance.exports.clear_yield();'],
  ];
  for (const [name, filename, startMarker, endMarker] of blocks) {
    const source = fs.readFileSync(filename, 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert(start >= 0 && end > start, `${name}: io-wait block must remain discoverable`);
    const service = new AsyncFunction('self', 'ctx', 'TRACE_YIELD', source.slice(start, end));
    const vfs = new VirtualFS();
    let complete;
    vfs.setProviderFile(GUEST, { provider: {
      size: 16, tryRead: () => null,
      fill: () => new Promise(resolve => { complete = resolve; }),
    } });
    const a = vfs.createFile(GUEST, 0x80000000, 3);
    const b = vfs.createFile(GUEST, 0x80000000, 3);
    const pa = vfs.readFile(a, new Uint8Array(4), 4).pending;
    const pb = vfs.readFile(b, new Uint8Array(4), 4).pending;
    vfs.pendingRead = pa;
    const running = service({ _helpCtx: { vfs }, logToUI: message => { throw Error(message); } }, { vfs }, false);
    vfs.pendingRead = pb;
    complete();
    await running;
    assert.strictEqual(vfs.pendingRead, pb, `${name}: late A completion must not clear B`);
  }
});

test('an async-only provider raises a named error on a consumer that cannot wait',
  () => {
    const vfs = lazyVfs({ sync: false });
    assert.throws(() => vfs.files.get(NORM).data, /async-only provider/,
      'materializing an unfilled async provider must fail loudly');
  });

test('vfs.materialize pre-fills an async-only provider for those consumers',
  async () => {
    const vfs = lazyVfs({ sync: false });
    const data = await vfs.materialize(GUEST);
    assert(Buffer.compare(Buffer.from(data), Buffer.from(BYTES)) === 0);
    // And now the ordinary accessor works, as every non-ReadFile path needs.
    assert.strictEqual(vfs.files.get(NORM).data.length, SIZE);
  });

test('vfs.materialize streams files larger than the ChunkCache LRU bound',
  async () => {
    const bigSize = bp.DEFAULT_CHUNK_SIZE * (bp.DEFAULT_MAX_CHUNKS + 1) + 137;
    const requests = [];
    const byteAt = i => (Math.imul(i, 131) ^ (i >>> 8) ^ 0x5a) & 0xff;
    const provider = {
      size: bigSize,
      readRange(off, len) {
        requests.push({ off, len });
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = byteAt(off + i);
        return Promise.resolve(bytes);
      },
    };
    const vfs = new VirtualFS();
    const guest = 'C:\\GAME\\LARGE.EXE';
    const norm = 'c:\\game\\large.exe';
    vfs.setProviderFile(guest, { provider });

    const data = await vfs.materialize(guest);
    assert.strictEqual(data.length, bigSize);
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== byteAt(i)) assert.fail(`wrong byte at ${i}`);
    }
    assert(requests.length > 1, 'the whole file was requested as one cache-busting range');
    assert(Math.max(...requests.map(r => r.len)) <= 4 * 1024 * 1024,
      'materialization requests must stay bounded');
    assert.strictEqual(vfs.files.get(norm)._provider, null,
      'the completed file must become an ordinary eager entry');
    assert.strictEqual(vfs.files.get(norm).data, data,
      'ordinary consumers must receive the materialized bytes without another read');
  });

// ---- chunk cache unit checks --------------------------------------------

test('HttpRangeProvider enforces its HEAD and byte-range contract', async () => {
  const calls = [];
  const headers = values => ({
    get(name) { return values[String(name).toLowerCase()] ?? null; },
  });
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (init && init.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: headers({ 'accept-ranges': 'bytes', 'content-length': '8' }),
      };
    }
    assert.strictEqual(init.headers.Range, 'bytes=2-4');
    const bytes = Uint8Array.from([2, 3, 4]);
    return { status: 206, arrayBuffer: async () => bytes.buffer };
  };
  const provider = await bp.HttpRangeProvider.open('https://example.test/disc.iso', { fetch });
  assert.strictEqual(provider.size, 8);
  assert.strictEqual(provider.name, 'disc.iso');
  assert.deepStrictEqual(Array.from(await provider.readRange(2, 3)), [2, 3, 4]);
  assert.strictEqual(calls[0].init.method, 'HEAD');
  assert.strictEqual(calls.length, 2);

  await assert.rejects(
    bp.HttpRangeProvider.open('https://example.test/no-range', {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: headers({ 'content-length': '8' }),
      }),
    }),
    /does not advertise Accept-Ranges/);

  const ignored = new bp.HttpRangeProvider('https://example.test/ignored', 8, {
    fetch: async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
  });
  await assert.rejects(ignored.readRange(0, 4), /answered 200, expected 206/);

  const truncated = new bp.HttpRangeProvider('https://example.test/short', 8, {
    fetch: async () => ({ status: 206, arrayBuffer: async () => new ArrayBuffer(3) }),
  });
  await assert.rejects(truncated.readRange(0, 4), /returned 3 bytes for @0\+4/);
});

test('ChunkCache refuses a short synchronous provider chunk', () => {
  const cache = new bp.ChunkCache({
    size: 8,
    readRangeSync: () => new Uint8Array(3),
    readRange: () => Promise.resolve(new Uint8Array(4)),
  }, { chunkSize: 4, readAhead: 0 });
  assert.throws(() => cache.tryRead(0, 1), /returned 3 bytes for @0\+4/);
  assert.strictEqual(cache._chunks.size, 0, 'the short synchronous chunk must not be cached');
});

test('ChunkCache.tryRead returns null on a miss, never a partial buffer', () => {
  const cache = new bp.ChunkCache(
    { size: 1000, readRange: () => Promise.resolve(new Uint8Array(0)) },
    { chunkSize: 100 });
  assert.strictEqual(cache.tryRead(0, 10), null);
  assert.strictEqual(cache.stats.misses, 1);
});

test('SliceProvider windows a parent provider', async () => {
  const parent = new bp.BytesProvider(BYTES);
  const slice = new bp.SliceProvider(parent, 1000, 256);
  assert.strictEqual(slice.size, 256);
  assert(Buffer.compare(Buffer.from(slice.readRangeSync(0, 256)),
    Buffer.from(BYTES.subarray(1000, 1256))) === 0);
  assert(Buffer.compare(Buffer.from(await slice.readRange(16, 16)),
    Buffer.from(BYTES.subarray(1016, 1032))) === 0);
});

test('provider windows preserve offsets above the signed 32-bit boundary',
  async () => {
    const high = 0x80000000 + 0x12345;
    const parentSize = high + 0x20000;
    const reads = [];
    const byteAt = i => (Math.floor(i / 0x1000000) + (i % 251)) & 0xff;
    const makeBytes = (off, len) => {
      reads.push({ off, len });
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = byteAt(off + i);
      return out;
    };
    const parent = {
      size: parentSize,
      readRangeSync: makeBytes,
      readRange: (off, len) => Promise.resolve(makeBytes(off, len)),
    };

    const slice = new bp.SliceProvider(parent, high, 0x1000);
    assert.strictEqual(slice.offset, high);
    assert.strictEqual(slice.size, 0x1000);
    const sliceBytes = await slice.readRange(0x20, 8);
    assert.deepStrictEqual(Array.from(sliceBytes),
      Array.from({ length: 8 }, (_, i) => byteAt(high + 0x20 + i)));
    assert(reads.some(r => r.off === high + 0x20),
      'SliceProvider truncated the parent offset');

    const vfs = new VirtualFS();
    const cache = new bp.ChunkCache(parent,
      { chunkSize: 4096, maxChunks: 4, readAhead: 0 });
    const guest = 'C:\\GAME\\HIGH.DAT';
    vfs.setProviderFile(guest, { provider: cache, offset: high, length: 0x1000 });
    const entry = vfs.files.get('c:\\game\\high.dat');
    assert.strictEqual(entry._offset, high);
    const handle = vfs.createFile(guest, 0x80000000, 3);
    const buf = new Uint8Array(8);
    const result = vfs.readFile(handle, buf, buf.length);
    assert(result.ok && result.bytesRead === buf.length);
    assert.deepStrictEqual(Array.from(buf),
      Array.from({ length: 8 }, (_, i) => byteAt(high + i)));
  });

test('provider file sizes above 2 GiB stay Numbers instead of wrapping', () => {
  const hugeLength = 0x80000000 + 17;
  const provider = {
    size: hugeLength + 32,
    readRangeSync: () => new Uint8Array(0),
    readRange: () => Promise.resolve(new Uint8Array(0)),
  };
  const vfs = new VirtualFS();
  vfs.setProviderFile('C:\\GAME\\HUGE.BIN', { provider, length: hugeLength });
  assert.strictEqual(vfs.files.get('c:\\game\\huge.bin')._size, hugeLength);
  assert.throws(() => vfs.setProviderFile('C:\\BAD.BIN', {
    provider, offset: Number.MAX_SAFE_INTEGER + 1, length: 0,
  }), /safe integer/);
  assert.throws(() => new bp.SliceProvider(provider, 0, Number.MAX_SAFE_INTEGER + 1),
    /safe integer/);
});

test('setProviderFile honours an offset/length window', () => {
  const vfs = new VirtualFS();
  vfs.setProviderFile('C:\\GAME\\ENTRY.BIN', {
    provider: new bp.BytesProvider(BYTES), offset: 4096, length: 300,
  });
  const h = vfs.createFile('C:\\GAME\\ENTRY.BIN', 0x80000000, 3);
  assert.strictEqual(vfs.getFileSize(h), 300);
  const buf = new Uint8Array(300);
  const r = vfs.readFile(h, buf, 300);
  assert(r.ok && r.bytesRead === 300);
  assert(Buffer.compare(Buffer.from(buf), Buffer.from(BYTES.subarray(4096, 4396))) === 0,
    'the window returned the wrong bytes');
  const tail = vfs.readFile(h, new Uint8Array(16), 16);
  assert(tail.ok && tail.bytesRead === 0, 'the window must end at its length');
});

Promise.all(async_tests).then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
