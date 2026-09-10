'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const RegionMap = require('../lib/region-map.generated');
const extraWat = String.raw`
 (func (export "lease_font_parse") (param $path i32) (param $data i32) (param $size i32) (result i32)
   (call $gdi_bitmap_font_add_buffer (local.get $path) (local.get $data) (local.get $size)))
 (func (export "lease_font_remove") (param $path i32)
   (drop (call $gdi_bitmap_font_remove_resource (local.get $path))))
 (func (export "lease_font_table") (result i32) (global.get $GDI_BITMAP_FONT_TABLE))
 (func (export "lease_font_state") (result i32) (i32.load (global.get $GDI_BITMAP_FONT_SYSTEM_STATE)))
 (func (export "lease_free") (param $p i32) (call $heap_free (local.get $p)))
`;
(async () => {
  const h = await bootRenderHarness({fonts:'none', extraWat});
  const e = h.exports, vfs = h.hostCtx.vfs, memory = new Uint8Array(h.memory.buffer);
  const wa = p => RegionMap.g2w(p, e.get_image_base() >>> 0);
  const name = 'c:\\windows\\fonts\\system.fon';
  const font = new Uint8Array(fs.readFileSync(path.join(__dirname, '../fonts/System.fon')));
  const nameBytes = Buffer.from(name + '\0'), namePtr = e.guest_alloc(nameBytes.length);
  memory.set(nameBytes, wa(namePtr));
  let publications = 0;
  function parse(bytes) {
    const pointer = e.guest_alloc(bytes.length); assert(pointer);
    try { memory.set(bytes, wa(pointer)); publications++; return e.lease_font_parse(namePtr,pointer,bytes.length); }
    finally { e.lease_free(pointer); }
  }
  function records() {
    const view = new DataView(h.memory.buffer), out = [], table = e.lease_font_table();
    for (let i=0;i<48;i++) {
      const at = table+i*64;
      if (!view.getUint32(at,true)) continue;
      const fields = Array.from({length:16},(_,j)=>view.getUint32(at+j*4,true));
      const bytes = memory.slice(fields[2],fields[2]+fields[3]); fields[2]=0;
      out.push({fields,bytes});
    }
    return out;
  }
  assert.strictEqual(parse(font),2);
  const expected = records(); assert.strictEqual(expected.length,2);
  e.lease_font_remove(namePtr); assert.deepStrictEqual(records(),[]);
  const budget = new ChunkCacheBudget({maxBytes:0});
  const provider = {size:font.length,revision:0,reads:0,
    async readRange(off,n) { this.reads++; return font.slice(off,off+n); }};
  const cache = new ChunkCache(provider,{chunkSize:1024,maxChunks:1,readAhead:0,budget});
  const entry = vfs.setProviderFile(name,{provider:cache});
  const lease = await vfs.prepareReadLease(name,{maxBytes:font.length,chunkSize:1024});
  assert(provider.reads>1); assert.strictEqual(budget.bytes,0);
  assert.strictEqual(e.lease_font_state(),0,'preparation never publishes unavailable/installed stock state');
  assert.deepStrictEqual(records(),[],'preparation alone does not register fonts');
  try { assert(lease.isCurrent()); assert.strictEqual(parse(lease.read(0,lease.size)),2); }
  finally { lease.release(); }
  assert.deepStrictEqual(records(),expected,'real parser metrics and every FNT byte match eager input');
  assert.strictEqual(entry._provider,cache); assert.strictEqual(budget.bytes,0);
  const before = publications;
  const stale = await vfs.prepareReadLease(name,{maxBytes:font.length});
  provider.revision++;
  assert.strictEqual(stale.isCurrent(),false); assert.throws(()=>parse(stale.read(0,stale.size))); stale.release();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(vfs.prepareReadLease(name,{maxBytes:font.length,signal:controller.signal}));
  assert.strictEqual(publications,before); assert.deepStrictEqual(records(),expected);
  assert.strictEqual(e.lease_font_state(),0,'cancel/stale never poison stock availability');
  e.lease_font_remove(namePtr); e.lease_free(namePtr); vfs.files.clear();
  console.log('PASS real FON parser: zero-cache immutable lease matches eager strikes/metrics, stale/cancel cannot publish');
})().catch(error=>{console.error(error);process.exitCode=1;});
