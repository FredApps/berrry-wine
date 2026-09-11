#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const { VirtualFS } = require('../lib/filesystem');
const { ChunkCache } = require('../lib/byte-provider');
const STACK = 0x110100, INFO = 0x120000, BUFFER = 0x121000, THUNK = 0x200000;
const extraWat = String.raw`
  (func (export "test_mmio_begin") (param $id i32)
    (global.set $thunk_guest_base (i32.const 0x200000))
    (global.set $thunk_guest_end (i32.const 0x200008))
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
    (global.set $esp (i32.const 0x110100))
    (global.set $eip (i32.const 0x200000))
    (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
  (func (export "test_mmio_resume")
    (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
    (call $run (i32.const 2)))
  (func (export "test_mmio_esp") (result i32) (global.get $esp))
  (func (export "test_mmio_eax") (result i32) (global.get $eax))
  (func (export "test_mmio_pending") (result i32) (global.get $mmio_descend_pending))
`;
(async () => {
  let e, data, cursor, missAt, missState, pending, seekFails, lazyVfs, lazyPending;
  const h = await bootRenderHarness({ fonts: 'none', extraWat, extraHostOverrides: {
    fs_read_file(handle, buffer, length, count) {
      assert.strictEqual(handle, 41);
      e.guest_write32(count, 0); pending = 0;
      if (lazyVfs) {
        const out = new Uint8Array(length), result = lazyVfs.readFile(handle,out,length);
        if (result.pending) { lazyPending = result.pending; pending = 1; return 0; }
        if (!result.ok) { pending = result.faulted ? 2 : 0; return 0; }
        for (let i=0;i<result.bytesRead;i++) e.guest_write8(buffer+i,out[i]);
        e.guest_write32(count,result.bytesRead); return 1;
      }
      if (cursor === missAt) { pending = missState; return 0; }
      const n = Math.max(0, Math.min(length, data.length - cursor));
      for (let i = 0; i < n; i++) e.guest_write8(buffer + i, data[cursor + i]);
      cursor += n; e.guest_write32(count, n); return 1;
    },
    fs_read_pending: () => pending,
    fs_set_file_pointer(handle, offset, origin) {
      assert.strictEqual(handle, 41);
      if (lazyVfs) return lazyVfs.setFilePointer(handle,offset,origin);
      if (seekFails && origin === 0) return -1;
      cursor = (origin === 1 ? cursor : origin === 2 ? data.length : 0) + offset;
      return cursor;
    },
  } });
  e = h.exports;
  const words = (at, count) => Array.from({ length: count }, (_, i) => e.guest_read32(at + i * 4) >>> 0);
  function begin(name, args) {
    missAt = -1; missState = 1; pending = 0; seekFails = false;
    e.test_mmio_begin(apis.find(a => a.name === name).id);
    [0, ...args, 0, 0].forEach((v, i) => e.guest_write32(STACK + i * 4, v));
  }
  function parked(frame, info, size = 5) {
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.get_eip(), THUNK);
    assert.strictEqual(e.test_mmio_esp(), STACK);
    assert.deepStrictEqual(words(STACK, 6), frame, 'pending must preserve every stack argument');
    assert.deepStrictEqual(words(INFO, size), info, 'pending must restore caller struct exactly');
  }
  function done(result, pop) {
    assert.strictEqual(e.get_yield_reason(), 0);
    assert.strictEqual(e.get_eip(), 0);
    assert.strictEqual(e.test_mmio_esp(), STACK + pop);
    assert.strictEqual(e.test_mmio_eax(), result);
  }
  // Nonzero initial cursor, an unmatched RIFF first, then the matching RIFF.
  // A later miss must restore criteria overwritten while scanning the first.
  const chunk = form => { const b = Buffer.alloc(12); b.write('RIFF'); b.writeUInt32LE(4, 4); b.write(form, 8); return b; };
  const contents = Buffer.concat([Buffer.alloc(7), chunk('NOPE'), chunk('WAVE')]);
  function descend(bytes = contents) {
    begin('mmioDescend', [41, INFO, 0, 0x20]); data = bytes; cursor = 7;
    [0x11223344, 0x55667788, 0x45564157, 0x99, 0xAA].forEach((v, i) => e.guest_write32(INFO + i * 4, v));
  }
  for (const at of [7, 15, 19, 27]) {
    descend(); const frame = words(STACK, 6), info = words(INFO, 5); missAt = at;
    e.run(2); parked(frame, info); assert.strictEqual(cursor, at);
    e.test_mmio_resume(); parked(frame, info); assert.strictEqual(cursor, at);
    missAt = -1; e.test_mmio_resume(); done(0, 20);
    assert.strictEqual(cursor, 31);
    assert.deepStrictEqual(words(INFO, 5), [0x46464952, 4, 0x45564157, 27, 0]);
    assert.strictEqual(e.test_mmio_pending(),0);
  }
  for (const state of [0, 2]) for (const at of [7, 15, 27]) {
    descend(); missAt = at; missState = state; e.run(2); done(266, 20);
  }
  descend(Buffer.alloc(7)); e.run(2); done(514, 20);
  // Short form-type reads must not use the old WAVE criterion as file data.
  descend(contents.subarray(0, 29)); e.run(2); done(514, 20);
  descend(); missAt = 7; seekFails = true; e.run(2); done(266, 20);

  // Hundreds of RIFF headers cannot fit a two-page cache. Rewinding to the
  // original scan cursor on every miss livelocks; current-header resume ends.
  const many = Buffer.concat([...Array.from({length:300},()=>chunk('NOPE')),chunk('WAVE')]);
  let fetches = 0;
  lazyVfs = new VirtualFS();
  const cache = new ChunkCache({size:many.length,readRange:async(offset,length)=>{
    fetches++; return new Uint8Array(many.slice(offset,offset+length));
  }},{chunkSize:32,maxChunks:2,readAhead:0});
  lazyVfs.setProviderFile('c:\\riff',{provider:cache});
  const actualHandle = lazyVfs.createFile('c:\\riff',0x80000000,3);
  lazyVfs.handles.set(41,lazyVfs.handles.get(actualHandle));
  begin('mmioDescend',[41,INFO,0,0x20]);
  e.guest_write32(INFO+8,0x45564157);
  const originalInfo = words(INFO,5);
  let rounds = 0;
  for (;;) {
    e.test_mmio_resume();
    if (e.get_yield_reason() !== 12) break;
    assert(++rounds < 500,'tiny-cache scan must make forward progress');
    assert.deepStrictEqual(words(INFO,5),originalInfo);
    await lazyVfs.fillPendingRead(lazyPending);
  }
  done(0,20);
  assert.strictEqual(words(INFO,5)[3],300*12+8);
  assert(fetches <= 120, 'each small cache page is fetched a bounded number of times');
  assert.strictEqual(e.test_mmio_pending(),0);
  lazyVfs.files.clear(); lazyVfs = null;
  console.log(`PASS MMIO tiny-cache scan: 301 RIFF chunks, ${fetches} page reads, ${rounds} parks`);

  lazyVfs = new VirtualFS();
  const single = chunk('WAVE');
  const narrow = new ChunkCache({size:single.length,readRange:async(offset,length)=>new Uint8Array(single.slice(offset,offset+length))},
    {chunkSize:8,maxChunks:1,readAhead:0});
  lazyVfs.setProviderFile('c:\\one',{provider:narrow});
  const narrowHandle = lazyVfs.createFile('c:\\one',0x80000000,3);
  lazyVfs.handles.set(41,lazyVfs.handles.get(narrowHandle));
  begin('mmioDescend',[41,INFO,0,0x20]); e.guest_write32(INFO+8,0x45564157);
  let formRounds = 0;
  for (;;) {
    e.test_mmio_resume(); if (e.get_yield_reason() !== 12) break;
    assert(++formRounds <= 4,'form-type retry must not reread an evicted header');
    await lazyVfs.fillPendingRead(lazyPending);
  }
  done(0,20); assert.strictEqual(e.test_mmio_pending(),0);
  console.log(`PASS MMIO form retry: one 8-byte cache page, ${formRounds} parks, completed header retained`);
  lazyVfs.files.clear(); lazyVfs = null;

  function advance(bytes = Buffer.from('0123456789abcdef')) {
    begin('mmioAdvance', [41, INFO, 0]); data = bytes; cursor = 0;
    for (let i = 0; i < 18; i++) e.guest_write32(INFO + i * 4, 0xA0 + i);
    e.guest_write32(INFO + 20, 4); e.guest_write32(INFO + 24, BUFFER);
    e.guest_write32(INFO + 28, BUFFER + 2); e.guest_write32(INFO + 32, BUFFER + 4);
    e.guest_write32(INFO + 40, 3); // consumed two bytes from file offset3 => retry5
  }
  advance(); const frame = words(STACK, 6), info = words(INFO, 18); missAt = 5;
  e.run(2); parked(frame, info, 18); assert.strictEqual(cursor, 5);
  e.test_mmio_resume(); parked(frame, info, 18); assert.strictEqual(cursor, 5);
  missAt = -1; e.test_mmio_resume(); done(0, 16); assert.strictEqual(cursor, 9);
  assert.deepStrictEqual(words(INFO + 28, 2), [BUFFER, BUFFER + 4]);
  assert.deepStrictEqual(words(INFO + 40, 2), [5, 9]);
  assert.strictEqual(Buffer.from(Array.from({ length: 4 }, (_, i) => e.guest_read8(BUFFER + i))).toString(), '5678');
  for (const state of [0, 2]) {
    advance(); const before = words(INFO, 18); missAt = 5; missState = state;
    e.run(2); done(266, 16); assert.deepStrictEqual(words(INFO, 18), before);
  }
  advance(Buffer.from('01234')); e.run(2); done(0, 16);
  assert.deepStrictEqual(words(INFO + 28, 2), [BUFFER, BUFFER]);
  assert.deepStrictEqual(words(INFO + 40, 2), [5, 5]);
  advance(); seekFails = true; e.run(2); done(266, 16);
  console.log('PASS MMIO lazy navigation: current-header retries, original struct/frame, faults, EOF and buffered refill');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
