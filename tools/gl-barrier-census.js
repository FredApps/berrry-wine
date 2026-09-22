#!/usr/bin/env node
'use strict';
// Why does the OpenGL command stream flush? A preload for test/run.js that
// attributes every WAT->host submission to its cause.
//
//   node -r ./tools/gl-barrier-census.js test/run.js --app=quake2_demo \
//     --args='+set vid_ref gl +map demo1' --headless-gl --quiet-api \
//     --max-batches=100000000 --max-seconds=120
//
// WHY THIS EXISTS. src/09a8c-gl-encoder.wat:537-539 flushes the stream as soon
// as it has emitted a record whose opcode is a barrier, so the barrier op is
// always the LAST record in the batch that gets submitted. Any other flush is
// the 2 MB buffer filling up (:112, :234, :311) or an explicit encoder reset
// (:547). That makes the cause of every flush recoverable from the batch
// itself, which nothing else reports: tools/gl-stats-preload.js counts
// submissions but not why, and --host-census sees one import name for all of
// them because every GL call crosses as gpu_gl_call.
//
// WHAT IT IS FOR. Four of the barriers -- glGetError(12), glGetFloatv(13),
// glIsEnabled(65), glGetIntegerv(103) -- are STATE queries. They only force a
// round trip because GL's state lives in lib/gl-compat.js instead of in WAT.
// docs/gl-software-path-design.md argues that moving that state into WAT would
// delete those flushes, and flags the argument as structural and never counted.
// This counts it. The closing line reports the share of flushes those four
// opcodes cause, which is the upper bound on what the state lift can remove.
//
// Counts only, so the numbers are load-immune and safe on a busy box.
//
// Env: GL_CENSUS_EVERY_MS (default 0 = only print at exit).

const stream = require('../lib/gl-command-stream.js');
const hostImports = require('../lib/host-imports.js');
const { CALLS } = require('../lib/gl-compat.js');

const EVERY_MS = Number(process.env.GL_CENSUS_EVERY_MS || 0);
// The state queries the design doc claims a WAT-side state lift would absorb.
const STATE_QUERIES = new Set([12, 13, 65, 103]);

const flushCause = new Map();   // opcode (or -1 capacity/unknown) -> flushes
const opHistogram = new Map();  // opcode -> records seen
const totals = { flushes: 0, records: 0, bytes: 0, parseFailures: 0 };

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
// CALLS only covers the guest-visible gl*/wgl* ordinals. The encoder also
// emits its own internal opcodes, and PACKED_DRAW is the single most common
// record in any real workload -- left unnamed it reads as "<unknown 65536>"
// at the top of the histogram, which looks like a decoding failure.
const name = op => {
  if (op === -1) return '(no barrier: capacity/reset)';
  if (op === stream.PACKED_DRAW_OPCODE) return '(packed draw)';
  if (op === stream.WAT_STREAM_FLUSH_OPCODE) return '(stream flush)';
  return CALLS[op | 0] || `<unknown ${op}>`;
};

const createHostImports = hostImports.createHostImports;
hostImports.createHostImports = function (ctx, ...rest) {
  const imports = createHostImports.call(this, ctx, ...rest);
  const call = imports.host.gpu_gl_call;
  const FLUSH = stream.WAT_STREAM_FLUSH_OPCODE;
  imports.host.gpu_gl_call = function (opcode, stackWa, aux) {
    if ((opcode | 0) === FLUSH) {
      totals.flushes++;
      totals.bytes += aux >>> 0;
      // Read-only second parse of the same bytes, before the real replay.
      // A malformed batch is the replay's problem to report, not ours, so a
      // throw here is counted and swallowed rather than failing the run.
      try {
        let last = -1;
        stream.replay(stream.memoryBatch(ctx.getMemory(), stackWa, aux), op => {
          bump(opHistogram, op | 0);
          totals.records++;
          last = op | 0;
          return 0;
        });
        bump(flushCause, stream.BARRIERS.has(last) ? last : -1);
      } catch (error) {
        totals.parseFailures++;
      }
    }
    return call.apply(this, arguments);
  };
  return imports;
};

function report(label) {
  const causes = [...flushCause.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[gl-census] ${label} flushes=${totals.flushes}`
    + ` records=${totals.records} bytes=${totals.bytes}`
    + (totals.parseFailures ? ` parseFailures=${totals.parseFailures}` : ''));
  if (!totals.flushes) return;
  const share = n => `${(100 * n / totals.flushes).toFixed(1)}%`;
  for (const [op, count] of causes) {
    console.log(`  ${String(count).padStart(9)}  ${share(count).padStart(6)}`
      + `  ${op === -1 ? '' : `op ${String(op).padStart(3)} `}${name(op)}`);
  }
  let stateFlushes = 0;
  for (const [op, count] of causes) if (STATE_QUERIES.has(op)) stateFlushes += count;
  console.log(`  state-query flushes: ${stateFlushes} of ${totals.flushes}`
    + ` (${share(stateFlushes)}) -- the upper bound a WAT-side state lift`
    + ' could remove');
  const top = [...opHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`  top records: ${top.map(([op, n]) => `${name(op)}=${n}`).join(' ')}`);
}

globalThis.__glCensus = { flushCause, opHistogram, totals };

if (EVERY_MS > 0) {
  const timer = setInterval(() => report('interim'), EVERY_MS);
  timer.unref();
}
process.on('exit', () => report('whole-run'));
