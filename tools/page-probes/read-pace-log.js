// Read back arm-pace-log.js as one JSON string for tools/pace-intervals.js.
// Times are performance.now() ms rounded to 0.01; paced entries are
// [wallMs, waitMs, guestMs].
(function () {
  const perf = window.WinePerf;
  const log = perf && perf.paceLog;
  if (!log) return JSON.stringify({ error: 'pace log not armed' });
  const r2 = x => Math.round(x * 100) / 100;
  const q = new URLSearchParams(location.search);
  return JSON.stringify({
    presentCap: q.get('present-cap'), presentPace: q.get('present-pace') || 'smooth (default or app field)',
    startedAt: r2(log.startedAt), endedAt: r2(performance.now()),
    wakeHook: log.wakeHook || null,
    paced: log.paced.map(([t, w, g]) => [r2(t), w, g]),
    present: log.present.map(r2),
    raf: log.raf.map(r2),
    wakes: (log.wakes || []).map(r2),
  });
})();
