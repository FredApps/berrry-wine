'use strict';

// Evaluate the emitted expression using CDP Runtime.evaluate in an INITIALIZED
// guest-worker.js target, not in the page/shadow instance. No guest writes.
// Read self.__wineCommandTrace.read(); uninstall with .stop(). This observer
// adds overhead: compare with an uninstrumented run before attributing a race.
function expression(capacity = 2048) {
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 16384)
    throw new Error('capacity must be an integer from 2 to 16384');
  return `(${install.toString()})(${capacity})`;
}

function install(capacity) {
  if (self.__wineCommandTrace) throw new Error('command trace already installed');
  if (typeof instance === 'undefined' || !instance || !instance.exports ||
      typeof threadSendFrames === 'undefined' || typeof self.onmessage !== 'function')
    throw new Error('attach to an initialized guest Worker, not the page');
  const previous = self.onmessage;
  const ring = new Array(capacity);
  let total = 0, command = 0, stopped = false, observerErrors = 0;
  const snapshot = (phase, id, msg) => {
    try {
      const ex = instance.exports;
      const get = name => typeof ex[name] === 'function' ? ex[name]() >>> 0 : null;
      ring[total % capacity] = {
        ordinal: total, at: performance.timeOrigin + performance.now(), phase, command: id,
        type: msg.t, seq: msg.seq, export: msg.name,
        eip: get('get_eip'), esp: get('get_esp'), yield: get('get_yield_reason'),
        frameDepth: threadSendFrames.length,
        frames: threadSendFrames.map(f => ({
          eip: f.snapshot.eip >>> 0, esp: f.snapshot.esp >>> 0,
          yield: f.snapshot.yieldReason, hwnd: f.send.hwnd, msg: f.send.msg,
        })),
      };
      total++;
    } catch (_) { observerErrors++; }
  };
  function observed(event) {
    const msg = event && event.data || {};
    const id = ++command;
    snapshot('entry', id, msg);
    try { return previous.call(this, event); }
    finally { snapshot('sync-return', id, msg); }
  }
  self.onmessage = observed;
  self.__wineCommandTrace = {
    read() {
      const events = [];
      for (let n = Math.max(0, total - capacity); n < total; n++) events.push(ring[n % capacity]);
      return { capacity, total, overwritten: Math.max(0, total - capacity),
        observerErrors, stopped, events,
        semantics: 'sync-return is the synchronous handler boundary; init is async. Install after init only.' };
    },
    stop() {
      if (self.onmessage !== observed) throw new Error('handler replaced by another observer');
      self.onmessage = previous;
      stopped = true;
      return this.read();
    },
  };
  return { installed: true, capacity };
}

module.exports = { expression };
if (require.main === module) process.stdout.write(expression(Number(process.argv[2] || 2048)) + '\n');
