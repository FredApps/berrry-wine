'use strict';

// Entries can be shared between live VFS maps and exit/chain snapshots. Each
// entry owns one provider lease while at least one managed map contains it.
// Provider arguments are borrowed; constructors/fork keep their caller-owned
// reference until that caller explicitly releases it after handoff.
(function(root) {
  function createOwnership(options = {}) {
    const entries = new WeakMap();
    const pending = new Set();
    const errors = [];
    const onError = options.onError || (error => console.error('[vfs ownership] release failed:', error));

    function report(error) {
      errors.push(error);
      try { onError(error); }
      catch (reportError) {
        errors.push(reportError);
        console.error('[vfs ownership] error reporter failed:', reportError, 'original:', error);
      }
    }

    function releaseProvider(provider) {
      let result;
      try { result = provider.release(); }
      catch (error) { report(error); return; }
      if (result != null) {
        const work = Promise.resolve(result).catch(report);
        pending.add(work);
        // work resolves even when release failed; diagnostics remain in errors.
        void work.then(() => pending.delete(work));
      }
    }

    function retainProvider(provider) {
      if (!provider || (typeof provider.retain !== 'function' && typeof provider.release !== 'function')) {
        return () => {};
      }
      if (typeof provider.retain !== 'function' || typeof provider.release !== 'function') {
        throw new TypeError('provider ownership requires both retain and release');
      }
      provider.retain();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        releaseProvider(provider);
      };
    }

    function acquireEntry(entry) {
      if (!entry || typeof entry !== 'object') throw new TypeError('VFS entry must be an object');
      const state = entries.get(entry);
      if (state) { state.refs++; return; }
      const release = retainProvider(entry._provider);
      entries.set(entry, { refs: 1, provider: entry._provider, release });
    }

    function releaseEntry(entry) {
      const state = entries.get(entry);
      if (!state || --state.refs) return;
      entries.delete(entry);
      state.release();
    }

    function setEntryProvider(entry, provider) {
      if (!entry || typeof entry !== 'object') throw new TypeError('VFS entry must be an object');
      const state = entries.get(entry);
      if (!state) { entry._provider = provider; return provider; }
      if (state.provider === provider) { entry._provider = provider; return provider; }
      // Acquire first: replacing a wrapper must not momentarily release its
      // underlying final lease. Failed retain leaves the old entry untouched.
      const release = retainProvider(provider);
      try { entry._provider = provider; }
      catch (error) { release(); throw error; }
      const previousRelease = state.release;
      state.provider = provider;
      state.release = release;
      previousRelease();
      return provider;
    }

    class OwnedFileMap extends Map {
      constructor(iterable) {
        super();
        try {
          if (iterable != null) for (const [path, entry] of iterable) this.set(path, entry);
        } catch (error) { this.clear(); throw error; }
      }
      set(path, entry) {
        if (this.has(path) && this.get(path) === entry) return this;
        acquireEntry(entry);
        const old = this.get(path);
        const existed = this.has(path);
        super.set(path, entry);
        if (existed) releaseEntry(old);
        return this;
      }
      delete(path) {
        if (!this.has(path)) return false;
        const entry = this.get(path);
        super.delete(path);
        releaseEntry(entry);
        return true;
      }
      clear() {
        const old = [...this.values()];
        super.clear();
        for (const entry of old) releaseEntry(entry);
      }
    }

    async function drain() {
      while (pending.size) await Promise.all([...pending]);
      return errors.slice();
    }

    return { OwnedFileMap, setEntryProvider, retainProvider, drain, errors };
  }

  const api = { createOwnership, ...createOwnership() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VfsEntryOwnership = api;
})(typeof window !== 'undefined' ? window : null);
