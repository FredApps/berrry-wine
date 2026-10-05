// Page probe: rates from tools/page-probes/arm-present-census.js over the
// last `window.__presentCensusWindowSec` seconds (default 10), so the
// profiler's warmup is not in the numbers. Also folds in the perf HUD's own
// snapshot (page fps, PRESENT/s, uploads/s when the build has it).
//
// Every rate here is a count or a sum of ms per wall second. The counts are
// load-immune -- uploads per guest present does not change with machine
// load -- which is why they lead; ms/s is a floor on a busy box.
(function () {
  const c = window.__presentCensus;
  if (!c) return JSON.stringify({ error: 'present census not armed' });
  const winSec = Number(window.__presentCensusWindowSec) || 10;
  c.series.push({
    t: performance.now() - c.armedAt,
    guestPresents: c.guestPresents, dxUploads: c.dxUploads, dxCalls: c.dxCalls,
    composites: c.composites, presentMs: c.dxMs + c.compositeMs,
  });
  const last = c.series[c.series.length - 1];
  let first = c.series[0];
  for (const s of c.series) if (last.t - s.t <= winSec * 1000) { first = s; break; }
  const sec = Math.max(0.001, (last.t - first.t) / 1000);
  const rate = k => +(((last[k] - first[k]) / sec).toFixed(2));
  const out = {
    windowSec: +sec.toFixed(2),
    guestPresentsPerSec: rate('guestPresents'),
    dxUploadsPerSec: rate('dxUploads'),
    dxCallsPerSec: rate('dxCalls'),
    compositesPerSec: rate('composites'),
    presentMsPerSec: rate('presentMs'),
  };
  const perf = window.WinePerf;
  if (perf && perf.snapshot) {
    const s = perf.snapshot();
    out.hud = {
      pageFps: +s.fps.toFixed(1), presentPerSec: +s.guestFps.toFixed(1),
      uploadsPerSec: s.uploadsPerSec != null ? +s.uploadsPerSec.toFixed(1) : null,
      phaseMs: s.phaseMs, steps: s.steps,
    };
  }
  return JSON.stringify(out);
})();
