#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  ISO_BYTES, ISO_SHA256, compareReports, handlerNames, parseArgs, usage,
} = require('../tools/smac-movie-bench');

assert.strictEqual(ISO_BYTES, 503289856);
assert.strictEqual(ISO_SHA256,
  '425f53a7da9b5acd2726a3ff30423f426ea27bf1a3b806e45688f83feada0c96');

const parsed = parseArgs([
  '--iso=./disc.iso', '--oracle=/tmp/base.json', '--out=/tmp/out.json',
  '--warmup-unique=9', '--measure-unique=42', '--wall-seconds=6.5',
  '--timeout-seconds=99', '--slice=123456', '--handler-hist', '--headful',
]);
assert(parsed.iso.endsWith('/disc.iso'));
assert.strictEqual(parsed.oracle, '/tmp/base.json');
assert.strictEqual(parsed.out, '/tmp/out.json');
assert.strictEqual(parsed.warmupUnique, 9);
assert.strictEqual(parsed.measureUnique, 42);
assert.strictEqual(parsed.wallSeconds, 6.5);
assert.strictEqual(parsed.timeoutSeconds, 99);
assert.strictEqual(parsed.slice, 123456);
assert.strictEqual(parsed.hist, true);
assert.strictEqual(parsed.headful, true);
assert.throws(() => parseArgs(['--wall-seconds=-1']), /non-negative/);
assert.match(usage(), /adjacent|unique frames|opening/i);

const baseline = {
  fixedWall: { uniqueFrames: 70 },
  fixedFrames: { anchorHash: 'aa', elapsedMs: 1000, hashes: ['aa', 'bb', 'cc'] },
};
const faster = {
  fixedWall: { uniqueFrames: 80 },
  fixedFrames: { anchorHash: 'aa', elapsedMs: 800, hashes: ['aa', 'bb', 'cc'] },
};
assert.deepStrictEqual(compareReports(baseline, faster), {
  anchorMatch: true,
  pixelSequenceMatch: true,
  firstMismatch: -1,
  baselineHashes: 3,
  candidateHashes: 3,
  fixedFramesSpeedup: 1.25,
  fixedWallUniqueDelta: 10,
});
const wrong = JSON.parse(JSON.stringify(faster));
wrong.fixedFrames.hashes[1] = 'XX';
assert.strictEqual(compareReports(baseline, wrong).firstMismatch, 1);
assert.strictEqual(compareReports(baseline, wrong).pixelSequenceMatch, false);

const names = handlerNames();
assert.strictEqual(names[0], 'th_nop');
assert.strictEqual(names[53], 'th_shift_r');
assert(names.length > 400, 'handler table parser should include fused handlers');

console.log('PASS Alpha movie benchmark CLI, handler names, and oracle comparison');
