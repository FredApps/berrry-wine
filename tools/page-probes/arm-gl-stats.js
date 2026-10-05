// Page probe: snapshot the OpenGL transport counters a while after launch, so
// tools/page-probes/read-gl-stats.js can report a gameplay window rather than
// the whole run. Pair them the same way as the handler-histogram probes:
//
//   node tools/profile-web-frames.js --app=simgolf_demo --headful \
//     --warmup=250 --seconds=20 \
//     --after-launch="window.__glStatsArmDelay=230000;$(cat tools/page-probes/arm-gl-stats.js)" \
//     --report-eval="$(cat tools/page-probes/read-gl-stats.js)"
//
// Encoding counters now live in WAT exports. Worker instances cannot be read
// from the page, so their guest-call counts are explicitly unavailable here.
// Executor counters include both cooperative and Worker submissions.
window.__glNativeStats = function () {
  var instances = new Set(), worker = false;
  (typeof runningApps !== 'undefined' ? runningApps : []).forEach(function (app) {
    var wine = app.wine, manager = wine && wine.threadManager;
    if (!wine) return;
    if (wine.instance) instances.add(wine.instance);
    if (manager && /worker/.test(manager.backend || '')) worker = true;
    if (manager && manager.threads) manager.threads.forEach(function (thread) {
      if (thread.instance) instances.add(thread.instance);
    });
  });
  if (worker) return null;
  var result = { calls: 0, spans: 0, vertices: 0, flushes: 0 };
  instances.forEach(function (instance) {
    var e = instance.exports;
    if (!e.gl_wat_stat_calls) return;
    result.calls += Number(e.gl_wat_stat_calls());
    result.spans += Number(e.gl_wat_stat_spans());
    result.vertices += Number(e.gl_wat_stat_vertices());
    result.flushes += Number(e.gl_wat_stat_flushes());
  });
  return result;
};
setTimeout(function () {
  try {
    var c = window.OpenGLCompat.stats;
    window.__glStatsArm = {
      at: performance.now(),
      stream: window.__glNativeStats(),
      compat: { enqueued: c.enqueued, draws: c.draws, drawVertices: c.drawVertices,
        presents: c.presents, frontFlushes: c.frontFlushes },
    };
  } catch (err) { window.__glStatsArmError = String(err); }
}, window.__glStatsArmDelay || 230000), 'gl stats armed';
