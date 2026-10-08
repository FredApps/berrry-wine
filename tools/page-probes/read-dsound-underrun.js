// Read back arm-dsound-underrun.js: per looping DirectSound ring, how much of
// the audible audio the cursor played was fresh vs a stale replay, and how
// the guest's refresh cadence compares with the ring's length.
(function () {
  const s = window.__dsUnderrun;
  if (!s) return JSON.stringify({ error: 'not armed' });
  const pct = (xs, p) => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    return +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2);
  };
  const ac = window.wine && window.wine.hostCtx && window.wine.hostCtx._voices &&
    window.wine.hostCtx._voices._ac;
  const out = {
    secondsArmed: +((performance.now() - s.armedAt) / 1000).toFixed(1),
    audioContext: ac ? ac.state : 'none',
    error: s.error || null,
    rings: [],
  };
  // `?audio-delay=MS`: the ring is not what sounds, its queued writes are.
  // Underruns/gapMs there replace the stale-cell numbers below.
  const voiceMap = window.wine.hostCtx._voices._map || {};
  const since = s.delayBaseline || {};
  out.delayQueues = [];
  for (const [id, v] of Object.entries(voiceMap)) {
    if (!v || !v.delayQ) continue;
    const st = v.delayQ.stats, b = since[id] || { chunks: 0, underruns: 0, gapMs: 0, skips: 0, lead: 0 };
    const lead = st.leadMs.slice(b.lead);
    out.delayQueues.push({
      voice: '0x' + (+id >>> 0).toString(16), delayMs: st.delayMs,
      chunks: st.chunks - b.chunks, underruns: st.underruns - b.underruns,
      gapMs: +(st.gapMs - b.gapMs).toFixed(1), skips: st.skips - b.skips,
      leadMs: { p1: pct(lead, 0.01), p10: pct(lead, 0.1), p50: pct(lead, 0.5), p99: pct(lead, 0.99) },
    });
  }
  for (const r of Object.values(s.rings)) {
    const audible = r.fresh + r.staleAudible;
    out.rings.push({
      voice: '0x' + (r.id >>> 0).toString(16),
      ringBytes: r.len,
      lapMs: +r.lapMs.toFixed(1),
      refreshes: r.refreshes,
      // Of those, seen by diffing a worklet-routed ring from the timer.
      polledRefreshes: r.polledRefreshes | 0,
      refreshGapMs: { p50: pct(r.refreshGaps, 0.5), p90: pct(r.refreshGaps, 0.9),
        p99: pct(r.refreshGaps, 0.99), max: pct(r.refreshGaps, 1) },
      sampleGapMs: { p50: pct(r.sampleGaps, 0.5), p99: pct(r.sampleGaps, 0.99),
        max: pct(r.sampleGaps, 1) },
      cellsCrossed: r.crossed,
      fresh: r.fresh,
      staleAudible: r.staleAudible,
      staleSilent: r.staleSilent,
      staleQuiet: r.staleQuiet,
      staleAudiblePct: audible ? +(100 * r.staleAudible / audible).toFixed(2) : null,
      tornWrites: r.torn,
      writeLeadCells: r.leadHist,
      writeSpanCells: r.spanHist,
      emptyRefreshes: r.emptyRefreshes,
      routedToWorklet: r.routed,
      guestFallbacks: r.guestFallbacks,
      guestMinusAudibleMs: { p1: pct(r.drift, 0.01), p50: pct(r.drift, 0.5), p99: pct(r.drift, 0.99) },
      backJumps: r.backJumps,
      backMaxBytes: r.backMaxBytes,
      blindGaps: r.blindGaps,
      blindGapMaxMs: +r.blindGapMaxMs.toFixed(1),
      perSecond: r.perSecond.map(b => `${b.s}s:${b.fresh}/${b.stale}/${b.refreshes}`).join(' '),
    });
  }
  return JSON.stringify(out, null, 1);
})();
