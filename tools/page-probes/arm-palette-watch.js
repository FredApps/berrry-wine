// Catch a palette going wrong ACROSS A RESUME, in the act.
//
// Reported twice on a real iPhone: the picture comes back from a backgrounded
// tab / a suspended context with the colours wrong, and then heals itself a
// moment later. By the time anyone can be asked to look, it is already fine --
// which is why two sessions of after-the-fact canvas sampling produced only
// "it is healthy now" and no cause.
//
// So sample on the transition instead of on demand. This arms a listener on
// visibilitychange/pageshow/focus and takes a burst of readings at
// 0/100/250/500/1000/2000/4000ms afterwards, keeping the last few bursts in
// window.__palWatch. Each reading pairs two INDEPENDENT things:
//
//   screen  -- what the compositor is showing (gray/colour/black shares over
//              the real canvas), which is the symptom the eye reports
//   pal     -- the actual DirectDraw palette bytes behind each 8bpp surface,
//              read live out of WAT memory through the presentation's
//              paletteWa, which is the thing that would be wrong
//
// Pairing them is the point, because they separate the three candidates that
// a screenshot alone cannot:
//
//   palette right + screen gray  -> the composite is stale, or iOS discarded
//                                   the canvas backing store while hidden and
//                                   nothing has repainted yet
//   palette gray  + screen gray  -> the guest really is mid-fade; the app is
//                                   doing this to itself and it is correct
//   palette right + screen right -> we missed the window; widen the burst
//
// Read it back with tools/page-probes/read-palette-watch.js.

(function () {
  if (typeof window === 'undefined') return 'no window';
  if (window.__palWatch && window.__palWatch.armed) return 'already armed';

  var MAX_BURSTS = 8;
  var OFFSETS = [0, 100, 250, 500, 1000, 2000, 4000];

  var state = { armed: true, bursts: [], note: null };
  window.__palWatch = state;

  // --- what the screen is showing -----------------------------------------
  // Sampled on a stride: a full 1125x1884 readback is 2.1M pixels and this
  // runs seven times per burst on a phone. Every 7th pixel is 300k samples,
  // which is far more than enough for a share and cheap enough not to perturb
  // the thing being measured.
  function screenStats() {
    var cv = document.querySelector('canvas');
    if (!cv || !cv.width || !cv.height) return null;
    var data;
    try {
      data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
    var gray = 0, col = 0, black = 0, n = 0;
    for (var i = 0; i < data.length; i += 4 * 7) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      n++;
      if (r === 0 && g === 0 && b === 0) { black++; continue; }
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn <= 4) gray++; else col++;
    }
    if (!n) return null;
    return {
      w: cv.width, h: cv.height, n: n,
      black: +(black / n * 100).toFixed(1),
      gray: +(gray / n * 100).toFixed(1),
      col: +(col / n * 100).toFixed(1),
    };
  }

  // --- what the palette actually holds -------------------------------------
  // The entries live in canonical WAT memory (see the comment at
  // lib/host-imports.js:257 -- GdiSurface keeps no copy), so this reads the
  // live bytes rather than any host-side cache that could itself be stale.
  function paletteStats() {
    var wine = window.wine;
    var host = wine && wine.hostCtx;
    // sharedGdi, not hostCtx directly: createHostImports returns the map under
    // a `gdi` key that the host parks on ctx.sharedGdi so worker threads and
    // other apps see the same one (host.js _deleteOwnSurfacePresentations
    // reads it by that path). Reaching for hostCtx.surfacePresentations gets
    // undefined and this probe reports a clean `null` that looks like "no
    // palettes" rather than "wrong accessor" -- which is exactly the kind of
    // silent nothing that makes a probe worse than no probe.
    var pres = host && ((host.sharedGdi && host.sharedGdi.surfacePresentations) ||
                        host.surfacePresentations);
    if (!pres || typeof pres.forEach !== 'function') {
      return { error: 'no surfacePresentations map -- accessor wrong or GDI not up' };
    }
    var mem;
    try { mem = new Uint8Array(host.getMemory()); } catch (e) { return null; }
    var out = [];
    pres.forEach(function (p, id) {
      if (!p || !p.paletteWa || !(p.paletteCount > 0)) return;
      var count = Math.min(p.paletteCount, 256);
      var gray = 0, col = 0, zero = 0, sum = 0;
      for (var i = 0; i < count; i++) {
        var o = p.paletteWa + i * 4;
        if (o + 3 >= mem.length) break;
        var r = mem[o], g = mem[o + 1], b = mem[o + 2];
        sum += r + g + b;
        if (!r && !g && !b) { zero++; continue; }
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        if (mx - mn <= 4) gray++; else col++;
      }
      out.push({
        id: id >>> 0,
        bpp: p.surface && p.surface.bpp,
        count: count,
        zero: zero,
        gray: gray,
        col: col,
        // Mean brightness is the fade tell: a palette being faded to black
        // keeps all 256 entries and walks this number down, which looks
        // nothing like a palette that was never written.
        meanRGB: +(sum / Math.max(1, count * 3)).toFixed(1),
      });
    });
    return out;
  }

  function sample(label, tag, t0) {
    return {
      tag: tag,
      atMs: Math.round((performance.now() - t0)),
      vis: document.visibilityState,
      hidden: !!document.hidden,
      ac: (window.wine && wine._audioCtx && wine._audioCtx.state) || 'none',
      acTime: (window.wine && wine._audioCtx)
        ? +wine._audioCtx.currentTime.toFixed(2) : 0,
      running: !!(window.wine && wine.running),
      screen: screenStats(),
      pal: paletteStats(),
    };
  }

  function burst(label) {
    var t0 = performance.now();
    var b = { label: label, startedAt: new Date().toISOString(), samples: [] };
    state.bursts.push(b);
    while (state.bursts.length > MAX_BURSTS) state.bursts.shift();
    OFFSETS.forEach(function (ms) {
      setTimeout(function () {
        try { b.samples.push(sample(label, ms, t0)); } catch (e) {
          b.samples.push({ tag: ms, error: String(e && e.message || e) });
        }
      }, ms);
    });
  }

  // Fire on the way OUT as well as the way back in: the last reading before a
  // hide is the baseline the resume has to be compared against, and without it
  // a wrong-looking palette after a resume cannot be told from one that was
  // already wrong before.
  var onVis = function () { burst(document.hidden ? 'hide' : 'show'); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pageshow', function () { burst('pageshow'); });
  window.addEventListener('focus', function () { burst('focus'); });

  state.disarm = function () {
    document.removeEventListener('visibilitychange', onVis);
    state.armed = false;
    return 'disarmed';
  };
  state.now = function () { burst('manual'); return 'sampling'; };

  // One baseline immediately, so there is always something to compare to.
  burst('arm');
  return 'armed';
})();
