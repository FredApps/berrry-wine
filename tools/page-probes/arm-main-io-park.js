// How often, and for how long, the cooperative main guest thread is parked on
// a lazy ReadFile (io_wait, yield 12) -- and whether the rest of the page keeps
// running while it is. Pair with arm-dsound-underrun.js: a park that froze the
// scheduler shows up there as stale audible replays during the park windows
// (Heroes III's looping music, LAZY-PARK-AUDIO-LOOP-20261006).
//
// Wraps window.wine._pollMainIo (host.js). Every call that answers "parked"
// is a host step the main thread sat out; steps that ran worker threads in the
// meantime are counted from threadManager's slice counter when it has one.
// Read back with read-main-io-park.js.

(function () {
  if (window.__mainIoPark) return 'already armed';
  const wine = window.wine;
  if (!wine || typeof wine._pollMainIo !== 'function') return 'no wine._pollMainIo on this page';
  const now = () => performance.now();
  const state = { armedAt: now(), parkedPolls: 0, parks: [], open: null, restores: [] };
  const orig = wine._pollMainIo;
  wine._pollMainIo = function () {
    const parked = orig.apply(this, arguments);
    const t = now();
    if (parked) {
      state.parkedPolls++;
      if (!state.open) state.open = { start: t, polls: 0 };
      state.open.polls++;
    } else if (state.open) {
      const p = state.open; state.open = null;
      if (state.parks.length < 5000) state.parks.push({ at: +(p.start - state.armedAt).toFixed(1), ms: +(t - p.start).toFixed(2), polls: p.polls });
    }
    return parked;
  };
  state.restores.push(() => { wine._pollMainIo = orig; });
  // Threads mode: the main guest thread is a Worker and host.js parks it by
  // setting wine._workerMainIoWait until the fill lands, then nulling it.
  // An accessor times each of those parks the same way.
  let workerWait = wine._workerMainIoWait || null;
  let workerOpen = null;
  Object.defineProperty(wine, '_workerMainIoWait', {
    configurable: true,
    get() { return workerWait; },
    set(v) {
      const t = now();
      if (v && !workerOpen) workerOpen = { start: t, path: '' };
      if (!v && workerOpen) {
        if (state.parks.length < 5000) state.parks.push({ at: +(workerOpen.start - state.armedAt).toFixed(1), ms: +(t - workerOpen.start).toFixed(2), worker: true });
        workerOpen = null;
      }
      workerWait = v;
    },
  });
  state.restores.push(() => { delete wine._workerMainIoWait; wine._workerMainIoWait = workerWait; });
  state.disarm = () => { for (const f of state.restores.splice(0)) f(); return 'disarmed'; };
  window.__mainIoPark = state;
  return 'armed';
})();
