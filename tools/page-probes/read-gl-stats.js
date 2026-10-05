// Page probe: difference the OpenGL transport counters against the snapshot
// tools/page-probes/arm-gl-stats.js took, and report them per frame. A frame
// here is one glFlush or SwapBuffers reaching the executor (frontFlushes +
// presents) -- SimGolf ends frames with glFlush and never swaps.
(function () {
  var arm = window.__glStatsArm;
  if (!arm) return JSON.stringify({ error: window.__glStatsArmError || 'gl stats were never armed' });
  var s = window.__glNativeStats(), c = window.OpenGLCompat.stats;
  var d = function (now, then) { return now - then; };
  var frames = d(c.frontFlushes, arm.compat.frontFlushes) + d(c.presents, arm.compat.presents);
  var per = function (v) { return frames ? +(v / frames).toFixed(1) : null; };
  var nativeDelta = function (key) { return s && arm.stream ? d(s[key], arm.stream[key]) : null; };
  var nativePer = function (key) { var v = nativeDelta(key); return v === null ? null : per(v); };
  var calls = nativeDelta('calls'), spans = nativeDelta('spans');
  var enq = d(c.enqueued, arm.compat.enqueued), draws = d(c.draws, arm.compat.draws);
  return JSON.stringify({
    windowMs: Math.round(performance.now() - arm.at),
    frames: frames,
    perFrame: {
      guestGlCalls: nativePer('calls'), spans: nativePer('spans'),
      packedVertices: nativePer('vertices'),
      encoderFlushes: nativePer('flushes'),
      enqueuedSpans: per(enq), webglDraws: per(draws),
      drawVertices: per(d(c.drawVertices, arm.compat.drawVertices)),
    },
    totals: { calls: calls, spans: spans, enqueued: enq, draws: draws },
    spansPerDraw: draws ? +(enq / draws).toFixed(2) : null,
    nativeCountersAvailable: !!(s && arm.stream),
  });
})();
