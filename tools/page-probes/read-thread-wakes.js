// Read back arm-thread-wakes.js: per guest thread, wakes/s, the Sleep
// durations it asked for, and how late it ran on the guest and wall clocks.
(function () {
  const s = window.__threadWakes;
  if (!s) return JSON.stringify({ error: 'not armed' });
  const pct = (xs, p) => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    return +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1);
  };
  const tm = window.wine.threadManager;
  const wallSec = (performance.now() - s.armedAt) / 1000;
  const guestSec = (tm._waitNow() - s.guestAt) / 1000;
  const out = {
    wallSec: +wallSec.toFixed(1),
    guestPerWall: +(guestSec / wallSec).toFixed(3),
    samplesPerSec: Math.round(s.samples / wallSec),
    error: s.error || null,
    runSlicesPerSec: +(s.runSlices / wallSec).toFixed(1),
    runSliceGapMs: { p50: pct(s.runSliceGapMs, 0.5), p90: pct(s.runSliceGapMs, 0.9), p99: pct(s.runSliceGapMs, 0.99) },
    stepsPerSec: +(s.stepGapMs.length / wallSec).toFixed(1),
    stepGapMs: { p10: pct(s.stepGapMs, 0.1), p50: pct(s.stepGapMs, 0.5), p90: pct(s.stepGapMs, 0.9), p99: pct(s.stepGapMs, 0.99) },
    inRunSlicePct: +(100 * s.inRunSliceMs / 1000 / wallSec).toFixed(1),
    guestFrozenMs: { n: s.frozenMs.length, p50: pct(s.frozenMs, 0.5), p90: pct(s.frozenMs, 0.9),
      p99: pct(s.frozenMs, 0.99), sumPct: +(100 * s.frozenMs.reduce((a, b) => a + b, 0) / 1000 / wallSec).toFixed(1) },
    threads: [],
    // Per running thread (0x0 = the main thread), calls per second.
    callsPerSec: Object.fromEntries(Object.entries(s.calls || {}).map(([w, c]) =>
      [w, Object.fromEntries(Object.entries(c).map(([k, n]) => [k, +(n / wallSec).toFixed(1)]))])),
  };
  for (const [h, r] of Object.entries(s.threads)) {
    if (!r.wakes) continue;
    out.threads.push({
      handle: '0x' + (+h >>> 0).toString(16), tid: r.tid,
      wakesPerSec: +(r.wakes / wallSec).toFixed(1), sleepMs: r.sleepMs,
      lateGuestMs: `${pct(r.lateGuest, 0.1)}/${pct(r.lateGuest, 0.5)}/${pct(r.lateGuest, 0.9)}/${pct(r.lateGuest, 0.99)}`,
      lateWallMs: `${pct(r.lateWall, 0.1)}/${pct(r.lateWall, 0.5)}/${pct(r.lateWall, 0.9)}/${pct(r.lateWall, 0.99)}`,
      perSecond: r.perSecond.slice(-12).map(b => b.n).join(' '),
    });
  }
  return JSON.stringify(out);
})();
