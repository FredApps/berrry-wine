'use strict';
// Import boundaries, not retired x86 returns. The supplied damage reader must
// read memory directly: update_rect_lt/rb call update_get_rect, which can clear
// empty damage, and are therefore unsuitable for a read-only observer.
function installPaintOwnershipReceipt(host, getContext, readDamage, emit) {
  const specs = new Map([
    ['CallWindowProcA', [5, 2]], ['CallWindowProcW', [5, 2]],
    ['DefDlgProcA', [4, 1]], ['DefDlgProcW', [4, 1]],
    ['DefWindowProcA', [4, 1]], ['DefWindowProcW', [4, 1]],
    ['BeginPaint', [2, 1]], ['EndPaint', [2, 1]],
    ['ValidateRect', [2, 1]], ['InvalidateRect', [3, 1]],
    ['ValidateRgn', [2, 1]], ['InvalidateRgn', [3, 1]],
    ['RedrawWindow', [4, 1]], ['UpdateWindow', [1, 1]],
    ['ShowWindow', [2,1]], ['SetWindowPos',[7,1]], ['MoveWindow',[6,1]],
  ]);
  const original = {}, hooks = {}, frames = [], names = new Map(), counts = new Map();
  const limits = {bytes: 65536, rows: 96, cpuMs: 200, hooks: 20000, depth: 128};
  let active = false, closed = false, deadline = 0, hwnd = 0, error = null, capped = null;
  let bytes = 0, rows = 0, cpuMs = 0, hookCount = 0, nextId = 0, unmatched = 0;
  let writerCount=0, writerCpuMs=0, writerBytes=0, writerError=null, writerCapped=null;
  const writerLimits={hooks:64,bytes:32768,cpuMs:100};
  let writerRead=false;
  function guard() {
    if(writerRead){if(Date.now()>=deadline)throw Error('deadline');if(writerBytes>=writerLimits.bytes||writerCpuMs>=writerLimits.cpuMs)throw Error('writer budget');return;}
    if (!active || Date.now() >= deadline) throw Error('deadline');
    if (bytes >= limits.bytes || rows >= limits.rows || cpuMs >= limits.cpuMs) throw Error('budget');
  }
  function get(c, n) { guard(); const v = c.exports[n](); guard(); return v >>> 0; }
  function read(c, address, length, guest = true) {
    guard(); if (!Number.isInteger(length) || length < 0 || length > 1024 || (writerRead ? writerBytes + length > writerLimits.bytes : bytes + length > limits.bytes)) throw Error('budget');
    const p = guest ? c.exports.guest_to_wasm(address) >>> 0 : address;
    guard(); const buffer = c.memory.buffer; guard();
    if (!Number.isSafeInteger(p) || p < 256 || p + length > buffer.byteLength) throw Error('bounds');
    const out = new Uint8Array(length), src = new Uint8Array(buffer, p, length);
    for (let i = 0; i < length; i++) { guard(); out[i] = src[i]; if(writerRead)writerBytes++;else bytes++; }
    guard(); return out;
  }
  function words(c, p, n) { const b = read(c, p, n * 4), v = new DataView(b.buffer); return Array.from({length: n}, (_, i) => v.getUint32(i * 4, true)); }
  function damage(c) { guard(); const v = readDamage(c, hwnd, (p, n) => read(c, p, n, false)); guard(); return v; }
  function record(r) {
    guard(); const key = JSON.stringify([r.kind, r.name, r.stack, r.result, r.before, r.after]);
    if (counts.has(key)) { counts.set(key, counts.get(key) + 1); return; }
    if (counts.size >= 96) throw Error('budget');
    counts.set(key, 1); rows++; emit({...r, at: Date.now()}); guard();
  }
  function observe(fn) {
    if (!active) return;
    if (Date.now() >= deadline) { active = false; capped = 'deadline'; return; }
    if (++hookCount > limits.hooks) { active = false; capped = 'hooks'; return; }
    const start = performance.now();
    try { guard(); fn(); }
    catch (e) { active = false; if (/budget|deadline/.test(String(e))) capped = String(e); else error = String(e); }
    finally { cpuMs += Math.max(0, performance.now() - start); if (cpuMs >= limits.cpuMs) { active = false; capped = 'cpuMs'; } }
  }
  function entry(args) {
    const c = getContext(); guard();
    let name = names.get(args[0]);
    if (name === undefined) {
      if (names.size >= 128) throw Error('budget');
      name = String.fromCharCode(...read(c, args[0], Math.min(args[1] >>> 0, 64), false)).split('\0')[0]; names.set(args[0], name);
    }
    if (frames.length >= limits.depth) throw Error('frame depth');
    const parent = [...frames].reverse().find(Boolean)?.id ?? null;
    frames.push(null); const spec = specs.get(name); if (!spec) return;
    const esp = get(c, 'get_esp'), stack = words(c, esp, spec[0] + 1);
    if (stack[spec[1]] !== hwnd) return;
    const msg = name.startsWith('CallWindowProc') ? stack[3] : name.startsWith('Def') ? stack[2] : null;
    // Preserve all validation/damage operations, and only paint/erase proc calls.
    if (msg !== null && msg !== 0xf && msg !== 0x14) return;
    const f = {id: ++nextId, parent, name, esp, stack, slot: c.slot, tid: get(c, 'get_current_thread_id'), before: damage(c)};
    frames[frames.length - 1] = f;
    record({kind: 'entry', ...f, callerCode: Array.from(read(c, stack[0] - 8, 32))});
  }
  function exit() {
    if (!frames.length) { unmatched++; return; }
    const f = frames.pop(); if (!f) return;
    const c = getContext(); guard();
    const tid = get(c, 'get_current_thread_id');
    if (tid !== f.tid || c.slot !== f.slot) throw Error('owning context changed');
    const result = get(c, 'get_eax'), eip = get(c, 'get_eip'), esp = get(c, 'get_esp');
    record({kind: 'handler-exit', ...f, result, eip, exitEsp: esp, after: damage(c),
      callbackReturn: 'unmeasured; guest dispatch can redirect after this handler',
      dlgprocHandled: 'unknown; DWL_MSGRESULT zero does not distinguish TRUE/FALSE'});
  }
  if(typeof host.invalidate!=='function')throw Error('missing invalidate');
  original.invalidate=host.invalidate;
  hooks.invalidate=function(...args){
    if(deadline&&!closed&&Date.now()<deadline&&[hwnd,0x10002,0x10003].includes(args[0]>>>0)&&writerCount<writerLimits.hooks&&!writerError&&!writerCapped){
      const start=performance.now();writerRead=true;
      try{writerCount++;const c=getContext(),esp=get(c,'get_esp');
        const target=args[0]>>>0;const snapshot=readDamage(c,target,(p,n)=>read(c,p,n,false));
        const eip=get(c,'get_eip');emit({kind:'writer',name:'host.invalidate',target,slot:c.slot,tid:get(c,'get_current_thread_id'),eip,esp,stack:words(c,esp,24),code:Array.from(read(c,eip,32)),damage:snapshot,parent:frames.filter(Boolean).map(f=>({id:f.id,name:f.name,stack:f.stack})),at:Date.now()});
      }catch(e){if(/budget|deadline/.test(String(e)))writerCapped=String(e);else writerError=String(e)}
      finally{writerRead=false;writerCpuMs+=Math.max(0,performance.now()-start);if(writerCpuMs>=writerLimits.cpuMs)writerCapped='cpuMs';}
    }
    try{return original.invalidate.apply(this,args)}catch(e){writerError='original import trap: '+String(e);throw e}
  };host.invalidate=hooks.invalidate;
  for (const [name, fn] of [['log', entry], ['log_api_exit', exit]]) {
    if (typeof host[name] !== 'function') throw Error('missing ' + name);
    original[name] = host[name];
  }
  for (const [name, fn] of [['log', entry], ['log_api_exit', exit]]) {
    hooks[name] = function(...args) {
      observe(() => fn(args));
      try { return original[name].apply(this, args); }
      catch (e) { active = false; error = 'original import trap: ' + String(e); throw e; }
    }; host[name] = hooks[name];
  }
  return {
    arm(target) { if (active || closed || deadline) throw Error('single arm required'); if (!Number.isInteger(target) || target <= 0) throw Error('HWND required'); hwnd = target; deadline = Date.now() + 8000; active = true; return {armed: true, deadline, limits}; },
    close() { active = false; closed = true; const pending = frames.filter(Boolean); for (const n of Object.keys(original)) if (host[n] === hooks[n]) host[n] = original[n];
      return {writer:{writerCount,writerCpuMs,writerBytes,writerError,writerCapped,limits:writerLimits},closed, deadline, error, capped, bytes, rows, cpuMs, hookCount, unmatched, pending, counts: Object.fromEntries(counts), scope: 'owning import entry/handler-exit damage; no raw DLGPROC BOOL or retired guest-return claim'}; },
  };
}

function readPaintDamage(c, hwnd, read, regions) {
  // WndRecord is six i32 fields, with HWND the publication field at offset 0.
  const table = regions.WND_RECORDS, capacity = table.size / 24;
  for (let i = 0; i < capacity; i++) {
    const b = read(table.base + i * 24, 4);
    if (new DataView(b.buffer).getUint32(0, true) !== hwnd) continue;
    const rect = read(regions.UPDATE_RECT.base + i * 16, 16), v = new DataView(rect.buffer);
    return {slot: i, update: read(regions.UPDATE_FLAGS.base + i, 1)[0], paint: read(regions.PAINT_FLAGS.base + i, 1)[0],
      rect: Array.from({length: 4}, (_, k) => v.getInt32(k * 4, true))};
  }
  return {destroyed: true};
}
if (typeof module !== 'undefined') module.exports = {installPaintOwnershipReceipt, readPaintDamage};
