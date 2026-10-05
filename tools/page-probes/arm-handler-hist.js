// Page probe: arm the emulator's threaded-handler / hot-block histogram inside
// the BROWSER, a while after launch, so the window covers gameplay rather than
// startup. Pair with tools/page-probes/read-handler-hist.js and feed the JSON
// it returns to tools/browser-handler-hist.js.
//
//   node tools/profile-web-frames.js --app=ID --headful --warmup=240 --seconds=20 \
//     --after-launch="$(cat tools/page-probes/arm-handler-hist.js)" \
//     --report-eval="$(cat tools/page-probes/read-handler-hist.js)"
//
// The delay is measured from --after-launch, which runs once the instance is
// up; set window.__histArmDelay before this (or edit the literal) to move it.
// It must land INSIDE the profiler's warmup so the read at the end of the
// sample still sees a live window. --after-launch evaluates this with
// String(eval(js)), hence the trailing comma expression rather than a return.
setTimeout(function () {
  try {
    var e = runningApps[0].wine.instance.exports;
    e.reset_handler_hist();
    e.set_handler_hist_enabled(1);
    window.__histArmed = Date.now();
    // Same clock the present-timestamp ring uses, so the reader can count
    // exactly the presents that fall inside the histogram window.
    try { window.__histArmPerfMs = performance.now(); } catch (_) {}
    // Snapshot the frame counters at the SAME instant the histogram starts, so
    // the reader can difference them. WinePerf.snapshot() is cumulative over
    // the whole run -- its fps covers the loader too, and dividing lifetime
    // presents into a 20-second histogram window is how you talk yourself into
    // a pixels-per-frame figure that is off by the length of the warmup.
    try { window.__histArmSnap = window.WinePerf.snapshot(); } catch (_) {}
  } catch (err) { window.__histErr = String(err); }
// Explicitly null-checked, not `||`: an agent stepping a FROZEN session wants
// to arm the window right now and sets this to 0, and `0 || 230000` silently
// armed it three and a half minutes later, so every window read back ops=0.
}, window.__histArmDelay != null ? window.__histArmDelay : 230000), 'hist-arm-scheduled'
