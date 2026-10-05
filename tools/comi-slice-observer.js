'use strict';
// Diagnostic-only page observer: no guest exports, scheduling or audio changes.
function install(options) {
  const { wine, now, setTimeout, clearTimeout } = options;
  const target = wine.guestWorker;
  if (!target || typeof target.slice !== 'function') throw Error('Main Worker missing');
  const original = target.slice;
  const own = Object.getOwnPropertyDescriptor(target, 'slice');
  const rows = [], errors = [];
  let closed = false, reason = null, timer, next = 0, overheadMs = 0;
  const start = now();
  function close(why = 'requested') {
    if (closed) return;
    closed = true; reason = why; clearTimeout(timer);
    if (target.slice === wrapped) {
      if (own) Object.defineProperty(target, 'slice', own);
      else delete target.slice;
    } else errors.push('Foreign slice replacement retained');
  }
  function record(row) {
    if (closed) return;
    const begin = now();
    if (wine.guestWorker !== target) { errors.push('Owner changed'); close('identity'); return; }
    rows.push(row);
    if (rows.length >= 512) close('512-record-cap');
    overheadMs += now() - begin;
  }
  function wrapped(...args) {
    const id = next++, requested = now();
    record({ kind: 'request', id, at: requested, steps: args[0], mmTimer: !!args[1]?.mmTimer });
    let result;
    try { result = Reflect.apply(original, this, args); }
    catch (error) { record({ kind: 'throw', id, at: now(), error: String(error) }); throw error; }
    // Attach a passive settlement listener; return the SAME Promise/object.
    if (result && typeof result.then === 'function') {
      result.then(value => {
        const data = {};
        for (const key of ['ms', 'blocks', 'eip', 'yield', 'sleepYielded', 'sleepMs', 'sleepLeftMs', 'localSleeps', 'localMessageWaits', 'timerDue', 'spinOwedMs', 'trapped']) {
          if (value && ['number', 'string', 'boolean'].includes(typeof value[key])) data[key] = value[key];
        }
        record({ kind: 'settled', id, at: now(), data });
      }, error => record({ kind: 'rejected', id, at: now(), error: String(error) })).catch(error => {
        errors.push('Observer error: ' + String(error)); close('observer-error');
      });
    } else record({ kind: 'non-promise', id, at: now() });
    return result;
  }
  Object.defineProperty(target, 'slice', { configurable: true, writable: true, value: wrapped });
  timer = setTimeout(() => close('5sec-limit'), 5000);
  return { close, snapshot: () => ({ start, end: now(), closed, reason, rows, errors, overheadMs,
    note: 'Page-clock request/settlement times; Worker ms is wall duration, not CPU; yield0 is budget-or-return.' }) };
}
if (typeof module !== 'undefined') module.exports = install;
