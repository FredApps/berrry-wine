#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const extraWat = String.raw`
 (func (export "resolver_prepare") (param $record i32) (param $owner i32) (result i32)
  (global.set $exe_size_of_image (i32.const 4096))
  (call $help_routine_prepare_vfs (local.get $record) (local.get $owner)))
 (func (export "resolver_commit") (param $frame i32) (result i32)
  (call $help_routine_commit_vfs (local.get $frame)))
 (func (export "resolver_cancel") (param $owner i32) (call $help_routine_cancel_vfs (local.get $owner)))
 (func (export "resolver_handle") (param $owner i32) (result i32)
  (call $help_routine_pending_handle (local.get $owner)))
 (func (export "resolver_record") (result i32) (call $help_routine_at (i32.const 0)))
 (func (export "resolver_release_binding") (call $help_release_all_routine_strings))
 (func (export "resolver_free") (param $p i32) (call $heap_free (local.get $p)))
 (func (export "resolver_head") (result i32) (global.get $help_routine_pending))
`;
function fixture() {
 const b = Buffer.alloc(0x3200), pe = 0x80, opt = pe + 24, section = opt + 224;
 b.writeUInt16LE(0x5a4d); b.writeUInt32LE(pe, 0x3c); b.writeUInt32LE(0x4550, pe);
 b.writeUInt16LE(0x14c, pe + 4); b.writeUInt16LE(1, pe + 6); b.writeUInt16LE(224, pe + 20);
 b.writeUInt16LE(0x2102, pe + 22); b.writeUInt16LE(0x10b, opt);
 b.writeUInt32LE(0x10000000, opt + 28); b.writeUInt32LE(0x1000, opt + 32);
 b.writeUInt32LE(0x200, opt + 36); b.writeUInt32LE(0x5000, opt + 56);
 b.writeUInt32LE(0x200, opt + 60); b.writeUInt32LE(16, opt + 92);
 b.writeUInt32LE(0x1100, opt + 96); b.writeUInt32LE(0x90, opt + 100);
 b.write('.text', section); b.writeUInt32LE(0x3000, section + 8);
 b.writeUInt32LE(0x1000, section + 12); b.writeUInt32LE(0x3000, section + 16);
 b.writeUInt32LE(0x200, section + 20); b.writeUInt32LE(0x60000020, section + 36);
 b[0x200] = 0xc3;
 b.writeUInt32LE(0x1160, 0x30c); b.writeUInt32LE(1, 0x310);
 b.writeUInt32LE(1, 0x314); b.writeUInt32LE(1, 0x318);
 b.writeUInt32LE(0x1140, 0x31c); b.writeUInt32LE(0x1144, 0x320); b.writeUInt32LE(0x1148, 0x324);
 b.writeUInt32LE(0x1000, 0x340); b.writeUInt32LE(0x1170, 0x344);
 b.write('fixture.dll\0', 0x360); b.write('Probe\0', 0x370);
 return b;
}
(async () => {
 const h = await bootRenderHarness({ fonts: 'none', extraWat });
 const e = h.exports, vfs = h.hostCtx.vfs, data = fixture(), path = 'c:\\fixture.dll';
 const live = () => [...vfs.handles.values()].filter(handle => !handle.closed).length;
 const baseline = live();
 function register(name = 'fixture.dll') {
  const text = Buffer.from(`RegisterRoutine("${name}","Probe","")\0`);
  text.forEach((b, i) => e.guest_write8(0x120000 + i, b));
  assert.strictEqual(e.test_help_macro_execute(0, e.guest_to_wasm(0x120000), text.length - 1), 1);
  return e.resolver_record();
 }
 function mount(bytes = data, fault = false) {
  const calls = [], budget = new ChunkCacheBudget({ maxBytes: 0 });
  vfs.setProviderFile(path, { provider: new ChunkCache({ size: bytes.length,
   readRange: async (offset, length) => {
    calls.push([offset, length]); if (fault) throw Error('DLL unavailable');
    return new Uint8Array(bytes.subarray(offset, offset + length));
   },
  }, { chunkSize: 32, budget, readAhead: 0 }) });
  return { calls, budget };
 }
 const owner = e.guest_alloc(16), other = e.guest_alloc(16);
 // Two owners retain independent frames; deleting the non-head is safe.
 mount(); let record = register();
 assert.strictEqual(e.resolver_prepare(record, owner), -1);
 const first = vfs.pendingRead;
 assert.strictEqual(e.resolver_prepare(record, other), -1);
 assert.strictEqual(vfs.pendingRead, first, 'foreign pending cannot be replaced');
  e.resolver_cancel(owner); e.resolver_cancel(owner); assert.strictEqual(vfs.pendingRead, null);
 assert.strictEqual(e.resolver_prepare(0, other), -1);
 e.resolver_cancel(other); assert.strictEqual(e.resolver_head(), 0); assert.strictEqual(live(), baseline);
 // Permanent provider failure cleans the entire owner, with no DLL published.
 mount(data, true); record = register();
 assert.strictEqual(e.resolver_prepare(record, owner), -1);
 await vfs.fillPendingRead(vfs.pendingRead);
 assert.strictEqual(e.resolver_prepare(0, owner), 0);
 assert.strictEqual(e.resolver_head(), 0); assert.strictEqual(live(), baseline);
 // A malformed full read is rejected only at no-I/O publication.
 mount(Buffer.alloc(64)); record = register();
 assert.strictEqual(e.resolver_prepare(record, owner), -1);
 await vfs.fillPendingRead(vfs.pendingRead);
 const malformed = e.resolver_prepare(0, owner); assert(malformed > 0);
 assert.strictEqual(e.resolver_commit(malformed), 0); assert.strictEqual(e.resolver_head(), 0);
 // Stage a real exported DLL using tiny zero-retention cache pages. The
 // registry binding may disappear immediately after the first pending read.
  const stats = mount(); record = register();
  const stagingView = new DataView(h.memory.buffer), staging = e.get_staging();
  stagingView.setUint32(staging, 0x89abcdef, true);
 assert.strictEqual(e.resolver_prepare(record, owner), -1);
 const handle = e.resolver_handle(owner);
 e.resolver_release_binding();
 let ready = -1, parks = 0;
 while (ready === -1 && parks < 20) {
  assert.strictEqual(e.resolver_prepare(0, owner), -1);
  assert.strictEqual(e.resolver_handle(owner), handle);
  await vfs.fillPendingRead(vfs.pendingRead);
  ready = e.resolver_prepare(0, owner); parks++;
 }
 assert(ready > 0); assert.strictEqual(parks, Math.ceil(data.length / 4096));
  assert.strictEqual(e.resolver_handle(owner), 0); assert.strictEqual(stats.budget.bytes, 0);
  assert.strictEqual(stagingView.getUint32(staging, true), 0x89abcdef, 'shared PE staging untouched across all awaits');
 assert(stats.calls.every(([offset, length], i) => length <= 32 && offset === i * 32));
 const readsBeforeCommit = stats.calls.length;
 const entry = e.resolver_commit(ready); assert(entry > 0, 'synthetic exported Probe resolves');
 assert.strictEqual(stats.calls.length, readsBeforeCommit); assert.strictEqual(live(), baseline);
 assert.strictEqual(e.guest_read8(entry), 0xc3); assert.strictEqual(e.resolver_head(), 0);
 // Loaded-image cache path works after removing its source and does no I/O.
 vfs.files.delete(path); record = register();
 const cached = e.resolver_prepare(record, owner); assert(cached > 0);
 assert.strictEqual(e.resolver_handle(owner), 0); assert.strictEqual(e.resolver_commit(cached), entry);
 assert.strictEqual(live(), baseline);
 e.resolver_release_binding(); e.resolver_free(owner); e.resolver_free(other);
 console.log(`PASS owned macro DLL preparation: ${parks} parks, ${stats.calls.length} bounded reads, copied bindings, cancellation/fault/cache`);
})().catch(error => { console.error(error); process.exitCode = 1; });
