// Preload for test/run.js: print the OpenGL transport counters while a
// --headless-gl run is going, without editing run.js.
//
//   node -r ./tools/gl-stats-preload.js test/run.js --app=simgolf_demo \
//     --headless-gl --quiet-api --max-batches=100000000 --max-seconds=240
//
// Every GL_STATS_EVERY_MS (default 10000) it prints one `[gl-stats]` line with
// the DELTA since the previous line, per frame, and once more at exit with the
// whole-run totals. A frame is one glFlush or SwapBuffers reaching the
// executor (frontFlushes + presents); SimGolf ends frames with glFlush.
//
// Renderer counters are module-level in lib/gl-compat.js,
// so they are the same objects run.js's host imports use:
// require() caches one instance per process. All values are counts, so they
// are load-immune. Columns:
//   calls    GL host-import crossings (one per batch)
//   batches  WAT command submissions
//   enq      packed spans handed to the executor
//   draws    WebGL draws actually issued (enq/draws = how well spans merge)
//   verts    vertices drawn
'use strict';

const stream = require('../lib/gl-command-stream.js');
const compat = require('../lib/gl-compat.js');
const hostImports = require('../lib/host-imports.js');
const crossings = { calls: 0, batches: 0, bytes: 0 };
const createHostImports = hostImports.createHostImports;
hostImports.createHostImports = function (...args) {
  const imports = createHostImports.apply(this, args);
  const call = imports.host.gpu_gl_call;
  imports.host.gpu_gl_call = function (opcode, stackWa, aux) {
    if ((opcode >= 0 && opcode < stream.ARG_WORDS.length)
        || opcode === stream.WAT_STREAM_FLUSH_OPCODE) crossings.calls++;
    if (opcode === stream.WAT_STREAM_FLUSH_OPCODE) {
      crossings.batches++;
      crossings.bytes += aux >>> 0;
    }
    return call.apply(this, arguments);
  };
  // Real Workers reach the main-thread broker endpoint directly, without
  // calling the main instance's gpu_gl_call import.
  const batch = imports.host.gpu_gl_batch;
  imports.host.gpu_gl_batch = function (commands, owner) {
    crossings.calls++;
    crossings.batches++;
    crossings.bytes += commands.bytes >>> 0;
    return batch.apply(this, arguments);
  };
  return imports;
};

const EVERY_MS = parseInt(process.env.GL_STATS_EVERY_MS || '10000', 10);
const snap = () => ({
  calls: crossings.calls,
  batches: crossings.batches, bytes: crossings.bytes,
  enq: compat.stats.enqueued, draws: compat.stats.draws,
  verts: compat.stats.drawVertices,
  frames: compat.stats.frontFlushes + compat.stats.presents,
});

const line = (label, now, then) => {
  const frames = now.frames - then.frames;
  const per = v => (frames ? (v / frames).toFixed(1) : '-');
  const d = k => now[k] - then[k];
  const merge = d('draws') ? (d('enq') / d('draws')).toFixed(2) : '-';
  console.log(`[gl-stats] ${label} frames=${frames} per-frame: calls=${per(d('calls'))}`
    + ` batches=${per(d('batches'))}`
    + ` bytes=${per(d('bytes'))} enq=${per(d('enq'))} draws=${per(d('draws'))}`
    + ` verts=${per(d('verts'))} spans/draw=${merge}`);
};

// Reachable from a --control session's `eval`, so a stepped/frozen run can
// snapshot the counters at exactly the moment it chooses:
//   node tools/ctl.js eval 'JSON.stringify(globalThis.__glStats.snap())'
globalThis.__glStats = { snap, stream, compat, crossings };

const start = snap();
let previous = start;
const began = Date.now();
const timer = setInterval(() => {
  const now = snap();
  line(`t=${Math.round((Date.now() - began) / 1000)}s`, now, previous);
  previous = now;
}, EVERY_MS);
timer.unref();
process.on('exit', () => line('whole-run', snap(), start));
