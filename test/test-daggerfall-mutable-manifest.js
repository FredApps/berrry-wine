'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildManifest } = require('../tools/gen-daggerfall-manifest');
const { normalizeLazyFiles, APP_EAGER_BYTES } = require('../lib/app-files');
const { VirtualFS, VfsPendingError } = require('../lib/filesystem');
const byteProvider = require('../lib/byte-provider');

// Exercise the real generator, loading policy, host loader, and VFS. Only the
// network transport is replaced; no guest, compiler, or proprietary fixture.
test('original mutable saves load resident while game archives remain lazy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daggerfall-manifest-'));
  try {
    const originals = ['DOSBOX/DOSBox.exe', 'DOSBOX/SDL.dll', 'DOSBOX/SDL_net.dll',
      'FALL.EXE', 'Z.CFG', '__support/app/dosbox_daggerfall.conf'];
    const saves = ['arena2/MAPSAVE.SAV', 'arena2/maps/MAPSAVE.SAV',
      'SAVE0/MAPSAVE.SAV', 'app/SAVE0/MAPSAVE.SAV'];
    const bytes = Uint8Array.from({length: 16406}, (_, i) => i % 251);
    for (const name of [...originals, ...saves, 'arena2/BULK.BSA']) {
      const filename = path.join(root, 'installed', name);
      fs.mkdirSync(path.dirname(filename), {recursive: true});
      fs.writeFileSync(filename, saves.includes(name) ? bytes : Uint8Array.of(1));
      if (name.endsWith('.BSA')) fs.truncateSync(filename, APP_EAGER_BYTES + 1);
    }
    const manifest = buildManifest(root, path.resolve(__dirname, '..'));
    const normalized = normalizeLazyFiles({}, manifest.files).files;
    const mutable = normalized.filter(f => /\.sav$/i.test(f.url));
    assert.equal(mutable.length, 4);
    assert.equal(mutable.reduce((n, f) => n + f.size, 0), 65624);
    for (const file of mutable) {
      assert.equal(file.loadMode, 'required');
      assert.notEqual(file.httpRange, true);
    }
    const bulk = normalized.find(f => f.url.endsWith('BULK.BSA'));
    assert.equal(bulk.httpRange, true);
    const calls = [], requests = [];
    const context = { console, URL, URLSearchParams, Uint8Array, AbortController,
      setTimeout, clearTimeout, fetch: async (url, init) => {
        requests.push({url, method:init?.method || 'GET'});
        if (url.startsWith('__bundle?')) return {ok:false, status:404};
        if (init?.method === 'HEAD') return {ok:true, status:200, headers:{get:name => name.toLowerCase()==='accept-ranges' ? 'bytes' : name.toLowerCase()==='content-length' ? String(url==='old-save' ? bytes.length : APP_EAGER_BYTES+1) : null}};
        calls.push(url);
        assert(!init?.headers?.Range, 'mutable saves must fetch whole original bytes');
        return {ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer};
      }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../host.js'), 'utf8') +
      '\n;globalThis.WineAssembly = WineAssembly;', context);
    context.window = {byteProvider};
    const wine = Object.create(context.WineAssembly.prototype);
    const vfs = new VirtualFS();
    wine._helpCtx = {vfs};
    await wine.loadFiles([...mutable, bulk], {required: true});
    assert.deepEqual(calls.slice().sort(), mutable.map(f=>f.url).sort());
    assert(!requests.some(r=>r.url===bulk.url && r.method!=='HEAD'), 'bulk GET must remain lazy');
    for (const file of mutable) {
      const entry = vfs.files.get(vfs._normPath(file.vfsPath));
      assert.deepEqual(entry.data, bytes);
      assert(!entry._provider);
      const handle = vfs.createFile(file.vfsPath, 0x40000000, 3);
      vfs.setFilePointer(handle, 10, 0);
      assert.equal(vfs.setEndOfFileResult(handle), 0);
      assert.deepEqual(entry.data, bytes.slice(0, 10));
      vfs.setFilePointer(handle, 12, 0);
      assert.equal(vfs.setEndOfFileResult(handle), 0);
      assert.deepEqual([...entry.data.slice(10)], [0, 0]);
      vfs.setFilePointer(handle, 2, 0);
      vfs.writeFile(handle, Uint8Array.of(99, 98), 2);
      assert.deepEqual([...entry.data.slice(0, 5)], [0, 1, 99, 98, 4]);
    }
    // Historical manifest policy: no loading declaration -> provider-backed.
    // Demonstrate the same mount bug without swallowing or changing VFS errors.
    const old = {...mutable[0]}; delete old.loadMode;
    old.url = 'old-save'; old.vfsPath = 'c:\\old-save.sav';
    const historical = normalizeLazyFiles({}, [old, bulk]).files;
    await wine.loadFiles(historical);
    const h = vfs.createFile(old.vfsPath, 0x40000000, 3);
    vfs.setFilePointer(h, 1, 0);
    assert.throws(() => vfs.setEndOfFileResult(h), VfsPendingError);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
