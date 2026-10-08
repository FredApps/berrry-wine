'use strict';

// ChunkCache.preload: the ranges a guest reads where it cannot park (Diablo's
// spawn.mpq UI art, read inside a synchronous WM_INITDIALOG) are fetched before
// the guest starts and pinned outside the LRU, so streaming reads elsewhere in
// the file can never evict them. preloadRangesFor validates a measured list.

const assert = require('assert');
const { ChunkCache, BytesProvider, preloadRangesFor } = require('../lib/byte-provider');

const SIZE = 10 * 64 + 17;          // 11 chunks of 64, the last one short
const source = new Uint8Array(SIZE).map((_, i) => (i * 7 + 3) & 0xff);

function asyncProvider(failures = {}) {
  const inner = new BytesProvider(source);
  const calls = [];
  return {
    size: SIZE,
    calls,
    readRangeSync: () => null,
    readRange(off, len) {
      calls.push(off);
      const left = failures[off] || 0;
      if (left > 0) {
        failures[off] = left - 1;
        return Promise.reject(new Error(`HTTP 503 @${off}`));
      }
      return inner.readRange(off, len);
    },
  };
}

(async () => {
  {
    const p = asyncProvider();
    // prefetch: 0 -- this case counts provider calls around pinning, and a
    // background prefetch from the sequential stream below would land late.
    const cache = new ChunkCache(p, { chunkSize: 64, maxChunks: 2, readAhead: 0, prefetch: 0 });
    assert.deepStrictEqual(cache.chunksFor([[0, 1], [130, 200], [640, 657], [700, 900]]), [0, 2, 3, 10]);
    const seen = [];
    const result = await cache.preload([[0, 1], [130, 200], [640, 657]], {
      onProgress: e => seen.push(e),
    });
    assert.deepStrictEqual(result, { chunks: 4, bytes: 64 * 3 + 17 });
    assert.deepStrictEqual(seen[0], { loaded: 0, total: 209 });
    assert.deepStrictEqual(seen[seen.length - 1], { loaded: 209, total: 209 });
    // Stream through the rest of the file with a 2-chunk LRU.
    for (let off = 0; off < SIZE; off += 64) {
      if (!cache.tryRead(off, 1)) await cache.fill(off, 1);
    }
    // Every pinned chunk is still a synchronous hit; nothing was refetched.
    const before = p.calls.length;
    assert.deepStrictEqual(Array.from(cache.tryRead(130, 70)), Array.from(source.subarray(130, 200)));
    assert.deepStrictEqual(Array.from(cache.tryRead(640, 17)), Array.from(source.subarray(640, 657)));
    assert.ok(cache.tryRead(0, 1));
    assert.strictEqual(p.calls.length, before);
    // An unpinned middle chunk was evicted by the LRU, as before.
    assert.strictEqual(cache.tryRead(64 * 5, 1), null);
    assert.strictEqual(cache.stats.pinnedChunks, 4);
    // Preloading again is free.
    await cache.preload([[130, 200]]);
    assert.strictEqual(p.calls.length, before);
  }

  {
    // Retryable failure, then success; a chunk already resident is pinned
    // without a fetch.
    const p = asyncProvider({ 64: 2 });
    const cache = new ChunkCache(p, { chunkSize: 64, readAhead: 0 });
    await cache.fill(0, 1);
    await cache.preload([[0, 128]], { backoffMs: 0 });
    assert.deepStrictEqual(p.calls, [0, 64, 64, 64]);
    assert.strictEqual(cache.stats.pinnedChunks, 2);
  }

  {
    // Exhausted retries reject with the attempt count.
    const p = asyncProvider({ 0: 5 });
    const cache = new ChunkCache(p, { chunkSize: 64, readAhead: 0 });
    await assert.rejects(cache.preload([[0, 10]], { retries: 1, backoffMs: 0 }),
      e => /HTTP 503/.test(e.message) && e.attempts === 2);
  }

  {
    // Abort stops the preload as a cancellation, not a download error.
    const p = asyncProvider();
    const cache = new ChunkCache(p, { chunkSize: 64, readAhead: 0 });
    const controller = { signal: { aborted: true } };
    await assert.rejects(cache.preload([[0, 10]], controller), e => e.name === 'AbortError');
  }

  {
    assert.deepStrictEqual(preloadRangesFor([[0, 4]], 10), [[0, 4]]);
    assert.deepStrictEqual(preloadRangesFor({ schemaVersion: 1, size: 10, ranges: [[2, 9]] }, 10), [[2, 9]]);
    assert.throws(() => preloadRangesFor({ schemaVersion: 1, size: 11, ranges: [] }, 10), /measured on 11/);
    assert.throws(() => preloadRangesFor({ schemaVersion: 1, ranges: [[5, 4]] }, 10), /bad range/);
    assert.throws(() => preloadRangesFor({ schemaVersion: 1, ranges: [[0, 11]] }, 10), /bad range/);
    assert.throws(() => preloadRangesFor({ ranges: [] }, 10), /schemaVersion/);
  }

  console.log('test-chunk-cache-preload: PASS');
})().catch(e => { console.error(e); process.exit(1); });
