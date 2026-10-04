'use strict';

// tools/io-range-census.js: parse run.js --trace-fs ReadFile lines, coalesce
// the ranges per phase, and keep reads made under a nested synchronous message
// (mainDepth > 0) apart, because those are the ones a lazy mount cannot park.

const assert = require('assert');
const { parseLine, mergeRanges, census, widenToMpqBlocks } = require('../tools/io-range-census');

const line = (pos, n, tid, b, depth, path = 'c:\\spawn.mpq') =>
  `[FS] ReadFile(h=0x10, buf=0x500000, n=0x${n.toString(16)}, read=0x${n.toString(16)}, ` +
  `pos=0x${pos.toString(16)}, path=${path}) tid=${tid} b=${b} mainDepth=${depth}`;

{
  const r = parseLine(line(0x200, 0x80, 2, 812, 1));
  assert.deepStrictEqual(r, { asked: 0x80, read: 0x80, pos: 0x200, path: 'c:\\spawn.mpq', tid: 2, batch: 812, mainDepth: 1 });
  // The pre-tag format still parses; depth is unknown, not zero.
  const old = parseLine('[FS] ReadFile(h=0x1, buf=0x2, n=0x4, read=0x4, pos=0x0, path=c:\\a.dat)');
  assert.strictEqual(old.mainDepth, null);
  assert.strictEqual(parseLine('[fs] CreateFile c:\\a.dat'), null);
}

assert.deepStrictEqual(mergeRanges([[10, 20], [0, 5], [5, 8], [15, 30], [40, 40]]), [[0, 8], [10, 30]]);

{
  const reads = [
    line(0, 0x20, 1, 10, 0),             // phase 0, parkable
    line(0x40000, 0x100, 2, 20, 1),      // phase 0, worker under nested wait
    line(0x40080, 0x100, 1, 30, 2),      // phase 0, main inside a dialog, overlaps
    line(0x80000, 0x1000, 1, 150, 0),    // phase 1
    line(0x90000, 0, 1, 160, 1),         // zero-byte read ignored
  ].map(parseLine);
  const c = census(reads, { splits: [100], chunkSize: 0x40000 });
  assert.strictEqual(c.phases.length, 2);
  assert.strictEqual(c.phases[0].reads, 3);
  assert.deepStrictEqual(c.phases[0].unsafeRanges, [[0x40000, 0x40180]]);
  assert.strictEqual(c.phases[0].unsafeBytes, 0x180);
  assert.deepStrictEqual(c.phases[0].tids, { 1: 2, 2: 1 });
  assert.strictEqual(c.phases[1].unsafeReads, 0);
  assert.deepStrictEqual(c.unsafeRanges, [[0x40000, 0x40180]]);
  assert.strictEqual(c.chunks, 3);        // chunks 0, 1, 2
  assert.strictEqual(c.unsafeChunks, 1);
}

{
  // Widening to MPQ blocks also pins the archive tables every open reads.
  const archive = {
    base: 0, headerSize: 0x20,
    hashTablePos: 0x1000, hashTableSize: 4, blockTablePos: 0x1040, blockTableSize: 3,
    blocks: [
      { index: 0, filePos: 0x100, cSize: 0x100 },
      { index: 1, filePos: 0x200, cSize: 0x300 },
      { index: 2, filePos: 0x800, cSize: 0x100 },
    ],
  };
  const w = widenToMpqBlocks([[0x280, 0x290]], archive);
  assert.deepStrictEqual(w.blocks, [1]);
  assert.deepStrictEqual(w.ranges, [[0, 0x20], [0x200, 0x500], [0x1000, 0x1070]]);
}

console.log('test-io-range-census: PASS');
