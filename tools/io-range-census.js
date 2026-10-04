#!/usr/bin/env node
'use strict';

// Which byte ranges of a file did a run actually read, in which phase, and
// which of those reads could NOT have parked on a lazy (HTTP-range) mount?
//
//   node test/run.js --app=ID --trace-fs ... > run.log
//   node tools/io-range-census.js run.log --path=spawn.mpq \
//     [--split=B1,B2,...] [--chunk=262144] [--mpq=FILE] [--emit=ranges.json] [--json]
//
// Input is run.js's `--trace-fs` ReadFile line, which carries the thread and,
// via ctx.ioTraceTag, the batch and the MAIN thread's synchronous-message
// depth at the moment of the read:
//
//   [FS] ReadFile(h=0x.., buf=0x.., n=0x200, read=0x200, pos=0x0, path=c:\spawn.mpq) tid=1 b=812 mainDepth=1
//
// A read made while mainDepth > 0 happened inside a recursive $wnd_send_message
// frame (by main itself, or by a worker the cooperative scheduler ran inline
// from that frame's nested wait). Such a read cannot wait for a network fetch:
// the frame cannot return to the host event loop, so a miss there becomes
// WAIT_FAILED / an abandoned wndproc / Storm's silent ERROR_HANDLE_EOF. Those
// ranges are what a lazy mount must have resident before the guest starts.
//
// --split cuts the run into phases at those batch numbers (e.g. menu, gameplay).
// --mpq labels every range with the MPQ block(s) it falls in and widens the
// unsafe set to whole blocks (a dialog that reads part of an art file reads all
// of it on the next visit, possibly from another offset into the same block).
// --emit writes the unsafe set as {path,size,chunkSize,ranges,blocks} JSON.

const fs = require('fs');

const LINE = /\[FS\] ReadFile\(h=0x[0-9a-f]+, buf=0x[0-9a-f]+, n=0x([0-9a-f]+), read=0x([0-9a-f]+), pos=0x([0-9a-f]+), path=([^)]*)\)(.*)$/i;

function parseLine(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const tail = m[5] || '';
  const num = (key) => {
    const t = new RegExp(`\\b${key}=(-?\\d+)`).exec(tail);
    return t ? Number(t[1]) : null;
  };
  return {
    asked: parseInt(m[1], 16),
    read: parseInt(m[2], 16),
    pos: parseInt(m[3], 16),
    path: m[4],
    tid: num('tid'),
    batch: num('b'),
    mainDepth: num('mainDepth'),
  };
}

// Sorted, coalesced [start, end) list. Touching ranges merge.
function mergeRanges(ranges) {
  const sorted = ranges.filter(r => r[1] > r[0]).map(r => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

function rangeBytes(ranges) {
  return ranges.reduce((sum, r) => sum + (r[1] - r[0]), 0);
}

function chunkSet(ranges, chunkSize) {
  const set = new Set();
  for (const [start, end] of ranges) {
    for (let i = Math.floor(start / chunkSize); i <= Math.floor((end - 1) / chunkSize); i++) set.add(i);
  }
  return set;
}

function phaseOf(batch, splits) {
  if (batch === null || batch === undefined) return 0;
  let p = 0;
  while (p < splits.length && batch >= splits[p]) p++;
  return p;
}

// Summarise the reads of one file. `reads` are parseLine results.
function census(reads, opts = {}) {
  const splits = (opts.splits || []).slice().sort((a, b) => a - b);
  const chunkSize = opts.chunkSize || 256 * 1024;
  const phases = [];
  for (let p = 0; p <= splits.length; p++) {
    phases.push({
      phase: p,
      fromBatch: p ? splits[p - 1] : 0,
      toBatch: p < splits.length ? splits[p] : null,
      reads: 0, bytes: 0, ranges: [], unsafeReads: 0, unsafeRanges: [], tids: {},
    });
  }
  for (const r of reads) {
    if (!r.read) continue;
    const ph = phases[phaseOf(r.batch, splits)];
    const range = [r.pos, r.pos + r.read];
    ph.reads++;
    ph.bytes += r.read;
    ph.ranges.push(range);
    ph.tids[r.tid] = (ph.tids[r.tid] || 0) + 1;
    if ((r.mainDepth | 0) > 0) {
      ph.unsafeReads++;
      ph.unsafeRanges.push(range);
    }
  }
  const all = [], allUnsafe = [];
  for (const ph of phases) {
    ph.ranges = mergeRanges(ph.ranges);
    ph.unsafeRanges = mergeRanges(ph.unsafeRanges);
    ph.uniqueBytes = rangeBytes(ph.ranges);
    ph.unsafeBytes = rangeBytes(ph.unsafeRanges);
    ph.chunks = chunkSet(ph.ranges, chunkSize).size;
    ph.unsafeChunks = chunkSet(ph.unsafeRanges, chunkSize).size;
    all.push(...ph.ranges);
    allUnsafe.push(...ph.unsafeRanges);
  }
  const ranges = mergeRanges(all);
  const unsafeRanges = mergeRanges(allUnsafe);
  return {
    chunkSize,
    phases,
    ranges,
    uniqueBytes: rangeBytes(ranges),
    chunks: chunkSet(ranges, chunkSize).size,
    unsafeRanges,
    unsafeBytes: rangeBytes(unsafeRanges),
    unsafeChunks: chunkSet(unsafeRanges, chunkSize).size,
  };
}

// Map ranges onto MPQ blocks (absolute file offsets). Returns the touched
// blocks and the ranges widened to whole blocks, plus the archive's own
// header/hash/block tables, which every open reads.
function widenToMpqBlocks(ranges, archive) {
  const base = archive.base;
  const blocks = archive.blocks
    .filter(b => b.cSize > 0)
    .map(b => ({ index: b.index, start: base + b.filePos, end: base + b.filePos + b.cSize }))
    .sort((a, b) => a.start - b.start);
  const touched = new Map();
  for (const [start, end] of ranges) {
    for (const b of blocks) {
      if (b.start >= end) break;
      if (b.end > start) touched.set(b.index, b);
    }
  }
  const tables = [
    [base, base + archive.headerSize],
    [base + archive.hashTablePos, base + archive.hashTablePos + archive.hashTableSize * 16],
    [base + archive.blockTablePos, base + archive.blockTablePos + archive.blockTableSize * 16],
  ];
  const widened = mergeRanges([...ranges, ...tables, ...[...touched.values()].map(b => [b.start, b.end])]);
  return { blocks: [...touched.keys()].sort((a, b) => a - b), ranges: widened };
}

function fmtMB(n) { return (n / 1048576).toFixed(2) + ' MB'; }

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
  };
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node tools/io-range-census.js <run.log> --path=SUBSTR [--split=B1,B2] ' +
      '[--chunk=N] [--mpq=FILE] [--emit=out.json] [--json]');
    process.exit(2);
  }
  const want = (arg('path') || '').toLowerCase();
  const splits = (arg('split') || '').split(',').filter(Boolean).map(Number);
  const chunkSize = Number(arg('chunk')) || 256 * 1024;
  const reads = [];
  let untagged = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const r = parseLine(line);
    if (!r || (want && !r.path.toLowerCase().includes(want))) continue;
    if (r.mainDepth === null) untagged++;
    reads.push(r);
  }
  const result = census(reads, { splits, chunkSize });
  result.path = want || null;
  result.reads = reads.length;
  result.untaggedReads = untagged;
  const mpqPath = arg('mpq');
  if (mpqPath) {
    const { openArchive } = require('./mpq');
    const archive = openArchive(mpqPath);
    result.fileSize = archive.buf.length;
    result.allBlocks = widenToMpqBlocks(result.ranges, archive);
    result.unsafeBlocks = widenToMpqBlocks(result.unsafeRanges, archive);
  }
  const emit = arg('emit');
  if (emit) {
    const src = result.unsafeBlocks || { ranges: result.unsafeRanges, blocks: null };
    fs.writeFileSync(emit, JSON.stringify({
      schemaVersion: 1,
      path: want,
      size: result.fileSize || null,
      chunkSize,
      why: 'ranges read while the main thread was inside a synchronous message (mainDepth>0); ' +
        'such reads cannot park on a lazy mount',
      source: file.replace(/^.*\//, ''),
      blocks: src.blocks,
      ranges: src.ranges,
    }, null, 1) + '\n');
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 1));
    return;
  }
  console.log(`${reads.length} reads of "${want || '*'}"${untagged ? ` (${untagged} without ioTraceTag: mainDepth unknown)` : ''}`);
  for (const ph of result.phases) {
    console.log(`phase ${ph.phase} [b${ph.fromBatch}..${ph.toBatch === null ? 'end' : 'b' + ph.toBatch}): ` +
      `${ph.reads} reads, ${fmtMB(ph.bytes)} read, ${fmtMB(ph.uniqueBytes)} unique in ${ph.ranges.length} ranges / ${ph.chunks} chunks; ` +
      `non-parkable ${ph.unsafeReads} reads, ${fmtMB(ph.unsafeBytes)} / ${ph.unsafeChunks} chunks; tids ${JSON.stringify(ph.tids)}`);
  }
  console.log(`total unique ${fmtMB(result.uniqueBytes)} (${result.chunks} chunks of ${chunkSize}); ` +
    `non-parkable ${fmtMB(result.unsafeBytes)} (${result.unsafeChunks} chunks)`);
  if (result.unsafeBlocks) {
    console.log(`non-parkable widened to MPQ blocks: ${result.unsafeBlocks.blocks.length} blocks, ` +
      `${fmtMB(rangeBytes(result.unsafeBlocks.ranges))} in ${result.unsafeBlocks.ranges.length} ranges ` +
      `(${chunkSet(result.unsafeBlocks.ranges, chunkSize).size} chunks) of ${fmtMB(result.fileSize)}`);
  }
}

if (require.main === module) main();

module.exports = { parseLine, mergeRanges, rangeBytes, chunkSet, census, widenToMpqBlocks };
