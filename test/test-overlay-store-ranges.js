#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { memoryStore, nodeDirStore, opfsStore, removeOpfsScope, RANGE_CHUNK_SIZE } = require('../lib/overlay-store');
const bytes = s => new TextEncoder().encode(s);
const text = b => new TextDecoder().decode(b);
const file = (data, name = 'save') => ({ path: name, kind: 'file', data: bytes(data) });
const missing = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
class Locks {
  constructor() { this.active = new Set(); this.queues = new Map(); }
  request(name, options, callback) {
    if (options.ifAvailable && this.active.has(name)) return Promise.resolve().then(() => callback(null));
    const previous = this.queues.get(name) || Promise.resolve();
    const result = previous.then(async () => {
      this.active.add(name);
      try { return await callback({ name }); } finally { this.active.delete(name); }
    });
    this.queues.set(name, result.catch(() => {}));
    return result;
  }
}
class Directory {
  constructor(stats) { this.stats = stats; this.dirs = new Map(); this.files = new Map(); }
  async getDirectoryHandle(name, opts = {}) {
    if (!this.dirs.has(name)) { if (!opts.create) throw missing(); this.dirs.set(name, new Directory(this.stats)); }
    return this.dirs.get(name);
  }
  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) { if (!opts.create) throw missing(); this.files.set(name, new Uint8Array()); }
    return {
      getFile: async () => {
        if (!this.files.has(name)) throw missing();
        const data = this.files.get(name);
        return { size: data.length,
          arrayBuffer: async () => { if (name.endsWith('.bin')) this.stats.fullReads++; return data.slice().buffer; },
          slice: (start, end) => { this.stats.reads.push(end - start); return new Blob([data.slice(start, end)]); },
        };
      },
      createWritable: async () => {
        let staged;
        return {
          write: async data => { staged = new Uint8Array(data); if (name.endsWith('.bin')) this.stats.writes.push(staged.length); },
          close: async () => { if (name === 'index.json' && this.stats.failIndex) throw new Error('injected index failure'); this.files.set(name, staged); },
          abort: async () => {},
        };
      },
    };
  }
  async removeEntry(name) { if (!this.files.delete(name) && !this.dirs.delete(name)) throw missing(); }
  async *keys() { yield* this.files.keys(); yield* this.dirs.keys(); }
}
async function common(label, store, reopen) {
  await store.writeBatch([file('abcdefgh')]);
  const snapshot = await store.openSnapshot();
  const base = snapshot.records[0].provider;
  assert.strictEqual(base.retain(), base);
  await snapshot.release();
  await store.writeBatch([{ path: 'save', kind: 'file', size: 12, base, baseSize: 3,
    ranges: [{ offset: 6, data: bytes('XY') }] }]);
  assert.deepStrictEqual([...await store.read('save')], [97,98,99,0,0,0,88,89,0,0,0,0]);
  assert.strictEqual(text(await base.readRange(2, 4)), 'cdef');
  assert.deepStrictEqual(await (await reopen()).read('save'), await store.read('save'));
  await store.remove('save');
  assert.strictEqual(text(await base.readRange(0, 99)), 'abcdefgh');
  await base.release();
  await assert.rejects(base.readRange(0, 1), /released/);
  await assert.rejects(store.writeBatch([{ path: 'x', kind: 'file', size: 4,
    ranges: [{offset:2,data:bytes('ab')}, {offset:1,data:bytes('x')}] }]), /ordered/);
  const calls = [];
  const external = { size: RANGE_CHUNK_SIZE * 2 + 7, readRange: async (offset, length) => {
    calls.push(length); return new Uint8Array(length).fill((offset / RANGE_CHUNK_SIZE) + 1);
  } };
  await store.writeBatch([{path:'large',kind:'file',size:external.size,base:external}]);
  assert.deepStrictEqual(calls, [RANGE_CHUNK_SIZE, RANGE_CHUNK_SIZE, 7]);
  const large = await store.openSnapshot();
  const p = large.records.find(r => r.path === 'large').provider;
  assert.deepStrictEqual([...await p.readRange(RANGE_CHUNK_SIZE-1, 3)], [1,2,2]);
  await store.writeBatch([{path:'large',kind:'file',size:external.size,base:p,ranges:[{offset:9,data:bytes('!')}]}]);
  assert.strictEqual((await p.readRange(9,1))[0], 1);
  await large.release();
  console.log('PASS ' + label + ' immutable snapshots, range patches, truncate/extend and bounded external copy');
}
(async () => {
  const memory = memoryStore();
  await common('memory', memory, async () => memory);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-overlay-ranges-'));
  try {
    await common('Node', nodeDirStore(dir), async () => nodeDirStore(dir));
    const indexPath = path.join(dir, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    index.records.push({...index.records[0]});
    fs.writeFileSync(indexPath, JSON.stringify(index));
    const originalUnlink = fs.unlinkSync;
    let unlinks = 0;
    fs.unlinkSync = (...args) => { unlinks++; return originalUnlink(...args); };
    try { await assert.rejects(nodeDirStore(dir).list(), /duplicate overlay index path/); }
    finally { fs.unlinkSync = originalUnlink; }
    assert.strictEqual(unlinks, 0, 'malformed duplicate index must fail before GC');
  }
  finally { fs.rmSync(dir, {recursive:true,force:true}); }
  const stats = { reads: [], writes: [], fullReads: 0 };
  const root = new Directory(stats), locks = new Locks(), opts = {root,locks};
  const store = opfsStore('range-test', opts);
  const released = [], cleanupFailure = new Error('bad release');
  const externalBase = (id, fail) => ({size:1, retain() { return this; },
    readRange: async () => Uint8Array.of(id),
    release() { released.push(id); if (fail) throw cleanupFailure; },
  });
  const cleaned = await store.writeBatch([1,2].map(id => ({path:'cleanup-'+id,kind:'file',size:1,
    base:externalBase(id,id===1)})), {snapshot:true});
  assert.strictEqual(cleaned.written, 2);
  assert.deepStrictEqual(released, [1,2], 'sync release failure cannot skip other bases');
  assert.deepStrictEqual(cleaned.cleanupErrors, [cleanupFailure]);
  assert.deepStrictEqual([...await cleaned.snapshot.records.find(r=>r.path==='cleanup-2').provider.readRange(0,1)], [2]);
  await cleaned.snapshot.release();
  await store.remove('cleanup-1'); await store.remove('cleanup-2');
  const failingRead = new Error('original read failure');
  const rejectedBase = externalBase(3, false);
  rejectedBase.readRange = async () => { throw failingRead; };
  rejectedBase.release = async () => { released.push(3); throw cleanupFailure; };
  await assert.rejects(store.writeBatch([{path:'failed',kind:'file',size:1,base:rejectedBase},
    {path:'never-written',kind:'file',size:1,base:externalBase(4,false)}]), error => error === failingRead);
  assert.deepStrictEqual(released, [1,2,3,4], 'async cleanup rejection preserves original failure and releases all bases');
  await common('OPFS', store, async () => opfsStore('range-test', opts));
  stats.reads.length = 0;
  const snapshot = await store.openSnapshot();
  assert.deepStrictEqual(stats.reads, [], 'snapshot mounts metadata without payload reads');
  const provider = snapshot.records.find(r => r.path === 'large').provider;
  stats.reads.length = stats.writes.length = 0;
  await store.writeBatch([{path:'large',kind:'file',size:provider.size,base:provider,ranges:[{offset:10,data:bytes('abc')}]}]);
  assert.deepStrictEqual(stats.reads, [], 'own-store patches do not read clean extents');
  assert.deepStrictEqual(stats.writes, [3], 'own-store patches write only dirty bytes');
  stats.failIndex = true;
  await assert.rejects(store.writeBatch([file('failure', 'large')]), /injected/);
  stats.failIndex = false;
  const committed = await store.openSnapshot();
  assert.strictEqual(text(await committed.records.find(r=>r.path==='large').provider.readRange(10,3)), 'abc');
  await committed.release();
  const peer = opfsStore('range-test', opts);
  const ownCommit = store.writeBatch([file('first', 'race')], {snapshot:true});
  const laterCommit = peer.writeBatch([file('second', 'race')]);
  const acknowledged = await ownCommit;
  await laterCommit;
  assert.strictEqual(text(await acknowledged.snapshot.records.find(r => r.path === 'race').provider.readRange(0,99)), 'first');
  assert.strictEqual(text(await peer.read('race')), 'second');
  await acknowledged.snapshot.release();
  await Promise.all([store.writeBatch([file('one','one')]), peer.writeBatch([file('two','two')])]);
  assert.strictEqual(text(await store.read('two')), 'two');
  const scopeDir = [...root.dirs.get('wine-assembly').dirs.get('overlays').dirs.values()][0];
  await removeOpfsScope('range-test', opts);
  assert.deepStrictEqual(await store.list(), []);
  assert.strictEqual((await provider.readRange(10, 1))[0], 1, 'scope deletion preserves mounted old version');
  await snapshot.release();
  assert.strictEqual(scopeDir.dirs.get('blobs').files.size, 0, 'final release reclaims deleted versions');
  assert.strictEqual(scopeDir.dirs.get('snapshots').files.size, 0, 'final release reclaims lease manifests');
  scopeDir.dirs.get('blobs').files.set('abandoned.bin', bytes('orphan'));
  scopeDir.dirs.get('snapshots').files.set('crashed.json', bytes('["abandoned.bin"]'));
  await opfsStore('range-test', opts).list();
  assert.strictEqual(scopeDir.dirs.get('blobs').files.size, 0, 'crashed snapshot lock does not pin blobs forever');
  assert.strictEqual(scopeDir.dirs.get('snapshots').files.size, 0);
  assert.strictEqual(stats.fullReads, 0, 'no eager blob arrayBuffer reads');
  assert(stats.reads.every(n => n <= RANGE_CHUNK_SIZE));
  assert(stats.writes.every(n => n <= RANGE_CHUNK_SIZE));
  console.log('PASS OPFS pinned deletion, dirty-only I/O and publication failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
