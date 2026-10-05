// Page probe: is the guest actually DRAWING?
//
//   node tools/profile-web-frames.js --app=ID ... \
//     --report-eval="$(cat tools/page-probes/read-backcanvas-coverage.js)"
//
// WHY THIS EXISTS: "the course is black" can mean two completely different
// things and a screenshot cannot tell them apart -- either the guest stopped
// painting, or it painted fine and the compositor put the result somewhere the
// screen canvas does not show. This reads the GUEST's own back-canvas, before
// any compositing, and reports how much of it is non-black. A back-canvas at
// 97% non-black with a black screen is a presentation bug; one at 7% is the
// app not drawing.
//
// It also reports the display mode, the screen canvas size and the
// exclusive-fullscreen flag, because those three are what a mode change moves
// and every question here is "did they end up agreeing".
//
// Sampling is on a grid, not every pixel: a 800x600 readback per window per
// call is fine, but the counting is the expensive half and a 4px step is
// plenty to separate 7% from 97%.
(() => {
  const STEP = 4;
  const pctNonBlack = (cv) => {
    if (!cv || !cv.width || !cv.height) return null;
    try {
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let total = 0, nonBlack = 0;
      for (let y = 0; y < cv.height; y += STEP) {
        for (let x = 0; x < cv.width; x += STEP) {
          const i = (y * cv.width + x) * 4;
          total++;
          if (d[i] || d[i + 1] || d[i + 2]) nonBlack++;
        }
      }
      return total ? +(nonBlack * 100 / total).toFixed(1) : null;
    } catch (err) { return 'ERR:' + (err && err.message || err); }
  };
  const r = window.wineShell && window.wineShell.renderer;
  const out = { windows: [], mode: null, screen: null, exclusiveFullscreen: null };
  const sc = document.getElementById('screen');
  if (sc) out.screen = { w: sc.width, h: sc.height, cssW: sc.clientWidth, cssH: sc.clientHeight };
  out.exclusiveFullscreen = document.body.classList.contains('exclusive-fullscreen');
  if (!r) return JSON.stringify({ error: 'no renderer' });
  for (const win of Object.values(r.windows || {})) {
    if (!win || win.isChild) continue;
    const e = win.wasm && win.wasm.exports;
    if (e && e.get_display_mode_active && !out.mode) {
      out.mode = {
        active: e.get_display_mode_active() | 0,
        w: e.get_display_mode_w ? e.get_display_mode_w() | 0 : null,
        h: e.get_display_mode_h ? e.get_display_mode_h() | 0 : null,
        fullscreenFlag: e.get_display_fullscreen ? e.get_display_fullscreen() | 0 : null,
      };
    }
    const rec = {
      hwnd: win.hwnd, x: win.x, y: win.y, w: win.w, h: win.h,
      visible: !!win.visible, canvas: null, nonBlackPct: null,
    };
    // An OpenGL app draws through a GPU frame layer that is merged into the
    // window's canonical bits, not straight onto the back canvas. SimGolf is
    // the case: terrain on the GL layer, whole interface in GDI afterwards.
    // So "the back canvas is black" has two causes -- GL never produced a
    // frame, or it produced one the merge did not land -- and only reading
    // the layer separately tells them apart.
    for (const key of ['_dxFrameLayer', '_gpuFrameLayer']) {
      const layer = win[key];
      if (!layer) continue;
      rec[key] = {
        kind: layer.kind || null,
        mergedIntoWindow: !!layer.mergedIntoWindow,
        writeSeq: layer.writeSeq | 0,
        w: layer.canvas ? layer.canvas.width : null,
        h: layer.canvas ? layer.canvas.height : null,
        nonBlackPct: pctNonBlack(layer.canvas),
      };
    }
    rec.gdiWriteSeq = win._gdiWriteSeq | 0;
    try {
      const got = r.getWindowCanvas ? r.getWindowCanvas(win.hwnd) : null;
      const cv = got && got.canvas;
      const ctx = got && got.ctx;
      if (cv && ctx) {
        rec.canvas = { w: cv.width, h: cv.height };
        rec.nonBlackPct = pctNonBlack(cv);
      }
    } catch (err) {
      rec.error = String(err && err.message || err);
    }
    out.windows.push(rec);
  }
  return JSON.stringify(out);
})()
