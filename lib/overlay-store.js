// Versioned persistence for the writable C: overlay.
//
// list/read/writeBatch/remove retain the original store contract. Durable
// stores also expose openSnapshot(): metadata + version-pinned providers.
// Each provider initially owns one reference; retain() returns that provider
// with another reference, release() drops one. snapshot.release() drops the
// initial references once. Range reads temporarily retain their own reference.
// writeBatch(records, {snapshot:true}) returns result.snapshot pinned before
// releasing the writer lock, so checkpoint rebasing sees precisely that commit.
// The caller owns/release()s this snapshot; ordinary writes create no lease.
//
// writeBatch file records accept data, or {size, base: provider, baseSize, ranges}.
// Optional baseSize discards baseline bytes beyond a prior truncation; omitted
// it defaults to min(base.size, size). Re-extending the discarded tail yields zeros.
// Ranges are sorted nonoverlapping {offset, data} patches. Same-store bases
// reuse immutable extents without reading them; other providers are streamed
// in bounded chunks. Missing extents represent zeros. The index is published
// only after all new blobs exist. No power-loss fsync guarantee is made.
//
// Node directories are coordinated within this JS process, not across
// independent Node processes. OPFS transactions and snapshot leases use Web
// Locks across tabs. Leased snapshot manifests keep obsolete blobs alive;
// a crashed tab loses its lease and the next collection reclaims its blobs.
(function () {
  const KINDS = new Set(['file', 'dir', 'whiteout']);
  const STORE_METHODS = ['list', 'read', 'writeBatch', 'remove'];
  const INDEX_VERSION = 1;
  const RANGE_CHUNK_SIZE = 256 * 1024;
  const versions = new WeakMap();
  const nodeScopes = new Map();
  const rootIds = new WeakMap();
  let nextRootId = 1;

  function assertStore(store, label) {
    const what = label ? label + ': ' : '';
    if (!store || typeof store !== 'object') throw new Error(what + 'overlay store must be an object');
    for (const name of STORE_METHODS) {
      if (typeof store[name] !== 'function') throw new Error(what + 'overlay store is missing ' + name + '()');
    }
    return store;
  }

  function integer(value, label) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(label + ' must be a non-negative safe integer');
    return n;
  }

  function fileTime(value) {
    if (!value || !Number.isFinite(value.lo) || !Number.isFinite(value.hi)) return null;
    return { lo: value.lo >>> 0, hi: value.hi >>> 0 };
  }

  function metaOf(record) {
    if (!KINDS.has(record.kind)) throw new Error('overlay record kind must be file/dir/whiteout');
    return {
      path: String(record.path), kind: record.kind, attrs: (record.attrs >>> 0) || 0,
      size: record.kind === 'file'
        ? integer(record.data ? record.data.length : (record.size == null ? 0 : record.size), 'overlay record size') : 0,
      creationTime: fileTime(record.creationTime),
      lastAccessTime: fileTime(record.lastAccessTime), lastWriteTime: fileTime(record.lastWriteTime),
    };
  }

  function uuid() {
    const crypto = typeof require === 'function' ? require('crypto') : globalThis.crypto;
    return crypto.randomUUID();
  }

  function blobNameValid(name) {
    return typeof name === 'string' && /^[A-Za-z0-9_-]+\.bin$/.test(name);
  }

  function extentsOf(record) {
    if (record.kind !== 'file') return [];
    if (record.blob) {
      if (!blobNameValid(record.blob)) throw new Error('invalid overlay blob name');
      return record.size ? [{ start: 0, length: record.size, blob: record.blob, offset: 0, blobSize: record.size }] : [];
    }
    if (!Array.isArray(record.extents)) throw new Error('overlay file record has no blob or extents');
    let end = 0;
    return record.extents.map(raw => {
      const e = {
        start: integer(raw.start, 'extent start'), length: integer(raw.length, 'extent length'),
        offset: integer(raw.offset, 'extent offset'), blobSize: integer(raw.blobSize, 'blob size'), blob: raw.blob,
      };
      if (!e.length || !blobNameValid(e.blob) || e.start < end ||
          e.length > record.size - e.start || e.offset > e.blobSize || e.length > e.blobSize - e.offset) {
        throw new Error('invalid or overlapping overlay extent');
      }
      end = e.start + e.length;
      return e;
    });
  }

  function storedRecord(raw) {
    const record = metaOf(raw);
    if (record.kind === 'file') {
      if (raw.blob) record.blob = raw.blob;
      else record.extents = raw.extents;
      const extents = extentsOf(record);
      if (!record.blob) record.extents = extents;
    }
    return record;
  }

  function copyRecord(record) {
    const copy = { ...record };
    if (record.extents) copy.extents = record.extents.map(e => ({ ...e }));
    return copy;
  }

  function blobSet(records) {
    const names = new Set();
    for (const record of records) {
      if (record.kind !== 'file') continue;
      if (record.blob) names.add(record.blob);
      for (const extent of extentsOf(record)) names.add(extent.blob);
    }
    return names;
  }

  function sliceExtents(extents, start, end) {
    const result = [];
    for (const e of extents) {
      const lo = Math.max(start, e.start), hi = Math.min(end, e.start + e.length);
      if (hi > lo) result.push({ ...e, start: lo, offset: e.offset + lo - e.start, length: hi - lo });
    }
    return result;
  }

  function rangeBounds(size, offset, length) {
    const start = integer(offset, 'range offset'), count = integer(length, 'range length');
    return { start: Math.min(start, size), length: start >= size ? 0 : Math.min(count, size - start) };
  }

  async function readRecord(backend, record, offset, length) {
    const range = rangeBounds(record.size, offset, length);
    const out = new Uint8Array(range.length);
    for (const e of sliceExtents(extentsOf(record), range.start, range.start + range.length)) {
      for (let copied = 0; copied < e.length; copied += RANGE_CHUNK_SIZE) {
        const want = Math.min(RANGE_CHUNK_SIZE, e.length - copied);
        const data = await backend.readBlob(e.blob, e.offset + copied, want, e.blobSize);
        if (!(data instanceof Uint8Array) || data.length !== want) throw new Error('short overlay range read');
        out.set(data, e.start - range.start + copied);
      }
    }
    return out;
  }

  function prepareBatch(input) {
    return [...(input || [])].map(raw => {
      const record = { ...raw };
      record.size = metaOf(record).size;
      if (record.baseSize !== undefined) integer(record.baseSize, 'baseSize');
      if (raw.data) record.data = new Uint8Array(raw.data);
      if (raw.ranges !== undefined) {
        if (!Array.isArray(raw.ranges)) throw new Error('overlay ranges must be an array');
        let end = 0;
        record.ranges = raw.ranges.map(range => {
          const offset = integer(range.offset, 'patch offset');
          const data = new Uint8Array(range.data || 0);
          if (offset < end || offset > record.size || data.length > record.size - offset) {
            throw new RangeError('overlay ranges must be ordered, nonoverlapping and within final size');
          }
          end = offset + data.length;
          return { offset, data };
        });
      }
      if (record.data && (record.base || record.ranges)) throw new Error('overlay data cannot be combined with base/ranges');
      return record;
    });
  }

  async function buildRecord(backend, raw, created) {
    const record = metaOf(raw);
    if (record.kind !== 'file') return record;
    let extents = [];
    async function addBytes(start, data) {
      for (let offset = 0; offset < data.length; offset += RANGE_CHUNK_SIZE) {
        const bytes = data.subarray(offset, Math.min(data.length, offset + RANGE_CHUNK_SIZE));
        const blob = uuid() + '.bin';
        await backend.writeBlob(blob, bytes);
        created.add(blob);
        extents.push({ start: start + offset, length: bytes.length, blob, offset: 0, blobSize: bytes.length });
      }
    }
    if (raw.data) {
      await addBytes(0, raw.data);
    } else if (raw.base) {
      const baseSize = Math.min(record.size, integer(raw.base.size, 'base provider size'),
        raw.baseSize === undefined ? Number.MAX_SAFE_INTEGER : integer(raw.baseSize, 'baseSize'));
      const pinned = versions.get(raw.base);
      if (pinned && !pinned.active()) throw new Error('overlay base provider has been released');
      if (pinned && pinned.key === backend.key) {
        extents = sliceExtents(extentsOf(pinned.record), 0, baseSize);
      } else {
        if (typeof raw.base.readRange !== 'function') throw new Error('overlay base provider has no readRange');
        const size = Math.min(record.size, baseSize);
        for (let offset = 0; offset < size; offset += RANGE_CHUNK_SIZE) {
          const want = Math.min(RANGE_CHUNK_SIZE, size - offset);
          const bytes = await raw.base.readRange(offset, want);
          if (!(bytes instanceof Uint8Array) || bytes.length !== want) throw new Error('short overlay base provider read');
          await addBytes(offset, bytes);
        }
      }
    }
    for (const range of raw.ranges || []) {
      if (!range.data.length) continue;
      extents = [
        ...sliceExtents(extents, 0, range.offset),
        ...sliceExtents(extents, range.offset + range.data.length, record.size),
      ];
      await addBytes(range.offset, range.data);
    }
    extents.sort((a, b) => a.start - b.start);
    // Keep the original single-blob format for small, contiguous files.
    if (extents.length === 1 && extents[0].start === 0 && extents[0].offset === 0 &&
        extents[0].length === record.size && extents[0].blobSize === record.size) record.blob = extents[0].blob;
    else record.extents = extents;
    return record;
  }

  function makeStore(backend) {
    let initialCleanup = true;
    async function collect(records) {
      const live = blobSet(records.values());
      for (const name of await backend.pinnedBlobs()) live.add(name);
      for (const name of await backend.listBlobs()) {
        if (!live.has(name)) {
          try { await backend.removeBlob(name); } catch (_) {}
        }
      }
      initialCleanup = false;
    }

    async function current() {
      const records = await backend.load();
      if (initialCleanup) await collect(records);
      return records;
    }

    async function openSnapshotUnlocked() {
      const records = await current();
      const unpin = await backend.pin(blobSet(records.values()));
      let totalRefs = 0, snapshotReleased = false, finishing = null;
      const files = [];
      const list = [...records.values()].map(record => {
        if (record.kind !== 'file') return copyRecord(record);
        let refs = 1;
        totalRefs++;
        const provider = {
          size: record.size,
          retain() {
            if (!refs) throw new Error('overlay provider has been released');
            refs++; totalRefs++;
            return provider;
          },
          release() {
            if (!refs) return finishing || Promise.resolve();
            refs--; totalRefs--;
            if (!totalRefs && !finishing) {
              finishing = backend.run(async () => {
                await unpin();
                await collect(await backend.load());
              });
            }
            return finishing || Promise.resolve();
          },
          async readRange(offset, length) {
            provider.retain();
            try { return await readRecord(backend, record, offset, length); }
            finally { await provider.release(); }
          },
        };
        versions.set(provider, { key: backend.key, record, active: () => refs > 0 });
        files.push(provider);
        return { ...metaOf(record), provider };
      });
      // Empty snapshots have no payload to protect.
      if (!totalRefs) await unpin();
      return {
        records: list,
        release() {
          if (snapshotReleased) return finishing || Promise.resolve();
          snapshotReleased = true;
          return Promise.all(files.map(provider => provider.release())).then(() => undefined);
        },
      };
    }

    return {
      kind: backend.kind, scope: backend.scope, dir: backend.dir,
      openSnapshot() { return backend.run(openSnapshotUnlocked); },
      list() { return backend.run(async () => [...(await current()).values()].map(copyRecord)); },
      read(path) {
        return backend.run(async () => {
          const record = (await current()).get(String(path));
          return !record || record.kind !== 'file' ? null : readRecord(backend, record, 0, record.size);
        });
      },
      readSnapshot() {
        return backend.run(async () => {
          const result = [];
          for (const record of (await current()).values()) {
            const copy = copyRecord(record);
            if (record.kind === 'file') {
              try { copy.data = await readRecord(backend, record, 0, record.size); }
              catch (readError) { copy.readError = readError; }
            }
            result.push(copy);
          }
          return result;
        });
      },
      writeBatch(input, options = {}) {
        let batch, retained = [];
        async function releaseBases() {
          const settled = await Promise.allSettled(retained.map(provider =>
            Promise.resolve().then(() => provider.release())));
          const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason);
          for (const error of errors) {
            try { backend.log('[overlay] base release failed: ' + String(error)); } catch (_) {}
          }
          return errors;
        }
        try {
          batch = prepareBatch(input);
          for (const raw of batch) {
            if (raw.base && typeof raw.base.retain === 'function') {
              raw.base.retain(); retained.push(raw.base);
            }
          }
        } catch (error) {
          return releaseBases().then(() => { throw error; });
        }
        return backend.run(async () => {
          const records = await current(), next = new Map(records), created = new Set();
          try {
            for (const raw of batch) next.set(String(raw.path), await buildRecord(backend, raw, created));
            await backend.commit(next);
          } catch (error) {
            for (const name of created) { try { await backend.removeBlob(name); } catch (_) {} }
            throw error;
          }
          await collect(next);
          backend.log('[overlay] wrote ' + batch.length + ' record(s)');
          const result = { written: batch.length, removed: 0 };
          if (options.snapshot) result.snapshot = await openSnapshotUnlocked();
          return result;
        }).then(async result => {
          const cleanupErrors = await releaseBases();
          if (cleanupErrors.length) result.cleanupErrors = cleanupErrors;
          return result;
        }, async error => {
          await releaseBases();
          throw error;
        });
      },
      remove(path) {
        return backend.run(async () => {
          const records = await current();
          if (!records.delete(String(path))) return;
          await backend.commit(records);
          await collect(records);
        });
      },
    };
  }

  function serial(state, fn) {
    const operation = state.operation.then(fn, fn);
    state.operation = operation.catch(() => {});
    return operation;
  }

  function memoryStore() {
    const state = { operation: Promise.resolve(), records: new Map(), blobs: new Map(), pins: new Set() };
    const backend = {
      kind: 'memory', key: state, run: fn => serial(state, fn), log: () => {},
      load: async () => new Map(state.records),
      commit: async records => { state.records = records; },
      readBlob: async (name, offset, length, size) => {
        const data = state.blobs.get(name);
        if (!data || data.length !== size) throw new Error('missing or short memory overlay blob');
        return data.slice(offset, offset + length);
      },
      writeBlob: async (name, data) => { state.blobs.set(name, new Uint8Array(data)); },
      removeBlob: async name => { state.blobs.delete(name); },
      listBlobs: async () => [...state.blobs.keys()],
      pin: async names => { state.pins.add(names); return async () => { state.pins.delete(names); }; },
      pinnedBlobs: async () => new Set([...state.pins].flatMap(names => [...names])),
    };
    return makeStore(backend);
  }

  function parseIndex(raw, scope) {
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== INDEX_VERSION || !Array.isArray(parsed.records) ||
        (scope !== undefined && parsed.scope !== scope)) throw new Error('invalid overlay index');
    const records = new Map();
    for (const raw of parsed.records) {
      const record = storedRecord(raw);
      if (records.has(record.path)) throw new Error('duplicate overlay index path: ' + record.path);
      records.set(record.path, record);
    }
    return records;
  }

  function nodeDirStore(dir, options = {}) {
    const fs = require('fs'), path = require('path');
    const root = path.resolve(dir), blobDir = path.join(root, 'blobs'), indexPath = path.join(root, 'index.json');
    let state = nodeScopes.get(root);
    if (!state) nodeScopes.set(root, state = { operation: Promise.resolve(), pins: new Set() });
    const backend = {
      kind: 'node-dir', key: 'node:' + root, dir: root, log: options.log || (() => {}),
      run: fn => serial(state, fn),
      async load() {
        try { return parseIndex(fs.readFileSync(indexPath, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
      },
      async commit(records) {
        fs.mkdirSync(root, { recursive: true });
        const temp = indexPath + '.tmp';
        fs.writeFileSync(temp, JSON.stringify({ version: INDEX_VERSION, records: [...records.values()] }));
        fs.renameSync(temp, indexPath);
      },
      async readBlob(name, offset, length, expectedSize) {
        const fd = fs.openSync(path.join(blobDir, name), 'r');
        try {
          const size = fs.fstatSync(fd).size;
          if (size !== expectedSize) throw new Error('overlay blob is ' + size + ' bytes, index says ' + expectedSize);
          const out = new Uint8Array(length);
          let read = 0;
          while (read < length) {
            const count = fs.readSync(fd, out, read, length - read, offset + read);
            if (!count) throw new Error('short overlay range read');
            read += count;
          }
          return out;
        } finally { fs.closeSync(fd); }
      },
      async writeBlob(name, data) {
        fs.mkdirSync(blobDir, { recursive: true });
        const file = path.join(blobDir, name), fd = fs.openSync(file, 'wx');
        try { fs.writeFileSync(fd, data); }
        catch (error) { try { fs.unlinkSync(file); } catch (_) {} throw error; }
        finally { fs.closeSync(fd); }
      },
      async removeBlob(name) { fs.unlinkSync(path.join(blobDir, name)); },
      async listBlobs() {
        try { return fs.readdirSync(blobDir); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      },
      async pin(names) { state.pins.add(names); return async () => { state.pins.delete(names); }; },
      async pinnedBlobs() { return new Set([...state.pins].flatMap(names => [...names])); },
    };
    return makeStore(backend);
  }

  function opfsScope(scope) {
    const scopeText = String(scope == null ? '' : scope);
    if (!scopeText) throw new Error('opfsStore: scope is required');
    const bytes = new TextEncoder().encode(scopeText);
    if (bytes.length > 100) throw new Error('opfsStore: scope is too long');
    return { scopeText, scopeName: 'overlay-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') };
  }

  async function opfsRoot(options) {
    if (options.root) return options.root;
    const storage = typeof navigator !== 'undefined' && navigator.storage;
    if (!storage || typeof storage.getDirectory !== 'function') throw new Error('opfsStore: this browser has no origin-private file system');
    return storage.getDirectory();
  }

  function lockManager(options) {
    const locks = options.locks || (typeof navigator !== 'undefined' && navigator.locks);
    if (!locks || typeof locks.request !== 'function') throw new Error('opfsStore: Web Locks are required for durable overlays');
    return locks;
  }

  function scopeLock(name, options, fn) {
    return lockManager(options).request('wine-assembly:' + name, { mode: 'exclusive' }, fn);
  }

  function missing(error) {
    return error && (error.name === 'NotFoundError' || error.code === 'ENOENT');
  }

  async function opfsDirs(scopeName, options, create = true) {
    const root = await opfsRoot(options);
    const app = await root.getDirectoryHandle('wine-assembly', { create });
    const overlays = await app.getDirectoryHandle('overlays', { create });
    const dir = await overlays.getDirectoryHandle(scopeName, { create });
    const blobs = await dir.getDirectoryHandle('blobs', { create });
    const snapshots = await dir.getDirectoryHandle('snapshots', { create: true });
    return { dir, blobs, snapshots, overlays };
  }

  async function opfsWrite(dir, name, bytes) {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(bytes); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
  }

  async function opfsText(dir, name) {
    const file = await (await dir.getFileHandle(name)).getFile();
    return new TextDecoder().decode(await file.arrayBuffer());
  }

  async function pinnedOpfsBlobs(scopeName, options, snapshots) {
    const live = new Set();
    for await (const name of snapshots.keys()) {
      const lease = 'wine-assembly:' + scopeName + ':snapshot:' + name;
      await lockManager(options).request(lease, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (lock) { try { await snapshots.removeEntry(name); } catch (_) {} return; }
        // Corrupt live lease metadata must fail collection, never guess that
        // its blobs are free. The mounted reader still owns them.
        const names = JSON.parse(await opfsText(snapshots, name));
        if (!Array.isArray(names) || names.some(name => !blobNameValid(name))) throw new Error('invalid overlay snapshot manifest');
        for (const blob of names) live.add(blob);
      });
    }
    return live;
  }

  function opfsStore(scope, options = {}) {
    const { scopeText, scopeName } = opfsScope(scope);
    let dirs;
    let identity = '';
    if (options.root) {
      if (!rootIds.has(options.root)) rootIds.set(options.root, nextRootId++);
      identity = ':' + rootIds.get(options.root);
    }
    const backend = {
      kind: 'opfs', scope: scopeText, key: 'opfs:' + scopeName + identity,
      log: options.log || (() => {}),
      run: async fn => scopeLock(scopeName, options, async () => {
        dirs = await opfsDirs(scopeName, options);
        return fn();
      }),
      async load() {
        try { return parseIndex(await opfsText(dirs.dir, 'index.json'), scopeText); }
        catch (error) { if (missing(error)) return new Map(); throw error; }
      },
      async commit(records) {
        await opfsWrite(dirs.dir, 'index.json', new TextEncoder().encode(JSON.stringify({
          version: INDEX_VERSION, scope: scopeText, nextBlob: 1, records: [...records.values()],
        })));
      },
      async readBlob(name, offset, length, expectedSize) {
        // Providers may read outside the transaction lock, but their lease
        // pins these immutable blobs throughout the await.
        const file = await (await dirs.blobs.getFileHandle(name)).getFile();
        if (file.size !== expectedSize) throw new Error('overlay blob is ' + file.size + ' bytes, index says ' + expectedSize);
        return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      },
      async writeBlob(name, data) {
        try { await opfsWrite(dirs.blobs, name, data); }
        catch (error) { try { await dirs.blobs.removeEntry(name); } catch (_) {} throw error; }
      },
      async removeBlob(name) { await dirs.blobs.removeEntry(name); },
      async listBlobs() { const names = []; for await (const name of dirs.blobs.keys()) names.push(name); return names; },
      async pinnedBlobs() { return pinnedOpfsBlobs(scopeName, options, dirs.snapshots); },
      async pin(names) {
        const name = uuid() + '.json', snapshots = dirs.snapshots;
        let releaseLease, acquired;
        const held = new Promise(resolve => { releaseLease = resolve; });
        const ready = new Promise(resolve => { acquired = resolve; });
        const lease = lockManager(options).request('wine-assembly:' + scopeName + ':snapshot:' + name,
          { mode: 'exclusive' }, async () => { acquired(); await held; });
        await Promise.race([ready, lease]);
        try { await opfsWrite(snapshots, name, new TextEncoder().encode(JSON.stringify([...names]))); }
        catch (error) { releaseLease(); await lease; throw error; }
        return async () => {
          releaseLease(); await lease;
          try { await snapshots.removeEntry(name); } catch (error) { if (!missing(error)) throw error; }
        };
      },
    };
    return makeStore(backend);
  }

  async function removeOpfsScope(scope, options = {}) {
    const { scopeText, scopeName } = opfsScope(scope);
    return scopeLock(scopeName, options, async () => {
      let dirs;
      try { dirs = await opfsDirs(scopeName, options, false); }
      catch (error) { if (missing(error)) return false; throw error; }
      const pinned = await pinnedOpfsBlobs(scopeName, options, dirs.snapshots);
      if (!pinned.size) {
        await dirs.overlays.removeEntry(scopeName, { recursive: true });
      } else {
        // Removing a library item hides its committed tree immediately, while
        // already-mounted versions retain their bytes until their last release.
        await opfsWrite(dirs.dir, 'index.json', new TextEncoder().encode(JSON.stringify({
          version: INDEX_VERSION, scope: scopeText, nextBlob: 1, records: [],
        })));
        for await (const name of dirs.blobs.keys()) {
          if (!pinned.has(name)) { try { await dirs.blobs.removeEntry(name); } catch (_) {} }
        }
      }
      return true;
    });
  }

  const api = { memoryStore, nodeDirStore, opfsStore, removeOpfsScope, assertStore, metaOf, STORE_METHODS, RANGE_CHUNK_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OverlayStore = api;
})();
