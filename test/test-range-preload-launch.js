#!/usr/bin/env node
// host.js loadFiles for an `httpRange` file with `preloadRanges` (Diablo's
// spawn.mpq): the measured ranges are fetched and pinned before the guest
// starts, reported to the launch window with an exact total, and everything
// else stays on the server. A split release asset (name.part000, ...) is read
// by range across its parts. A range list measured on other bytes, or a server
// without ranges, falls back to the whole file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const byteProvider = require('../lib/byte-provider');

const ROOT = path.join(__dirname, '..');
const FILE = new Uint8Array(70).map((_, i) => (i * 13 + 1) & 0xff);
const calls = [];
let routes = new Map();     // url -> Uint8Array (ranged), or {status}
let ranged = true;

function respond(url, init = {}) {
  calls.push(`${init.method || 'GET'} ${url}${init.headers && init.headers.Range ? ' ' + init.headers.Range : ''}`);
  const body = routes.get(url);
  if (!(body instanceof Uint8Array)) {
    return { status: 404, ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  const headers = new Map([['content-length', String(body.length)]]);
  if (ranged) headers.set('accept-ranges', 'bytes');
  const get = name => headers.has(name) ? headers.get(name) : null;
  if (init.method === 'HEAD') return { status: 200, ok: true, headers: { get } };
  const m = init.headers && init.headers.Range && /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
  if (m && ranged) {
    const slice = body.slice(Number(m[1]), Number(m[2]) + 1);
    return { status: 206, ok: true, headers: { get }, arrayBuffer: async () => slice.buffer };
  }
  return { status: 200, ok: true, headers: { get }, arrayBuffer: async () => body.slice().buffer };
}

const context = {
  console: { log() {}, warn() {}, error: console.error },
  setTimeout, clearTimeout, URLSearchParams, Uint8Array, Promise, Error,
  fetch: async (url, init) => respond(String(url), init),
};
context.window = { byteProvider };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'host.js'), 'utf8') +
  '\n;globalThis.WineAssembly = WineAssembly;', context);
const WA = context.WineAssembly;
WA.ASSET_PART_SIZE = 32;

function makeWine() {
  const wine = Object.create(WA.prototype);
  const mounted = new Map();
  wine._helpCtx = { vfs: {
    files: new Map(),
    ensureParentDirs() {},
    setProviderFile(p, { provider }) { mounted.set(p, provider); },
    applyFileMetadata() {},
  } };
  return { wine, mounted };
}

(async () => {
  // A split release asset reads across its parts as one file.
  routes = new Map([
    ['big.mpq.part000', FILE.slice(0, 32)],
    ['big.mpq.part001', FILE.slice(32, 64)],
    ['big.mpq.part002', FILE.slice(64)],
  ]);
  calls.length = 0;
  const parted = await WA._openRangeProvider('big.mpq', { fetch: context.fetch }, byteProvider);
  assert.strictEqual(parted.size, 70);
  assert.deepStrictEqual(Array.from(await parted.readRange(30, 36)), Array.from(FILE.slice(30, 66)));
  assert.deepStrictEqual(calls.slice(0, 4), ['HEAD big.mpq', 'HEAD big.mpq.part000',
    'HEAD big.mpq.part001', 'HEAD big.mpq.part002']);

  // Neither form exists: the original 404 surfaces (loadFiles then falls back).
  routes = new Map();
  await assert.rejects(WA._openRangeProvider('none.mpq', { fetch: context.fetch }, byteProvider), /HEAD none\.mpq → 404/);

  // Preload: only the listed ranges move before start, with an exact total.
  routes = new Map([['spawn.mpq', FILE]]);
  calls.length = 0;
  const events = [];
  let { wine, mounted } = makeWine();
  await wine.loadFiles([{
    url: 'spawn.mpq', vfsPath: 'c:\\spawn.mpq', httpRange: true,
    preloadRanges: { schemaVersion: 1, size: 70, ranges: [[0, 4], [66, 70]] },
  }], { required: true, transfer: { onTransfer: e => events.push(e) } });
  const cache = mounted.get('c:\\spawn.mpq');
  assert.ok(cache, 'mounted provider-backed');
  // 256KB chunks over a 70-byte file: one chunk, which is the whole file here.
  assert.strictEqual(cache.stats.pinnedChunks, 1);
  assert.ok(cache.tryRead(66, 4), 'pinned range is a synchronous hit');
  const done = events.filter(e => e.kind === 'done');
  assert.strictEqual(done.length, 1);
  assert.strictEqual(done[0].total, 70);
  assert.deepStrictEqual(calls, ['HEAD spawn.mpq', 'GET spawn.mpq bytes=0-69']);

  // With realistic chunking only the chunks the ranges touch are fetched.
  const big = new Uint8Array(3 * 262144 + 5).map((_, i) => i & 0xff);
  routes = new Map([['huge.mpq', big]]);
  calls.length = 0;
  ({ wine, mounted } = makeWine());
  await wine.loadFiles([{
    url: 'huge.mpq', vfsPath: 'c:\\huge.mpq', httpRange: true,
    preloadRanges: [[10, 20], [3 * 262144, 3 * 262144 + 5]],
  }], { required: true });
  assert.deepStrictEqual(calls, ['HEAD huge.mpq', 'GET huge.mpq bytes=0-262143',
    'GET huge.mpq bytes=786432-786436']);
  assert.strictEqual(mounted.get('c:\\huge.mpq').tryRead(262144 + 1, 1), null,
    'an unlisted chunk is still lazy');

  // A list measured on other bytes is not trusted: the whole file loads.
  routes = new Map([['spawn.mpq', FILE]]);
  calls.length = 0;
  ({ wine, mounted } = makeWine());
  await wine.loadFiles([{
    url: 'spawn.mpq', vfsPath: 'c:\\spawn.mpq', httpRange: true,
    preloadRanges: { schemaVersion: 1, size: 71, ranges: [[0, 4]] },
  }], { required: true });
  assert.strictEqual(mounted.size, 0);
  assert.strictEqual(wine._helpCtx.vfs.files.get('c:\\spawn.mpq').data.length, 70);

  // A server without ranges: whole file, as before.
  ranged = false;
  ({ wine, mounted } = makeWine());
  await wine.loadFiles([{
    url: 'spawn.mpq', vfsPath: 'c:\\spawn.mpq', httpRange: true,
    preloadRanges: { schemaVersion: 1, size: 70, ranges: [[0, 4]] },
  }], { required: true });
  assert.strictEqual(mounted.size, 0);
  assert.strictEqual(wine._helpCtx.vfs.files.get('c:\\spawn.mpq').data.length, 70);

  console.log('PASS  range preload launch: pinned ranges, split parts, honest fallbacks');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
