#!/usr/bin/env node
'use strict';
// Unit tests for wav-compare.js on synthetic WAV files (no emulator).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWav, compare } = require('./wav-compare');

const dir = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'wavcmp-'));
function wav(file, samples, rate = 22050, channels = 1) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}
const tone = (n, f = 0) => Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin((i + f) / 7)));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok   ${name}`); };

t('identical files', () => {
  const r = compare(readWav(wav(path.join(dir, 'a.wav'), tone(2205))), readWav(wav(path.join(dir, 'b.wav'), tone(2205))));
  assert.strictEqual(r.differingSamples, 0); assert.strictEqual(r.firstDiffSeconds, null); assert.strictEqual(r.identicalPrefixFrames, 2205);
});
t('a longer render is a length difference, not a content difference', () => {
  const r = compare(readWav(wav(path.join(dir, 'c.wav'), tone(2205))), readWav(wav(path.join(dir, 'd.wav'), tone(2300))));
  assert.strictEqual(r.differingSamples, 0); assert.strictEqual(r.lengthDiffFrames, 95);
});
t('a one-sample jitter shows a small first-difference time and short runs', () => {
  const a = tone(22050), b = a.slice(); b[11025] += 3;
  const r = compare(readWav(wav(path.join(dir, 'e.wav'), a)), readWav(wav(path.join(dir, 'f.wav'), b)));
  assert.strictEqual(r.differingSamples, 1); assert.strictEqual(r.firstDiffSeconds, 0.5); assert.strictEqual(r.maxAbsDiff, 3); assert.strictEqual(r.longestRunSamples, 1);
});
t('shifted content is a long run with a large difference', () => {
  const r = compare(readWav(wav(path.join(dir, 'g.wav'), tone(22050))), readWav(wav(path.join(dir, 'h.wav'), tone(22050, 3))));
  assert.ok(r.differingShare > 0.9); assert.ok(r.longestRunSamples > 1000); assert.ok(r.maxAbsDiff > 1000);
});
t('a sample-rate mismatch is reported as not comparable', () => {
  const r = compare(readWav(wav(path.join(dir, 'i.wav'), tone(100), 22050)), readWav(wav(path.join(dir, 'j.wav'), tone(100), 44100)));
  assert.strictEqual(r.comparable, false);
});
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${n}/5 passed`);
