// Page probe: start a memory time series for a browser run, so "is it leaking?"
// is answered by a slope instead of by an opinion.
//
// Pass as --before-load to tools/profile-web-frames.js and read it back with
// tools/page-probes/read-memory-series.js as --report-eval. It samples every
// SAMPLE_MS from the moment the page script runs, so the series covers app
// load as well as steady state -- a leak that only shows during load is
// invisible to a sampler armed after launch.
//
// WHAT IS SAMPLED AND WHY EACH ONE IS HERE:
//   wasmBytes  the guest's linear memory. FIXED at launch -- the import says
//              (memory 8192 32768 shared) but host.js creates it with
//              initial === maximum, so it never grows: 512MB, or as much as
//              2GB for an app with bigMemory set in lib/apps.js. It is here as the
//              denominator and to catch a second instance being launched, NOT
//              as a leak signal; virtualTop below is the exhaustion signal.
//   jsHeap     performance.memory.usedJSHeapSize. Chrome only, and it is
//              quantised and lags real allocation, so read the trend across
//              many samples and never a single delta.
//   canvases   document.querySelectorAll('canvas').length. A per-window
//              back-canvas that is never released shows up here long before
//              it shows up in the heap number, because the bitmap lives off
//              the JS heap.
//   apps       runningApps.length, to attribute a step change to a launch.
//
// runningApps is a MODULE-SCOPE binding in host.js, not a property of
// globalThis, so it can only be reached by bare name and only inside a
// try/catch -- referencing it before host.js has run is a ReferenceError that
// would kill the sampler on its first tick.
(function () {
  var SAMPLE_MS = 2000;
  var MAX_SAMPLES = 4000;
  var series = [];
  var t0 = 0;
  try { t0 = performance.now(); } catch (_) {}

  // ALLOCATION FAILURES. heap_oom_trace in lib/host-imports.js prints
  // "[heap] OOM: N bytes — reason" and is deliberately never gated behind a
  // flag, because a guest that does not check the returned NULL stores it and
  // corrupts a structure far from here. Counting the lines in the page makes
  // the failure part of the series instead of something you have to have
  // remembered to put in --relay; the relay stays useful for reading the
  // reasons, this makes their ABSENCE evidence rather than an untested
  // assumption.
  var oom = { count: 0, first: null, last: null, bytesMax: 0 };
  try {
    var realLog = console.log.bind(console);
    console.log = function () {
      try {
        var s = arguments.length === 1 ? arguments[0] : Array.prototype.join.call(arguments, ' ');
        if (typeof s === 'string' && s.indexOf('[heap] OOM') === 0) {
          oom.count++;
          if (!oom.first) oom.first = s;
          oom.last = s;
          var m = /OOM: (\d+) bytes/.exec(s);
          if (m && +m[1] > oom.bytesMax) oom.bytesMax = +m[1];
        }
      } catch (_) {}
      return realLog.apply(null, arguments);
    };
  } catch (_) {}
  window.__memOom = oom;

  function sample() {
    var row = { t: 0, wasmBytes: 0, jsHeap: 0, jsTotal: 0, canvases: 0, apps: 0,
      virtualTop: 0, bumpFree: 0, sparseFree: 0, dibFree: 0, dibTotal: 0, oom: 0 };
    try { row.t = Math.round(performance.now() - t0); } catch (_) {}
    try {
      var m = performance.memory;
      if (m) { row.jsHeap = m.usedJSHeapSize | 0; row.jsTotal = m.totalJSHeapSize | 0; }
    } catch (_) {}
    try { row.canvases = document.querySelectorAll('canvas').length; } catch (_) {}
    try {
      var apps = runningApps;
      row.apps = apps.length;
      var w = apps[0] && apps[0].wine;
      var mem = w && (w.memory || (w.instance && w.instance.exports && w.instance.exports.memory));
      if (mem && mem.buffer) row.wasmBytes = mem.buffer.byteLength;
      // PRESSURE, not just size. heap_oom_trace only fires once the allocation
      // has already failed; these say how close we are getting.
      //   virtualTop  guest-space top of the DOWNWARD-growing sparse
      //               VirtualAlloc arena, and the real exhaustion signal --
      //               B&W2 died with it at 0x164f0000. It is NOT monotonic:
      //               measured on WC3 it descends as space is handed out and
      //               rises again when it is released, so read its low-water
      //               mark, not its travel. A cursor that barely moves is
      //               nowhere near the ceiling.
      //   bumpFree    heap_end - heap_ptr, the per-INSTANCE bump chunk. It
      //               oscillates by design as chunks refill, so a small value
      //               here is normal and is NOT evidence of exhaustion --
      //               read virtualTop for that.
      //   dibFree     free pages in the DIB arena, which exhausts separately
      //               and reports separately (see project_printer_dc_dib_arena).
      var e = w && w.instance && w.instance.exports;
      if (e) {
        if (e.get_virtual_alloc_top) row.virtualTop = e.get_virtual_alloc_top() >>> 0;
        if (e.get_heap_ptr && e.get_heap_end) {
          row.bumpFree = (e.get_heap_end() >>> 0) - (e.get_heap_ptr() >>> 0);
        }
        if (e.get_heap_sparse_ptr && e.get_heap_sparse_end) {
          row.sparseFree = (e.get_heap_sparse_end() >>> 0) - (e.get_heap_sparse_ptr() >>> 0);
        }
        if (e.gdi_dib_arena_stat) {
          row.dibFree = e.gdi_dib_arena_stat(1) | 0;
          row.dibTotal = e.gdi_dib_arena_stat(3) | 0;
        }
      }
    } catch (_) {}
    row.oom = oom.count;
    if (series.length < MAX_SAMPLES) series.push(row);
    // Also print each row. --report-eval returns nothing when the page has
    // died, and a run that died of memory pressure is precisely the run this
    // probe was written for -- so the series has to survive in the run log
    // too. Pair with --relay='memseries'.
    try {
      console.log('memseries ' + row.t + ' wasm=' + row.wasmBytes +
        ' js=' + row.jsHeap + ' canvas=' + row.canvases + ' apps=' + row.apps +
        ' vtop=' + row.virtualTop + ' bump=' + row.bumpFree +
        ' sparse=' + row.sparseFree + ' dibfree=' + row.dibFree + ' oom=' + row.oom);
    } catch (_) {}
  }

  sample();
  var id = setInterval(sample, SAMPLE_MS);
  window.__memSeries = series;
  window.__memSeriesStop = function () { clearInterval(id); };
  window.__memSeriesArmed = 1;
})()
