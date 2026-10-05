// Attribute the perf HUD's `other` phase to actual call sites.
//
// `other` is a RESIDUAL, not a phase: lib/perf-hud.js computes it as
// total - main - workers - present, so everything the step does outside the
// six mark() call sites in host.js lands there with no name on it. On a real
// iPhone running StarCraft in worker mode it is ~40% of measured step time,
// and the distribution says that is not a tax but a spike: 237 of 240 steps
// spend <=1ms there while 3 steps spend 15-17ms each and account for 64% of
// the total.
//
// So this wraps the run loop's own methods and accumulates per step, then
// keeps the full breakdown for any step whose `other` exceeded a threshold.
// Read it back with read-step-attribution.js.
//
// Arm it against the live page; it patches in place and can be disarmed by
// window.__stepAttr.disarm().

(function () {
  if (window.__stepAttr) return 'already armed';
  const perf = window.WinePerf;
  const wine = window.wine;
  if (!perf || !wine) return 'no WinePerf/wine on this page';

  const THRESHOLD_MS = 5;
  const state = {
    cur: null,
    spikes: [],
    steps: 0,
    totals: {},
    restores: [],
  };

  const add = (name, ms) => {
    state.totals[name] = (state.totals[name] || 0) + ms;
    if (state.cur) state.cur[name] = (state.cur[name] || 0) + ms;
  };

  // Wrap one method in place, recording its own wall time. Nested calls are
  // double counted by construction, which is why the readback prints the
  // names rather than trying to sum them into a pie.
  //
  // MUST be await-aware. The run loop's step is an async function with seven
  // await points between stepBegin() and stepEnd(), so a try/finally around
  // apply() stops the clock when the promise is RETURNED, not when it
  // SETTLES -- and the time the step spends parked at an await is exactly
  // what we are hunting. Measuring it synchronously reports 0.02ms for a call
  // the step then waited 18ms on, which is how `inside` came back empty.
  const wrap = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function') return false;
    const original = obj[name];
    const tag = label || name;
    obj[name] = function (...args) {
      const t0 = performance.now();
      let result;
      try {
        result = original.apply(this, args);
      } catch (err) {
        add(tag, performance.now() - t0);
        throw err;
      }
      if (result && typeof result.then === 'function') {
        add(tag + ':sync', performance.now() - t0);
        return result.then(
          (value) => { add(tag, performance.now() - t0); return value; },
          (err) => { add(tag, performance.now() - t0); throw err; });
      }
      add(tag, performance.now() - t0);
      return result;
    };
    state.restores.push(() => { obj[name] = original; });
    return true;
  };

  const proto = Object.getPrototypeOf(wine);
  const wrapped = [];
  // Every await target between stepBegin() (host.js:4208) and stepEnd()
  // (:4568), plus the synchronous phases, so a parked step can be told apart
  // from a working one.
  for (const name of ['_runThreaded', '_runCooperativeSlice', '_pumpMultimediaTimer',
                      '_presentDxIfDirty', '_deleteOwnSurfacePresentations', '_postStep',
                      'handleComDllLoad', 'handleLoadLibrary',
                      'handleCooperativeThreadLoadLibraries']) {
    if (wrap(proto, name) || wrap(wine, name)) wrapped.push(name);
  }
  const tm = wine.threadManager;
  if (tm) {
    const tproto = Object.getPrototypeOf(tm);
    for (const name of ['pumpThreadsOnce', 'runWorkerSlices', 'runSlice', 'runBudgeted',
                        '_pumpWorkersForThreadSend',
                        'resolveMainThreadSend', 'spawnPending', 'drainCooperativeWakes']) {
      if (wrap(tproto, name, 'tm.' + name) || wrap(tm, name, 'tm.' + name)) {
        wrapped.push('tm.' + name);
      }
    }
  }
  // The audio pumps run on this thread too, and the DirectSound path was just
  // rewritten, so they are suspects rather than background.
  const hc = wine.hostCtx;
  if (hc) {
    for (const name of ['pumpWaveOutCompletions', 'pumpAudioTap']) {
      if (wrap(hc, name, 'audio.' + name)) wrapped.push('audio.' + name);
    }
  }

  const beginOriginal = perf.stepBegin.bind(perf);
  const endOriginal = perf.stepEnd.bind(perf);
  perf.stepBegin = function () {
    state.cur = {};
    return beginOriginal();
  };
  perf.stepEnd = function () {
    const bucket = state.cur;
    state.cur = null;
    const r = endOriginal();
    state.steps++;
    const last = perf.steps[perf.steps.length - 1];
    if (last && last.other >= THRESHOLD_MS) {
      state.spikes.push({
        total: +last.total.toFixed(2),
        other: +last.other.toFixed(2),
        main: +last.main.toFixed(2),
        workers: +last.workers.toFixed(2),
        present: +last.present.toFixed(2),
        gap: +(last.gap || 0).toFixed(2),
        // Everything the wrappers saw during this step, largest first.
        inside: Object.keys(bucket || {})
          .map(k => [k, +bucket[k].toFixed(2)])
          .filter(e => e[1] > 0.01)
          .sort((a, b) => b[1] - a[1]),
      });
      if (state.spikes.length > 40) state.spikes.shift();
    }
    return r;
  };
  state.restores.push(() => { perf.stepBegin = beginOriginal; perf.stepEnd = endOriginal; });

  window.__stepAttr = {
    state,
    thresholdMs: THRESHOLD_MS,
    wrapped,
    armedAt: performance.now(),
    disarm() {
      for (const undo of state.restores.reverse()) { try { undo(); } catch (_) {} }
      delete window.__stepAttr;
      return 'disarmed';
    },
  };
  return 'armed: ' + wrapped.join(', ');
})()
