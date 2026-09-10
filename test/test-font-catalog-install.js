#!/usr/bin/env node
'use strict';
const assert = require('assert');
const Catalog = require('../lib/font-catalog');
const { bootRenderHarness } = require('./render-helper');
const { createFilesystemImports, VirtualFS } = require('../lib/filesystem');

(async () => {
  const overrides = Object.fromEntries(Object.entries(createFilesystemImports({}))
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => [name, () => { throw Error(`unexpected native filesystem import: ${name}`); }]));
  const roots = ['tt_faces', 'tt_cache', 'tt_scratch', 'tt_cache_used', 'tt_reg'];
  const extraWat = roots.map(name => `(func (export "catalog_${name}") (result i32) (global.get $${name}))`).join('\n');
  const h = await bootRenderHarness({ extraWat, extraHostOverrides: overrides });
  const e = h.exports, memory = new Uint8Array(h.memory.buffer);
  const source = h.hostCtx.vfs.files.get('c:\\windows\\fonts\\arial.ttf').data.slice();
  const vfs = new VirtualFS();
  const first = 'c:\\windows\\fonts\\first.ttf';
  const setFile = (path, data) => vfs.files.set(path, { data });
  setFile(first, source);
  const states = () => roots.map(name => e[`catalog_${name}`]());
  const cold = states();
  const pointers = new Set();
  const ex = { ...e, guest_alloc(size) {
    const pointer = e.guest_alloc(size); if (pointer) pointers.add(pointer); return pointer;
  }, guest_free(pointer) { assert(pointers.delete(pointer)); e.guest_free(pointer); } };
  const options = { exports: ex, memory: h.memory };
  assert.strictEqual(await Catalog.install(vfs, options), 1);
  assert.strictEqual(e.font_catalog_ready(), 1);
  assert.strictEqual(e.font_catalog_generation(), 1);
  assert.deepStrictEqual(states(), cold, 'metadata install never warms native face/glyph caches');
  assert.strictEqual(pointers.size, 0, 'all local staging allocations released');
  const family = e.guest_alloc(64);
  const data = e.guest_alloc(source.length);
  const wa = pointer => e.guest_to_wasm(pointer) >>> 0;
  memory.set(source, wa(data));
  assert(e.test_tt_family_name(wa(data), source.length, wa(family), 64));
  e.guest_free(data);
  const resolve = () => {
    const at = e.test_tt_subst_resolve(wa(family), 400, 0) >>> 0;
    let end = at; while (memory[end]) end++;
    return Buffer.from(memory.subarray(at, end)).toString('latin1');
  };
  assert.strictEqual(resolve(), first);
  const unchanged = () => {
    assert.strictEqual(resolve(), first);
    assert.strictEqual(e.font_catalog_generation(), 1);
    assert.deepStrictEqual(states(), cold);
    assert.strictEqual(pointers.size, 0);
  };
  // The native exclusion policy is also a dependency across asynchronous
  // source preparation, even though the VFS itself did not change.
  const policyPointer = e.font_catalog_exclusion_path(0) >>> 0;
  const policyByte = memory[policyPointer];
  vfs.setProviderFile(first, { provider: { size: source.length,
    async readRange(offset, length) {
      memory[policyPointer] = policyByte === 67 ? 68 : 67;
      return source.slice(offset, offset + length);
    } } });
  try { await assert.rejects(Catalog.install(vfs, options), /exclusion|policy/); }
  finally { memory[policyPointer] = policyByte; setFile(first, source); }
  unchanged();
  setFile('c:\\windows\\fonts\\malformed.ttf', new Uint8Array(64));
  await assert.rejects(Catalog.install(vfs, options)); unchanged();
  vfs.files.delete('c:\\windows\\fonts\\malformed.ttf');

  // Synchronous native-call hooks can invalidate sources or membership after
  // add. The local installer must revalidate before committing any metadata.
  for (const membership of [false, true]) {
    setFile(first, source.slice());
    const batch = await Catalog.prepare(vfs);
    const wrapped = { ...ex, font_catalog_add(...args) {
      const result = e.font_catalog_add(...args);
      if (membership) setFile('c:\\windows\\fonts\\new.ttf', source);
      else setFile(first, source.slice());
      return result;
    } };
    try { assert.throws(() => Catalog.installBatch(batch, { ...options, exports: wrapped })); }
    finally { batch.release(); }
    unchanged(); vfs.files.delete('c:\\windows\\fonts\\new.ttf');
  }
  for (const fault of ['allocation', 'add', 'check']) {
    const batch = await Catalog.prepare(vfs);
    const wrapped = { ...ex };
    if (fault === 'allocation') wrapped.guest_alloc = () => 0;
    if (fault === 'add') wrapped.font_catalog_add = () => { throw Error('injected native failure'); };
    try { assert.throws(() => Catalog.installBatch(batch, { ...options, exports: wrapped,
      check: () => { if (fault === 'check') throw Error('injected cancellation'); } })); }
    finally { batch.release(); }
    unchanged();
    const token = e.font_catalog_begin(); assert(token, 'failed installation must not leak native pending table');
    e.font_catalog_abort(token);
  }
  vfs.files.clear();
  assert.strictEqual(await Catalog.install(vfs, options), 0);
  assert.strictEqual(e.font_catalog_ready(), 1);
  assert.strictEqual(e.font_catalog_generation(), 2);
  assert.notStrictEqual(resolve(), first);
  assert.strictEqual(pointers.size, 0);
  e.guest_free(family);
  console.log('PASS compiled catalog install: metadata-only ownership, stale/malformed/fault rollback, staging cleanup and empty replacement');
})().catch(error => { console.error(error); process.exitCode = 1; });
