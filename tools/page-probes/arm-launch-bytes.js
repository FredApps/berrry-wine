// Page probe (--before-load): how many bytes did the page download before the
// guest's first presented frame, and how many by the end of the sample?
//
// This is the number a lazy file mount is supposed to move (LAZY-LOAD-ALL,
// 2026-10-06), so it is counted the same way on any build: every fetch() the
// page makes is wrapped and its body size taken from the response headers --
// Content-Range's span for a 206, Content-Length otherwise -- without reading
// the body, so the probe adds no copy. That survives the service worker this
// box's Chrome installs (sw-coi), which makes Resource Timing report
// transferSize 0; the Resource Timing sums are kept beside it as a second
// reading (buffer raised so a 6000-file tree is not truncated at 250).
// "First frame" is the first WinePerf.guestFrame(), the emulator's own present
// boundary (DirectDraw/GL/D3D present, or a GDI canonical-surface flush), which
// host-imports calls whether or not the HUD is enabled.
//
//   node tools/profile-web-frames.js --app=ID --seconds=40 \
//     --before-load="$(cat tools/page-probes/arm-launch-bytes.js)" \
//     --report-eval="$(cat tools/page-probes/read-launch-bytes.js)"
//
// Serve the page from a host that answers Range (tools/dev-server.js): a
// server that ignores Range makes every lazy file fall back to a whole-file
// GET, and this then measures the eager fallback. `?eager-files` is the
// control arm (lib/app-files.js). rangeFetches/rangeBytes say which you got.
(function () {
  if (window.__launchBytes) return;
  const t0 = performance.now();
  const s = {
    fetches: 0, bytes: 0, rangeFetches: 0, rangeBytes: 0, unknown: 0,
    byUrl: Object.create(null),
    firstFrameAt: null, atFirstFrame: null, frames: 0,
  };
  window.__launchBytes = s;
  try { performance.setResourceTimingBufferSize(200000); } catch (_) {}

  const spanOf = (response) => {
    const range = response.headers.get('content-range');
    const m = range && /bytes\s+(\d+)-(\d+)\//i.exec(range);
    if (m) return { bytes: Number(m[2]) - Number(m[1]) + 1, range: true };
    const len = response.headers.get('content-length');
    return len === null ? null : { bytes: Number(len), range: false };
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    return realFetch(input, init).then(response => {
      if (String(method).toUpperCase() !== 'HEAD') {
        const span = spanOf(response);
        s.fetches++;
        if (!span) s.unknown++;
        else {
          s.bytes += span.bytes;
          if (span.range) { s.rangeFetches++; s.rangeBytes += span.bytes; }
          const key = url.replace(/[?#].*$/, '');
          s.byUrl[key] = (s.byUrl[key] || 0) + span.bytes;
        }
      }
      return response;
    });
  };

  const resourceBytes = () => {
    let transfer = 0, body = 0, n = 0;
    for (const e of performance.getEntriesByType('resource')) {
      transfer += e.transferSize || 0; body += e.encodedBodySize || 0; n++;
    }
    return { entries: n, transferSize: transfer, encodedBodySize: body };
  };
  s.resourceBytes = resourceBytes;
  const snapshot = () => ({
    ms: Math.round(performance.now() - t0),
    fetches: s.fetches, bytes: s.bytes, rangeFetches: s.rangeFetches,
    rangeBytes: s.rangeBytes, unknown: s.unknown, resource: resourceBytes(),
  });
  s.snapshot = snapshot;

  // WinePerf is created by lib/perf-hud.js after this script runs; wrap its
  // guestFrame as soon as it exists.
  const hook = () => {
    const perf = window.WinePerf;
    if (!perf || typeof perf.guestFrame !== 'function') return false;
    const real = perf.guestFrame.bind(perf);
    perf.guestFrame = function () {
      s.frames++;
      if (s.firstFrameAt === null) {
        s.firstFrameAt = Math.round(performance.now() - t0);
        s.atFirstFrame = snapshot();
      }
      return real();
    };
    return true;
  };
  if (!hook()) {
    const timer = setInterval(() => { if (hook()) clearInterval(timer); }, 20);
  }
})();
