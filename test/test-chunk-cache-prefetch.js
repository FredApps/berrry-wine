#!/usr/bin/env node
'use strict';

// ChunkCache sequential prefetch (lib/byte-provider.js): 1MB chunks by
// default; a read that continues the previous one starts fetching the next
// `prefetch` chunks in the background, a random read fetches only what it
// covers (no read-ahead), the LRU stays bounded, and overFetchBytes counts
// fetched chunks no read ever touched.

const assert = require('assert');
const { ChunkCache, DEFAULT_CHUNK_SIZE, DEFAULT_MAX_CHUNKS } = require('../lib/byte-provider');

const CH = 1000;
const SIZE = 20 * CH;
function provider() {
  const calls = [];
  return {
    size: SIZE, name: 't', calls,
    readRange(off, len) {
      calls.push(off / CH);
      return Promise.resolve(Uint8Array.from({ length: len }, (_, i) => (off + i) & 0xff));
    },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function read(cache, off, len) {
  if (!cache.tryRead(off, len)) { await cache.fill(off, len); assert(cache.tryRead(off, len)); }
  await settle();
}

(async () => {
  assert.strictEqual(DEFAULT_CHUNK_SIZE, 1024 * 1024, '1MB range requests by default');
  assert(DEFAULT_CHUNK_SIZE * DEFAULT_MAX_CHUNKS <= 16 * 1024 * 1024, 'resident bytes stay bounded (16MB)');

  // Sequential scan: after the second read the next chunks arrive ahead of
  // the reads, so later reads do not miss.
  let p = provider();
  let c = new ChunkCache(p, { chunkSize: CH, maxChunks: 8, prefetch: 2 });
  for (let off = 0; off < 10 * CH; off += 500) await read(c, off, 500);
  const missesSeq = c.stats.misses;
  assert(missesSeq <= 2, `a forward scan rarely parks (misses ${missesSeq})`);
  assert(c.stats.prefetches > 0, 'prefetches were issued');
  assert(p.calls.every((idx, i) => i === 0 || idx > p.calls[i - 1]), 'chunks fetched once, in order');
  assert(c._chunks.size <= 8, 'the LRU bound holds');
  assert(c.overFetchBytes <= 2 * CH, `over-fetch is at most the prefetch window (${c.overFetchBytes})`);

  // Random access: each read fetches exactly its own chunk, no read-ahead,
  // no prefetch.
  p = provider();
  c = new ChunkCache(p, { chunkSize: CH, maxChunks: 8, prefetch: 2 });
  for (const idx of [7, 2, 15, 9, 0]) await read(c, idx * CH + 10, 20);
  assert.deepStrictEqual(p.calls, [7, 2, 15, 9, 0], 'random reads fetch only what they cover');
  assert.strictEqual(c.stats.prefetches, 0);
  assert.strictEqual(c.overFetchBytes, 0);

  // Legacy shape (the --lazy-cache=legacy arm): read-ahead on every miss.
  p = provider();
  c = new ChunkCache(p, { chunkSize: CH, maxChunks: 8, prefetch: 0, readAhead: 1, sequentialReadAhead: false });
  await read(c, 7 * CH, 10);
  assert.deepStrictEqual(p.calls, [7, 8], 'legacy reads ahead even on a random miss');
  assert.strictEqual(c.overFetchBytes, CH);

  // Prefetch never exceeds half the cache, so it cannot evict what is read.
  c = new ChunkCache(provider(), { chunkSize: CH, maxChunks: 2, prefetch: 5 });
  assert.strictEqual(c.prefetch, 1);

  console.log('PASS ChunkCache: 1MB default, sequential prefetch, no random read-ahead, bounded, over-fetch counted');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
