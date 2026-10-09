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
      typeof threadSendFrames === 'undefined' || typeof self.onmessage !== 'function' ||
      typeof self.postMessage !== 'function')
    throw new Error('attach to an initialized guest Worker, not the page');
  const previous = self.onmessage;
  const previousPost = self.postMessage;
  const ring = new Array(capacity);
  let total = 0, command = 0, stopped = false, observerErrors = 0;
  let firstTrap = null;
  const events = () => {
    const out = [];
    for (let n = Math.max(0, total - capacity); n < total; n++) out.push(ring[n % capacity]);
    return out;
  };
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
  function observedPost(msg) {
    // Freeze before the host receives the trap and starts teardown or polling.
    // Keep this separate from the rolling ring, which must remain useful for
    // later commands. Forward the original object and transfer list unchanged.
    if (!firstTrap && msg && msg.trapped) {
      try {
        snapshot('trapped-reply', command, msg);
        const ex = instance.exports;
        const read = (base, count) => {
          const bytes = [];
          if (typeof ex.guest_read8 !== 'function') return null;
          for (let i = 0; i < count; i++) bytes.push(ex.guest_read8((base + i) >>> 0) & 255);
          return bytes;
        };
        firstTrap = {
          at: performance.timeOrigin + performance.now(), type: msg.t, seq: msg.seq,
          trapped: String(msg.trapped), total, events: events(),
        };
        const eip = ex.get_eip() >>> 0, esp = ex.get_esp() >>> 0;
        firstTrap.memory = { eip, esp, codeBase: (eip - 64) >>> 0,
          code: read((eip - 64) >>> 0, 128), stack: read(esp, 256) };
      } catch (_) { observerErrors++; }
    }
    return previousPost.apply(this, arguments);
  }
  self.onmessage = observed;
  self.postMessage = observedPost;
  self.__wineCommandTrace = {
    read() {
      return { capacity, total, overwritten: Math.max(0, total - capacity),
        observerErrors, stopped, events: events(), firstTrap,
        semantics: 'sync-return is the synchronous handler boundary; init is async. Install after init only.' };
    },
    stop() {
      if (self.onmessage !== observed) throw new Error('handler replaced by another observer');
      if (self.postMessage !== observedPost) throw new Error('postMessage replaced by another observer');
      self.onmessage = previous;
      self.postMessage = previousPost;
      stopped = true;
      return this.read();
    },
  };
  return { installed: true, capacity };
}

module.exports = { expression };
if (require.main === module) process.stdout.write(expression(Number(process.argv[2] || 2048)) + '\n');
