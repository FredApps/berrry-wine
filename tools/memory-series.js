#!/usr/bin/env node
// Is a browser run leaking memory over time?
//
// `--host-census` and the perf HUD both answer "what is it doing"; neither
// answers "is it growing". This does, from the series
// tools/page-probes/arm-memory-series.js collects:
//
//   node tools/profile-web-frames.js --app=ID --seconds=N --headful \
//     --before-load="$(cat tools/page-probes/arm-memory-series.js)" \
//     --report-eval="$(cat tools/page-probes/read-memory-series.js)" \
//     --relay='memseries'
//   node tools/memory-series.js <json-file>
//
// Both probe flags take SOURCE, not a path -- hence the $(cat ...). The
// --relay is not redundant: --report-eval returns nothing when the page has
// died, which is the exact run a memory question is asked about, so the
// sampler also logs each row and the relay puts it in the run log. Recover a
// series from a killed run with tools/memory-series.js --from-log <run.log>.
//
// TWO THINGS IT EXISTS TO STOP YOU CONCLUDING:
//
// 1. "The run got OOM-killed, so we leak." The guest's linear memory is FIXED
//    at launch -- host.js creates it with initial === maximum, 512MB for every
//    app and up to 2GB for one that sets bigMemory in lib/apps.js -- so wasmMB
//    is a floor the run starts at, not something that grows. One tab still
//    costs ~1GB at a GC peak, which is enough to be OOM-killed on a loaded box
//    with nothing whatsoever wrong. Read the JS heap for leaks and the sparse
//    arena cursor for guest-space exhaustion; wasm size answers neither.
//
// 2. "First sample to last sample went up, so we leak." Every healthy run
//    allocates during app load. The verdict is computed on the SECOND HALF of
//    the samples only, where a healthy run is flat and a leak still climbs.
//
// A slope is only meaningful with enough samples on a long enough run, so a
// short series reports UNKNOWN rather than a number nobody should quote.
'use strict';

const fs = require('fs');

const MB = 1024 * 1024;
// Chrome's usedJSHeapSize is quantised and moves with GC timing, so a small
// positive slope is noise. Measured across healthy runs, steady-state drift
// stays inside a couple of MB/min; 8 is comfortably outside that.
const LEAK_MB_PER_MIN = 8;
const MIN_SAMPLES = 12;
const MIN_MINUTES = 3;

function mb(bytes) {
  if (bytes === null || bytes === undefined) return '   n/a';
  return (bytes / MB).toFixed(1).padStart(6);
}

// Rebuild the series from the relayed log lines of a run whose page died
// before --report-eval could return. The rows are the same shape, so every
// summary below works on them unchanged; the slopes are recomputed here
// because the read probe never got to run.
function fromLog(file) {
  const rows = [];
  // The pressure fields are optional so a log written by an older build of the
  // arm probe still parses -- a recovered series is usually the only copy.
  const re = /memseries (\d+) wasm=(\d+) js=(\d+) canvas=(\d+) apps=(\d+)/;
  const extra = /vtop=(\d+) bump=(-?\d+) sparse=(-?\d+) dibfree=(-?\d+) oom=(\d+)/;
  const oomLine = /\[heap\] OOM: (\d+) bytes/;
  let oom = { count: 0, first: null, last: null, bytesMax: 0 };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const om = oomLine.exec(line);
    if (om) {
      oom.count++;
      if (!oom.first) oom.first = line.trim();
      oom.last = line.trim();
      if (+om[1] > oom.bytesMax) oom.bytesMax = +om[1];
    }
    const m = re.exec(line);
    if (!m) continue;
    const row = { t: +m[1], wasmBytes: +m[2], jsHeap: +m[3], canvases: +m[4], apps: +m[5] };
    const x = extra.exec(line);
    if (x) {
      row.virtualTop = +x[1]; row.bumpFree = +x[2];
      row.sparseFree = +x[3]; row.dibFree = +x[4]; row.oom = +x[5];
    }
    rows.push(row);
  }
  const half = rows.slice(Math.floor(rows.length / 2));
  const slope = (list, key) => {
    if (list.length < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const r of list) {
      const x = r.t / 60000, y = r[key];
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const d = list.length * sxx - sx * sx;
    return d ? Math.round((list.length * sxy - sx * sy) / d) : null;
  };
  return {
    armed: rows.length ? 1 : 0,
    oom,
    samples: rows.length,
    first: rows[0] || null,
    last: rows[rows.length - 1] || null,
    slopeSecondHalf: {
      fromMs: half.length ? half[0].t : 0,
      jsHeapBytesPerMin: slope(half, 'jsHeap'),
      wasmBytesPerMin: slope(half, 'wasmBytes'),
    },
    peakJsHeap: rows.reduce((a, r) => (r.jsHeap > a ? r.jsHeap : a), 0),
    peakWasm: rows.reduce((a, r) => (r.wasmBytes > a ? r.wasmBytes : a), 0),
    maxCanvases: rows.reduce((a, r) => (r.canvases > a ? r.canvases : a), 0),
    series: rows,
  };
}

function main() {
  const args = process.argv.slice(2);
  const logArg = args.find(a => a.startsWith('--from-log'));
  if (logArg) {
    const path = logArg.includes('=') ? logArg.split('=')[1] : args[args.indexOf(logArg) + 1];
    if (!path) {
      console.error('usage: node tools/memory-series.js --from-log=<run.log>');
      process.exit(2);
    }
    return report(fromLog(path));
  }
  const file = args[0];
  if (!file) {
    console.error('usage: node tools/memory-series.js <series.json>');
    console.error('       node tools/memory-series.js --from-log=<run.log>');
    console.error('  the JSON is what tools/page-probes/read-memory-series.js returns;');
    console.error('  --from-log rebuilds it from relayed lines when the page died first');
    process.exit(2);
  }
  let raw = fs.readFileSync(file, 'utf8').trim();
  // profile-web-frames prints the report-eval result as a JSON string, so the
  // file may hold a quoted string rather than the object itself.
  let data = JSON.parse(raw);
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && data.report && typeof data.report === 'string') data = JSON.parse(data.report);
  return report(data);
}

function report(data) {
  const series = data.series || [];
  if (!data.armed) {
    console.error('memory series: NOT ARMED — the --before-load probe never ran.');
    process.exit(1);
  }
  const spanMin = series.length ? (series[series.length - 1].t - series[0].t) / 60000 : 0;

  console.log(`samples ${series.length}  span ${spanMin.toFixed(1)} min  ` +
    `max canvases ${data.maxCanvases}`);
  const hasPressure = series.some(r => r.virtualTop !== undefined);
  console.log('');
  console.log(hasPressure
    ? '      t(s)   wasmMB   jsHeapMB  canvases  apps   virtualTop  dibFree  oom'
    : '      t(s)   wasmMB   jsHeapMB  canvases  apps');
  const step = Math.max(1, Math.floor(series.length / 24));
  for (let i = 0; i < series.length; i += step) {
    const r = series[i];
    let line = `  ${String(Math.round(r.t / 1000)).padStart(6)}  ${mb(r.wasmBytes)}` +
      `    ${mb(r.jsHeap)}  ${String(r.canvases).padStart(8)}  ${String(r.apps).padStart(4)}`;
    if (hasPressure) {
      line += `   0x${(r.virtualTop >>> 0).toString(16).padStart(8, '0')}` +
        `  ${String(r.dibFree).padStart(7)}  ${String(r.oom).padStart(3)}`;
    }
    console.log(line);
  }
  console.log('');
  console.log(`peak wasm   ${mb(data.peakWasm)} MB`);
  console.log(`peak jsHeap ${mb(data.peakJsHeap)} MB`);

  // Allocation failures come first in the reading order, because an app that
  // is failing allocations has a cause for whatever else looks wrong, and no
  // amount of slope analysis matters next to one of these lines.
  const oom = data.oom || { count: 0 };
  console.log('');
  if (oom.count) {
    console.log(`ALLOCATION FAILURES: ${oom.count}  (largest request ` +
      `${(oom.bytesMax / MB).toFixed(1)} MB)`);
    if (oom.first) console.log(`  first  ${oom.first}`);
    if (oom.last && oom.last !== oom.first) console.log(`  last   ${oom.last}`);
    console.log('  A refused allocation returns NULL. A guest that checks it prints its own');
    console.log('  "out of memory"; one that does not stores it and corrupts a structure far');
    console.log('  from here — so treat any nonzero count as the prime suspect for unrelated-');
    console.log('  looking misbehaviour, not as a capacity footnote.');
  } else if (series.some(r => r.oom !== undefined)) {
    // Every row carries the page-side counter, which wraps console.log from
    // before page load. Zero here really is zero.
    console.log('allocation failures: 0 — verified by the in-page counter.');
  } else {
    // The rows predate the counter, so the only evidence would be relayed
    // [heap] OOM lines -- and a run whose --relay did not ask for them cannot
    // contain them. Absence here is absence of evidence, and saying "0" would
    // be reporting an untested assumption as a measurement.
    console.log('allocation failures: UNVERIFIED — these samples predate the in-page');
    console.log('  counter, so a failure would only appear if the run\'s --relay asked for');
    console.log('  "\\[heap\\] OOM". Re-run with the current probe before treating this as zero.');
  }

  if (hasPressure) {
    const tops = series.map(r => r.virtualTop >>> 0).filter(v => v);
    if (tops.length) {
      const hi = Math.max(...tops), lo = Math.min(...tops);
      console.log('');
      const start = tops[0], end = tops[tops.length - 1];
      let rises = 0;
      for (let i = 1; i < tops.length; i++) if (tops[i] > tops[i - 1]) rises++;
      console.log(`sparse arena cursor: start 0x${start.toString(16)}  ` +
        `low-water 0x${lo.toString(16)}  end 0x${end.toString(16)}`);
      console.log(`  peak excursion ${((hi - lo) / MB).toFixed(1)} MB, and it rose again ` +
        `${rises} of ${tops.length - 1} steps.`);
      console.log('  The cursor descends as the arena hands out guest address space and rises');
      console.log('  back when it is released, so the excursion is a HIGH-WATER MARK, not live');
      console.log('  usage — a run that reclaims is not accumulating. What matters for a ceiling');
      console.log('  decision is the low-water figure: how close the worst moment ever came.');
    }
  }

  const s = data.slopeSecondHalf || {};
  const jsPerMin = s.jsHeapBytesPerMin;
  const wasmPerMin = s.wasmBytesPerMin;
  console.log('');
  console.log(`steady-state slope (second half, from t=${Math.round((s.fromMs || 0) / 1000)}s):`);
  console.log(`  jsHeap ${jsPerMin === null || jsPerMin === undefined
    ? 'n/a' : (jsPerMin / MB).toFixed(2) + ' MB/min'}`);
  console.log(`  wasm   ${wasmPerMin === null || wasmPerMin === undefined
    ? 'n/a' : (wasmPerMin / MB).toFixed(2) + ' MB/min'}`);
  console.log('');

  if (series.length < MIN_SAMPLES || spanMin < MIN_MINUTES) {
    console.log(`VERDICT: UNKNOWN — need >=${MIN_SAMPLES} samples over >=${MIN_MINUTES} min ` +
      `to separate a slope from GC noise (got ${series.length} over ${spanMin.toFixed(1)} min).`);
    process.exit(0);
  }
  if (jsPerMin === null || jsPerMin === undefined) {
    console.log('VERDICT: UNKNOWN — no JS heap numbers. performance.memory is Chrome-only.');
    process.exit(0);
  }

  const jsMbMin = jsPerMin / MB;
  if (jsMbMin > LEAK_MB_PER_MIN) {
    console.log(`VERDICT: LEAKING — JS heap climbs ${jsMbMin.toFixed(1)} MB/min in steady state ` +
      `(threshold ${LEAK_MB_PER_MIN}).`);
    process.exit(1);
  }
  console.log(`VERDICT: NO JS LEAK — heap slope ${jsMbMin.toFixed(1)} MB/min is within ` +
    `the ${LEAK_MB_PER_MIN} MB/min noise band.`);
  if (wasmPerMin && wasmPerMin / MB > 1) {
    // Linear memory cannot grow (initial === maximum in host.js), so a nonzero
    // slope here is not the guest taking more RAM -- it means a SECOND app was
    // launched and the sampler switched instances. Check the apps column.
    console.log(`  NOTE: wasm size moved by ${(wasmPerMin / MB).toFixed(1)} MB/min, and it is ` +
      'fixed at launch — so this is a second instance, not growth. Check the apps column.');
  }
}

main();
