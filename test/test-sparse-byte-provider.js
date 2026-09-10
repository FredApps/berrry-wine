#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { SparseByteProvider, BytesProvider } = require('../lib/byte-provider');

async function main() {
  let reads = 0, largest = 0, refs = 0;
  const base = {
    size: 3 * 1024 * 1024 * 1024,
    retain() { refs++; }, release() { refs--; },
    async readRange(off, len) {
      reads++; largest = Math.max(largest, len);
      return Uint8Array.from({ length: len }, (_, i) => (off + i) % 251);
    },
  };
  const file = new SparseByteProvider(base);
  const at = 2 * 1024 * 1024 * 1024 + 123;
  file.write(at, Uint8Array.of(7, 8, 9));
  assert.strictEqual(reads, 0, 'write must not fetch untouched bytes');
  assert.strictEqual(file.pages.size, 1, 'tiny edit to 3GiB file owns one page');
  assert.deepStrictEqual(file.tryRead(at, 3), Uint8Array.of(7, 8, 9));
  assert.strictEqual(file.tryRead(at - 1, 5), null);
  await file.fill(at - 1, 5);
  assert.deepStrictEqual(file.tryRead(at - 1, 5),
    Uint8Array.of((at - 1) % 251, 7, 8, 9, (at + 3) % 251));
  assert(largest <= 256 * 1024);
  const snapshot = file.snapshot();
  file.write(at, Uint8Array.of(99));
  assert.deepStrictEqual(snapshot.ranges[0].data, Uint8Array.of(7, 8, 9));
  assert.strictEqual(await file.rebase(base, snapshot.revision), false, 'stale checkpoint cannot clear newer writes');
  snapshot.release(); snapshot.release();
  assert.strictEqual(refs, 1);
  file.truncate(10);
  file.truncate(base.size);
  assert.strictEqual(file.pages.size, 0);
  assert.deepStrictEqual(file.tryRead(at, 3), new Uint8Array(3), 'truncated base tail cannot resurrect');
  file.release();
  assert.strictEqual(refs, 0);
  assert.throws(() => file.tryRead(0, 1), /released/);

  // Overlap, page boundaries, holes and truncation checked against a simple
  // eager oracle after each operation, for both sync and async consumers.
  const initial = Uint8Array.from({ length: 97 }, (_, i) => i);
  const sparse = new SparseByteProvider(new BytesProvider(initial), { pageSize: 16 });
  let expected = initial.slice();
  let seed = 13;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 250; i++) {
    if (random(4) === 0) {
      const size = random(150);
      sparse.truncate(size);
      const next = new Uint8Array(size);
      next.set(expected.subarray(0, size)); expected = next;
    } else {
      const offset = random(150), data = Uint8Array.from({ length: 1 + random(25) }, () => random(256));
      sparse.write(offset, data);
      const next = new Uint8Array(Math.max(expected.length, offset + data.length));
      next.set(expected); next.set(data, offset); expected = next;
    }
    assert.deepStrictEqual(sparse.tryRead(0, sparse.size), expected, `sync operation ${i}`);
    assert.deepStrictEqual(await sparse.readRange(0, sparse.size), expected, `async operation ${i}`);
  }
  const current = sparse.snapshot();
  assert.strictEqual(await sparse.rebase(new BytesProvider(expected.slice()), current.revision), true);
  assert.strictEqual(sparse.pages.size, 0);
  assert.deepStrictEqual(sparse.tryRead(0, sparse.size), expected);
  current.release(); sparse.release();

  let resume;
  const original = Uint8Array.of(1, 2, 3, 4);
  const slow = new SparseByteProvider({ size: 4, readRange: (off, len) => off === 0
    ? new Promise(resolve => { resume = () => resolve(original.slice(off, off + len)); })
    : Promise.resolve(original.slice(off, off + len)) });
  slow.write(1, Uint8Array.of(10));
  const pending = slow.readRange(0, 4);
  slow.write(1, Uint8Array.of(20));
  resume();
  assert.deepStrictEqual(await pending, Uint8Array.of(1, 10, 3, 4), 'read observes its initial version');
  slow.release();
  console.log('PASS sparse byte provider: bounded COW, versioned reads, truncate holes, 250 oracle operations');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
