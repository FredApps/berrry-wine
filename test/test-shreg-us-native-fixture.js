'use strict';
// Native-oracle integrity only; does not claim emulator conformance.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const dir = path.join(__dirname, 'fixtures/win98-shreg-us-value');
const sentinel = 'a5'.repeat(16);
const expected = [
  ['user-first', 0, 3, 4, '10111213'],
  ['ignore-user', 0, 3, 4, '20212223'],
  ['ignore-user-nonzero', 0, 3, 4, '20212223'],
  ['missing-user-value', 0, 3, 4, '20212223'],
  ['default-value-name', 0, 3, 4, '10111213'],
  ['query-size', 0, 3, 4, ''],
  ['short-no-default', 234, 3, 4, ''],
  ['short-with-default', 234, 3, 4, ''],
  ['user-too-large-machine-fits', 0, 3, 4, '20212223'],
  ['user-too-large-default', 0, 3, 4, '20212223'],
  ['both-too-large', 234, 3, 6, ''],
  ['both-too-large-default', 0, 3, 4, 'd0d1d2d3'],
  ['user-only-too-large', 2, 0, 4, ''],
  ['user-only-too-large-default', 0, 0, 4, 'd0d1d2d3'],
  ['short-small-default', 0, 3, 1, 'd0'],
  ['missing-value', 2, 0, 16, ''],
  ['missing-value-default', 0, 0, 4, 'd0d1d2d3'],
  ['missing-key', 2, 0x12345678, 16, ''],
  ['default-cap0', 2, 0x12345678, 0, ''],
  ['default-cap2', 2, 0x12345678, 2, ''],
  ['default-cap4', 0, 0x12345678, 4, 'd0d1d2d3'],
  ['default-cap16', 0, 0x12345678, 4, 'd0d1d2d3'],
].map(([name, ret, type, size, prefix]) => ({ name, ret, type, size,
  last: 0x5a5aa55a, data: prefix + sentinel.slice(prefix.length) }));

function verify(text) {
  const lines = text.trim().split(/\r?\n/);
  assert.strictEqual(lines.shift(), 'SHREG_US_BEGIN version=c0000a04');
  assert.strictEqual(lines.pop(), 'SHREG_US_END');
  assert.strictEqual(lines.pop(), 'CLEANUP user=00000000 machine=00000000');
  const rows = lines.map(line => {
    const m = /^ROW ([\w-]+) ret=([\da-f]{8}) type=([\da-f]{8}) size=([\da-f]{8}) last=([\da-f]{8}) data=([\da-f]{32})$/.exec(line);
    assert(m, `malformed row: ${line}`);
    return { name: m[1], ret: parseInt(m[2], 16), type: parseInt(m[3], 16),
      size: parseInt(m[4], 16), last: parseInt(m[5], 16), data: m[6] };
  });
  assert.deepStrictEqual(rows, expected);
  return rows;
}
const first = fs.readFileSync(path.join(dir, 'serial.txt'), 'utf8');
const repeat = fs.readFileSync(path.join(dir, 'repeat-serial.txt'), 'utf8');
assert.strictEqual(first, repeat, 'two fresh VM observations agree (LF-normalized)');
assert.deepStrictEqual(verify(first), require('./fixtures/win98-shreg-us-value/observations.json'));
verify(repeat);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceHash = hash(fs.readFileSync(path.join(root, 'tools/v86-reference/probes/shreg-us-value.c')));
const captures = ['capture.json', 'repeat-capture.json'].map(name => JSON.parse(fs.readFileSync(path.join(dir, name))));
for (const capture of captures) {
  assert.strictEqual(capture.probeSourceSha256, sourceHash);
  assert.strictEqual(capture.serialNormalizedSha256, hash(first));
  assert.strictEqual(capture.app.id, 'shreg-us-value');
  assert.strictEqual(capture.app.launch, 'D:\\SHREGUS.EXE');
  assert.deepStrictEqual(capture.payload.map(p => p.name), ['SHREGUS.EXE']);
  assert.match(capture.payload[0].sha256, /^[\da-f]{64}$/);
}
assert.deepStrictEqual(captures[0].payload, captures[1].payload);
assert.notStrictEqual(captures[0].capturedAt, captures[1].capturedAt);
const manifest = require('../tools/v86-reference/shreg-us-apps.json').apps['shreg-us-value'];
assert.deepStrictEqual(manifest.files, [], 'capture requires an explicit companion-files list');
for (const corrupt of [
  first.replace('SHREG_US_END', ''),
  first.replace('ROW user-first', 'ROW ignore-user'),
  first.replace('data=10111213', 'data=20212223'),
  first.replace('size=00000006', 'size=00000008'),
  first.replace('last=5a5aa55a', 'last=00000000'),
  first.replace('CLEANUP user=00000000', 'CLEANUP user=00000002'),
]) assert.throws(() => verify(corrupt));
console.log('PASS native SHRegGetUSValueA fixture: 22 repeated observations, source provenance, six negative controls');
