#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Bootstrap = require('../lib/stock-font-bootstrap');
const RegionMap = require('../lib/region-map.generated');
const { bootRenderHarness } = require('./render-helper');
const { stageAndLoadPe } = require('../lib/process-boot');
const { BUNDLED_BITMAP_FONTS } = require('../lib/font-substitutions');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
function fixture() {
  const memory = { buffer: new ArrayBuffer(65536) }, states = [0, 0, 0, 0, 0];
  const leases = [], events = [], installs = [], frees = [];
  let prepared = 0;
  const vfs = { async prepareReadLease(name) {
    const index = prepared++, bytes = Uint8Array.of(index + 1, 2, 3, 4);
    const lease = { size: bytes.length, current: true, released: 0,
      isCurrent() { return this.current && !this.released; },
      read() { return bytes.slice(); }, release() { this.released++; } };
    leases.push(lease); return lease;
  } };
  const ex = { get_image_base: () => RegionMap.GUEST_BASE,
    stock_font_state(index) { events.push(`state${index}`); return states[index]; },
    guest_alloc() { events.push('alloc'); return 4096; },
    guest_free(pointer) { frees.push(pointer); },
    stock_font_install(index, pointer, size) {
      events.push(`install${index}`);
      assert.deepStrictEqual([...new Uint8Array(memory.buffer, pointer, size)], [index + 1, 2, 3, 4]);
      installs.push(index); states[index] = 2; return 1;
    } };
  return { memory, states, leases, events, installs, frees, vfs, ex,
    run: options => Bootstrap.install(vfs, { exports: ex, memory, ...options }),
    released() { assert(leases.every(lease => lease.released === 1)); } };
}
(async () => {
  {
    const f = fixture(); assert.strictEqual(await f.run(), 5);
    assert.deepStrictEqual(f.states, [2, 2, 2, 2, 2]);
    assert.deepStrictEqual(f.events.slice(0, 5), ['state0', 'state1', 'state2', 'state3', 'state4']);
    assert.strictEqual(f.frees.length, 5); f.released();
  }
  {
    const f = fixture(), prepare = f.vfs.prepareReadLease;
    f.vfs.prepareReadLease = async name => {
      if (f.leases.length === 2) throw Error('media preparation failed');
      return prepare(name);
    };
    await assert.rejects(f.run(), /media preparation failed/);
    assert.deepStrictEqual(f.events, []); f.released();
  }
  {
    const f = fixture(); f.states[4] = 2;
    await assert.rejects(f.run(), /already initialized/);
    assert.strictEqual(f.installs.length, 0); assert.strictEqual(f.frees.length, 0); f.released();
  }
  for (const abort of [false, true]) {
    const f = fixture(), controller = new AbortController(), prepare = f.vfs.prepareReadLease;
    f.vfs.prepareReadLease = async name => {
      const lease = await prepare(name);
      if (f.leases.length === 3) {
        if (abort) controller.abort(); else f.leases[0].current = false;
      }
      return lease;
    };
    await assert.rejects(f.run({ signal: controller.signal }), /changed|aborted/);
    assert.deepStrictEqual(f.events, []); f.released();
  }
  for (const abort of [false, true]) {
    const f = fixture(), controller = new AbortController(), install = f.ex.stock_font_install;
    f.ex.stock_font_install = (...args) => {
      const result = install(...args);
      // A synchronous import/hook can invalidate an earlier dependency.
      if (abort) controller.abort(); else f.leases[0].current = false;
      return result;
    };
    await assert.rejects(f.run({ signal: controller.signal }), /discard the unstarted process/);
    assert.deepStrictEqual(f.installs, [0]);
    assert.deepStrictEqual(f.states, [2, 0, 0, 0, 0], 'failure is not an all-five rollback');
    assert.strictEqual(f.frees.length, 1); f.released();
  }
  for (const kind of ['allocation', 'native', 'throw', 'bounds']) {
    const f = fixture();
    if (kind === 'allocation') f.ex.guest_alloc = () => 0;
    if (kind === 'native') f.ex.stock_font_install = () => 0;
    if (kind === 'throw') f.ex.stock_font_install = () => { throw Error('native trap'); };
    if (kind === 'bounds') f.ex.guest_alloc = () => 65535;
    await assert.rejects(f.run(), /discard the unstarted process/);
    assert.strictEqual(f.frees.length, kind === 'allocation' ? 0 : 1); f.released();
  }
  for (const duringFree of [false, true]) {
    const f = fixture(), controller = new AbortController();
    const install = f.ex.stock_font_install, free = f.ex.guest_free;
    f.ex.stock_font_install = (...args) => {
      const count = install(...args);
      if (!duringFree && args[0] === 4) controller.abort();
      return count;
    };
    f.ex.guest_free = pointer => {
      free(pointer);
      if (duringFree && f.frees.length === 5) controller.abort();
    };
    await assert.rejects(f.run({ signal: controller.signal }), /stale|aborted/);
    assert.deepStrictEqual(f.installs, [0, 1, 2, 3, 4]);
    assert.strictEqual(f.frees.length, 5); f.released();
  }
  {
    const f = fixture(); f.ex.stock_font_state = async () => 0;
    await assert.rejects(f.run(), /synchronously/);
    assert.strictEqual(f.installs.length, 0); f.released();
  }
  // Real local executing exports + PE address translation, not a Worker proxy.
  const h = await bootRenderHarness({ fonts: 'none' });
  stageAndLoadPe(h.exports, h.memory.buffer,
    fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe')), () => {});
  const vfs = h.hostCtx.vfs;
  const entries = BUNDLED_BITMAP_FONTS.map(file => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', file)));
    const provider = new ChunkCache({ size: bytes.length,
      async readRange(off, len) { return bytes.slice(off, off + len); }
    }, { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 1024, readAhead: 0 });
    return vfs.setProviderFile(`c:\\windows\\fonts\\${file.toLowerCase()}`, { provider });
  });
  const result = await Bootstrap.install(vfs, { exports: h.exports, memory: h.memory });
  assert(result >= 5);
  assert.deepStrictEqual(Array.from({ length: 5 }, (_, i) => h.exports.stock_font_state(i)), [2, 2, 2, 2, 2]);
  assert.strictEqual(h.exports.test_gdi_bitmap_font_count(), result);
  assert(entries.every(entry => entry._provider), 'successful install does not materialize VFS');
  console.log('PASS stock install: prechecks, prepare/stale/abort/allocation/native cleanup, partial publication, real PE five-font success');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
