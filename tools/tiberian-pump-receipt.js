'use strict';
// Owning import receipts, never an instruction-retirement trace. No guest writes.
function installTiberianPumpReceipt(host, getContext, emit) {
  const specs = new Map([
    ['PeekMessageA', {args: 5, callers: [0x562857, 0x56292e]}],
    ['GetMessageA', {args: 4, callers: [0x56287e]}],
    ['DispatchMessageA', {args: 1, callers: [0x56291b]}],
    ['DestroyWindow', {args: 1, boundary: true}],
    ['CreateDialogIndirectParamA', {args: 5, boundary: true}],
    ['DialogBoxIndirectParamA', {args: 5, boundary: true}],
  ]);
  for (const n of ['log', 'log_api_exit']) if (typeof host[n] !== 'function') throw Error('missing ' + n);
  const originals = new Map(), hooks = new Map(), names = new Map(), frames = [], seen = new Set(), counts = new Map();
  const limits = {regular: {bytes: 45056, rows: 64, ms: 120}, metadata: {bytes: 4096, rows: 0, ms: 20}, scan: {bytes: 8192, rows: 0, ms: 20}, boundary: {bytes: 8192, rows: 32, ms: 40}};
  const used = Object.fromEntries(Object.keys(limits).map(k => [k, {bytes: 0, rows: 0, ms: 0, capped: false}]));
  let active = false, closed = false, deadline = 0, lane = 'regular', laneStart = 0, error = null, firstEmpty = false, unmatched = 0;
  const now = () => performance.now();
  function guard() {
    if (!active || Date.now() >= deadline) throw Error('deadline/inactive');
    const u = used[lane], l = limits[lane];
    if (u.capped || u.ms + Math.max(0, now() - laneStart) >= l.ms) throw Error('lane cap');
  }
  function getter(ctx, n, ...args) { guard(); const fn = ctx.exports[n]; guard(); if (typeof fn !== 'function') throw Error('missing getter ' + n); const r = fn(...args); guard(); return r >>> 0; }
  function read(ctx, p, n, guest = true) {
    guard(); if (n > 256 || used[lane].bytes + n > limits[lane].bytes) throw Error('lane cap');
    const wa = guest ? getter(ctx, 'guest_to_wasm', p) : p >>> 0; guard();
    const buffer = ctx.memory.buffer; guard(); if (wa < 256 || wa + n > buffer.byteLength) throw Error('bounds');
    const src = new Uint8Array(buffer, wa, n), copy = new Uint8Array(n);
    for (let i = 0; i < n; i++) { guard(); copy[i] = src[i]; used[lane].bytes++; }
    guard(); return copy;
  }
  function words(ctx, p, n) { const b = read(ctx, p, n * 4), v = new DataView(b.buffer); return Array.from({length: n}, (_, i) => v.getUint32(i * 4, true)); }
  function context() { guard(); const c = getContext(); guard(); return c; }
  function row(r) { guard(); if (used[lane].rows >= limits[lane].rows) throw Error('lane cap'); used[lane].rows++; emit({...r, at: Date.now()}); guard(); }
  function observe(which, fn) {
    if (!active || Date.now() >= deadline || used[which].capped) return;
    const previousLane = lane, previousStart = laneStart;
    lane = which; const start = now(); laneStart = start;
    try { fn(); } catch (e) {
      if (String(e).includes('lane cap')) used[which].capped = true;
      else { error = String(e); active = false; frames.length = 0; }
    } finally { used[which].ms += Math.max(0, now() - start); if (used[which].ms >= limits[which].ms) used[which].capped = true; lane = previousLane; laneStart = previousStart; }
  }
  function identity(ctx, frame) {
    const base = frame.esp + (frame.spec.args + 1) * 4;
    return {slot: ctx.slot, tid: getter(ctx, 'get_current_thread_id'), eip: getter(ctx, 'get_eip'), esp: getter(ctx, 'get_esp'),
      apiStack: frame.stack, callerCode: Array.from(read(ctx, frame.stack[0] - 8, 32)),
      // Pump saves four registers + 0x1c locals: its return is base+44.
      frameBase: base, frameWords: words(ctx, base, 20),
      expectedPumpReturn: 0x58cdb5, expectedOuterReturn: 0x4de743,
      callbackReturn: 'unmeasured; handler exit may redirect into a guest callback'};
  }
  function entry(a) {
    let name = names.get(a[0]);
    if (name === undefined) observe('metadata', () => {
      if (names.size >= 128) throw Error('lane cap');
      const c = context(), b = read(c, a[0], Math.min(a[1] >>> 0, 64), false);
      name = String.fromCharCode(...b).split('\0')[0]; names.set(a[0], name);
    });
    if (!active) return;
    if (frames.length >= 128) { error = 'frame cap'; active = false; frames.length = 0; return; }
    const index = frames.length; frames.push(null);
    const spec = specs.get(name); if (!spec) return;
    const which = spec.boundary ? 'boundary' : used.regular.capped && name === 'PeekMessageA' ? 'scan' : 'regular';
    observe(which, () => {
      const c = context(), esp = getter(c, 'get_esp'), stack = words(c, esp, spec.args + 1);
      if (spec.callers && !spec.callers.includes(stack[0])) return;
      const frame = {name, spec, esp, stack, lane: which};
      if (name === 'DispatchMessageA') frame.msg = words(c, stack[1], 7);
      frames[index] = frame;
      if (spec.boundary) row({kind: 'boundary-entry', name, identity: identity(c, frame)});
    });
  }
  function exit() {
    if (!active || Date.now() >= deadline) return;
    if (!frames.length) { unmatched++; return; }
    const f = frames.pop(); if (!f) return;
    observe(f.lane, () => {
      const c = context(), result = getter(c, 'get_eax');
      if (f.spec.boundary) { row({kind: 'boundary-handler-exit', name: f.name, result, identity: identity(c, f)}); return; }
      // MSG is meaningful on successful Get/Peek, or at Dispatch entry (captured below).
      const msg = f.msg || (result && f.lane !== 'scan' ? words(c, f.stack[1], 7) : null);
      const key = [f.name, f.stack[0], result, ...(msg ? msg.slice(0, 4) : [])].join(':');
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
      else if (counts.size < 64) counts.set(key, 1); else counts.set('overflow', (counts.get('overflow') || 0) + 1);
      const empty = f.name === 'PeekMessageA' && result === 0;
      const sample = !seen.has(key) && seen.size < 64; if (sample) seen.add(key);
      // First empty uses reserved budget even when regular sample rows have filled.
      if (empty && !firstEmpty) {
        firstEmpty = true; observe('boundary', () => row({kind: 'first-empty', name: f.name, result, msg: null, identity: identity(c, f)}));
      } else if (f.lane === 'regular' && sample && used.regular.rows < limits.regular.rows) row({kind: 'pump-result', name: f.name, result, msg, identity: identity(c, f)});
    });
  }
  for (const [n, before] of [['log', entry], ['log_api_exit', exit]]) {
    const original = host[n]; originals.set(n, original);
    const hook = function(...args) {
      if (active && Date.now() < deadline) try { before(args); } catch (e) { error = String(e); active = false; frames.length = 0; }
      try { return original.apply(this, args); } catch (e) { active = false; frames.length = 0; throw e; }
    };
    hooks.set(n, hook); host[n] = hook;
  }
  return {
    arm() { if (closed || active) throw Error('observer unavailable'); active = true; deadline = Date.now() + 8000; return {armed: true, deadline, maxReadBytes: 65536, maxRows: 96, maxCpuMs: 200, limits}; },
    close() { active = false; closed = true; for (const [n, original] of originals) if (host[n] === hooks.get(n)) host[n] = original; frames.length = 0;
      return {closed: true, deadline, error, firstEmpty, unmatched, used, counts: Object.fromEntries(counts), coverage: 'counts stop at regular read/CPU cap; reserved boundary records continue within original deadline'}; },
  };
}
if (typeof module !== 'undefined') module.exports = {installTiberianPumpReceipt};
