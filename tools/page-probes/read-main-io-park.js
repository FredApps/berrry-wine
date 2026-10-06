// Read back arm-main-io-park.js: count and duration of main-thread lazy-read
// parks. A park that spans several polls is one the host kept stepping
// through (the fix); one poll per park with a long duration means the step
// itself was held for the fetch.
(function () {
  const s = window.__mainIoPark;
  if (!s) return JSON.stringify({ error: 'not armed' });
  const ms = s.parks.map(p => p.ms).sort((a, b) => a - b);
  const pct = p => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
  return JSON.stringify({
    secondsArmed: +((performance.now() - s.armedAt) / 1000).toFixed(1),
    parks: s.parks.length,
    parkedPolls: s.parkedPolls,
    stillOpen: !!s.open,
    totalParkMs: +ms.reduce((a, b) => a + b, 0).toFixed(1),
    parkMs: { p50: pct(0.5), p90: pct(0.9), max: pct(1) },
    longest: s.parks.slice().sort((a, b) => b.ms - a.ms).slice(0, 8),
  });
})();
