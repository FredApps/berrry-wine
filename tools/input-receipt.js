'use strict';

// Page-side evidence only. Do not call WASM exports: in Worker mode those
// belong to an idle shadow and cannot prove guest callback delivery.
function pointerSnapshot(wine, document) {
  const r = wine?.renderer, c = r?.canvas, rect = c?.getBoundingClientRect();
  const keys = ['x', 'y', 'w', 'h', 'srcX', 'srcY', 'srcW', 'srcH',
    'dstX', 'dstY', 'dstW', 'dstH', 'outputW', 'outputH',
    'nativeX', 'nativeY', 'nativeW', 'nativeH'];
  const geometry = o => o ? Object.fromEntries(keys.filter(k => Number.isFinite(o[k])).map(k => [k, o[k]])) : null;
  const event = e => e ? Object.fromEntries(['type', 'hwnd', 'msg', 'wParam', 'lParam',
    'mouseX', 'mouseY', 'mouseButtons'].filter(k => typeof e[k] === 'string' || Number.isFinite(e[k])).map(k => [k, e[k]])) : null;
  const down = r?._directMouseDown;
  return {
    at: Date.now(), scope: 'DOM and renderer fields; guest delivery unmeasured',
    canvas: c ? { width: c.width, height: c.height, rect: rect ? Object.fromEntries(
      ['left', 'top', 'width', 'height', 'right', 'bottom'].map(k => [k, rect[k]])) : null } : null,
    focus: document?.activeElement ? { tag: document.activeElement.tagName, id: document.activeElement.id } : null,
    mouse: r ? { x: r._mouseX, y: r._mouseY, buttons: r._mouseButtonsMask } : null,
    transform: geometry(r?._exclusiveTransform), viewport: geometry(r?._exclusivePresentationViewport),
    down: down ? { targetHwnd: down.targetHwnd, screenX: down.screenX,
      screenY: down.screenY, ownerHwnd: down.win?.hwnd } : null,
    activeEvent: event(r?._activeInputEvent), queue: (r?.inputQueue || []).slice(-8).map(event),
    windows: Object.values(r?.windows || {}).slice(0, 16).map(w => ({ hwnd: w.hwnd,
      title: String(w.title || '').slice(0, 80), style: w.style, parentHwnd: w.parentHwnd,
      isChild: w.isChild, isPopup: w.isPopup, isDialog: w.isDialog, visible: w.visible,
      x: w.x, y: w.y, w: w.w, h: w.h, clientRect: geometry(w.clientRect) })),
  };
}

function installPointerTrace(wine, document) {
  const r = wine?.renderer;
  if (!r) throw Error('actual renderer absent');
  const own = Object.prototype.hasOwnProperty.call(r, 'onInputTrace');
  const previous = r.onInputTrace, rows = [];
  let closed = false, deadline = null;
  function hook(what) {
    if (!closed && rows.length < 32) {
      if (deadline === null) deadline = Date.now() + 15000;
      if (Date.now() < deadline) {
        try { rows.push({ text: String(what).slice(0, 240), snapshot: pointerSnapshot(wine, document) }); }
        catch (e) { rows.push({ error: String(e).slice(0, 240) }); }
      }
    }
    if (typeof previous === 'function') return previous.call(this, what);
  }
  r.onInputTrace = hook;
  return { rows: () => rows.slice(), stop() {
    closed = true;
    if (r.onInputTrace === hook) {
      if (own) r.onInputTrace = previous;
      else delete r.onInputTrace;
    }
  } };
}

if (typeof module !== 'undefined') module.exports = { pointerSnapshot, installPointerTrace };
