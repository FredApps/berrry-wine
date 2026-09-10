// Startup-only preparation and local installation of five stock bitmap fonts.
// Preparation does not mutate VFS entries. Call before guest execution, after
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

  // LOCAL executing-instance startup only: exports and memory must belong to
  // the same guest, never an idle shadow or an asynchronous Worker proxy.
  // All awaits finish before publication starts. Five installs are NOT atomic:
  // any error requires the caller to discard this unstarted guest process.
  async function install(vfs, { exports: ex, memory, signal } = {}) {
    for (const name of ['get_image_base', 'stock_font_state', 'stock_font_install', 'guest_alloc', 'guest_free']) {
      if (!ex || typeof ex[name] !== 'function') throw new TypeError(`stock fonts: local export ${name} required`);
    }
    if (!memory || !memory.buffer || !Number.isSafeInteger(memory.buffer.byteLength)) {
      throw new TypeError('stock fonts: matching WebAssembly memory required');
    }
    const mem = typeof module !== 'undefined' && module.exports ? require('./mem-utils') : (root.memUtils || root);
    if (typeof mem.g2w !== 'function' || typeof mem.g2wSpan !== 'function') {
      throw new TypeError('stock fonts: full guest address translation required');
    }
    const number = (value, name) => {
      if (!Number.isInteger(value)) throw new TypeError(`stock fonts: ${name} must return synchronously`);
      return value;
    };
    const batch = await prepare(vfs, { signal });
    try {
      const check = () => {
        if ((signal && signal.aborted) || !batch.isCurrent()) throw new Error('stock fonts: stale or aborted batch');
      };
      check();
      for (let index = 0; index < batch.count; index++) {
        if (number(ex.stock_font_state(index), 'stock_font_state') !== 0) {
          throw new Error(`stock fonts: ${paths[index]} is already initialized`);
        }
      }
      const imageBase = number(ex.get_image_base(), 'get_image_base') >>> 0;
      let installed = 0;
      for (let index = 0; index < batch.count; index++) {
        let pointer = 0;
        try {
          check();
          const bytes = batch.read(index);
          pointer = number(ex.guest_alloc(bytes.length), 'guest_alloc') >>> 0;
          if (!pointer) throw new Error('staging allocation failed');
          const buffer = memory.buffer;
          const address = mem.g2w(pointer, imageBase, buffer);
          const span = mem.g2wSpan(pointer, bytes.length, imageBase, buffer);
          if (address === 0xF0 || span < bytes.length || address > buffer.byteLength ||
              bytes.length > buffer.byteLength - address) {
            throw new Error('staging allocation is not a contiguous mapped span');
          }
          new Uint8Array(buffer, address, bytes.length).set(bytes);
          check();
          const count = number(ex.stock_font_install(index, pointer, bytes.length), 'stock_font_install');
          if (count <= 0) throw new Error('native font validation or installation failed');
          installed += count;
        } catch (error) {
          throw new Error(`stock fonts: ${paths[index]}: ${error.message}; discard the unstarted process`, { cause: error });
        } finally {
          if (pointer) ex.guest_free(pointer);
        }
      }
      check();
      return installed;
    } finally { batch.release(); }
  }

  const api = { prepare, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockFontBootstrap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
