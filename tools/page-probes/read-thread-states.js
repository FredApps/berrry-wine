// Read back arm-thread-states.js: every thread-state transition as
// `ms:Tn:state@eip`, plus the final state of each thread.
(function () {
  const s = window.__threadStates;
  if (!s) return JSON.stringify({ error: 'not armed' });
  return JSON.stringify({
    secondsArmed: +((performance.now() - s.armedAt) / 1000).toFixed(1),
    samples: s.samples, dropped: s.dropped, error: s.error || null,
    final: s.last,
    clock: s.clock || [],
    changes: s.changes,
  });
})();
