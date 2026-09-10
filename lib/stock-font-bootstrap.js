// Startup-only preparation of the five stock bitmap fonts. This module does
// not install fonts or mutate VFS entries. Call before guest execution, after
// final mounts/hydration; the caller must validate before publication and
// release in a finally. Publication across Worker calls is not atomic here.
(function (root) {
  'use strict';
  const paths = Object.freeze(['system', 'mssansserif', 'fixedsys', 'courier', 'terminal']
    .map(name => `c:\\windows\\fonts\\${name}.fon`));
  const maxBytes = 0xF0000;

  async function prepare(vfs, { signal } = {}) {
    if (!vfs || typeof vfs.prepareReadLease !== 'function') {
      throw new TypeError('stock fonts: VFS read leases are required');
    }
    const leases = [];
    let active = true;
    let abortSignal = signal;
    const release = () => {
      if (!active) return;
      active = false;
      if (abortSignal) abortSignal.removeEventListener('abort', release);
      abortSignal = null;
      // Remove references before releasing: even a faulty custom lease cannot
      // retain the rest of the batch or prevent their cleanup.
      const owned = leases.splice(0);
      let failure;
      for (const lease of owned) {
        try { lease.release(); } catch (error) { failure ||= error; }
      }
      if (failure) throw failure;
    };
    const isCurrent = () => active && !(abortSignal && abortSignal.aborted) &&
      leases.length === paths.length && leases.every(lease => lease.isCurrent());
    const checkPrepared = () => {
      if (!active || (abortSignal && abortSignal.aborted)) {
        throw new Error('stock fonts: preparation aborted or released');
      }
      if (!leases.every(lease => lease.isCurrent())) {
        throw new Error('stock fonts: prepared file changed');
      }
    };
    const get = index => {
      if (!Number.isInteger(index) || index < 0 || index >= paths.length) {
        throw new RangeError('stock fonts: invalid font index');
      }
      if (!isCurrent()) throw new Error('stock fonts: stale or released batch');
      return leases[index];
    };
    try {
      if (abortSignal) abortSignal.addEventListener('abort', release, { once: true });
      checkPrepared();
      for (const path of paths) {
        const lease = await vfs.prepareReadLease(path, { maxBytes, signal: abortSignal });
        // Abort can finish while this request is awaiting bytes. Its result
        // never joins an already-released batch; the lease owns in-flight IO.
        if (!active) {
          lease.release();
          throw new Error('stock fonts: preparation aborted or released');
        }
        leases.push(lease);
        checkPrepared();
      }
      return Object.freeze({ count: paths.length, isCurrent, release,
        read: index => { const lease = get(index); return lease.read(0, lease.size); },
        size: index => get(index).size });
    } catch (error) {
      try { release(); } catch (_) { /* preserve the preparation failure */ }
      throw error;
    } finally {
      // The ready batch retains leases, not the mounted filesystem itself.
      vfs = null;
      signal = null;
    }
  }

  const api = { prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockFontBootstrap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
