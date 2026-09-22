// Is a periodic guest thread (a DirectSound mixer on Sleep(5)) short of
// wakes because the host schedules it rarely, or because the clock it is
// judged against stands still?
//
// Samples the cooperative ThreadManager every 1ms. Each time a thread's
// `sleepUntil` changes, that thread has run and called Sleep again: one wake.
// For every wake it records how late the thread ran against the deadline it
// was waiting on, measured two ways -- on the guest clock the scheduler uses
// (`_waitNow()`), and on the wall clock (the deadline translated to wall time
// when it was set). Alongside: guest clock rate vs performance.now(), and how
// long the guest clock stood still while the wall moved.
//
// Read back with read-thread-wakes.js; disarm with window.__threadWakes.disarm().
(function () {
  if (window.__threadWakes) return 'already armed';
  const tm = window.wine && window.wine.threadManager;
  if (!tm || !tm.threads) return 'no cooperative threadManager on this page';
  const now = () => performance.now();
  const guest = () => tm._waitNow();
  const state = { armedAt: now(), guestAt: guest(), threads: {}, frozenMs: [], samples: 0 };
  let lastGuest = state.guestAt, lastGuestChangeAt = state.armedAt;
  // Sampled after every scheduler call, not only from a timer: the page's
  // step chain holds the main thread, so a 1ms interval measured ~23 runs/s
  // and missed most wakes. Wakes happen inside runSlice, so this sees each.
  state.runSlices = 0; state.runSliceGapMs = []; state.inRunSliceMs = 0;
  let lastRunSliceEnd = null;
  const origRunSlice = tm.runSlice;
  tm.runSlice = function () {
    const t0 = now();
    if (lastRunSliceEnd !== null && state.runSliceGapMs.length < 50000) state.runSliceGapMs.push(t0 - lastRunSliceEnd);
    const ret = origRunSlice.apply(this, arguments);
    lastRunSliceEnd = now();
    state.inRunSliceMs += lastRunSliceEnd - t0;
    state.runSlices++;
    try { sample(); } catch (e) { state.error = String(e && e.stack || e); }
    return ret;
  };
  const sample = () => {
    const t = now(), g = guest();
    state.samples++;
    if (g !== lastGuest) {
      if (t - lastGuestChangeAt > 2 && state.frozenMs.length < 50000) state.frozenMs.push(t - lastGuestChangeAt);
      lastGuest = g; lastGuestChangeAt = t;
    }
    for (const [handle, th] of tm.threads) {
      let r = state.threads[handle];
      if (!r) r = state.threads[handle] = { tid: th.tid, lastUntil: th.sleepUntil, lastUntilWall: null,
        wakes: 0, sleepMs: {}, lateGuest: [], lateWall: [], perSecond: [] };
      if (th.sleepUntil !== r.lastUntil) {
        // It ran. Lateness against the previous deadline.
        if (r.lastUntil > 0) {
          if (r.lateGuest.length < 20000) r.lateGuest.push(g - r.lastUntil);
          if (r.lastUntilWall !== null && r.lateWall.length < 20000) r.lateWall.push(t - r.lastUntilWall);
        }
        r.wakes++;
        const ms = th.lastSleepMs | 0;
        r.sleepMs[ms] = (r.sleepMs[ms] || 0) + 1;
        const s = Math.floor((t - state.armedAt) / 1000);
        const b = r.perSecond[r.perSecond.length - 1];
        if (b && b.s === s) b.n++; else r.perSecond.push({ s, n: 1 });
        r.lastUntil = th.sleepUntil;
        // Wall instant the new deadline falls due, if guest and wall ran 1:1 from here.
        r.lastUntilWall = th.sleepUntil > 0 ? t + (th.sleepUntil - g) : null;
      }
    }
  };
  const timer = setInterval(sample, 1);
  // Which thread polls the play cursor and which one refills the ring:
  // GetCurrentPosition lands in voices.getPos, Unlock in playRing(loop 2).
  state.calls = {};
  const voices = window.wine.hostCtx && window.wine.hostCtx._voices;
  const who = () => '0x' + ((tm._runningThreadHandle || 0) >>> 0).toString(16);
  const bump = (k) => { const w = who(); const c = state.calls[w] || (state.calls[w] = {}); c[k] = (c[k] || 0) + 1; };
  const origGetPos = voices && voices.getPos, origPlayRing = voices && voices.playRing;
  if (voices) {
    voices.getPos = function () { bump('getPos'); return origGetPos.apply(this, arguments); };
    voices.playRing = function (id, ptr, len, off, loop) { bump(loop === 2 ? 'unlock' : 'play'); return origPlayRing.apply(this, arguments); };
  }
  // Host step cadence (needs ?perf): start-to-start interval of each step.
  state.stepGapMs = [];
  const perf = window.WinePerf;
  const origStepBegin = perf && perf.stepBegin;
  let lastStep = null;
  if (origStepBegin) {
    perf.stepBegin = function () {
      const t = now();
      if (lastStep !== null && state.stepGapMs.length < 50000) state.stepGapMs.push(t - lastStep);
      lastStep = t;
      return origStepBegin.apply(this, arguments);
    };
  }
  state.disarm = () => {
    clearInterval(timer); tm.runSlice = origRunSlice;
    if (origStepBegin) perf.stepBegin = origStepBegin;
    if (voices) { voices.getPos = origGetPos; voices.playRing = origPlayRing; }
    return 'disarmed';
  };
  window.__threadWakes = state;
  return 'armed';
})();
