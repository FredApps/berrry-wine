// Page probe: read back the histogram tools/page-probes/arm-handler-hist.js
// armed, disable it, and return everything tools/browser-handler-hist.js needs
// as one JSON string — per-handler counts, the hot-block table, the module
// bases that turn a block address into module+0xVA, and a WinePerf snapshot so
// one run carries both the profile and the frame numbers it belongs to.
// Only a COOPERATIVE run can use this: with --threads the guest main thread
// lives in a Worker and the page instance's counters stay at zero.
(function(){
  var w = runningApps[0].wine, e = w.instance.exports;
  var mem = w.memory || e.memory;
  var m = new Uint32Array(mem.buffer);
  var hb = e.get_handler_hist_base() >>> 2;
  var slots = (e.get_handler_hist_slots ? e.get_handler_hist_slots() : e.get_handler_hist_count()) | 0;
  var H = [], tot = 0;
  for (var i = 0; i < slots; i++) { var h = m[hb + i] >>> 0; tot += h; if (h) H.push([i, h]); }
  H.sort(function(a, b){ return b[1] - a[1]; });
  var bb = e.get_hot_block_hist_base() >>> 2, bc = e.get_hot_block_hist_count() | 0;
  var B = [], bt = 0;
  for (var j = 0; j < bc; j++) {
    var ad = m[bb + j * 2] >>> 0, hh = m[bb + j * 2 + 1] >>> 0;
    if (ad && hh) { bt += hh; B.push([ad.toString(16), hh]); }
  }
  B.sort(function(a, b){ return b[1] - a[1]; });
  e.set_handler_hist_enabled(0);
  var mods = {};
  var mb = w.moduleBases || {};
  for (var k in mb) { mods[k] = [(mb[k].base || mb[k].loadAddr || 0), (mb[k].origBase || 0)]; }
  var perf = null;
  try { perf = window.WinePerf && window.WinePerf.snapshot ? window.WinePerf.snapshot() : null; } catch (_) {}
  // snapshot().guestFps is a rolling 2000ms rate -- at a couple of presents a
  // second that is a five-sample estimate, far too thin to divide into a
  // 20-second block count. The ring of raw present timestamps is the real
  // measurement, so hand it over and let the host pick the window.
  var frames = null, nowMs = 0;
  try {
    nowMs = performance.now();
    if (window.WinePerf && window.WinePerf.guestFrames) frames = window.WinePerf.guestFrames.slice();
  } catch (_) {}
  // armSnap + perf bracket the histogram window: every count below was taken
  // between them, so presents and wall time for THIS window are the two
  // differences, not the cumulative figures in either snapshot alone.
  // Decode-time folds: did the grammar ever match, and did the executor ever
  // run? A profile that only shows hot blocks cannot tell "the fold is broken"
  // from "the fold is fine and this scene does not use that loop" -- these
  // three counters separate them. Guarded per name so an older build, or a
  // build without a given fold, still reports everything else.
  var folds = {};
  ['rle_run_matches', 'lut_span_matches'].forEach(function (k) {
    try { if (e['get_' + k]) folds[k] = String(e['get_' + k]()); } catch (_) {}
  });
  return JSON.stringify({ perf: perf, armSnap: window.__histArmSnap || null,
    folds: folds,
    presentTimes: frames, nowMs: nowMs, armPerfMs: window.__histArmPerfMs || 0,
    err: window.__histErr || null, armed: window.__histArmed || 0,
    ops: tot, handlers: H.slice(0, 30), blockHits: bt, distinct: B.length,
    blocks: B.slice(0, 40), mods: mods });
})()
