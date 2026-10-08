'use strict';

// Install only in the Worker which owns these imports and exports. Dispatch
// exit is an API-handler boundary, not proof that a redirected callback returned.
function installWorkerInputReceipt(host, getContext, emit) {
  const calls = new Map([
    ['GetMessageA', 4], ['PeekMessageA', 5], ['DispatchMessageA', 1],
    ['CallWindowProcA', 5], ['CallWindowProcW', 5], ['IsDialogMessageA', 2],
    ['SendMessageA', 4], ['PostMessageA', 4], ['DefWindowProcA', 4],
    ['SetCapture', 1], ['ReleaseCapture', 0], ['SetFocus', 1],
  ]);
  const original = new Map(), wrappers = new Map(), frames = [];
  for (const name of ['log', 'log_api_exit', 'check_input', 'check_input_hwnd',
    'check_input_lparam', 'check_input_wparam']) {
    if (typeof host[name] !== 'function') throw Error('missing import ' + name);
  }
  let deadline = 0, count = 0, readBytes = 0, watched = 0, active = false, closed = false;
  const alive = () => active && Date.now() < deadline && count < 256 && readBytes < 16384;
  function guard() { if (!alive()) throw Error('receipt limit'); }
  function getter(ex, name, ...args) {
    guard(); const fn = ex[name];
    if (typeof fn !== 'function') return null;
    guard(); const value = fn(...args); guard(); return value >>> 0;
  }
  function bytes(ctx, pointer, length, guest) {
    guard(); if (!Number.isInteger(length) || length < 0 || length > 128) throw Error('read size');
    let wa = pointer >>> 0;
    if (guest) { wa = getter(ctx.exports, 'guest_to_wasm', wa); if (wa === null) throw Error('translator absent'); }
    guard(); const buffer = ctx.memory.buffer; guard();
    if (wa < 0x100 || wa + length > buffer.byteLength || readBytes + length > 16384) throw Error('read bounds');
    guard(); readBytes += length;
    const copy = new Uint8Array(length), source = new Uint8Array(buffer, wa, length);
    for (let i = 0; i < length; i++) { guard(); copy[i] = source[i]; }
    return copy;
  }
  function words(ctx, pointer, n) {
    const b = bytes(ctx, pointer, n * 4, true), view = new DataView(b.buffer);
    return Array.from({ length: n }, (_, i) => view.getUint32(i * 4, true));
  }
  function state(ctx) {
    const ex = ctx.exports;
    const row = { slot: ctx.slot, tid: getter(ex, 'get_current_thread_id'),
      eip: getter(ex, 'get_eip'), esp: getter(ex, 'get_esp'), eax: getter(ex, 'get_eax'),
      capture: getter(ex, 'get_capture_hwnd'), focus: getter(ex, 'get_focus_hwnd') };
    if (watched) row.button = { hwnd: watched, flags: getter(ex, 'button_get_flags', watched),
      id: getter(ex, 'ctrl_get_id', watched), size: getter(ex, 'ctrl_get_wh', watched),
      proc: getter(ex, 'wnd_get_proc_export', watched), parent: getter(ex, 'wnd_get_parent', watched) };
    const n = Math.min(getter(ex, 'get_post_queue_count') || 0, 4);
    row.postQueue = Array.from({ length: n }, (_, i) =>
      Array.from({ length: 4 }, (_, f) => getter(ex, 'post_queue_peek', i, f)));
    return row;
  }
  function record(row) {
    guard(); row.at = Date.now(); count++; emit(row);
  }
  function observe(fn) { if (alive()) { try { fn(); } catch (_) {} } }
  function wrap(name, before, after) {
    if (typeof host[name] !== 'function') throw Error('missing import ' + name);
    const previous = host[name]; original.set(name, previous);
    function hook(...args) {
      if (before) observe(() => before(args));
      const result = previous.apply(this, args);
      if (after) observe(() => after(args, result));
      return result;
    }
    wrappers.set(name, hook); host[name] = hook;
  }
  wrap('log', args => {
    guard(); const ctx = getContext(); guard();
    const b = bytes(ctx, args[0], Math.min(args[1] >>> 0, 64), false);
    let name = ''; for (const c of b) { if (!c) break; name += String.fromCharCode(c); }
    const n = calls.get(name);
    if (frames.length >= 32) throw Error('frame cap');
    if (n === undefined) { frames.push(null); return; }
    const s = state(ctx), stack = words(ctx, s.esp, n + 1), frame = { name, stack, entry: s };
    frames.push(frame);
    const row = { kind: 'api-entry', name, stack, state: s };
    if (name === 'DispatchMessageA') row.message = words(ctx, stack[1], 7);
    if (name === 'IsDialogMessageA') row.message = words(ctx, stack[2], 7);
    if (!['GetMessageA', 'PeekMessageA'].includes(name)) record(row);
  });
  wrap('log_api_exit', () => {
    const frame = frames.pop(); if (!frame) return;
    guard(); const ctx = getContext(); guard();
    const row = { kind: 'dispatch-exit', name: frame.name, stack: frame.stack,
      state: state(ctx), callbackReturned: 'unmeasured' };
    if (['GetMessageA', 'PeekMessageA'].includes(frame.name)) {
      if (row.state.eax === 0 && frame.name === 'PeekMessageA') return;
      row.message = words(ctx, frame.stack[1], 7);
      if (![0x100, 0x101, 0x111, 0x201, 0x202, 0x84].includes(row.message[1])) return;
    }
    record(row);
  });
  for (const name of ['check_input', 'check_input_hwnd', 'check_input_lparam', 'check_input_wparam']) {
    wrap(name, null, (args, result) => {
      if (name === 'check_input' && !result) return;
      guard(); const ctx = getContext(); guard();
      record({ kind: 'input-import', name, args, result: result >>> 0, state: state(ctx) });
    });
  }
  return {
    arm(hwnd) {
      if (closed) throw Error('receipt closed');
      if (active) throw Error('receipt already armed');
      if (!Number.isInteger(hwnd) || hwnd <= 0) throw Error('watched HWND required');
      watched = hwnd >>> 0; deadline = Date.now() + 8000; count = 0; readBytes = 0;
      frames.length = 0; active = true;
      return { armed: true, deadline, maxRows: 256, maxReadBytes: 16384 };
    },
    close() {
      active = false; closed = true; frames.length = 0;
      for (const [name, previous] of original) if (host[name] === wrappers.get(name)) host[name] = previous;
      return { closed: true, rows: count, readBytes, deadline };
    },
  };
}

if (typeof module !== 'undefined') module.exports = { installWorkerInputReceipt };
