// Control-channel probe: read back the threaded-handler / hot-block histogram
// from a LIVE `--control` run, with no restart and no browser.
//
//   node tools/ctl.js -s :PORT eval 'exports.reset_handler_hist(); exports.set_handler_hist_enabled(1)'
//   ...let the window you care about elapse...
//   jq -Rs '{action:"eval",code:.}' < tools/ctl-probes/read-handler-hist.js \
//     | node tools/ctl.js -s :PORT pipe
//
// This is the CLI twin of tools/page-probes/read-handler-hist.js. That one
// reaches the instance through `runningApps[0].wine`, which only exists in the
// page; run.js's controlEval hands its code (instance, exports, renderer,
// memory, g2w, tickState, ctx) instead, and -- because `new Function` bodies
// close over the GLOBAL scope, not run.js's module scope -- `moduleBases` is
// NOT reachable here. Block addresses therefore come back as raw hex; name
// them from the run's own DLL-load log, or feed them to tools/hist-blocks.js
// with bases supplied separately.
//
// Reading DISABLES the histogram, exactly as the page probe does, so a window
// is one arm/read pair and a second read of the same window is empty.
(function () {
  var e = exports;
  var m = new Uint32Array(memory.buffer);
  var hb = e.get_handler_hist_base() >>> 2;
  var slots = (e.get_handler_hist_slots ? e.get_handler_hist_slots() : e.get_handler_hist_count()) | 0;
  var H = [], tot = 0;
  for (var i = 0; i < slots; i++) { var h = m[hb + i] >>> 0; tot += h; if (h) H.push([i, h]); }
  H.sort(function (a, b) { return b[1] - a[1]; });
  var bb = e.get_hot_block_hist_base() >>> 2, bc = e.get_hot_block_hist_count() | 0;
  var B = [], bt = 0;
  for (var j = 0; j < bc; j++) {
    var ad = m[bb + j * 2] >>> 0, hh = m[bb + j * 2 + 1] >>> 0;
    if (ad && hh) { bt += hh; B.push([ad.toString(16), hh]); }
  }
  B.sort(function (a, b) { return b[1] - a[1]; });
  e.set_handler_hist_enabled(0);
  return JSON.stringify({ ops: tot, handlers: H.slice(0, 30),
    blockHits: bt, distinct: B.length, blocks: B.slice(0, 40) });
})()
