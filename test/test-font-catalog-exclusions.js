'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { bootRenderHarness } = require('./render-helper');
const { createFilesystemImports } = require('../lib/filesystem');
const Catalog = require('../lib/font-catalog');
const RegionMap = require('../lib/region-map.generated');
const manifest = require('../fonts/substitutions.json');

(async () => {
  const roots = ['heap_ptr','heap_end','free_list','tt_faces','tt_cache','tt_scratch',
    'tt_cache_used','tt_reg','tt_font_dir_scanned'];
  const extraWat = roots.map(n => `(func (export "exclusion_${n}") (result i32) (global.get $${n}))`).join('\n') + `
    (func (export "exclusion_owns") (param i32) (result i32)
      (i32.or
        (call $tt_subst_owns_path (global.get $TT_SUBST_TABLE) (global.get $TT_SUBST_TABLE_SIZE) (local.get 0))
        (call $tt_subst_owns_path (global.get $TT_SUBST_ALIAS_TABLE) (global.get $TT_SUBST_ALIAS_TABLE_SIZE) (local.get 0))))`;
  const imports = createFilesystemImports({});
  const extraHostOverrides = Object.fromEntries(Object.keys(imports).filter(n => typeof imports[n] === 'function')
    .map(n => [n, () => { throw Error(`exclusion query called ${n}`); }]));
  const h = await bootRenderHarness({ extraWat, extraHostOverrides });
  const e = h.exports, bytes = new Uint8Array(h.memory.buffer);
  const read = at => { let end = at; while (bytes[end]) end++; return Buffer.from(bytes.subarray(at,end)).toString('latin1'); };
  const normalize = s => s.replace(/\//g,'\\').toLowerCase();
  const fields = [];
  for (const [base,size,alias] of [[RegionMap.BASE.TT_SUBST_TABLE,RegionMap.SIZE.TT_SUBST_TABLE,false], [RegionMap.BASE.TT_SUBST_ALIAS_TABLE,RegionMap.SIZE.TT_SUBST_ALIAS_TABLE,true]]) {
    let at = base;
    while (at < base + size && bytes[at]) {
      at += read(at).length + 1;
      for (let i=0;i<4;i++) {
        const path = read(at); if (path) fields.push({at,path,alias}); at += path.length + 1;
      }
    }
    assert(at < base + size, 'table terminates in declared region');
  }
  assert(fields.some(f=>f.alias), 'fixture includes actual alias fields');
  const expected = [...new Set(fields.map(f=>normalize(f.path)))].sort();
  const scratch = e.guest_alloc(160), scratchWA = e.guest_to_wasm(scratch) >>> 0;
  const manifestPaths = manifest.faces.flatMap(face => Object.values(face.win98Files || {})).map(p => 'c:\\windows\\fonts\\'+p.toLowerCase());
  for (const path of manifestPaths) {
    bytes.set(Buffer.from(path+'\0','latin1'),scratchWA);
    assert.strictEqual(e.exclusion_owns(scratchWA),1,path);
    assert(expected.includes(path),path);
  }
  bytes.fill(0xa9,scratchWA,scratchWA+160);
  const digest = () => crypto.createHash('sha256').update(bytes).digest('hex');
  const beforeRoots = roots.map(n=>e[`exclusion_${n}`]()), before = digest();
  let copied;
  for (let repeat=0;repeat<10;repeat++) {
    const native=[];
    for (let i=0;i<512;i++) { const p=e.font_catalog_exclusion_path(i)>>>0; if(!p) break; native.push(normalize(read(p))); }
    assert.deepStrictEqual(native,fields.map(f=>normalize(f.path)), 'native iteration follows both actual table field lists');
    copied = Catalog.excludedPaths({exports:e,memory:h.memory});
    assert(Object.isFrozen(copied)); assert.deepStrictEqual([...copied].sort(),expected);
    assert.strictEqual(new Set(copied).size,copied.length);
  }
  assert.strictEqual(e.font_catalog_exclusion_path(-1),0);
  assert.strictEqual(e.font_catalog_exclusion_path(1000000),0);
  assert.deepStrictEqual(roots.map(n=>e[`exclusion_${n}`]()),beforeRoots);
  assert.strictEqual(digest(),before,'native/host exclusions do not allocate or write shared memory');
  console.log('PASS both native tables match manifest ownership and exclusion query is byte-pure without filesystem imports');

  const field = fields.find(f=>f.alias), original=bytes.slice(field.at,field.at+field.path.length+1);
  const changed=field.path.replace(/[^\\](?=[^\\]*$)/,'Z');
  assert.notStrictEqual(changed,field.path); assert.strictEqual(changed.length,field.path.length);
  assert(!expected.includes(normalize(changed)));
  try {
    bytes.set(Buffer.from(changed+'\0','latin1'),field.at);
    const current=Catalog.excludedPaths({exports:e,memory:h.memory});
    assert(current.includes(normalize(changed)), 'host exclusions read mutated WAT table rather than manifest');
    assert(!copied.includes(normalize(changed)), 'previous copied snapshot survives native table mutation');
    assert.deepStrictEqual([...copied].sort(),expected);
    assert.strictEqual(e.exclusion_owns(field.at),1);
  } finally { bytes.set(original,field.at); }
  assert.strictEqual(digest(),before,'fixture restored every native table byte');
  assert.deepStrictEqual([...Catalog.excludedPaths({exports:e,memory:h.memory})].sort(),expected);
  console.log('PASS live alias-table mutation updates new exclusions while prior copied list remains immutable');
  const mock = fn => ({exports:{font_catalog_exclusion_path:fn},memory:h.memory});
  assert.throws(()=>Catalog.excludedPaths({exports:{},memory:h.memory}));
  for (const value of [-1,0.5,NaN,bytes.length,Promise.resolve(0)]) {
    assert.throws(()=>Catalog.excludedPaths(mock(()=>value)));
  }
  assert.throws(()=>Catalog.excludedPaths(mock(()=>fields[0].at)), 'unterminated entry enumeration is bounded');
  const canary=bytes.slice(scratchWA,scratchWA+160);
  try {
    bytes.fill(65,scratchWA,scratchWA+160); bytes[scratchWA+132]=0;
    assert.throws(()=>Catalog.excludedPaths(mock(i=>i?0:scratchWA)), 'overlong path rejected');
    bytes[scratchWA]=0xff; bytes[scratchWA+1]=0;
    assert.throws(()=>Catalog.excludedPaths(mock(i=>i?0:scratchWA)), 'non-ASCII path rejected');
  } finally { bytes.set(canary,scratchWA); }
  assert.strictEqual(digest(),before);
  console.log('PASS host reader rejects invalid pointers, asynchronous exports and unbounded paths/enumeration');
  const aliasBase=RegionMap.BASE.TT_SUBST_ALIAS_TABLE, aliasSize=RegionMap.SIZE.TT_SUBST_ALIAS_TABLE;
  const savedAlias=bytes.slice(aliasBase,aliasBase+aliasSize);
  try {
    bytes.fill(65,aliasBase,aliasBase+aliasSize);
    const primaryCount=fields.filter(f=>!f.alias).length;
    assert.strictEqual(e.font_catalog_exclusion_path(primaryCount),-1,'unterminated native field reports malformed, not EOF');
    assert.throws(()=>Catalog.excludedPaths({exports:e,memory:h.memory}));
  } finally { bytes.set(savedAlias,aliasBase); }
  assert.strictEqual(digest(),before);
  e.guest_free(scratch);
  console.log('PASS malformed native alias table rejects rather than returning partial exclusions');
})().catch(error=>{console.error(error);process.exitCode=1;});
