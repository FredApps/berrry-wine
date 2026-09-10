#!/usr/bin/env node
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { bootRenderHarness } = require('./render-helper');
const { createFilesystemImports } = require('../lib/filesystem');
const manifest = require('../fonts/substitutions.json');

(async () => {
  let pure = false, filesystem, calls = 0;
  const overrides = {};
  const importShape = createFilesystemImports({});
  for (const name of Object.keys(importShape)) {
    if (typeof importShape[name] !== 'function') continue;
    overrides[name] = (...args) => {
      assert(!pure, `pure query called filesystem import ${name}`);
      calls++;
      return filesystem[name](...args);
    };
  }
  const roots = ['heap_ptr', 'heap_end', 'free_list', 'tt_reg', 'tt_faces',
    'tt_cache', 'tt_scratch', 'tt_cache_used', 'tt_font_dir_scanned'];
  const extraWat = roots.map(name =>
    `(func (export "resolver_${name}") (result i32) (global.get $${name}))`).join('\n') + `
    (func (export "resolver_cache_only") (param i32) (result i32)
      (call $tt_face_open_source (local.get 0) (i32.const 0) (i32.const -1)))
    (func (export "resolver_register") (param i32) (result i32)
      (call $tt_reg_add (local.get 0)))`;
  const h = await bootRenderHarness({ extraWat, extraHostOverrides: overrides });
  filesystem = createFilesystemImports(h.hostCtx);
  const e = h.exports, bytes = new Uint8Array(h.memory.buffer), vfs = h.hostCtx.vfs;
  const wa = p => e.guest_to_wasm(p) >>> 0;
  const string = p => {
    if (!p) return null;
    let end = p;
    while (bytes[end]) end++;
    return Buffer.from(bytes.subarray(p, end)).toString('latin1');
  };
  const inputs = [];
  const input = text => {
    const guest = e.guest_alloc(text.length + 33) >>> 0, base = wa(guest);
    bytes.fill(0xa7, base, base + text.length + 33);
    bytes.set(Buffer.from(text + '\0', 'latin1'), base + 16);
    inputs.push([base, bytes.slice(base, base + text.length + 33)]);
    return { guest: guest + 16, wasm: base + 16 };
  };
  const names = [...new Set([...manifest.faces.filter(f => f.win98Files).map(f => f.win98),
    'Tms Rmn', 'arial', 'ARIAL', 'unknown fixture family', ''])];
  const queries = names.map(name => ({ name, ...input(name) }));
  const custom = input('c:\\fixture-override.ttf'), missing = input('c:\\not-cached.ttf');
  const styles = [[400, 0], [699, 0], [700, 0], [900, 1], [400, 1]];
  const digest = () => crypto.createHash('sha256').update(bytes).digest('hex');
  const checkPure = fn => {
    const before = roots.map(n => e[`resolver_${n}`]());
    const memoryBefore = digest(), callsBefore = calls;
    pure = true;
    try { fn(); } finally { pure = false; }
    assert.deepStrictEqual(roots.map(n => e[`resolver_${n}`]()), before, 'heap and catalog roots unchanged');
    assert.strictEqual(digest(), memoryBefore, 'query must not write shared memory, including catalog and canaries');
    assert.strictEqual(calls, callsBefore);
    for (const [at, copy] of inputs) assert.deepStrictEqual(bytes.slice(at, at + copy.length), copy);
  };
  const lookup = (q, weight, italic) => string(e.test_tt_subst_resolve(q.wasm, weight, italic) >>> 0);
  assert.strictEqual(e.resolver_tt_font_dir_scanned(), 0);
  assert.strictEqual(e.resolver_tt_faces(), 0);
  checkPure(() => {
    assert.strictEqual(e.test_tt_subst_resolve(0, 400, 0), 0);
    assert.strictEqual(lookup(queries.find(q => q.name === ''), 400, 0), null);
    for (let i = 0; i < 20; i++) {
      for (const q of queries) for (const style of styles) lookup(q, ...style);
      assert.strictEqual(e.resolver_cache_only(missing.guest), -1);
    }
  });
  console.log('PASS cold queries are provisional, allocation-free, filesystem-free and byte-pure');

  // Legacy discovery publishes the catalog; compare every advertised and alias
  // style rather than duplicating the native fallback selection algorithm.
  const expected = queries.map(q => styles.map(s => string(e.test_tt_subst_path(q.wasm, ...s) >>> 0)));
  assert.strictEqual(e.resolver_tt_font_dir_scanned(), 1);
  checkPure(() => {
    for (let repeat = 0; repeat < 20; repeat++) queries.forEach((q, i) =>
      styles.forEach((s, j) => assert.strictEqual(lookup(q, ...s), expected[i][j], q.name)));
  });
  console.log('PASS published catalog matches legacy substitution for all manifest names/styles');

  vfs.files.set('c:\\fixture-override.ttf', { data: vfs.files.get('c:\\windows\\fonts\\arial.ttf').data.slice() });
  assert.strictEqual(e.resolver_register(custom.guest), 1);
  const table = wa(e.resolver_tt_reg());
  let family;
  for (let i = 0; i < 32; i++) {
    const record = table + i * 208;
    if (string(record + 76).toLowerCase() === 'c:\\fixture-override.ttf') family = string(record + 12);
  }
  assert(family, 'actual font registration publishes its family');
  const registered = input(family);
  const face = e.resolver_cache_only(custom.guest);
  assert(face >= 0);
  vfs.files.delete('c:\\fixture-override.ttf');
  checkPure(() => {
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(lookup(registered, 400, 0).toLowerCase(), 'c:\\fixture-override.ttf');
      assert.strictEqual(e.resolver_cache_only(custom.guest), face);
      assert.strictEqual(e.resolver_cache_only(missing.guest), -1);
    }
  });
  console.log('PASS explicit registration and warm cache survive source deletion without I/O or mutation');
})().catch(error => { console.error(error); process.exitCode = 1; });
