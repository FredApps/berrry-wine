#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { createFilesystemImports } = require('../lib/filesystem');

(async () => {
  const imports = createFilesystemImports({});
  const overrides = Object.fromEntries(Object.keys(imports).filter(k => typeof imports[k] === 'function')
    .map(k => [k, () => { throw Error(`catalog unexpectedly called ${k}`); }]));
  const roots = ['tt_faces', 'tt_cache', 'tt_scratch', 'tt_cache_used', 'tt_reg'];
  const extraWat = roots.map(n => `(func (export "catalog_${n}") (result i32) (global.get $${n}))`).join('\n') + `
    (func (export "catalog_enum") (param i32) (result i32) (call $tt_enum_face_name (local.get 0)))
    (func (export "catalog_explicit_add") (param $p i32) (param $d i32) (param $s i32) (result i32)
      (call $tt_reg_add_face (local.get $p)
        (call $tt_face_open_source (local.get $p) (local.get $d) (local.get $s))))
    (func (export "catalog_explicit_remove") (param i32) (result i32) (call $tt_reg_remove (local.get 0)))
    (func (export "catalog_scan") (call $tt_scan_font_dir))
    (func (export "catalog_scan_state") (result i32) (global.get $tt_font_dir_scanned))`;
  const h = await bootRenderHarness({ extraWat, extraHostOverrides: overrides });
  const e = h.exports, bytes = new Uint8Array(h.memory.buffer);
  const wa = p => e.guest_to_wasm(p) >>> 0;
  const alloc = data => { const p = e.guest_alloc(data.length); assert(p); bytes.set(data, wa(p)); return p; };
  const text = s => alloc(Buffer.from(s + '\0', 'latin1'));
  const read = p => { if (!p) return null; let end = p; while (bytes[end]) end++; return Buffer.from(bytes.subarray(p, end)).toString('latin1'); };
  const font = name => h.hostCtx.vfs.files.get('c:\\windows\\fonts\\' + name).data.slice();
  const regularBytes = font('arial.ttf'), boldBytes = font('arialbd.ttf'), italicBytes = font('ariali.ttf');
  const regular = alloc(regularBytes), bold = alloc(boldBytes), italic = alloc(italicBytes);
  const familyOut = alloc(new Uint8Array(96).fill(0xa6));
  assert(e.test_tt_family_name(wa(regular), regularBytes.length, wa(familyOut) + 8, 64));
  const family = text(read(wa(familyOut) + 8));
  assert.deepStrictEqual(bytes.slice(wa(familyOut), wa(familyOut) + 8), new Uint8Array(8).fill(0xa6));
  assert.deepStrictEqual(bytes.slice(wa(familyOut) + 72, wa(familyOut) + 96), new Uint8Array(24).fill(0xa6));
  const resolve = (weight = 400, slant = 0) => read(e.test_tt_subst_resolve(wa(family), weight, slant) >>> 0);
  const cold = roots.map(n => e[`catalog_${n}`]());
  const unchangedCaches = () => assert.deepStrictEqual(roots.map(n => e[`catalog_${n}`]()), cold);
  const path = text('c:\\catalog-regular.ttf'), boldPath = text('c:\\catalog-bold.ttf'), italicPath = text('c:\\catalog-italic.ttf');
  assert.strictEqual(e.font_catalog_ready(), 0);
  const provisional = resolve();
  let token = e.font_catalog_begin(); assert(token);
  assert.strictEqual(e.font_catalog_begin(), 0, 'busy begin preserves pending transaction');
  assert.strictEqual(e.font_catalog_add(token, path, regular, regularBytes.length), 1);
  assert.strictEqual(e.font_catalog_add(token, boldPath, bold, boldBytes.length), 1);
  assert.strictEqual(e.font_catalog_add(token, italicPath, italic, italicBytes.length), 1);
  assert.strictEqual(resolve(), provisional, 'staging cannot publish'); unchangedCaches();
  // Metadata is copied by add, not borrowed from the staging allocation.
  bytes.fill(0xcc, wa(regular), wa(regular) + regularBytes.length); e.guest_free(regular);
  bytes.fill(0xcc, wa(path), wa(path) + 'c:\\catalog-regular.ttf'.length + 1); e.guest_free(path);
  assert.strictEqual(e.font_catalog_commit(token), 1);
  assert.strictEqual(e.font_catalog_ready(), 1);
  assert.strictEqual(resolve(), 'c:\\catalog-regular.ttf');
  assert.strictEqual(resolve(700), 'c:\\catalog-bold.ttf');
  assert.strictEqual(resolve(400, 1), 'c:\\catalog-italic.ttf'); unchangedCaches();
  const generation = e.font_catalog_generation(); assert(generation);
  const names = [];
  for (let i = 0; i < 100; i++) { const name = read(e.catalog_enum(i) >>> 0); if (!name) break; names.push(name.toLowerCase()); }
  assert.strictEqual(names.filter(n => n === read(wa(family)).toLowerCase()).length, 1);
  console.log('PASS staged metadata publication, copied family/style paths, enum deduplication and cold caches');

  const live = alloc(regularBytes), livePath = text('c:\\replacement.ttf');
  const invalidPath = text('c:\\invalid.ttf');
  const preserve = () => { assert.strictEqual(resolve(), 'c:\\catalog-regular.ttf'); assert.strictEqual(e.font_catalog_generation(), generation); unchangedCaches(); };
  token = e.font_catalog_begin();
  assert.strictEqual(e.font_catalog_add(token, livePath, live, regularBytes.length), 1);
  e.font_catalog_abort(token); e.font_catalog_abort(token); preserve();
  const stale = token;
  token = e.font_catalog_begin(); assert.notStrictEqual(token, stale);
  assert.strictEqual(e.font_catalog_add(stale, livePath, live, regularBytes.length), 0);
  assert.strictEqual(e.font_catalog_commit(stale), 0); e.font_catalog_abort(stale);
  assert.strictEqual(e.font_catalog_add(token, livePath, live, regularBytes.length), 1);
  e.font_catalog_abort(token); preserve();
  for (const [data, size] of [[0, 20], [live + 1, regularBytes.length], [live, regularBytes.length + 4096], [live, 4], [live, 0], [live, 0x400001], [live, -1]]) {
    token = e.font_catalog_begin();
    assert.strictEqual(e.font_catalog_add(token, livePath, live, regularBytes.length), 1);
    assert.strictEqual(e.font_catalog_add(token, invalidPath, data, size), 0, 'invalid input poisons current transaction');
    assert.strictEqual(e.font_catalog_commit(token), 0); preserve(); e.font_catalog_abort(token);
  }
  const malformed = alloc(new Uint8Array(128));
  token = e.font_catalog_begin();
  assert.strictEqual(e.font_catalog_add(token, livePath, malformed, 128), 0);
  assert.strictEqual(e.font_catalog_commit(token), 0); e.font_catalog_abort(token); preserve();
  for (const badPath of [0, text(''), alloc(new Uint8Array(132).fill(65)), text('x'.repeat(132))]) {
    token = e.font_catalog_begin();
    assert.strictEqual(e.font_catalog_add(token, livePath, live, regularBytes.length), 1);
    assert.strictEqual(e.font_catalog_add(token, badPath, live, regularBytes.length), 0);
    assert.strictEqual(e.font_catalog_commit(token), 0); e.font_catalog_abort(token); preserve();
  }
  token = e.font_catalog_begin();
  assert.strictEqual(e.font_catalog_add(token, livePath, live, regularBytes.length), 1);
  assert.strictEqual(e.font_catalog_add(token, text('C:\\REPLACEMENT.TTF'), live, regularBytes.length), 0);
  assert.strictEqual(e.font_catalog_commit(token), 0); e.font_catalog_abort(token); preserve();
  console.log('PASS abort, stale nonce isolation, invalid spans and malformed font preserve prior catalog');

  token = e.font_catalog_begin();
  for (let i = 0; i < 32; i++) assert.strictEqual(e.font_catalog_add(token, text(`c:\\capacity-${i}.ttf`), live, regularBytes.length), 1);
  assert.strictEqual(e.font_catalog_add(token, text('c:\\capacity-overflow.ttf'), live, regularBytes.length), 0);
  assert.strictEqual(e.font_catalog_commit(token), 0); e.font_catalog_abort(token); preserve();
  console.log('PASS 32-record capacity overflow is atomic and does not warm face/glyph caches');

  const explicit = text('c:\\explicit.ttf');
  assert.strictEqual(e.catalog_explicit_add(explicit, live, regularBytes.length), 1);
  assert.strictEqual(resolve(), 'c:\\explicit.ttf');
  const explicitNames = [];
  for (let i = 0; i < 100; i++) { const name = read(e.catalog_enum(i) >>> 0); if (!name) break; explicitNames.push(name.toLowerCase()); }
  assert.strictEqual(explicitNames.filter(n => n === read(wa(family)).toLowerCase()).length, 1);
  assert.strictEqual(e.catalog_explicit_remove(explicit), 1);
  assert.strictEqual(resolve(), 'c:\\catalog-regular.ttf');
  token = e.font_catalog_begin(); assert.strictEqual(e.font_catalog_commit(token), 1);
  assert.strictEqual(e.font_catalog_ready(), 1);
  assert.notStrictEqual(e.font_catalog_generation(), generation);
  assert.strictEqual(resolve(), provisional);
  // Unlike pure resolution, this legacy entry normally scans the directory.
  // A successfully published empty catalog must suppress that import too.
  assert.strictEqual(read(e.test_tt_subst_path(wa(family), 400, 0) >>> 0), provisional);
  console.log('PASS explicit precedence/removal fallback and empty-ready discovery suppression');

  // The real legacy scan marks its flag before importing directory data. Even
  // a failed scan prevents safely treating the explicit registry as unmixed.
  const transition = await bootRenderHarness({ extraWat, extraHostOverrides: overrides });
  const t = transition.exports;
  const pending = t.font_catalog_begin(); assert(pending);
  assert.throws(() => t.catalog_scan(), /catalog unexpectedly called/);
  assert.strictEqual(t.catalog_scan_state(), 1);
  assert.strictEqual(t.font_catalog_commit(pending), 0, 'intervening scan rejects publication');
  assert.strictEqual(t.font_catalog_ready(), 0);
  assert.strictEqual(t.font_catalog_generation(), 0);
  t.font_catalog_abort(pending); t.font_catalog_abort(pending);
  assert.strictEqual(t.font_catalog_begin(), 0, 'legacy-first preparation cannot migrate mixed ownership');
  console.log('PASS legacy-first and intervening-scan transitions reject catalog publication');
})().catch(error => { console.error(error); process.exitCode = 1; });
