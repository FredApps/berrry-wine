#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { ChunkCache, ChunkCacheBudget, SliceProvider, SparseByteProvider } = require('../lib/byte-provider');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function source(size = 24) {
  const data = Uint8Array.from({ length: size }, (_, i) => i);
  return { size, data, reads: 0, refs: 1,
    retain() { assert(this.refs > 0); this.refs++; },
    release() { assert(this.refs > 0); this.refs--; },
    async readRange(off, len) { this.reads++; return data.slice(off, off + len); },
  };
}
(async () => {
  const budget = new ChunkCacheBudget({ maxBytes: 8 });
  const aSource = source(), bSource = source();
  const options = { budget, chunkSize: 4, maxChunks: 4, readAhead: 0 };
  const a = new ChunkCache(aSource, options), b = new ChunkCache(bSource, options);
  const check = () => {
    const total = [...a._chunks.values(), ...b._chunks.values()].reduce((n, x) => n + x.length, 0);
    assert.strictEqual(budget.bytes, total); assert(total <= 8);
  };
  await a.readRange(0, 4); await b.readRange(0, 4); check();
  assert(a.tryRead(0, 4)); // A becomes newest; next B chunk evicts old B.
  await b.readRange(4, 4); check();
  assert(a._chunks.has(0)); assert(!b._chunks.has(0)); assert(b._chunks.has(1));
  const before = bSource.reads;
  await b.readRange(0, 4); assert.strictEqual(bSource.reads, before + 1); check();
  b._touch(0, Uint8Array.of(9, 8)); check();
  assert.strictEqual(budget.bytes, 6, 'replacement accounts changed byte length');
  b.clear(); a.clear(); assert.strictEqual(budget.bytes, 0); assert.strictEqual(budget.chunks, 0);

  // One chunk and one request can each be larger than the pool. No cache
  // admission is required for either a direct async read or a guest retry.
  const tiny = new ChunkCacheBudget({ maxBytes: 2 });
  const large = new ChunkCache(source(), { budget: tiny, chunkSize: 4, readAhead: 2 });
  assert.deepStrictEqual(await large.readRange(0, 12), Uint8Array.from({ length: 12 }, (_, i) => i));
  assert.strictEqual(tiny.bytes, 0);
  await large.fill(1, 15);
  assert.strictEqual(large.transientBytes, 15);
  assert.deepStrictEqual(large.tryRead(1, 15), Uint8Array.from({ length: 15 }, (_, i) => i + 1));
  assert.strictEqual(large.transientBytes, 0);
  assert.strictEqual(large.tryRead(1, 15), null, 'operation result is consumed, not an unbounded cache');
  assert.strictEqual(tiny.bytes, 0);
  assert.deepStrictEqual(await large.readRange(24, 10), new Uint8Array());
  await large.fill(0, 0); assert.strictEqual(large.transientBytes, 0);
  const zeroBudget = new ChunkCacheBudget({ maxBytes: 0 });
  const zero = new ChunkCache(source(), { budget: zeroBudget, chunkSize: 4 });
  await zero.fill(0, 4); assert.deepStrictEqual(zero.tryRead(0, 4), Uint8Array.of(0, 1, 2, 3));
  assert.strictEqual(zeroBudget.bytes, 0);

  // Speculation and another file cannot destroy the pending operation result.
  const speculative = new ChunkCache(source(), { ...options, readAhead: 8 });
  await speculative.fill(0, 4);
  assert(speculative._chunks.size <= 2);
  await a.readRange(8, 8);
  assert.deepStrictEqual(speculative.tryRead(0, 4), Uint8Array.of(0, 1, 2, 3));
  assert(budget.bytes <= 8);

  const gate = deferred(), slow = source();
  const original = slow.readRange.bind(slow);
  slow.readRange = async (...args) => { await gate.promise; return original(...args); };
  const cache = new ChunkCache(slow, options);
  const f1 = cache.fill(0, 4), f2 = cache.fill(0, 4), direct = cache.readRange(0, 4);
  assert.strictEqual(f1, f2, 'matching fills share the whole operation');
  gate.resolve(); await Promise.all([f1, f2, direct]);
  assert.strictEqual(slow.reads, 1, 'direct read and fills deduplicate the same in-flight chunk');
  cache.retain(); cache.retain();
  cache.release(); assert(cache.transientBytes > 0);
  cache.release(); assert.strictEqual(cache.transientBytes, 0); assert.strictEqual(cache._chunks.size, 0);
  assert.strictEqual(slow.refs, 1, 'cache constructor remains borrowed');

  const late = deferred(), pendingSource = source();
  pendingSource.readRange = async (off, len) => { await late.promise; return pendingSource.data.slice(off, off + len); };
  const clearing = new ChunkCache(pendingSource, options);
  const pending = clearing.fill(0, 12); clearing.clear(); late.resolve(); await pending;
  assert.strictEqual(clearing._chunks.size, 0, 'pre-clear fetch cannot repopulate released cache');
  assert.strictEqual(clearing.transientBytes, 0);

  const inherited = new ChunkCache(source(), options);
  const sparse = new SparseByteProvider(new SliceProvider(inherited, 0, 12));
  assert.strictEqual(sparse.budget, budget);
  assert.strictEqual(sparse._cache.budget, budget);
  const replacement = source(12);
  assert.strictEqual(await sparse.rebase(replacement, sparse.revision), true);
  assert.strictEqual(sparse._cache.budget, budget, 'checkpoint rebase preserves shared pool');
  const fork = sparse.fork();
  assert.strictEqual(fork._cache.budget, budget, 'copy after rebase keeps the same pool');
  await fork.release();
  await sparse.release();
  assert.strictEqual(replacement.refs, 1);
  assert.throws(() => new ChunkCacheBudget({ maxBytes: -1 }), /cache budget/);
  assert.throws(() => new ChunkCache(source(), { budget: {} }), /budget/);
  for (const item of [a, b, large, zero, speculative, cache, clearing, inherited]) item.clear();
  assert.strictEqual(budget.bytes, 0);
  for (const opts of [{ budget: new ChunkCacheBudget({ maxBytes: 0 }) }, { maxChunks: 1 }]) {
    const concurrent = new ChunkCache(source(32), { ...opts, chunkSize: 4, readAhead: 0 });
    const ranges = [[0, 8], [16, 8], [0, 8]];
    const results = await Promise.all(ranges.map(([off, len]) => concurrent.fill(off, len)));
    for (let i = 0; i < ranges.length; i++) {
      assert.deepStrictEqual(results[i], concurrent.provider.data.slice(ranges[i][0], ranges[i][0] + 8));
    }
    const direct = await Promise.all(ranges.map(([off, len]) => concurrent.readRange(off, len)));
    assert.deepStrictEqual(direct, results, 'concurrent direct reads own results independently of retry slot');
    concurrent.clear();
  }
  const dirtyBase = new ChunkCache(source(16), { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 4, readAhead: 0 });
  const dirtySparse = new SparseByteProvider(dirtyBase, { pageSize: 4 });
  dirtySparse.write(2, Uint8Array.of(99));
  assert.deepStrictEqual(await dirtySparse.fill(0, 8), Uint8Array.of(0, 1, 99, 3, 4, 5, 6, 7));
  assert.deepStrictEqual(dirtySparse.tryRead(0, 8), Uint8Array.of(0, 1, 99, 3, 4, 5, 6, 7));
  await dirtySparse.release();
  console.log('PASS shared byte cache budget: global LRU, actual eviction, retry buffers, oversized reads, dedup and lifecycle');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
