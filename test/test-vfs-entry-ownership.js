#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createOwnership } = require('../lib/vfs-entry-ownership');

(async () => {
  const reported = [];
  const o = createOwnership({ onError: error => reported.push(error) });
  const events = [];
  function provider(name) {
    return { refs: 1,
      retain() { assert(this.refs > 0); events.push('retain ' + name); this.refs++; },
      release() { assert(this.refs > 0); events.push('release ' + name); this.refs--; },
    };
  }
  const p = provider('p'), q = provider('q');
  const entry = { _provider: p };
  const first = new o.OwnedFileMap([['file', entry]]);
  assert.strictEqual(p.refs, 2);
  p.release(); // Constructor's temporary owner hands off to the mapped entry.
  const second = new o.OwnedFileMap(first);
  first.set('file', entry);
  first.set('alias', entry);
  assert.strictEqual(p.refs, 1, 'shared entry gets one provider lease, not one per alias');
  first.clear();
  assert.strictEqual(p.refs, 1, 'snapshot remains live');
  events.length = 0;
  o.setEntryProvider(entry, q);
  assert.deepStrictEqual(events, ['retain q', 'release p']);
  assert.strictEqual(p.refs, 0);
  q.release();
  second.set('moved', entry);
  second.delete('file');
  assert.strictEqual(q.refs, 1, 'move acquires destination before deleting source');
  o.setEntryProvider(entry, null);
  assert.strictEqual(q.refs, 0, 'materialization releases provider once');
  second.clear(); second.clear();

  const a = provider('a'), b = provider('b');
  const map = new o.OwnedFileMap([['x', { _provider: a }]]);
  a.release(); events.length = 0;
  map.set('x', { _provider: b });
  assert.deepStrictEqual(events, ['retain b', 'release a']);
  assert.strictEqual(a.refs, 0);
  const bad = { retain() { throw new Error('cannot acquire'); }, release() {} };
  const current = map.get('x');
  assert.throws(() => o.setEntryProvider(current, bad), /cannot acquire/);
  assert.strictEqual(current._provider, b);
  assert.throws(() => map.set('x', { _provider: bad }), /cannot acquire/);
  assert.strictEqual(map.get('x'), current);
  map.clear(); assert.strictEqual(b.refs, 1);

  const unmapped = {}, c = provider('c');
  o.setEntryProvider(unmapped, c);
  assert.strictEqual(c.refs, 1, 'unmapped assignment only borrows');
  const live = new o.OwnedFileMap([['c', unmapped]]);
  c.release();
  const releaseOperation = o.retainProvider(c);
  live.delete('c');
  assert.strictEqual(c.refs, 1, 'pending operation survives deletion');
  releaseOperation(); releaseOperation();
  assert.strictEqual(c.refs, 0);
  assert.strictEqual(live.delete('missing'), false);
  assert.throws(() => new o.OwnedFileMap([['ok', { _provider: b }], ['bad', null]]), /entry/);
  assert.strictEqual(b.refs, 1, 'failed constructor releases partially acquired entries');

  let finish;
  const asyncError = new Error('lease cleanup failed');
  const asyncProvider = { retain() {}, release() { return new Promise((resolve, reject) => { finish = () => reject(asyncError); }); } };
  o.retainProvider(asyncProvider)();
  let drained = false;
  const draining = o.drain().then(errors => { drained = true; return errors; });
  await Promise.resolve(); assert.strictEqual(drained, false);
  finish();
  assert.deepStrictEqual(await draining, [asyncError]);
  assert.deepStrictEqual(reported, [asyncError]);
  const syncError = new Error('synchronous cleanup failed');
  o.retainProvider({ retain() {}, release() { throw syncError; } })();
  assert.deepStrictEqual(await o.drain(), [asyncError, syncError]);
  assert.deepStrictEqual(reported, [asyncError, syncError]);

  const context = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/vfs-entry-ownership'), 'utf8'), context);
  assert.strictEqual(typeof context.window.VfsEntryOwnership.OwnedFileMap, 'function');
  console.log('PASS VFS entry ownership: shared maps, handoff, replacement, move, pending operations and cleanup errors');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
