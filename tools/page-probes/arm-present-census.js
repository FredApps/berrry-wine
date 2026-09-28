// Page probe: how many canvas uploads the page makes per guest present, and
// how much main-thread time they cost -- measured the same way on any build.
//
// Guest presents (the perf HUD's PRESENT/s) and canvas uploads are different
// things: an app can present 84 times a second on a 60 Hz display, and every
// upload past one per display frame is overwritten before anyone sees it. The
// HUD's `present` phase cannot tell those apart, and it only sees time spent
// inside a step. So this wraps the three places pixels actually move:
//
//   gdi.presentBestDxOffscreen  DirectDraw surface -> canvas (an upload when
//                               it returns nonzero)
//   renderer.repaint            full-desktop composite (back-canvases -> screen)
//   WinePerf.guestFrame         the guest's own present boundary
//
// and samples cumulative counts plus wall time once a second. Read back with
// read-present-census.js; both files are build-agnostic on purpose, so the
// same pair measures a before and an after.
//
//   node tools/profile-web-frames.js --app=moorhuhn_3 --seconds=20 --headful \
//     --query='?debug&perf' \
//     --after-launch="$(cat tools/page-probes/arm-present-census.js)" \
//     --report-eval="$(cat tools/page-probes/read-present-census.js)"
(function () {
  if (window.__presentCensus) return 'already armed';
  const app = (typeof runningApps !== 'undefined' ? runningApps : [])[0];
  const wine = (app && app.wine) || window.wine;
  if (!wine) return 'no wine instance on this page';
  const now = () => performance.now();
  const c = {
    armedAt: now(),
    guestPresents: 0,
    dxCalls: 0, dxUploads: 0, dxMs: 0,
    composites: 0, compositeMs: 0,
    series: [],
  };
  window.__presentCensus = c;

  let depth = 0;   // a composite can run inside a DX present; count its time once
  const timed = (fn, onDone) => function (...args) {
    const t0 = now();
    depth++;
    try {
      const r = fn.apply(this, args);
      onDone(r, now() - t0, depth === 1);
      return r;
    } finally {
      depth--;
    }
  };

  const gdi = wine.hostCtx && wine.hostCtx.sharedGdi;
  if (gdi && typeof gdi.presentBestDxOffscreen === 'function') {
    gdi.presentBestDxOffscreen = timed(gdi.presentBestDxOffscreen, (r, ms, outer) => {
      c.dxCalls++;
      if (r) c.dxUploads++;
      if (outer) c.dxMs += ms;
    });
  }
  const renderer = wine.renderer;
  if (renderer && typeof renderer.repaint === 'function') {
    renderer.repaint = timed(renderer.repaint, (_r, ms, outer) => {
      c.composites++;
      if (outer) c.compositeMs += ms;
    });
  }
  const perf = window.WinePerf;
  if (perf && typeof perf.guestFrame === 'function') {
    const raw = perf.guestFrame;
    perf.guestFrame = function (...args) { c.guestPresents++; return raw.apply(this, args); };
  }

  const sample = () => c.series.push({
    t: now() - c.armedAt,
    guestPresents: c.guestPresents, dxUploads: c.dxUploads, dxCalls: c.dxCalls,
    composites: c.composites, presentMs: c.dxMs + c.compositeMs,
  });
  sample();
  c.timer = setInterval(sample, 1000);
  return `armed: dx=${!!gdi} renderer=${!!renderer} perf=${!!perf}`;
})();
