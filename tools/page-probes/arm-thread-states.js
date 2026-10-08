// What is every guest thread doing, over time? The page twin of test/run.js
// --trace-sched, for either backend: samples window.wine.threadManager every
// 50ms and records one entry per thread each time its state changes
// (state, last yield reason, wait handle, EIP, critical section it waits on).
//
// Reach for it when a periodic guest thread (a DirectSound mixer) goes quiet
// for seconds in the browser: pair with arm-dsound-underrun.js, whose
// perSecond refresh counts say WHEN the ring stopped being refilled, and read
// what the mixer thread was parked on at that moment.
//
// Read back with read-thread-states.js; disarm with window.__threadStates.disarm().
(function () {
  if (window.__threadStates) return 'already armed';
  const tm = window.wine && window.wine.threadManager;
  if (!tm || !tm.threads) return 'no threadManager on this page';
  const now = () => performance.now();
  const hex = v => '0x' + ((v >>> 0).toString(16));
  const state = { armedAt: now(), samples: 0, last: {}, changes: [], dropped: 0 };
  const describe = t => {
    const yr = t.lastYield | 0;
    const e = t.instance && t.instance.exports;
    const eip = e && e.get_eip ? e.get_eip() : (t.lastEip || 0);
    const st = t.state !== 'active' ? t.state
      : t.suspendCount > 0 ? 'susp'
      : t.csWaitAddr ? `cs(${hex(t.csWaitAddr)} by T${t.csWaitOwner | 0})`
      : yr === 1 ? `wait(${hex(e && e.get_wait_handle ? e.get_wait_handle() : 0)})`
      : yr === 2 ? 'exited'
      : yr === 7 ? 'msgwait'
      : yr === 9 ? 'cs'
      : yr === 12 ? 'io'
      : (t.sleepUntil && Date.now() < t.sleepUntil) ? 'sleep'
      : t.inFlight ? 'run' : 'idle';
    return { st, eip: hex(eip), slices: t.workerSlices | 0 };
  };
  // Once a second: how far the scheduler's guest clock (the one wait
  // timeouts are judged against) moved against the wall, and each thread's
  // open wait (started at, polls so far). A timed wait cannot expire on a
  // clock that stands still, which reads as a thread "waiting" forever.
  state.clock = [];
  let lastBeat = null;
  const guestNow = () => { try { return tm._waitNow ? tm._waitNow() : null; } catch (_) { return null; } };
  const timer = setInterval(() => {
    state.samples++;
    const t = +(now() - state.armedAt).toFixed(0);
    if (lastBeat === null || t - lastBeat.t >= 1000) {
      const g = guestNow();
      const beat = { t, g };
      if (lastBeat && g !== null && lastBeat.g !== null && state.clock.length < 600) {
        const waits = [];
        for (const [, th] of tm.threads) {
          if (th.waitStartedAt) waits.push(`T${th.tid}:${Math.round(g - th.waitStartedAt)}ms/${th.waitPolls | 0}p`);
        }
        state.clock.push(`${t}:+${Math.round(g - lastBeat.g)}g/${t - lastBeat.t}w${waits.length ? ' ' + waits.join(',') : ''}`);
      }
      lastBeat = beat;
    }
    for (const [, th] of tm.threads) {
      let d;
      try { d = describe(th); } catch (e) { state.error = String(e && e.stack || e); continue; }
      const key = 'T' + th.tid;
      const prev = state.last[key];
      if (prev && prev.st === d.st) { prev.eip = d.eip; prev.slices = d.slices; continue; }
      state.last[key] = d;
      if (state.changes.length < 20000) state.changes.push(`${t}:${key}:${d.st}@${d.eip}`);
      else state.dropped++;
    }
  }, 50);
  state.disarm = () => { clearInterval(timer); return 'disarmed'; };
  window.__threadStates = state;
  return 'armed';
})();
