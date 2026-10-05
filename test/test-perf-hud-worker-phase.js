#!/usr/bin/env node
//
// The perf HUD's `workers` phase in WORKER mode must be the WALL time of the
// guest rendezvous, not the main guest worker's self-reported slice time.
//
// `other` is a residual -- lib/perf-hud.js computes it as
// total - main - workers - present -- so anything a step spends outside the
// marked regions lands there anonymously. The worker run loop parks on
// `await Promise.all([runMain(), runThreads()])` and then marked `workers` as
// `r.ms`, the value the MAIN guest worker reported for its own slice. Two
// things were wrong with that: an awaited call does block the step (it is an
// async function), and r.ms says nothing about the other guest threads, which
// is where most of the work is.
//
// Measured on a real iPhone running StarCraft, 69910 steps over 49s: 67.8% of
// wall clock was inside the awaited runWorkerSlices, only 3.3% of it
// synchronous. The HUD drew that as main 0% / workers ~0% / other 40-55% -- a
// fully busy machine reported as idle.
//
// Two halves are asserted here: that host.js measures the rendezvous rather
// than reading r.ms, and that perf-hud's residual really does absorb an
// under-marked phase (so the reasoning above is the mechanism, not a guess).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  console.log(`  ok   ${label}`);
  checks++;
};

console.log('perf HUD worker-phase attribution');

// ---- half one: what host.js actually marks ---------------------------------
const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
ok(/const bytes = await response\.arrayBuffer\(\);[\s\S]*?WebAssembly\.compile\(bytes\);[\s\S]*?recordWasmIdentity\(artifact, bytes\)/.test(hostSrc),
  'artifact identity hashes the bytes compiled by the page, not a second fetch');
ok(/recordWasmIdentity\('src\/main\.watx', built\.bytes\)/.test(hostSrc),
  'source-compiled fallback also reports its actual bytes');

// A fixed window rather than a brace match: the point is that these three
// things sit together in one region, and a brace-counting regex would be a
// second thing that can break.
const startAt = hostSrc.indexOf('const perfRendezvousStart = perf ? performance.now() : 0;');
ok(startAt > 0, 'the worker rendezvous is bracketed by a wall-clock timer');

const block = hostSrc.slice(startAt, startAt + 1200);
ok(/await Promise\.all\(\[runMain(?:ThenEnd)?\(\), runThreads\(\)\]\)/.test(block),
  'and the bracket encloses the Promise.all the step actually parks on');
ok(/finally \{[\s\S]*?perfRendezvousMs = performance\.now\(\) - perfRendezvousStart/.test(block),
  'the elapsed time is taken in a finally, so a trapped slice is still accounted');

ok(/perf\.mark\('workers', perfRendezvousMs\)/.test(hostSrc),
  "the 'workers' phase is marked with the rendezvous WALL time");
ok(!/perf\.mark\('workers', r\.ms/.test(hostSrc),
  "and never with r.ms, the main guest worker's self-reported slice time");

// The cooperative path was correct and must stay that way: its mark brackets a
// synchronous call, so re-deriving it from a promise would be wrong there.
ok(/const perfThreadStart = perf \? performance\.now\(\) : 0;/.test(hostSrc) &&
   /perf\.mark\('workers', performance\.now\(\) - perfThreadStart\)/.test(hostSrc),
  'the cooperative path still marks its own synchronous span, unchanged');

// ---- half two: the residual really does hide an under-marked phase ---------
// Drive the real PerfHud so the claim about `other` is demonstrated rather
// than asserted from reading.
const hudSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'perf-hud.js'), 'utf8');
ok((hudSrc.match(/wasmIdentity: global\.WINE_WASM_IDENTITY \|\| null/g) || []).length === 2,
  'perf batches and idle heartbeats include the selected WASM source and SHA-256');
const stubWindow = {
  addEventListener() {}, removeEventListener() {},
  performance: { now: () => stubWindow.__now },
  __now: 0,
  document: { createElement: () => ({ style: {}, getContext: () => null, appendChild() {} }),
              body: { appendChild() {} } },
};
stubWindow.window = stubWindow;
const sandbox = new Function('window', 'document', 'performance', 'requestAnimationFrame',
                             'PerformanceObserver', 'self',
  hudSrc + '\n;return window.WinePerf;');
const perf = sandbox(stubWindow, stubWindow.document, stubWindow.performance,
                     () => 0, undefined, stubWindow);
ok(!!perf && typeof perf.stepBegin === 'function', 'the real PerfHud loads outside a browser');
perf.enabled = true;

// One step: 20ms long, of which only 0.2ms is marked -- the exact shape the
// device reported.
const runStep = (totalMs, markedWorkersMs) => {
  stubWindow.__now += 1;
  perf.stepBegin();
  stubWindow.__now += totalMs;
  perf.mark('workers', markedWorkersMs);
  perf.stepEnd();
  return perf.steps[perf.steps.length - 1];
};

const underMarked = runStep(20, 0.2);
ok(Math.abs(underMarked.total - 20) < 1e-6, 'the step is measured end to end at 20ms');
ok(Math.abs(underMarked.other - 19.8) < 1e-6,
  'under-marking the phase by 19.8ms puts exactly 19.8ms into `other` -- ' +
  'the residual absorbs it silently, with no name on it');

const marked = runStep(20, 20);
ok(Math.abs(marked.workers - 20) < 1e-6, 'marking the true wall time attributes all 20ms');
ok(marked.other === 0, 'and `other` goes to zero -- nothing unexplained is left');

// A phase marked LARGER than the step must not produce a negative residual,
// because overlapping concurrent work is exactly what this loop has.
const over = runStep(5, 40);
ok(over.other === 0, 'an over-marked phase clamps the residual at zero rather than going negative');

// A phone profile needs the guest Worker's own fold counters, not the empty
// page-side WASM instance. This is one RPC per streaming tick, never per step.
let counterReads = 0;
stubWindow.wineShell = { runningApps: [{
  name: 'diablo_shareware',
  wine: { running: true, guestWorker: { readExports: names => {
    counterReads++;
    assert(names.includes('get_loop_xlat_stosb_runs'));
    return Promise.resolve({ get_loop_xlat_stosb_runs: 42 });
  } } },
}] };
perf.streamUrl = '/api/perf';
perf._sampleGuestCounters();
perf._sampleGuestCounters();
ok(counterReads === 1, 'concurrent stream ticks do not pile up Worker counter reads');
Promise.resolve().then(async () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  ok(perf._guestCounters.app === 'diablo_shareware' &&
     perf._guestCounters.values.get_loop_xlat_stosb_runs === 42,
  'the Worker fold count is retained for the next streamed batch');
  const memory = new ArrayBuffer(64);
  const hist = new Uint32Array(memory);
  let collisions = 0;
  const arms = [];
  stubWindow.location = { search: '?hot-blocks' };
  stubWindow.wineShell.runningApps[0].wine = {
    running: true, memory: { buffer: memory },
    guestWorker: {
      callExport: (name, flag) => { arms.push([name, flag]); return Promise.resolve(); },
      readExports: () => Promise.resolve({
        get_hot_block_hist_base: 0, get_hot_block_hist_count: 4,
        get_hot_block_hist_collisions: collisions,
      }),
    },
  };
  perf._sampleGuestCounters();
  await settle();
  ok(arms.length === 1 && arms[0][0] === 'set_handler_hist_enabled' && arms[0][1] === 1,
    'hot-block collection arms the guest Worker only with the opt-in query');
  hist[0] = 0x7a8bba; hist[1] = 10;
  perf._sampleGuestCounters();
  await settle(); // baseline
  hist[1] = 100;
  hist[2] = 0x441ab9; hist[3] = 3;
  collisions = 1;
  perf._sampleGuestCounters();
  await settle();
  ok(perf._hotBlocks.total === 93 && perf._hotBlocks.top[0].eip === 0x7a8bba &&
     perf._hotBlocks.top[0].hits === 90 && perf._hotBlocks.collisions === 1,
  'phone hot-block sample reports interval deltas, not accumulated startup hits');
  perf.stopStream();
  await settle();
  ok(arms.at(-1)[0] === 'set_handler_hist_enabled' && arms.at(-1)[1] === 0,
    'stopping the stream releases the opt-in histogram overhead');
  console.log(`\nPASS  ${checks}/${checks} checks passed`);
}).catch(error => { console.error(error); process.exitCode = 1; });
