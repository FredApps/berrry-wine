// Page probe: read back the series tools/page-probes/arm-memory-series.js
// collected, plus a first/last summary and a least-squares slope for the two
// numbers a leak would move.
//
// The slope is why this returns more than the raw rows: eyeballing a first and
// last sample cannot tell a leak from a run that allocated once during load
// and then held flat, and those are the two answers worth separating. Slopes
// are bytes per minute over the SECOND HALF of the run only -- app load is a
// legitimate one-time climb and including it reports a leak on every healthy
// run.
//
// Pass as --report-eval to tools/profile-web-frames.js. Feed the JSON to
// tools/memory-series.js to get a verdict and a plot.
(function () {
  var series = window.__memSeries || [];
  try { if (window.__memSeriesStop) window.__memSeriesStop(); } catch (_) {}

  function slopePerMin(rows, key) {
    if (rows.length < 3) return null;
    var n = rows.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
      var x = rows[i].t / 60000, y = rows[i][key];
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    var d = n * sxx - sx * sx;
    if (!d) return null;
    return Math.round((n * sxy - sx * sy) / d);
  }

  var half = series.slice(Math.floor(series.length / 2));
  var oom = window.__memOom || { count: 0, first: null, last: null, bytesMax: 0 };
  return JSON.stringify({
    armed: window.__memSeriesArmed || 0,
    // Allocation failures seen in this run. Zero here is a real negative, not
    // an untested assumption -- the counter wraps console.log from before page
    // load, and heap_oom_trace is never gated behind a flag.
    oom: oom,
    samples: series.length,
    first: series[0] || null,
    last: series[series.length - 1] || null,
    // Steady-state slopes: second half only, so one-time load allocation is
    // not reported as a leak.
    slopeSecondHalf: {
      fromMs: half.length ? half[0].t : 0,
      jsHeapBytesPerMin: slopePerMin(half, 'jsHeap'),
      wasmBytesPerMin: slopePerMin(half, 'wasmBytes'),
    },
    peakJsHeap: series.reduce(function (a, r) { return r.jsHeap > a ? r.jsHeap : a; }, 0),
    peakWasm: series.reduce(function (a, r) { return r.wasmBytes > a ? r.wasmBytes : a; }, 0),
    maxCanvases: series.reduce(function (a, r) { return r.canvases > a ? r.canvases : a; }, 0),
    series: series,
  });
})()
