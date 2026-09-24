// Read back arm-rpc-census.js: blocking host imports served per second, the
// busiest names, and the gap between serves (how long a Worker can wait).
// Note: per-name counts include the page's own calls into the same host
// table; the serve count and gaps are Worker requests only.
(function () {
  const s = window.__rpcCensus;
  if (!s) return JSON.stringify({ error: 'not armed' });
  const pct = (xs, p) => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    return +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1);
  };
  const sec = (performance.now() - s.armedAt) / 1000;
  const top = Object.entries(s.calls).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, n]) => `${name}=${(n / sec).toFixed(1)}/s`);
  return JSON.stringify({
    sec: +sec.toFixed(1),
    servesPerSec: +(s.serves / sec).toFixed(1),
    servePct: +(100 * s.serveMs / 1000 / sec).toFixed(1),
    serveGapMs: { p50: pct(s.serveGapMs, 0.5), p90: pct(s.serveGapMs, 0.9), p99: pct(s.serveGapMs, 0.99) },
    top,
  });
})();
