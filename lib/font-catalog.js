// Startup-only metadata catalog preparation. No permanent VFS materialization.
// Local publication retains aggregate leases + one 4MiB read copy + native
// staging; remote publication also retains bounded message copies on both
// sides. These bounds exclude existing VFS/cache ownership. Local installation
// requires executing exports, never an idle shadow or async proxy; use the
// dedicated remote startup protocol for a Worker.
(function (root) {
  'use strict';
  const directory = 'c:\\windows\\fonts\\';
  const fileCap = 4 * 1024 * 1024;
  const normalize = value => String(value).replace(/\//g, '\\').toLowerCase();

  function enumerate(vfs, excluded) {
    const result = [];
    const first = vfs.findFirstFile(directory + '*.ttf');
    try {
      for (let entry = first.entry; entry; entry = vfs.findNextFile(first.handle)) {
        if (entry.attrs & 0x10) continue;
        const name = String(entry.name);
        if (/[\\/]/.test(name) || !/\.ttf$/i.test(name)) continue;
        const path = directory + name.toLowerCase();
        if (excluded.has(path)) continue;
        if (!/^[\x20-\x7e]+$/.test(path) || path.length > 131) throw new Error('font catalog: invalid font path');
        if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > fileCap) {
          throw new RangeError(`font catalog: invalid size for ${path}`);
        }
        result.push({ path, size: entry.size });
        if (result.length > 32) throw new RangeError('font catalog: more than 32 candidates');
      }
    } finally { if (first.handle) vfs.findClose(first.handle); }
    result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (let i = 1; i < result.length; i++) {
      if (result[i].path === result[i - 1].path) throw new Error('font catalog: duplicate path');
    }
    return result;
  }

  async function prepare(vfs, { signal, excludedPaths = [], maxTotalBytes = 16 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0 || maxTotalBytes > 32 * fileCap) {
      throw new RangeError('font catalog: invalid aggregate budget');
    }
    for (const name of ['prepareReadLease', 'findFirstFile', 'findNextFile', 'findClose']) {
      if (!vfs || typeof vfs[name] !== 'function') throw new TypeError(`font catalog: VFS ${name} required`);
    }
    if (!Array.isArray(excludedPaths)) throw new TypeError('font catalog: excludedPaths must be an array');
    let excluded = new Set(excludedPaths.map(normalize));
    let owner = vfs, abortSignal = signal, membership = null;
    const leases = [];
    let active = true, ready = false;
    const release = () => {
      if (!active) return;
      active = false;
      if (abortSignal) abortSignal.removeEventListener('abort', release);
      abortSignal = null;
      owner = null; membership = null; excluded = null;
      // Abort listeners cannot surface arbitrary custom-release exceptions.
      for (const lease of leases.splice(0)) { try { lease.release(); } catch (_) {} }
    };
    const current = () => {
      if (!active || (abortSignal && abortSignal.aborted)) return false;
      try {
        const now = enumerate(owner, excluded);
        return now.length === membership.length && now.every((entry, i) =>
          entry.path === membership[i].path && entry.size === membership[i].size) &&
          leases.every(lease => lease.isCurrent());
      } catch (_) { return false; }
    };
    const check = () => { if (!current()) throw new Error('font catalog: stale, canceled or released snapshot'); };
    const get = index => {
      if (!Number.isInteger(index) || index < 0 || !membership || index >= membership.length) {
        throw new RangeError('font catalog: invalid index');
      }
      check();
      return leases[index];
    };
    try {
      if (signal && signal.aborted) throw new Error('font catalog: aborted');
      membership = enumerate(owner, excluded);
      if (abortSignal) abortSignal.addEventListener('abort', release, { once: true });
      let used = 0;
      for (let i = 0; i < membership.length; i++) {
        check();
        const remaining = maxTotalBytes - used;
        if (membership[i].size > remaining) throw new RangeError('font catalog: aggregate budget exceeded');
        const lease = await owner.prepareReadLease(membership[i].path,
          { maxBytes: Math.min(fileCap, remaining), signal: abortSignal });
        if (!active) { try { lease.release(); } catch (_) {} throw new Error('font catalog: aborted'); }
        leases.push(lease);
        check();
        if (lease.size !== membership[i].size) throw new Error('font catalog: lease size changed');
        used += lease.size;
      }
      check(); ready = true;
      return Object.freeze({ count: membership.length,
        path(index) { get(index); return membership[index].path; },
        size(index) { return get(index).size; },
        read(index) { const lease = get(index); return lease.read(0, lease.size); },
        isCurrent: () => ready && current(), release });
    } catch (error) { release(); throw error; }
    finally { vfs = null; signal = null; excludedPaths = null; }
  }

  function installBatch(batch, { exports: ex, memory, check = () => {} } = {}) {
    for (const name of ['font_catalog_begin', 'font_catalog_add', 'font_catalog_commit',
      'font_catalog_abort', 'guest_alloc', 'guest_free', 'get_image_base']) {
      if (!ex || typeof ex[name] !== 'function') throw new TypeError(`font catalog: local ${name} export required`);
    }
    if (!memory || !memory.buffer) throw new TypeError('font catalog: memory required');
    if (!batch || !Number.isInteger(batch.count) || batch.count < 0 || batch.count > 32) {
      throw new TypeError('font catalog: invalid batch');
    }
    const mem = typeof module !== 'undefined' && module.exports ? require('./mem-utils') : (root.memUtils || root);
    const number = value => { if (!Number.isInteger(value)) throw new TypeError('font catalog: synchronous exports required'); return value; };
    const valid = () => { check(); if (!batch.isCurrent()) throw new Error('font catalog: stale batch'); };
    const imageBase = number(ex.get_image_base()) >>> 0;
    const copy = (pointer, bytes) => {
      const buffer = memory.buffer, address = mem.g2w(pointer, imageBase, buffer);
      if (address === 0xf0 || mem.g2wSpan(pointer, bytes.length, imageBase, buffer) < bytes.length ||
          address > buffer.byteLength || bytes.length > buffer.byteLength - address) {
        throw new Error('font catalog: unmapped staging allocation');
      }
      new Uint8Array(buffer, address, bytes.length).set(bytes);
    };
    valid();
    const token = number(ex.font_catalog_begin()) >>> 0;
    if (!token) throw new Error('font catalog: native transaction unavailable');
    let committed = false;
    try {
      for (let i = 0; i < batch.count; i++) {
        let pathPointer = 0, dataPointer = 0;
        try {
          valid();
          const path = batch.path(i), bytes = batch.read(i);
          if (typeof path !== 'string' || !/^[\x20-\x7e]+$/.test(path) || path.length > 131 ||
              !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > fileCap) {
            throw new Error('font catalog: invalid staged font');
          }
          const name = Uint8Array.from([...path].map(char => char.charCodeAt(0)).concat(0));
          pathPointer = number(ex.guest_alloc(name.length)) >>> 0;
          if (!pathPointer) throw new Error('font catalog: path allocation failed');
          copy(pathPointer, name);
          dataPointer = number(ex.guest_alloc(bytes.length)) >>> 0;
          if (!dataPointer) throw new Error('font catalog: data allocation failed');
          copy(dataPointer, bytes);
          valid();
          if (number(ex.font_catalog_add(token, pathPointer, dataPointer, bytes.length)) !== 1) {
            throw new Error(`font catalog: invalid metadata for ${path}`);
          }
        } finally {
          try { if (dataPointer) ex.guest_free(dataPointer); }
          finally { if (pathPointer) ex.guest_free(pathPointer); }
        }
      }
      valid();
      if (number(ex.font_catalog_commit(token)) !== 1) throw new Error('font catalog: commit rejected');
      committed = true;
      return batch.count;
    } finally { if (!committed) ex.font_catalog_abort(token); }
  }

  function excludedPaths({ exports: ex, memory } = {}) {
    if (!ex || typeof ex.font_catalog_exclusion_path !== 'function' || !memory || !memory.buffer) {
      throw new TypeError('font catalog: executing exclusion export and memory required');
    }
    const paths = new Set();
    for (let index = 0; index <= 256; index++) {
      const value = ex.font_catalog_exclusion_path(index);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new TypeError('font catalog: synchronous unsigned exclusion address required');
      }
      const pointer = value >>> 0;
      if (!pointer) return Object.freeze([...paths]);
      if (index === 256) throw new RangeError('font catalog: too many native exclusions');
      const bytes = new Uint8Array(memory.buffer);
      let path = '', terminated = false;
      for (let offset = 0; offset <= 131; offset++) {
        if (pointer >= bytes.length || offset >= bytes.length - pointer) {
          throw new RangeError('font catalog: exclusion outside memory');
        }
        const byte = bytes[pointer + offset];
        if (!byte) { terminated = true; break; }
        if (byte < 0x20 || byte > 0x7e) throw new Error('font catalog: non-ASCII exclusion');
        path += String.fromCharCode(byte);
      }
      if (!terminated || !path) throw new Error('font catalog: invalid exclusion length');
      paths.add(normalize(path));
    }
    throw new RangeError('font catalog: too many native exclusions');
  }

  async function install(vfs, options = {}) {
    const nativePaths = excludedPaths(options);
    if (options.excludedPaths !== undefined && !Array.isArray(options.excludedPaths)) {
      throw new TypeError('font catalog: excludedPaths must be an array');
    }
    const batch = await prepare(vfs, { ...options,
      excludedPaths: [...nativePaths, ...(options.excludedPaths || [])] });
    try { return installBatch(batch, { ...options, check() {
      if (options.check) options.check();
      const currentPaths = excludedPaths(options);
      if (currentPaths.length !== nativePaths.length ||
          currentPaths.some((path, index) => path !== nativePaths[index])) {
        throw new Error('font catalog: native exclusion policy changed');
      }
    } }); }
    finally { batch.release(); }
  }
  // Dedicated Worker protocol bounds, validated before cloning any bytes.
  function validateEntries(entries, expectedExcludedPaths) {
    if (!Array.isArray(entries) || entries.length > 32) throw new TypeError('font catalog: invalid entries');
    if (!Array.isArray(expectedExcludedPaths) || expectedExcludedPaths.length > 256 ||
        expectedExcludedPaths.some(path => typeof path !== 'string' || !/^[\x20-\x7e]+$/.test(path) || path.length > 131)) {
      throw new TypeError('font catalog: invalid expected exclusions');
    }
    const excluded = new Set(expectedExcludedPaths.map(normalize)), seen = new Set();
    let total = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.path !== 'string' || !/^[\x20-\x7e]+$/.test(entry.path) || entry.path.length > 131 ||
          !(entry.bytes instanceof Uint8Array) || !entry.bytes.length || entry.bytes.length > fileCap) {
        throw new TypeError('font catalog: invalid entry');
      }
      const path = normalize(entry.path);
      if (!/^c:\\windows\\fonts\\[^\\:]+\.ttf$/.test(path)) {
        throw new Error('font catalog: entry must be a direct font-directory TTF');
      }
      if (excluded.has(path) || seen.has(path)) throw new Error('font catalog: excluded or duplicate entry');
      seen.add(path); total += entry.bytes.length;
      if (total > 16 * 1024 * 1024) throw new RangeError('font catalog: Worker aggregate budget exceeded');
    }
  }

  function installEntries(entries, { expectedExcludedPaths, ...options } = {}) {
    validateEntries(entries, expectedExcludedPaths);
    const expected = [...new Set(expectedExcludedPaths.map(normalize))].sort();
    const policyCurrent = () => {
      const actual = excludedPaths(options).slice().sort();
      return actual.length === expected.length && actual.every((path, i) => path === expected[i]);
    };
    if (!policyCurrent()) throw new Error('font catalog: native exclusion policy mismatch');
    const owned = entries.map(entry => ({ path: normalize(entry.path), bytes: new Uint8Array(entry.bytes) }));
    return installBatch({ count: owned.length, path: i => owned[i].path,
      read: i => owned[i].bytes, isCurrent: policyCurrent }, options);
  }

  // Source leases outlive the remote publication reply. A failed/uncertain
  // reply or a changed source after publication requires process discard; do
  // not stop here, because stop joins the caller's startup completion barrier.
  async function installRemote(vfs, { worker, signal, check = () => {} } = {}) {
    let batch = null;
    let cancelPreparation = null;
    const valid = () => {
      check();
      if ((signal && signal.aborted) || (batch && !batch.isCurrent())) {
        throw new Error('font catalog: canceled or stale remote startup');
      }
    };
    try {
      valid();
      if (!worker || typeof worker.getFontCatalogStartupState !== 'function' ||
          typeof worker.getFontCatalogExclusions !== 'function' || typeof worker.installFontCatalog !== 'function') {
        throw new TypeError('font catalog: executing Worker startup API required');
      }
      const state = await worker.getFontCatalogStartupState();
      valid();
      if (state !== 'OPEN') throw new Error('font catalog: Worker startup is not open');
      const exclusions = await worker.getFontCatalogExclusions();
      valid();
      const preparation = new AbortController();
      cancelPreparation = () => preparation.abort();
      if (signal) signal.addEventListener('abort', cancelPreparation, { once: true });
      try {
        batch = await prepare(vfs, { signal: preparation.signal,
          excludedPaths: exclusions, maxTotalBytes: 16 * 1024 * 1024 });
      } finally {
        if (signal) signal.removeEventListener('abort', cancelPreparation);
        cancelPreparation = null;
      }
      // Once publication can begin, external abort must not release its input
      // leases until the Worker settles. valid() still rejects cancellation.
      valid();
      const entries = Array.from({ length: batch.count }, (_, i) => ({ path: batch.path(i), bytes: batch.read(i) }));
      valid();
      const result = await worker.installFontCatalog(entries, exclusions);
      valid();
      if (!result || result.count !== batch.count || !Number.isInteger(result.generation) ||
          result.generation <= 0 || result.generation > 0xffffffff) {
        throw new Error('font catalog: invalid remote publication reply');
      }
      return result;
    } catch (error) {
      throw new Error(`${error.message || error}; discard the unstarted process`, { cause: error });
    } finally {
      if (signal && cancelPreparation) signal.removeEventListener('abort', cancelPreparation);
      if (batch) batch.release();
    }
  }

  const api = { prepare, installBatch, install, excludedPaths, validateEntries, installEntries, installRemote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FontCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
