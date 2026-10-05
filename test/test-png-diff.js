#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { PNG } = require('pngjs');
const { diffPng } = require('../tools/png-diff');

function image(width, height, bytes) {
  const png = new PNG({ width, height });
  png.data.set(bytes);
  return png;
}

const base = image(2, 2, [
  10, 20, 30, 40,   50, 60, 70, 80,
  90, 100, 110, 120, 130, 140, 150, 160,
]);
const changed = image(2, 2, [
  10, 20, 30, 41,   50, 62, 70, 80,
  90, 100, 110, 120, 130, 140, 150, 160,
]);

let result = diffPng(base, changed);
assert.strictEqual(result.sizeMismatch, false);
assert.strictEqual(result.changed, 2, 'RGBA comparison must include alpha');
assert.strictEqual(result.maxDelta, 2);
assert.strictEqual(result.totalDelta, 3, 'total channel error includes alpha by default');
assert.deepStrictEqual(result.box, { x: 0, y: 0, w: 2, h: 1 });

result = diffPng(base, changed, { includeAlpha: false });
assert.strictEqual(result.changed, 1, 'RGB comparison must ignore alpha');
assert.strictEqual(result.totalDelta, 2, 'RGB total excludes alpha');
assert.strictEqual(result.maxDelta, 2);
assert.deepStrictEqual(result.box, { x: 1, y: 0, w: 1, h: 1 });

result = diffPng(base, changed, {
  includeAlpha: false,
  tolerance: 2,
  region: { x: 1, y: 0, w: 1, h: 1 },
});
assert.strictEqual(result.changed, 0, 'tolerance and region must compose');
assert.strictEqual(result.compared, 1);
assert.strictEqual(result.totalDelta, 2, 'total is region-limited but independent of tolerance');

result = diffPng(base, image(1, 1, [0, 0, 0, 0]));
assert.strictEqual(result.sizeMismatch, true);
assert.deepStrictEqual(result.a, { width: 2, height: 2 });
assert.deepStrictEqual(result.b, { width: 1, height: 1 });

// Distributed channel changes distinguish summed distance from max-channel
// distance. Equal-to-threshold changes must still be ignored, and alpha is
// excluded by the migrated candidate/installer tests.
const black = image(3, 1, new Array(12).fill(0));
const distributed = image(3, 1, [10, 10, 10, 255, 10, 10, 11, 0, 0, 0, 0, 255]);
result = diffPng(black, distributed, { metric: 'sum', includeAlpha: false, tolerance: 30 });
assert.strictEqual(result.changed, 1);
assert.strictEqual(result.maxDelta, 11, 'maxDelta remains a per-channel diagnostic');
assert.strictEqual(result.totalDelta, 61, 'total sums channel error across pixels, even unchanged ones');
assert.deepStrictEqual(result.box, { x: 1, y: 0, w: 1, h: 1 });
assert.strictEqual(diffPng(black, distributed, { tolerance: 30, includeAlpha: false }).changed, 0);
assert.strictEqual(diffPng(black, distributed, { metric: 'sum', tolerance: 30 }).changed, 3);
assert.strictEqual(diffPng(black, distributed, { metric: 'sum', includeAlpha: false,
  tolerance: 30, region: { x: 0, y: 0, w: 1, h: 1 } }).changed, 0);
assert.throws(() => diffPng(black, distributed, { metric: 'typo' }), /unknown PNG difference metric/);
const candidateChanges = image(3, 1, [20, 10, 10, 0, 20, 10, 11, 0, 1, 1, 1, 255]);
result = diffPng(black, candidateChanges, { metric: 'sum', includeAlpha: false, tolerance: 40 });
assert.strictEqual(result.changed, 1, 'candidate threshold is strictly greater than 40');
assert.deepStrictEqual(result.box, { x: 1, y: 0, w: 1, h: 1 });

const wide = image(3, 2, [1,2,3,255, 4,5,6,255, 99,99,99,255,
  7,8,9,255, 10,11,12,255, 99,99,99,255]);
const narrow = image(2, 3, [1,2,3,255, 4,5,6,255,
  7,8,9,255, 10,11,13,255, 99,99,99,255, 99,99,99,255]);
assert.strictEqual(diffPng(wide, narrow).changed, undefined, 'strict still rejects mismatch');
result = diffPng(wide, narrow, { sizePolicy: 'overlap' });
assert.strictEqual(result.sizeMismatch, true, 'overlap does not conceal mismatched dimensions');
assert.strictEqual(result.compared, 4);
assert.strictEqual(result.changed, 1, 'each image must use its own row stride');
assert.strictEqual(result.totalDelta, 1);
assert.strictEqual(result.share, 0.25);
assert.deepStrictEqual(result.box, { x: 1, y: 1, w: 1, h: 1 });
assert.strictEqual(diffPng(narrow, wide, { sizePolicy: 'overlap' }).changed, 1);
result = diffPng(wide, narrow, { sizePolicy: 'overlap', region: { x: 2, y: 2, w: 1, h: 1 } });
assert.strictEqual(result.changed, 0);
assert.strictEqual(result.compared, 0, 'empty overlap must not report a fabricated pixel');
assert.strictEqual(result.share, 0);
assert.throws(() => diffPng(wide, narrow, { sizePolicy: 'typo' }), /unknown PNG size policy/);

// Clip the original rectangle, not a rectangle shifted onto the image.
result = diffPng(base, changed, { region: { x: -1, y: -1, w: 2, h: 2 } });
assert.strictEqual(result.compared, 1, 'negative origin leaves only the top-left pixel');
assert.strictEqual(result.changed, 1);
assert.strictEqual(result.totalDelta, 1);
assert.deepStrictEqual(result.box, { x: 0, y: 0, w: 1, h: 1 });
for (const region of [
  { x: -3, y: 0, w: 2, h: 2 }, { x: 0, y: -3, w: 2, h: 2 },
  { x: 0, y: 0, w: 0, h: 2 }, { x: 1, y: 1, w: -1, h: -1 },
]) {
  result = diffPng(base, changed, { region });
  assert.strictEqual(result.compared, 0);
  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.totalDelta, 0);
  assert.strictEqual(result.share, 0);
  assert.strictEqual(result.box, null);
}
result = diffPng(wide, narrow, { sizePolicy: 'overlap',
  region: { x: -1, y: -1, w: 2, h: 2 } });
assert.strictEqual(result.compared, 1);
assert.strictEqual(result.changed, 0, 'overlap and negative-origin clipping compose');

console.log('png-diff helper: PASS');
