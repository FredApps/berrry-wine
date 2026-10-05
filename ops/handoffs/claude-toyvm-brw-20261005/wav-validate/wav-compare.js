#!/usr/bin/env node
'use strict';
// Compare two PCM WAV files sample by sample: is a changed wav hash a few
// samples of render-instant jitter, or different audio? Pure JS, no emulator.
//
//   node wav-compare.js a.wav b.wav [--json]
//
// Reports: format, length of each, the common prefix that is byte-identical,
// the first differing sample (and its time), how many samples differ over the
// common length, the largest absolute difference, the RMS of the difference
// against the RMS of the signal, and how many separate differing runs there are
// (jitter at render boundaries shows up as many short runs of small amplitude;
// different content shows up as long runs or large differences).

const fs = require('fs');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a RIFF/WAVE file`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') data = b.subarray(off + 8, off + 8 + len);
    off += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data chunk`);
  if (fmt.format !== 1 || (fmt.bits !== 16 && fmt.bits !== 8)) throw new Error(`${file}: only 8/16-bit PCM is supported`);
  const n = fmt.bits === 16 ? data.length >> 1 : data.length;
  const s = new Int32Array(n);
  for (let i = 0; i < n; i++) s[i] = fmt.bits === 16 ? data.readInt16LE(i * 2) : (data[i] - 128) << 8;
  return { fmt, samples: s };
}

function compare(a, b) {
  if (a.fmt.rate !== b.fmt.rate || a.fmt.channels !== b.fmt.channels) {
    return { comparable: false, reason: `format differs: ${JSON.stringify(a.fmt)} vs ${JSON.stringify(b.fmt)}` };
  }
  const ch = a.fmt.channels, rate = a.fmt.rate;
  const n = Math.min(a.samples.length, b.samples.length);
  let first = -1, differing = 0, maxAbs = 0, sumD = 0, sumS = 0, runs = 0, inRun = false, longest = 0, cur = 0;
  for (let i = 0; i < n; i++) {
    const d = a.samples[i] - b.samples[i];
    sumS += a.samples[i] * a.samples[i];
    if (d !== 0) {
      if (first < 0) first = i;
      differing++; sumD += d * d;
      if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
      if (!inRun) { runs++; inRun = true; cur = 0; }
      cur++; if (cur > longest) longest = cur;
    } else inRun = false;
  }
  const frames = (i) => Math.floor(i / ch);
  return {
    comparable: true, rate, channels: ch,
    lengthA: frames(a.samples.length), lengthB: frames(b.samples.length),
    lengthDiffFrames: frames(b.samples.length) - frames(a.samples.length),
    identicalPrefixFrames: first < 0 ? frames(n) : frames(first),
    firstDiffSeconds: first < 0 ? null : +(frames(first) / rate).toFixed(6),
    differingSamples: differing, differingShare: n ? +(differing / n).toFixed(6) : 0,
    maxAbsDiff: maxAbs,
    rmsDiff: n ? +Math.sqrt(sumD / n).toFixed(3) : 0,
    rmsSignal: n ? +Math.sqrt(sumS / n).toFixed(3) : 0,
    differingRuns: runs, longestRunSamples: longest,
  };
}

if (require.main === module) {
  const [fa, fb] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!fa || !fb) { console.error('usage: node wav-compare.js a.wav b.wav [--json]'); process.exit(2); }
  const r = compare(readWav(fa), readWav(fb));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else for (const [k, v] of Object.entries(r)) console.log(`${k.padEnd(22)} ${v}`);
  process.exit(r.comparable ? 0 : 3);
}
module.exports = { readWav, compare };
